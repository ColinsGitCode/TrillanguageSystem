'use strict';

const defaultDbService = require('../storage/databaseService');
const defaultGenerationJobService = require('../generation/generationJobService');
const { KnowledgeGraphService } = require('../kg/application/knowledgeGraphService');
const { KG_ENABLED } = require('../../lib/serverConfig');
const log = require('../../lib/logger').child({ module: 'svc/activity' });

const ACTIVE_STATUSES = new Set(['queued', 'running']);
const ATTENTION_STATUSES = new Set(['needs_attention', 'failed', 'partially_failed']);
const DEFAULT_TERMINAL_WINDOW_MS = 24 * 60 * 60 * 1000;

function isoTimestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:/u.test(raw)
    ? `${raw.replace(' ', 'T')}Z`
    : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function publicStatus(status) {
  if (status === 'success' || status === 'succeeded') return 'succeeded';
  if (status === 'superseded') return 'cancelled';
  if (['queued', 'running', 'needs_attention', 'partially_failed', 'failed', 'cancelled'].includes(status)) return status;
  return 'failed';
}

function generationTitle(jobType) {
  if (jobType === 'trilingual') return '三语卡片生成';
  if (jobType === 'grammar_ja') return '日语语法卡生成';
  if (jobType === 'scenario_phrase') return '场景表达卡生成';
  return '学习卡生成';
}

function generationSummary(job) {
  if (job.status === 'queued') return `任务 #${job.id} 正在等待生成`;
  if (job.status === 'running') return `任务 #${job.id} 正在生成`;
  if (job.status === 'success') return `任务 #${job.id} 已生成并保存，可打开学习卡`;
  if (job.status === 'failed') return `任务 #${job.id} 生成失败，可打开任务队列重试`;
  return `任务 #${job.id} 已取消`;
}

function textbookTitle(operation) {
  const track = String(operation.track_title || '').trim() || `Track ${operation.track_number || operation.track_id}`;
  const action = operation.kind === 'release'
    ? '发布'
    : operation.kind === 'tts' ? '例句语音生成' : '内容同步';
  return `${track} · ${action}`;
}

function textbookSummary(operation) {
  const summary = String(operation.public_summary || '').trim();
  if (summary) return summary;
  if (operation.status === 'failed') return '教材后台任务失败，可打开处理页面重试';
  if (operation.status === 'partially_failed') return '教材后台任务部分失败，可重试失败步骤';
  if (operation.status === 'succeeded') return '教材后台任务已完成';
  if (operation.status === 'cancelled') return '教材后台任务已取消，已完成步骤仍然保留';
  return operation.status === 'running' ? '教材后台任务正在处理' : '教材后台任务正在等待';
}

function knowledgeSummary(job) {
  const source = job.sourceKind === 'textbook_expression' ? '教材表达' : '学习单元';
  if (job.status === 'queued') return `${source}索引正在等待同步`;
  if (job.status === 'running') return `${source}索引正在同步`;
  if (job.status === 'succeeded') return `${source}索引已同步`;
  if (job.status === 'failed') return `${source}索引同步失败，可打开知识点页面检查`;
  return `${source}索引任务已被较新版本替代`;
}

function textbookReviewSummary(review) {
  const pending = Number(review.pending || 0);
  const needsAttention = Number(review.needs_attention || 0);
  const total = Math.max(Number(review.review_total || 0), Number(review.expression_count || 0));
  if (review.track_status === 'verified') {
    return `${total} 条表达已完成校对，可以发布到学习与复习系统`;
  }
  if (needsAttention > 0) {
    return `${needsAttention} 条需重点检查，另有 ${pending} 条待确认`;
  }
  if (pending > 0) return `${pending}/${total} 条表达仍待人工确认`;
  return `${total} 条表达尚待人工校对`;
}

function withinTerminalWindow(item, nowMs, terminalWindowMs) {
  if (ACTIVE_STATUSES.has(item.status) || ATTENTION_STATUSES.has(item.status)) return true;
  const updatedMs = Date.parse(item.updatedAt || '');
  return Number.isFinite(updatedMs) && nowMs - updatedMs <= terminalWindowMs;
}

class ActivityService {
  constructor(options = {}) {
    this.dbService = options.dbService || defaultDbService;
    this.generationJobService = options.generationJobService || defaultGenerationJobService;
    this.kgEnabled = options.kgEnabled ?? KG_ENABLED;
    this.knowledgeGraphService = options.knowledgeGraphService || new KnowledgeGraphService({
      db: this.dbService.db,
      busyRetry: (operation) => this.dbService.withBusyRetry
        ? this.dbService.withBusyRetry(operation)
        : operation(),
    });
    this.now = options.now || (() => new Date());
    this.terminalWindowMs = Number(options.terminalWindowMs || DEFAULT_TERMINAL_WINDOW_MS);
    this.logger = options.logger || log;
  }

  _collect(source, reader, mapper) {
    try {
      return {
        source: { id: source, status: 'available' },
        items: (reader() || []).map(mapper).filter(Boolean),
      };
    } catch (error) {
      this.logger.warn({ err: error, source }, 'activity source unavailable');
      return {
        source: { id: source, status: 'degraded' },
        items: [],
      };
    }
  }

  _learningActivity() {
    const row = this.dbService.db.prepare(`
      SELECT session.id, session.queue_id, session.last_activity_at_utc,
        queue.learning_day,
        COUNT(entry.id) AS total,
        SUM(CASE WHEN entry.status IN ('completed', 'skipped') THEN 1 ELSE 0 END) AS completed
      FROM learning_sessions session
      JOIN learning_daily_queues queue ON queue.id = session.queue_id
      LEFT JOIN learning_queue_entries entry ON entry.queue_id = session.queue_id
      WHERE session.status = 'active'
      GROUP BY session.id
      LIMIT 1
    `).get();
    if (!row) return [];
    const completed = Number(row.completed || 0);
    const total = Number(row.total || 0);
    return [{
      id: String(row.id),
      kind: 'learning-session',
      status: 'running',
      title: '未结束的学习会话',
      summary: `本次已完成 ${completed}/${total}，可继续上次进度`,
      href: '/learn/session',
      updatedAt: isoTimestamp(row.last_activity_at_utc),
      source: 'learning',
      actionLabel: '继续学习',
    }];
  }

  _textbookReviewActivity(limit) {
    return this.dbService.listPendingTextbookReviews(limit).map((review) => ({
      id: `${review.track_id}:${review.revision_id}`,
      kind: 'textbook-review',
      status: 'needs_attention',
      title: review.track_status === 'verified'
        ? `${review.track_title} · 待发布`
        : `${review.track_title} · 待校对`,
      summary: textbookReviewSummary(review),
      href: `/textbooks?track=${review.track_id}&stage=${review.track_status === 'verified' ? 'release' : 'review'}`,
      updatedAt: isoTimestamp(review.updated_at_utc),
      source: 'textbooks',
      actionLabel: review.track_status === 'verified' ? '检查并发布' : '继续校对',
    }));
  }

  _knowledgeResolutionActivity() {
    if (!this.kgEnabled) return [];
    const cases = this.knowledgeGraphService.listResolutionCases({ status: 'open', limit: 1 });
    if (!cases.length) return [];
    const count = this.knowledgeGraphService.countResolutionCases({ status: 'open' });
    const latest = cases[0];
    return [{
      id: 'open',
      kind: 'knowledge-resolution',
      status: 'needs_attention',
      title: `${count} 个知识点待确认`,
      summary: `最近待确认：${latest.normalizedInput}。未经人工确认的候选不会进入正式知识点`,
      href: `/knowledge?mode=resolution&case=${latest.id}`,
      updatedAt: isoTimestamp(latest.updatedAtUtc),
      source: 'knowledge',
      actionLabel: '开始确认',
    }];
  }

  getFeed(options = {}) {
    const limit = Math.min(Math.max(Number(options.limit || 30), 1), 50);
    const generatedAt = this.now();
    const nowMs = generatedAt.getTime();
    const generation = this._collect(
      'generation',
      () => this.generationJobService.listJobs(Math.max(limit, 30)),
      (job) => ({
        id: String(job.id),
        kind: 'generation-job',
        status: publicStatus(job.status),
        title: generationTitle(job.jobType),
        summary: generationSummary(job),
        href: `/?queue=1&job=${job.id}`,
        updatedAt: isoTimestamp(job.finishedAt || job.startedAt || job.createdAt),
        source: 'generation',
        actionLabel: job.status === 'failed'
          ? '查看并重试'
          : job.status === 'success' ? '查看结果' : '查看任务',
      })
    );
    const textbooks = this._collect(
      'textbooks',
      () => [
        ...this.dbService.listRecentTextbookOperations(Math.max(limit, 30)).map((operation) => ({
          id: String(operation.id),
          kind: 'textbook-operation',
          status: publicStatus(operation.status),
          title: textbookTitle(operation),
          summary: textbookSummary(operation),
          href: `/textbooks?track=${operation.track_id}&stage=processing&operation=${operation.id}`,
          updatedAt: isoTimestamp(operation.updated_at_utc),
          source: 'textbooks',
          actionLabel: ATTENTION_STATUSES.has(operation.status)
            ? '查看并重试'
            : operation.status === 'cancelled' ? '查看并继续' : '查看处理',
        })),
        ...this._textbookReviewActivity(Math.min(limit, 10)),
      ],
      (item) => item
    );
    const learning = this._collect(
      'learning',
      () => this._learningActivity(),
      (item) => item
    );
    const knowledge = this._collect(
      'knowledge',
      () => this.kgEnabled ? [
          ...this.dbService.listKgSourceSyncJobs({ limit: Math.max(limit, 30) }).map((job) => ({
            id: String(job.id),
            kind: 'knowledge-sync',
            status: publicStatus(job.status),
            title: '知识索引同步',
            summary: knowledgeSummary(job),
            href: '/knowledge',
            updatedAt: isoTimestamp(job.finishedAtUtc || job.startedAtUtc || job.updatedAtUtc || job.createdAtUtc),
            source: 'knowledge',
            actionLabel: '查看知识点',
          })),
          ...this._knowledgeResolutionActivity(),
        ] : [],
      (item) => item
    );
    const sourceResults = [generation, textbooks, learning, knowledge];
    const items = sourceResults
      .flatMap((result) => result.items)
      .filter((item) => withinTerminalWindow(item, nowMs, this.terminalWindowMs))
      .sort((left, right) => Date.parse(right.updatedAt || '') - Date.parse(left.updatedAt || ''))
      .slice(0, limit);
    return {
      items,
      summary: {
        active: items.filter((item) => ACTIVE_STATUSES.has(item.status)).length,
        needsAttention: items.filter((item) => ATTENTION_STATUSES.has(item.status)).length,
        total: items.length,
      },
      sources: sourceResults.map((result) => result.source),
      generatedAtUtc: generatedAt.toISOString(),
    };
  }
}

const activityService = new ActivityService();

module.exports = activityService;
module.exports.ActivityService = ActivityService;
module.exports.isoTimestamp = isoTimestamp;
module.exports.publicStatus = publicStatus;
