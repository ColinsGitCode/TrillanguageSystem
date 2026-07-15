'use strict';

const crypto = require('node:crypto');
const { Temporal } = require('@js-temporal/polyfill');
const { isSqliteBusyError } = require('../../storage/sqliteBusyRetry');
const { TsFsrsScheduler, stableJson } = require('../scheduling/tsFsrsScheduler');
const { DEFAULT_TIME_ZONE, dayBounds, learningDay, validateTimeZone } = require('../time/learningTime');
const { learningError } = require('../domain/learningErrors');
const { DEFAULT_SCOPE, itemMatchesScope, normalizeScope } = require('../domain/planScope');
const { createDefaultPlanningSignalProvider } = require('../planning/defaultPlanningSignalProvider');
const { CONTRACT_VERSION, mergePlanningDiagnostics } = require('../planning/planningSignalProvider');
const {
  extractStudyUnitMarkdown,
  labeledValue,
  scenarioAudioMatches,
} = require('../domain/studyItemContent');

const DEFAULT_ACTION_GOAL = 20;
const DEFAULT_NEW_LIMIT = 5;
const HISTORY_PRESETS = new Map([
  ['7', 7],
  ['30', 30],
  ['90', 90],
  ['all', null],
]);
const UNIT_KINDS = new Set([
  'trilingual_en',
  'trilingual_ja',
  'grammar_ja',
  'scenario_bilingual',
  'textbook_en',
  'textbook_ja',
  'whole_card',
]);

function parseJson(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function integer(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw learningError('LEARNING_INVALID_REQUEST', `${field} must be an integer from ${min} to ${max}`, 400);
  }
  return parsed;
}

function isoInstant(value, field = 'instant') {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw learningError('LEARNING_INVALID_REQUEST', `${field} must be a valid UTC instant`, 400);
  }
  return parsed.toISOString();
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function dateSequence(startDay, endDay) {
  const days = [];
  let cursor = Temporal.PlainDate.from(startDay);
  const end = Temporal.PlainDate.from(endDay);
  while (Temporal.PlainDate.compare(cursor, end) <= 0) {
    days.push(cursor.toString());
    cursor = cursor.add({ days: 1 });
  }
  return days;
}

function mapSchedule(row) {
  if (!row || row.schedule_version === null || row.schedule_version === undefined) return null;
  return {
    studyItemId: Number(row.study_item_id),
    fsrsState: row.fsrs_state,
    dueAtUtc: row.due_at_utc,
    lastReviewedAtUtc: row.last_reviewed_at_utc,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsedDays: Number(row.elapsed_days || 0),
    scheduledDays: Number(row.scheduled_days || 0),
    reps: Number(row.reps || 0),
    lapses: Number(row.lapses || 0),
    step: Number(row.step || 0),
    version: Number(row.schedule_version || 0),
    lastEventId: row.schedule_last_event_id ? Number(row.schedule_last_event_id) : null,
    algorithmId: row.schedule_algorithm_id,
    algorithmVersion: row.schedule_algorithm_version,
    parametersHash: row.schedule_parameters_hash,
    updatedAtUtc: row.schedule_updated_at_utc,
  };
}

function schedulerState(schedule) {
  if (!schedule) return null;
  return {
    fsrsState: schedule.fsrsState,
    dueAtUtc: schedule.dueAtUtc,
    lastReviewedAtUtc: schedule.lastReviewedAtUtc,
    stability: schedule.stability,
    difficulty: schedule.difficulty,
    elapsedDays: schedule.elapsedDays,
    scheduledDays: schedule.scheduledDays,
    reps: schedule.reps,
    lapses: schedule.lapses,
    step: schedule.step,
  };
}

function buildQueueCandidates(
  rows,
  tagsByGeneration,
  scope,
  bounds,
  nowUtc,
  dailyNewLimit,
  dailyActionGoal = Number.MAX_SAFE_INTEGER,
  completedActions = 0,
  planningSignalProvider = null,
  tagSignalsByGeneration = new Map()
) {
  const nowMs = Date.parse(nowUtc);
  const startMs = Date.parse(bounds.startUtc);
  const endMs = Date.parse(bounds.endUtc);
  const due = [];
  const fresh = [];
  const rowsByStudyItem = new Map(rows.map((row) => [Number(row.study_item_id), row]));

  for (const row of rows) {
    if (!itemMatchesScope(row, scope, tagsByGeneration.get(Number(row.generation_id)) || new Set())) continue;
    const schedule = mapSchedule(row);
    if (!schedule) {
      fresh.push({
        studyItemId: Number(row.study_item_id),
        reason: 'new',
        bucket: 6,
        availableAtUtc: nowUtc,
        dueAtUtc: null,
        providerScore: null,
        explanation: {
          code: 'new',
          label: '新内容',
          provider: { id: 'base-policy', version: '1', score: null },
        },
      });
      continue;
    }
    const dueMs = Date.parse(schedule.dueAtUtc);
    if (!Number.isFinite(dueMs) || dueMs >= endMs) continue;
    const recentlyFailed = Number(row.last_rating || 0) === 1 || Number(row.last_rating || 0) === 2;
    const overdue = dueMs < startMs;
    const bucket = overdue ? (recentlyFailed ? 1 : 2) : (recentlyFailed ? 3 : 4);
    due.push({
      studyItemId: Number(row.study_item_id),
      reason: overdue ? (recentlyFailed ? 'overdue-recent-failure' : 'overdue')
        : (recentlyFailed ? 'due-today-recent-failure' : 'due-today'),
      bucket,
      availableAtUtc: schedule.dueAtUtc,
      dueAtUtc: schedule.dueAtUtc,
      providerScore: null,
      explanation: {
        code: overdue ? 'overdue' : 'due-today',
        label: overdue ? '已逾期' : '今日到期',
        recentlyFailed,
        provider: { id: 'base-policy', version: '1', score: null },
      },
    });
  }

  const compare = (a, b) => a.bucket - b.bucket
    || String(a.availableAtUtc || '').localeCompare(String(b.availableAtUtc || ''))
    || String(a.dueAtUtc || '9999').localeCompare(String(b.dueAtUtc || '9999'))
    || a.studyItemId - b.studyItemId;
  due.sort(compare);
  fresh.sort((a, b) => a.studyItemId - b.studyItemId);
  const remainingGoalSlots = Math.max(0, dailyActionGoal - completedActions - due.length);
  const selectedFresh = fresh.slice(0, Math.min(dailyNewLimit, remainingGoalSlots));
  const entries = [...due, ...selectedFresh];
  const providerDiagnostics = planningSignalProvider?.createDiagnostics?.() || {};
  for (const entry of entries) {
    if (!planningSignalProvider) continue;
    const row = rowsByStudyItem.get(entry.studyItemId);
    const evaluation = planningSignalProvider.evaluate({
      studyItemId: entry.studyItemId,
      unitKind: row.unit_kind,
      cardType: row.card_type,
      generationDate: row.generation_date,
      folderName: row.folder_name,
      sourceTitle: row.source_title,
      tags: tagSignalsByGeneration.get(Number(row.generation_id)) || [],
      reviewEvidence: {
        lastRating: row.last_rating === null || row.last_rating === undefined ? null : Number(row.last_rating),
        reps: Number(row.reps || 0),
        lapses: Number(row.lapses || 0),
        difficulty: row.difficulty === null || row.difficulty === undefined ? null : Number(row.difficulty),
      },
    }, {
      reason: entry.reason,
      priorityBucket: entry.bucket,
      nowUtc,
      dayBounds: bounds,
    });
    mergePlanningDiagnostics(providerDiagnostics, evaluation.diagnostics);
    if (evaluation.score === null) continue;
    entry.providerScore = evaluation.score;
    entry.explanation.provider = {
      contractVersion: CONTRACT_VERSION,
      id: 'planning-signal-composite',
      version: '1',
      score: evaluation.score,
      sources: evaluation.signals,
    };
  }
  entries.sort((a, b) => a.bucket - b.bucket
    || String(a.availableAtUtc || '').localeCompare(String(b.availableAtUtc || ''))
    || String(a.dueAtUtc || '9999').localeCompare(String(b.dueAtUtc || '9999'))
    || Number(b.providerScore || 0) - Number(a.providerScore || 0)
    || a.studyItemId - b.studyItemId);
  return {
    entries,
    summary: {
      due: due.length,
      new: selectedFresh.length,
      newAvailable: fresh.length,
      deferredToday: due.filter((entry) => Date.parse(entry.availableAtUtc) > nowMs).length,
    },
    planning: {
      ...(planningSignalProvider?.describe?.() || { contractVersion: CONTRACT_VERSION, providers: [] }),
      diagnostics: providerDiagnostics,
    },
  };
}

class LearningService {
  constructor({
    db,
    scheduler = new TsFsrsScheduler(),
    planningSignalProvider = createDefaultPlanningSignalProvider(),
    now = () => new Date().toISOString(),
    busyRetry,
  } = {}) {
    if (!db) throw new TypeError('LearningService requires a SQLite database');
    this.db = db;
    this.scheduler = scheduler;
    this.planningSignalProvider = planningSignalProvider;
    this.now = now;
    this.busyRetry = busyRetry || ((operation) => operation());
  }

  _now() {
    return isoInstant(this.now(), 'server time');
  }

  _write(operation) {
    try {
      return this.busyRetry(() => this.db.transaction(operation)());
    } catch (error) {
      if (isSqliteBusyError(error)) {
        throw learningError('LEARNING_STORAGE_BUSY', 'Learning storage is busy; retry the complete request', 503);
      }
      throw error;
    }
  }

  _activeSessionRow() {
    return this.db.prepare("SELECT * FROM learning_sessions WHERE status = 'active' LIMIT 1").get() || null;
  }

  _assertNoActiveSession() {
    const active = this._activeSessionRow();
    if (active) {
      throw learningError(
        'LEARNING_ACTIVE_SESSION_CONFLICT',
        'End the active learning session before changing the plan',
        409,
        { sessionId: Number(active.id) }
      );
    }
  }

  _profileDto(row) {
    if (!row) {
      const description = this.scheduler.describe();
      return {
        persisted: false,
        timeZone: DEFAULT_TIME_ZONE,
        schedulerId: description.algorithmId,
        schedulerVersion: description.algorithmVersion,
        schedulerAdapter: description.adapterId,
        parametersHash: description.parametersHash,
        revision: 0,
      };
    }
    return {
      persisted: true,
      timeZone: row.time_zone,
      schedulerId: row.scheduler_id,
      schedulerVersion: row.scheduler_version,
      schedulerAdapter: row.scheduler_adapter,
      parametersHash: row.parameters_hash,
      revision: Number(row.revision),
      updatedAtUtc: row.updated_at_utc,
    };
  }

  _ensureProfile(nowUtc, requestedTimeZone = DEFAULT_TIME_ZONE) {
    const timeZone = validateTimeZone(requestedTimeZone);
    const existing = this.db.prepare('SELECT * FROM learning_profiles WHERE id = 1').get();
    const description = this.scheduler.describe();
    if (!existing) {
      this.db.prepare(`
        INSERT INTO learning_profiles(
          id, time_zone, scheduler_id, scheduler_version, scheduler_adapter,
          parameters_json, parameters_hash, revision, created_at_utc, updated_at_utc
        ) VALUES (1, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        timeZone,
        description.algorithmId,
        description.algorithmVersion,
        `${description.adapterId}@${description.adapterVersion}`,
        stableJson(description.parameters),
        description.parametersHash,
        nowUtc,
        nowUtc
      );
      return this.db.prepare('SELECT * FROM learning_profiles WHERE id = 1').get();
    }
    if (existing.time_zone !== timeZone) {
      this.db.prepare(`
        UPDATE learning_profiles
        SET time_zone = ?, revision = revision + 1, updated_at_utc = ?
        WHERE id = 1
      `).run(timeZone, nowUtc);
      this.db.prepare(`
        UPDATE learning_daily_queues
        SET status = 'superseded', updated_at_utc = ?
        WHERE status = 'ready'
      `).run(nowUtc);
    }
    return this.db.prepare('SELECT * FROM learning_profiles WHERE id = 1').get();
  }

  _planDto(row) {
    if (!row) return null;
    return {
      id: Number(row.id),
      status: row.status,
      scope: parseJson(row.scope_json, DEFAULT_SCOPE),
      dailyActionGoal: Number(row.daily_action_goal),
      dailyNewLimit: Number(row.daily_new_limit),
      revision: Number(row.revision),
      createdAtUtc: row.created_at_utc,
      updatedAtUtc: row.updated_at_utc,
    };
  }

  _candidateRows() {
    return this.db.prepare(`
      SELECT
        si.id AS study_item_id, si.generation_id, si.source_generation_id,
        si.unit_kind, si.unit_locator_json, si.lifecycle, g.card_type, g.generation_date,
        g.folder_name, g.phrase AS source_title,
        ss.fsrs_state, ss.due_at_utc, ss.last_reviewed_at_utc,
        ss.stability, ss.difficulty, ss.elapsed_days, ss.scheduled_days,
        ss.reps, ss.lapses, ss.step, ss.version AS schedule_version,
        ss.last_event_id AS schedule_last_event_id,
        ss.algorithm_id AS schedule_algorithm_id,
        ss.algorithm_version AS schedule_algorithm_version,
        ss.parameters_hash AS schedule_parameters_hash,
        ss.updated_at_utc AS schedule_updated_at_utc,
        (
          SELECT rating FROM learning_review_events event
          WHERE event.study_item_id = si.id
          ORDER BY event.id DESC LIMIT 1
        ) AS last_rating
      FROM study_items si
      JOIN generations g ON g.id = si.generation_id
      JOIN learning_source_admissions admission ON admission.generation_id = si.generation_id
      LEFT JOIN learning_schedule_states ss ON ss.study_item_id = si.id
      WHERE si.lifecycle = 'active'
        AND admission.status IN ('eligible', 'whole-card-only')
        AND admission.materialization_disposition IN ('create-items', 'adopt-existing')
      ORDER BY si.id
    `).all();
  }

  _tagsByGeneration(rows) {
    return this._tagDataByGeneration(rows).keys;
  }

  _tagDataByGeneration(rows) {
    const ids = [...new Set(rows.map((row) => Number(row.generation_id)))];
    const keys = new Map(ids.map((id) => [id, new Set()]));
    const signals = new Map(ids.map((id) => [id, []]));
    if (!ids.length) return { keys, signals };
    const tags = this.db.prepare(`
      SELECT generation_id, namespace, value, normalized_value, source,
             rule_version, rule_key, evidence_json
      FROM card_tags
      WHERE status = 'active' AND generation_id IN (${ids.map(() => '?').join(',')})
      ORDER BY generation_id, namespace, normalized_value
    `).all(...ids);
    for (const tag of tags) {
      const generationId = Number(tag.generation_id);
      keys.get(generationId)?.add(`${tag.namespace}:${String(tag.normalized_value).toLowerCase()}`);
      signals.get(generationId)?.push({
        namespace: tag.namespace,
        value: tag.value,
        normalizedValue: String(tag.normalized_value).toLowerCase(),
        source: tag.source,
        ruleVersion: tag.rule_version,
        ruleKey: tag.rule_key,
        evidence: parseJson(tag.evidence_json, null),
      });
    }
    return { keys, signals };
  }

  _scopePreview(scope) {
    const rows = this._candidateRows();
    const tags = this._tagsByGeneration(rows);
    const matching = rows.filter((row) => itemMatchesScope(row, scope, tags.get(Number(row.generation_id)) || new Set()));
    const byKind = {};
    for (const row of matching) byKind[row.unit_kind] = (byKind[row.unit_kind] || 0) + 1;
    return {
      generationCount: new Set(matching.map((row) => Number(row.generation_id))).size,
      studyItemCount: matching.length,
      byKind,
    };
  }

  _admissionSummary() {
    const rows = this.db.prepare(`
      SELECT status, COUNT(*) AS count
      FROM learning_source_admissions
      GROUP BY status
    `).all();
    return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
  }

  previewPlan(input = {}) {
    const scope = normalizeScope(input.scope || DEFAULT_SCOPE);
    return {
      scope,
      scopePreview: this._scopePreview(scope),
      admissionSummary: this._admissionSummary(),
    };
  }

  getScopeOptions() {
    const rows = this._candidateRows();
    const generationIds = [...new Set(rows.map((row) => Number(row.generation_id)))];
    const tags = generationIds.length ? this.db.prepare(`
      SELECT namespace, normalized_value AS value, COUNT(DISTINCT generation_id) AS generation_count
      FROM card_tags
      WHERE status = 'active' AND generation_id IN (${generationIds.map(() => '?').join(',')})
      GROUP BY namespace, normalized_value
      ORDER BY namespace, generation_count DESC, normalized_value
    `).all(...generationIds) : [];
    const dates = rows.length ? this.db.prepare(`
      SELECT MIN(generation_date) AS min_date, MAX(generation_date) AS max_date
      FROM generations
      WHERE id IN (${generationIds.map(() => '?').join(',')})
    `).get(...generationIds) : { min_date: null, max_date: null };
    const textbookTracks = this.db.prepare(`
      SELECT t.id, t.track_number, t.title, t.status, c.course_key, c.title AS course_title,
        COUNT(si.id) AS study_item_count
      FROM textbook_tracks t
      JOIN textbook_courses c ON c.id = t.course_id
      JOIN study_items si ON si.generation_id = t.generation_id
      WHERE t.status = 'published'
        AND si.lifecycle = 'active'
        AND si.unit_kind IN ('textbook_en', 'textbook_ja')
      GROUP BY t.id
      ORDER BY c.course_key, t.display_order, t.track_number
    `).all();
    return {
      dateRange: { min: dates?.min_date || null, max: dates?.max_date || null },
      tags: tags.map((row) => ({
        namespace: row.namespace,
        value: row.value,
        generationCount: Number(row.generation_count),
      })),
      textbookTracks: textbookTracks.map((row) => ({
        id: Number(row.id),
        trackNumber: Number(row.track_number),
        title: row.title,
        status: row.status,
        courseKey: row.course_key,
        courseTitle: row.course_title,
        studyItemCount: Number(row.study_item_count || 0),
      })),
    };
  }

  getPlan() {
    const plan = this.db.prepare('SELECT * FROM learning_plans WHERE id = 1').get() || null;
    const profile = this.db.prepare('SELECT * FROM learning_profiles WHERE id = 1').get() || null;
    const scope = plan ? parseJson(plan.scope_json, DEFAULT_SCOPE) : normalizeScope(DEFAULT_SCOPE);
    return {
      plan: this._planDto(plan),
      profile: this._profileDto(profile),
      scopePreview: this._scopePreview(scope),
      admissionSummary: this._admissionSummary(),
      defaults: { dailyActionGoal: DEFAULT_ACTION_GOAL, dailyNewLimit: DEFAULT_NEW_LIMIT, scope: normalizeScope(DEFAULT_SCOPE) },
    };
  }

  putPlan(input = {}) {
    const scope = normalizeScope(input.scope || DEFAULT_SCOPE);
    const dailyActionGoal = integer(input.dailyActionGoal ?? DEFAULT_ACTION_GOAL, 'dailyActionGoal', { min: 5, max: 100 });
    const dailyNewLimit = integer(input.dailyNewLimit ?? DEFAULT_NEW_LIMIT, 'dailyNewLimit', { min: 0, max: 50 });
    const expectedRevision = integer(input.expectedRevision ?? 0, 'expectedRevision', { min: 0 });
    const timeZone = validateTimeZone(input.timeZone || DEFAULT_TIME_ZONE);
    const nowUtc = this._now();

    this._write(() => {
      this._assertNoActiveSession();
      const existing = this.db.prepare('SELECT * FROM learning_plans WHERE id = 1').get();
      const actualRevision = existing ? Number(existing.revision) : 0;
      if (actualRevision !== expectedRevision) {
        throw learningError(
          'LEARNING_PLAN_REVISION_CONFLICT',
          'The learning plan changed; reload it before saving',
          409,
          { expectedRevision, actualRevision }
        );
      }
      this._ensureProfile(nowUtc, timeZone);
      if (!existing) {
        this.db.prepare(`
          INSERT INTO learning_plans(
            id, status, scope_json, daily_action_goal, daily_new_limit,
            revision, created_at_utc, updated_at_utc
          ) VALUES (1, 'active', ?, ?, ?, 1, ?, ?)
        `).run(stableJson(scope), dailyActionGoal, dailyNewLimit, nowUtc, nowUtc);
      } else {
        this.db.prepare(`
          UPDATE learning_plans
          SET status = 'active', scope_json = ?, daily_action_goal = ?, daily_new_limit = ?,
              revision = revision + 1, updated_at_utc = ?
          WHERE id = 1
        `).run(stableJson(scope), dailyActionGoal, dailyNewLimit, nowUtc);
      }
      this.db.prepare(`
        UPDATE learning_daily_queues
        SET status = 'superseded', updated_at_utc = ?
        WHERE status = 'ready'
      `).run(nowUtc);
    });
    return this.getPlan();
  }

  setPlanStatus(status) {
    if (!['active', 'paused'].includes(status)) throw new TypeError('Unsupported plan status');
    const nowUtc = this._now();
    this._write(() => {
      this._assertNoActiveSession();
      const existing = this.db.prepare('SELECT * FROM learning_plans WHERE id = 1').get();
      if (!existing) throw learningError('LEARNING_PLAN_REQUIRED', 'Create a learning plan first', 404);
      if (existing.status === status) return;
      this.db.prepare(`
        UPDATE learning_plans SET status = ?, revision = revision + 1, updated_at_utc = ? WHERE id = 1
      `).run(status, nowUtc);
      this.db.prepare(`
        UPDATE learning_daily_queues SET status = 'superseded', updated_at_utc = ? WHERE status = 'ready'
      `).run(nowUtc);
    });
    return this.getPlan();
  }

  _queueProgress(queueId) {
    const counts = this.db.prepare(`
      SELECT status, COUNT(*) AS count FROM learning_queue_entries
      WHERE queue_id = ? GROUP BY status
    `).all(queueId);
    const byStatus = Object.fromEntries(counts.map((row) => [row.status, Number(row.count)]));
    const total = Object.values(byStatus).reduce((sum, value) => sum + value, 0);
    const queue = this.db.prepare(`
      SELECT q.*, p.daily_action_goal FROM learning_daily_queues q
      JOIN learning_plans p ON p.id = q.plan_id WHERE q.id = ?
    `).get(queueId);
    const actionCount = queue ? Number(this.db.prepare(`
      SELECT COUNT(*) AS count FROM learning_review_events
      WHERE learning_day = ? AND time_zone = ?
    `).get(queue.learning_day, queue.time_zone).count) : 0;
    return {
      total,
      byStatus,
      actionCount,
      actionGoal: Number(queue?.daily_action_goal || 0),
      goalReached: Boolean(queue && actionCount >= Number(queue.daily_action_goal)),
    };
  }

  _queueDto(row, { includeEntries = true } = {}) {
    if (!row) return null;
    const dto = {
      id: Number(row.id),
      planId: Number(row.plan_id),
      learningDay: row.learning_day,
      timeZone: row.time_zone,
      planRevision: Number(row.plan_revision),
      profileRevision: Number(row.profile_revision),
      status: row.status,
      snapshot: parseJson(row.snapshot_json, {}),
      progress: this._queueProgress(Number(row.id)),
      createdAtUtc: row.created_at_utc,
      updatedAtUtc: row.updated_at_utc,
    };
    if (includeEntries) {
      dto.entries = this.db.prepare(`
        SELECT entry.id, entry.study_item_id, entry.reason, entry.bucket,
               entry.provider_score, entry.explanation_json, entry.available_at_utc,
               entry.due_at_utc, entry.status, entry.attempts, entry.last_event_id,
               item.unit_kind, item.unit_key, generation.phrase AS source_title,
               generation.card_type
        FROM learning_queue_entries entry
        JOIN study_items item ON item.id = entry.study_item_id
        LEFT JOIN generations generation ON generation.id = item.generation_id
        WHERE entry.queue_id = ?
        ORDER BY entry.bucket, COALESCE(entry.available_at_utc, ''),
                 COALESCE(entry.due_at_utc, ''), COALESCE(entry.provider_score, 0) DESC,
                 entry.study_item_id
      `).all(row.id).map((entry) => this._entryDto(entry));
    }
    return dto;
  }

  _entryDto(row) {
    if (!row) return null;
    return {
      id: Number(row.id),
      studyItemId: Number(row.study_item_id),
      reason: row.reason,
      bucket: Number(row.bucket),
      providerScore: row.provider_score,
      explanation: parseJson(row.explanation_json, {}),
      availableAtUtc: row.available_at_utc,
      dueAtUtc: row.due_at_utc,
      status: row.status,
      attempts: Number(row.attempts),
      lastEventId: row.last_event_id ? Number(row.last_event_id) : null,
      itemSummary: row.unit_kind ? {
        unitKind: row.unit_kind,
        unitKey: row.unit_key,
        title: row.source_title,
        cardType: row.card_type,
      } : null,
    };
  }

  ensureTodayQueue() {
    const nowUtc = this._now();
    let queueId;
    this._write(() => {
      const plan = this.db.prepare('SELECT * FROM learning_plans WHERE id = 1').get();
      if (!plan) throw learningError('LEARNING_PLAN_REQUIRED', 'Create a learning plan first', 404);
      if (plan.status !== 'active') throw learningError('LEARNING_PLAN_PAUSED', 'Resume the learning plan before creating a queue', 409);
      const currentProfile = this.db.prepare('SELECT * FROM learning_profiles WHERE id = 1').get();
      const profile = this._ensureProfile(nowUtc, currentProfile?.time_zone || DEFAULT_TIME_ZONE);
      const day = learningDay(nowUtc, profile.time_zone);
      const existing = this.db.prepare(`
        SELECT * FROM learning_daily_queues
        WHERE plan_id = 1 AND learning_day = ? AND plan_revision = ? AND profile_revision = ?
      `).get(day, plan.revision, profile.revision);
      if (existing) {
        queueId = Number(existing.id);
        return;
      }
      const scope = normalizeScope(parseJson(plan.scope_json, DEFAULT_SCOPE));
      const rows = this._candidateRows();
      const tagData = this._tagDataByGeneration(rows);
      const bounds = dayBounds(day, profile.time_zone);
      const completedActions = Number(this.db.prepare(`
        SELECT COUNT(*) AS count FROM learning_review_events
        WHERE learning_day = ? AND time_zone = ?
      `).get(day, profile.time_zone).count);
      const selection = buildQueueCandidates(
        rows,
        tagData.keys,
        scope,
        bounds,
        nowUtc,
        Number(plan.daily_new_limit),
        Number(plan.daily_action_goal),
        completedActions,
        this.planningSignalProvider,
        tagData.signals
      );
      this.db.prepare(`
        UPDATE learning_daily_queues SET status = 'superseded', updated_at_utc = ?
        WHERE plan_id = 1 AND learning_day = ? AND status = 'ready'
      `).run(nowUtc, day);
      const snapshot = {
        version: 2,
        scope,
        summary: selection.summary,
        dailyActionGoal: Number(plan.daily_action_goal),
        dailyNewLimit: Number(plan.daily_new_limit),
        completedActionsBeforeBuild: completedActions,
        planning: selection.planning,
        builtAtUtc: nowUtc,
      };
      const result = this.db.prepare(`
        INSERT INTO learning_daily_queues(
          plan_id, learning_day, time_zone, plan_revision, profile_revision,
          status, snapshot_json, created_at_utc, updated_at_utc
        ) VALUES (1, ?, ?, ?, ?, 'ready', ?, ?, ?)
      `).run(day, profile.time_zone, plan.revision, profile.revision, stableJson(snapshot), nowUtc, nowUtc);
      queueId = Number(result.lastInsertRowid);
      const insert = this.db.prepare(`
        INSERT INTO learning_queue_entries(
          queue_id, study_item_id, reason, bucket, provider_score, explanation_json,
          available_at_utc, due_at_utc, status, attempts, created_at_utc, updated_at_utc
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
      `);
      for (const entry of selection.entries) {
        insert.run(
          queueId,
          entry.studyItemId,
          entry.reason,
          entry.bucket,
          entry.providerScore,
          stableJson(entry.explanation),
          entry.availableAtUtc,
          entry.dueAtUtc,
          nowUtc,
          nowUtc
        );
      }
    });
    return this._queueDto(this.db.prepare('SELECT * FROM learning_daily_queues WHERE id = ?').get(queueId));
  }

  getTodayQueue() {
    const plan = this.db.prepare('SELECT * FROM learning_plans WHERE id = 1').get();
    const profile = this.db.prepare('SELECT * FROM learning_profiles WHERE id = 1').get();
    if (!plan || !profile) return { queue: null, emptyReason: 'not-created' };
    const day = learningDay(this._now(), profile.time_zone);
    const row = this.db.prepare(`
      SELECT * FROM learning_daily_queues
      WHERE plan_id = 1 AND learning_day = ? AND plan_revision = ? AND profile_revision = ?
      ORDER BY id DESC LIMIT 1
    `).get(day, plan.revision, profile.revision);
    return row ? { queue: this._queueDto(row) } : { queue: null, emptyReason: 'not-ensured' };
  }

  _nextEntry(queueId, nowUtc) {
    return this.db.prepare(`
      SELECT * FROM learning_queue_entries
      WHERE queue_id = ? AND status IN ('pending', 'deferred')
        AND (available_at_utc IS NULL OR available_at_utc <= ?)
      ORDER BY bucket, COALESCE(available_at_utc, ''), COALESCE(due_at_utc, ''),
               COALESCE(provider_score, 0) DESC, study_item_id
      LIMIT 1
    `).get(queueId, nowUtc) || null;
  }

  _nextAvailableAt(queueId) {
    return this.db.prepare(`
      SELECT MIN(available_at_utc) AS value FROM learning_queue_entries
      WHERE queue_id = ? AND status IN ('pending', 'deferred')
    `).get(queueId).value || null;
  }

  _sessionDto(row) {
    if (!row) return null;
    const current = row.current_entry_id
      ? this.db.prepare('SELECT * FROM learning_queue_entries WHERE id = ?').get(row.current_entry_id)
      : null;
    return {
      id: Number(row.id),
      queueId: Number(row.queue_id),
      status: row.status,
      currentEntry: this._entryDto(current),
      revealedEntryId: row.revealed_entry_id ? Number(row.revealed_entry_id) : null,
      revealedAtUtc: row.revealed_at_utc,
      nextAvailableAtUtc: current ? null : this._nextAvailableAt(Number(row.queue_id)),
      startedAtUtc: row.started_at_utc,
      lastActivityAtUtc: row.last_activity_at_utc,
      endedAtUtc: row.ended_at_utc,
      queueProgress: this._queueProgress(Number(row.queue_id)),
      reviewSummary: this._sessionReviewSummary(Number(row.id)),
    };
  }

  _sessionReviewSummary(sessionId) {
    const rows = this.db.prepare(`
      SELECT rating, COUNT(*) AS count
      FROM learning_review_events
      WHERE session_id = ?
      GROUP BY rating
    `).all(sessionId);
    const byRating = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const row of rows) byRating[Number(row.rating)] = Number(row.count);
    return {
      total: Object.values(byRating).reduce((sum, count) => sum + count, 0),
      byRating,
    };
  }

  _activateNext(sessionId, queueId, nowUtc) {
    const next = this._nextEntry(queueId, nowUtc);
    if (next) {
      this.db.prepare(`UPDATE learning_queue_entries SET status = 'active', updated_at_utc = ? WHERE id = ?`)
        .run(nowUtc, next.id);
      this.db.prepare(`
        UPDATE learning_sessions
        SET current_entry_id = ?, revealed_entry_id = NULL, revealed_at_utc = NULL,
            last_activity_at_utc = ? WHERE id = ?
      `).run(next.id, nowUtc, sessionId);
      return this.db.prepare('SELECT * FROM learning_queue_entries WHERE id = ?').get(next.id);
    }
    this.db.prepare(`
      UPDATE learning_sessions
      SET current_entry_id = NULL, revealed_entry_id = NULL, revealed_at_utc = NULL,
          last_activity_at_utc = ? WHERE id = ?
    `).run(nowUtc, sessionId);
    return null;
  }

  getActiveSession() {
    const row = this._activeSessionRow();
    return { session: this._sessionDto(row) };
  }

  startSession(input = {}) {
    const nowUtc = this._now();
    let sessionId = null;
    let resumed = false;
    this._write(() => {
      const active = this._activeSessionRow();
      if (active) {
        sessionId = Number(active.id);
        resumed = true;
        if (!active.current_entry_id) this._activateNext(sessionId, Number(active.queue_id), nowUtc);
        return;
      }
      let queue;
      if (input.queueId !== undefined) {
        const queueId = integer(input.queueId, 'queueId', { min: 1 });
        queue = this.db.prepare('SELECT * FROM learning_daily_queues WHERE id = ?').get(queueId);
      } else {
        const plan = this.db.prepare('SELECT * FROM learning_plans WHERE id = 1').get();
        const profile = this.db.prepare('SELECT * FROM learning_profiles WHERE id = 1').get();
        if (plan && profile) {
          const day = learningDay(nowUtc, profile.time_zone);
          queue = this.db.prepare(`
            SELECT * FROM learning_daily_queues
            WHERE plan_id = 1 AND learning_day = ? AND plan_revision = ? AND profile_revision = ?
            ORDER BY id DESC LIMIT 1
          `).get(day, plan.revision, profile.revision);
        }
      }
      if (!queue) throw learningError('LEARNING_QUEUE_NOT_FOUND', 'Ensure today\'s queue before starting a session', 404);
      if (!['ready', 'active'].includes(queue.status)) {
        throw learningError('LEARNING_QUEUE_NOT_AVAILABLE', 'The selected queue is not available', 409);
      }
      const unfinished = Number(this.db.prepare(`
        SELECT COUNT(*) AS count FROM learning_queue_entries
        WHERE queue_id = ? AND status IN ('pending', 'deferred', 'skipped', 'active')
      `).get(queue.id).count);
      if (unfinished === 0) {
        this.db.prepare(`UPDATE learning_daily_queues SET status = 'completed', updated_at_utc = ? WHERE id = ?`)
          .run(nowUtc, queue.id);
        return;
      }
      this.db.prepare(`
        UPDATE learning_queue_entries SET status = 'pending', updated_at_utc = ?
        WHERE queue_id = ? AND status IN ('skipped', 'active')
      `).run(nowUtc, queue.id);
      const inserted = this.db.prepare(`
        INSERT INTO learning_sessions(
          queue_id, status, current_entry_id, started_at_utc, last_activity_at_utc
        ) VALUES (?, 'active', NULL, ?, ?)
      `).run(queue.id, nowUtc, nowUtc);
      sessionId = Number(inserted.lastInsertRowid);
      this.db.prepare(`UPDATE learning_daily_queues SET status = 'active', updated_at_utc = ? WHERE id = ?`)
        .run(nowUtc, queue.id);
      this._activateNext(sessionId, Number(queue.id), nowUtc);
    });
    const row = sessionId ? this.db.prepare('SELECT * FROM learning_sessions WHERE id = ?').get(sessionId) : null;
    return { session: this._sessionDto(row), resumed, empty: !row };
  }

  _requireActiveSession(sessionId) {
    const id = integer(sessionId, 'sessionId', { min: 1 });
    const row = this.db.prepare('SELECT * FROM learning_sessions WHERE id = ?').get(id);
    if (!row || row.status !== 'active') {
      throw learningError('LEARNING_SESSION_NOT_ACTIVE', 'The learning session is not active', 409, { sessionId: id });
    }
    return row;
  }

  reveal(sessionId, input = {}) {
    const queueEntryId = integer(input.queueEntryId, 'queueEntryId', { min: 1 });
    const nowUtc = this._now();
    this._write(() => {
      const session = this._requireActiveSession(sessionId);
      if (Number(session.current_entry_id) !== queueEntryId) {
        throw learningError('LEARNING_SESSION_NOT_ACTIVE', 'The queue entry is not current in this session', 409);
      }
      this.db.prepare(`
        UPDATE learning_sessions
        SET revealed_entry_id = ?, revealed_at_utc = ?, last_activity_at_utc = ?
        WHERE id = ?
      `).run(queueEntryId, nowUtc, nowUtc, session.id);
    });
    return { session: this._sessionDto(this.db.prepare('SELECT * FROM learning_sessions WHERE id = ?').get(sessionId)) };
  }

  skip(sessionId, input = {}) {
    const queueEntryId = integer(input.queueEntryId, 'queueEntryId', { min: 1 });
    const nowUtc = this._now();
    this._write(() => {
      const session = this._requireActiveSession(sessionId);
      if (Number(session.current_entry_id) !== queueEntryId) {
        throw learningError('LEARNING_SESSION_NOT_ACTIVE', 'The queue entry is not current in this session', 409);
      }
      this.db.prepare(`UPDATE learning_queue_entries SET status = 'skipped', updated_at_utc = ? WHERE id = ?`)
        .run(nowUtc, queueEntryId);
      this._activateNext(Number(session.id), Number(session.queue_id), nowUtc);
    });
    return { session: this._sessionDto(this.db.prepare('SELECT * FROM learning_sessions WHERE id = ?').get(sessionId)) };
  }

  endSession(sessionId) {
    const nowUtc = this._now();
    this._write(() => {
      const session = this._requireActiveSession(sessionId);
      this.db.prepare(`
        UPDATE learning_queue_entries SET status = 'pending', updated_at_utc = ?
        WHERE queue_id = ? AND status IN ('active', 'skipped')
      `).run(nowUtc, session.queue_id);
      const remaining = Number(this.db.prepare(`
        SELECT COUNT(*) AS count FROM learning_queue_entries
        WHERE queue_id = ? AND status IN ('pending', 'deferred')
      `).get(session.queue_id).count);
      const sessionStatus = remaining === 0 ? 'completed' : 'ended';
      const queueStatus = remaining === 0 ? 'completed' : 'ready';
      this.db.prepare(`
        UPDATE learning_sessions
        SET status = ?, current_entry_id = NULL, revealed_entry_id = NULL,
            revealed_at_utc = NULL, last_activity_at_utc = ?, ended_at_utc = ?
        WHERE id = ?
      `).run(sessionStatus, nowUtc, nowUtc, session.id);
      this.db.prepare(`UPDATE learning_daily_queues SET status = ?, updated_at_utc = ? WHERE id = ?`)
        .run(queueStatus, nowUtc, session.queue_id);
    });
    return { session: this._sessionDto(this.db.prepare('SELECT * FROM learning_sessions WHERE id = ?').get(sessionId)) };
  }

  _requestHash(sessionId, input) {
    return sha256(stableJson({
      sessionId: Number(sessionId),
      queueEntryId: input.queueEntryId,
      studyItemId: input.studyItemId,
      rating: input.rating,
      expectedScheduleVersion: input.expectedScheduleVersion,
      responseMs: input.responseMs,
    }));
  }

  _validateReviewInput(sessionId, input = {}) {
    const id = integer(sessionId, 'sessionId', { min: 1 });
    const eventKey = String(input.eventKey || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(eventKey)) {
      throw learningError('LEARNING_INVALID_REQUEST', 'eventKey must be a UUID', 400);
    }
    const normalized = {
      eventKey,
      queueEntryId: integer(input.queueEntryId, 'queueEntryId', { min: 1 }),
      studyItemId: integer(input.studyItemId, 'studyItemId', { min: 1 }),
      rating: integer(input.rating, 'rating', { min: 1, max: 4 }),
      expectedScheduleVersion: integer(input.expectedScheduleVersion, 'expectedScheduleVersion', { min: 0 }),
      responseMs: integer(input.responseMs, 'responseMs', { min: 0, max: 86_400_000 }),
    };
    return { sessionId: id, input: normalized, requestHash: this._requestHash(id, normalized) };
  }

  _eventDto(row) {
    if (!row) return null;
    return {
      id: Number(row.id),
      eventKey: row.event_key,
      studyItemId: Number(row.study_item_id),
      sessionId: Number(row.session_id),
      queueEntryId: Number(row.queue_entry_id),
      rating: Number(row.rating),
      responseMs: Number(row.response_ms),
      occurredAtUtc: row.occurred_at_utc,
      learningDay: row.learning_day,
      timeZone: row.time_zone,
      contentHash: row.content_hash,
      beforeState: parseJson(row.before_state_json, null),
      afterState: parseJson(row.after_state_json, null),
      algorithmId: row.algorithm_id,
      algorithmVersion: row.algorithm_version,
      parametersHash: row.parameters_hash,
      publicExplanation: parseJson(row.public_explanation_json, {}),
    };
  }

  getHistory(input = {}) {
    const preset = String(input.range || '30');
    if (!HISTORY_PRESETS.has(preset)) {
      throw learningError('LEARNING_INVALID_REQUEST', 'range must be one of 7, 30, 90 or all', 400);
    }
    const unitKind = input.unitKind ? String(input.unitKind) : null;
    if (unitKind && !UNIT_KINDS.has(unitKind)) {
      throw learningError('LEARNING_INVALID_REQUEST', 'unitKind is not supported', 400);
    }

    const nowUtc = this._now();
    const profile = this.db.prepare('SELECT * FROM learning_profiles WHERE id = 1').get();
    const timeZone = profile?.time_zone || DEFAULT_TIME_ZONE;
    const endDay = learningDay(nowUtc, timeZone);
    const available = this.db.prepare(`
      SELECT MIN(day) AS start_day, MAX(day) AS end_day
      FROM (
        SELECT learning_day AS day FROM learning_review_events
        UNION ALL
        SELECT learning_day AS day FROM learning_daily_queues
      )
    `).get();
    const presetDays = HISTORY_PRESETS.get(preset);
    const candidateStart = presetDays
      ? Temporal.PlainDate.from(endDay).subtract({ days: presetDays - 1 }).toString()
      : (available.start_day || endDay);
    const startDay = candidateStart > endDay ? endDay : candidateStart;
    const rangeParameters = [startDay, endDay];
    const unitClause = unitKind ? ' AND item.unit_kind = ?' : '';
    const eventRows = this.db.prepare(`
      SELECT event.id, event.event_key, event.study_item_id, event.session_id,
             event.queue_entry_id, event.rating, event.response_ms,
             event.occurred_at_utc, event.learning_day,
             item.unit_kind, item.unit_key, item.lifecycle, item.generation_id,
             generation.card_type, generation.phrase AS source_title
      FROM learning_review_events event
      JOIN study_items item ON item.id = event.study_item_id
      LEFT JOIN generations generation ON generation.id = item.generation_id
      WHERE event.learning_day BETWEEN ? AND ?${unitClause}
      ORDER BY event.occurred_at_utc DESC, event.id DESC
    `).all(...rangeParameters, ...(unitKind ? [unitKind] : []));

    const queueRows = this.db.prepare(`
      SELECT queue.id, queue.learning_day, queue.snapshot_json,
             entry.id AS entry_id, entry.study_item_id, entry.bucket,
             item.unit_kind,
             CASE WHEN event.id IS NULL THEN 0 ELSE 1 END AS reviewed
      FROM learning_daily_queues queue
      LEFT JOIN learning_queue_entries entry ON entry.queue_id = queue.id
      LEFT JOIN study_items item ON item.id = entry.study_item_id
      LEFT JOIN learning_review_events event ON event.queue_entry_id = entry.id
      WHERE queue.learning_day BETWEEN ? AND ?${unitClause}
      ORDER BY queue.learning_day, queue.id, entry.id
    `).all(...rangeParameters, ...(unitKind ? [unitKind] : []));

    const sessionRows = this.db.prepare(`
      SELECT session.id, session.status, queue.learning_day,
             COUNT(event.id) AS review_count
      FROM learning_sessions session
      JOIN learning_daily_queues queue ON queue.id = session.queue_id
      LEFT JOIN learning_review_events event ON event.session_id = session.id
      ${unitKind ? 'LEFT JOIN study_items item ON item.id = event.study_item_id' : ''}
      WHERE queue.learning_day BETWEEN ? AND ?${unitKind ? ' AND (item.unit_kind = ? OR event.id IS NULL)' : ''}
      GROUP BY session.id
      ORDER BY session.id
    `).all(...rangeParameters, ...(unitKind ? [unitKind] : []));

    const daily = new Map(dateSequence(startDay, endDay).map((day) => [day, {
      learningDay: day,
      actions: 0,
      actionGoal: 0,
      goalReached: false,
      dueAssigned: 0,
      dueCompleted: 0,
      backlog: 0,
      newAssigned: 0,
      newReviewed: 0,
      averageResponseMs: 0,
      sessionCount: 0,
    }]));
    const responseByDay = new Map();
    for (const event of eventRows) {
      const day = daily.get(event.learning_day);
      if (!day) continue;
      day.actions += 1;
      if (!responseByDay.has(event.learning_day)) responseByDay.set(event.learning_day, []);
      responseByDay.get(event.learning_day).push(Number(event.response_ms));
    }

    const latestQueueByDay = new Map();
    const assignmentsByDay = new Map();
    for (const row of queueRows) {
      const previous = latestQueueByDay.get(row.learning_day);
      if (!previous || Number(row.id) > Number(previous.id)) latestQueueByDay.set(row.learning_day, row);
      if (!row.entry_id) continue;
      if (!assignmentsByDay.has(row.learning_day)) assignmentsByDay.set(row.learning_day, new Map());
      const assignments = assignmentsByDay.get(row.learning_day);
      const key = Number(row.study_item_id);
      const current = assignments.get(key) || { bucket: Number(row.bucket), reviewed: false };
      current.bucket = Math.min(current.bucket, Number(row.bucket));
      current.reviewed ||= Boolean(row.reviewed);
      assignments.set(key, current);
    }
    for (const [dayKey, row] of latestQueueByDay) {
      const target = daily.get(dayKey);
      if (target && !unitKind) target.actionGoal = Number(parseJson(row.snapshot_json, {}).dailyActionGoal || 0);
    }
    for (const [dayKey, assignments] of assignmentsByDay) {
      const target = daily.get(dayKey);
      if (!target) continue;
      for (const assignment of assignments.values()) {
        if (assignment.bucket <= 4) {
          target.dueAssigned += 1;
          if (assignment.reviewed) target.dueCompleted += 1;
        } else if (assignment.bucket === 6) {
          target.newAssigned += 1;
          if (assignment.reviewed) target.newReviewed += 1;
        }
      }
      target.backlog = Math.max(0, target.dueAssigned - target.dueCompleted);
    }
    for (const session of sessionRows) {
      const target = daily.get(session.learning_day);
      if (target) target.sessionCount += 1;
    }
    for (const item of daily.values()) {
      item.goalReached = item.actionGoal > 0 && item.actions >= item.actionGoal;
      const responses = responseByDay.get(item.learningDay) || [];
      item.averageResponseMs = responses.length
        ? Math.round(responses.reduce((sum, value) => sum + value, 0) / responses.length)
        : 0;
    }

    const ratingCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    const breakdownMap = new Map();
    const previousRatingByItem = new Map();
    let repeatedFailureCount = 0;
    for (const event of [...eventRows].reverse()) {
      const rating = Number(event.rating);
      ratingCounts[rating] += 1;
      if (rating === 1 && previousRatingByItem.get(Number(event.study_item_id)) === 1) repeatedFailureCount += 1;
      previousRatingByItem.set(Number(event.study_item_id), rating);
      const key = `${event.unit_kind}:${event.card_type || 'unknown'}`;
      const group = breakdownMap.get(key) || {
        unitKind: event.unit_kind,
        cardType: event.card_type || 'unknown',
        reviews: 0,
        ratingTotal: 0,
        failureCount: 0,
        responseTotal: 0,
      };
      group.reviews += 1;
      group.ratingTotal += rating;
      group.failureCount += rating === 1 ? 1 : 0;
      group.responseTotal += Number(event.response_ms);
      breakdownMap.set(key, group);
    }

    const planRow = this.db.prepare('SELECT scope_json FROM learning_plans WHERE id = 1').get();
    const currentScope = parseJson(planRow?.scope_json, DEFAULT_SCOPE);
    const currentCandidates = this._candidateRows();
    const currentTags = this._tagsByGeneration(currentCandidates);
    const todayStart = Date.parse(dayBounds(endDay, timeZone).startUtc);
    const currentOverdue = currentCandidates.filter((row) => {
      if (unitKind && row.unit_kind !== unitKind) return false;
      if (!itemMatchesScope(row, currentScope, currentTags.get(Number(row.generation_id)) || new Set())) return false;
      return row.due_at_utc && Date.parse(row.due_at_utc) < todayStart;
    }).length;

    const dailyRows = [...daily.values()];
    const queueDays = latestQueueByDay.size;
    const startedDays = dailyRows.filter((day) => day.sessionCount > 0).length;
    const goalReachedDays = dailyRows.filter((day) => day.goalReached).length;
    const dueAssigned = dailyRows.reduce((sum, day) => sum + day.dueAssigned, 0);
    const dueCompleted = dailyRows.reduce((sum, day) => sum + day.dueCompleted, 0);
    const newAssigned = dailyRows.reduce((sum, day) => sum + day.newAssigned, 0);
    const newReviewed = dailyRows.reduce((sum, day) => sum + day.newReviewed, 0);
    const responses = eventRows.map((event) => Number(event.response_ms));
    const activeDays = new Set(eventRows.map((event) => event.learning_day)).size;
    const sessionsWithProgress = sessionRows.filter((session) => Number(session.review_count) > 0).length;
    const validSessions = sessionRows.filter((session) => session.status === 'completed' || Number(session.review_count) > 0).length;
    const last7Start = Temporal.PlainDate.from(endDay).subtract({ days: 6 }).toString();
    const last30Start = Temporal.PlainDate.from(endDay).subtract({ days: 29 }).toString();
    const recentActiveDays7 = new Set(eventRows.filter((event) => event.learning_day >= last7Start).map((event) => event.learning_day)).size;
    const recentActiveDays30 = new Set(eventRows.filter((event) => event.learning_day >= last30Start).map((event) => event.learning_day)).size;

    const totalReviews = eventRows.length;
    return {
      range: {
        preset,
        startDay,
        endDay,
        timeZone,
        availableStartDay: available.start_day || null,
        availableEndDay: available.end_day || null,
        unitKind,
      },
      overview: {
        totalReviews,
        activeDays,
        queueDays,
        startedDays,
        learningStartRate: unitKind ? null : round(ratio(startedDays, queueDays)),
        totalSessions: sessionRows.length,
        sessionsWithProgress,
        validSessions,
        sessionCompletionRate: unitKind ? null : round(ratio(validSessions, sessionRows.length)),
        goalReachedDays,
        goalCompletionRate: unitKind ? null : round(ratio(goalReachedDays, queueDays)),
        dueAssigned,
        dueCompleted,
        dueCompletionRate: round(ratio(dueCompleted, dueAssigned)),
        newAssigned,
        newReviewed,
        newConversionRate: round(ratio(newReviewed, newAssigned)),
        currentOverdue,
        averageResponseMs: responses.length
          ? Math.round(responses.reduce((sum, value) => sum + value, 0) / responses.length)
          : 0,
        medianResponseMs: Math.round(median(responses)),
        repeatedFailureCount,
        repeatedFailureRate: round(ratio(repeatedFailureCount, totalReviews)),
        recentActiveDays7,
        recentActiveDays30,
        baselineEstablished: activeDays >= 14,
        baselineRemainingDays: Math.max(0, 14 - activeDays),
      },
      daily: dailyRows,
      ratings: [1, 2, 3, 4].map((rating) => ({
        rating,
        count: ratingCounts[rating],
        percentage: round(ratio(ratingCounts[rating], totalReviews)),
      })),
      breakdown: [...breakdownMap.values()].map((group) => ({
        unitKind: group.unitKind,
        cardType: group.cardType,
        reviews: group.reviews,
        averageRating: round(ratio(group.ratingTotal, group.reviews), 2),
        failureRate: round(ratio(group.failureCount, group.reviews)),
        averageResponseMs: Math.round(ratio(group.responseTotal, group.reviews)),
      })).sort((a, b) => b.reviews - a.reviews || a.unitKind.localeCompare(b.unitKind)),
      recent: eventRows.slice(0, 50).map((event) => ({
        id: Number(event.id),
        eventKey: event.event_key,
        learningDay: event.learning_day,
        occurredAtUtc: event.occurred_at_utc,
        rating: Number(event.rating),
        responseMs: Number(event.response_ms),
        unitKind: event.unit_kind,
        unitKey: event.unit_key,
        cardType: event.card_type || 'unknown',
        title: event.source_title || event.unit_key,
        contentAvailable: Boolean(event.generation_id && event.lifecycle !== 'archived'),
      })),
      dataQuality: {
        historicalSkipMetricsAvailable: false,
        notes: [
          '跳过是会话内临时状态；当前事实模型不会持久化历史跳过次数。',
          '按学习单元筛选时，不计算无法归属到单元的计划级目标与整场会话完成率。',
          '评分、响应时间、会话和队列指标均直接来自学习领域事实。',
        ],
      },
    };
  }

  _reviewResponse(eventRow, { idempotent = false } = {}) {
    const scheduleRow = this.db.prepare(`
      SELECT *, version AS schedule_version, last_event_id AS schedule_last_event_id,
        algorithm_id AS schedule_algorithm_id, algorithm_version AS schedule_algorithm_version,
        parameters_hash AS schedule_parameters_hash, updated_at_utc AS schedule_updated_at_utc
      FROM learning_schedule_states WHERE study_item_id = ?
    `).get(eventRow.study_item_id);
    const event = this._eventDto(eventRow);
    const session = this.db.prepare('SELECT * FROM learning_sessions WHERE id = ?').get(eventRow.session_id);
    return {
      idempotent,
      reviewEvent: event,
      scheduleState: idempotent
        ? event.afterState
        : mapSchedule({ ...scheduleRow, study_item_id: eventRow.study_item_id }),
      publicExplanation: event.publicExplanation,
      queueProgress: this._queueProgress(Number(session.queue_id)),
      nextEntry: session.current_entry_id
        ? this._entryDto(this.db.prepare('SELECT * FROM learning_queue_entries WHERE id = ?').get(session.current_entry_id))
        : null,
      session: this._sessionDto(session),
    };
  }

  submitReview(sessionId, rawInput = {}) {
    const validated = this._validateReviewInput(sessionId, rawInput);
    let eventId;
    let idempotent = false;
    const nowUtc = this._now();

    this._write(() => {
      const existingEvent = this.db.prepare('SELECT * FROM learning_review_events WHERE event_key = ?').get(validated.input.eventKey);
      if (existingEvent) {
        if (existingEvent.request_hash !== validated.requestHash) {
          throw learningError(
            'LEARNING_IDEMPOTENCY_CONFLICT',
            'The event key was already used for a different review request',
            409
          );
        }
        eventId = Number(existingEvent.id);
        idempotent = true;
        return;
      }

      const session = this._requireActiveSession(validated.sessionId);
      const entry = this.db.prepare('SELECT * FROM learning_queue_entries WHERE id = ?').get(validated.input.queueEntryId);
      if (!entry || Number(entry.queue_id) !== Number(session.queue_id)
        || Number(entry.study_item_id) !== validated.input.studyItemId
        || Number(session.current_entry_id) !== Number(entry.id)) {
        throw learningError('LEARNING_SESSION_NOT_ACTIVE', 'The review entry is not current in this session', 409);
      }
      if (Number(session.revealed_entry_id) !== Number(entry.id)) {
        throw learningError('LEARNING_ANSWER_NOT_REVEALED', 'Reveal the answer before rating this item', 409);
      }
      const item = this.db.prepare('SELECT * FROM study_items WHERE id = ?').get(validated.input.studyItemId);
      if (!item) throw learningError('LEARNING_SOURCE_INELIGIBLE', 'The Study Item no longer exists', 409);
      if (item.lifecycle === 'archived') throw learningError('LEARNING_ITEM_ARCHIVED', 'The Study Item is archived', 409);
      if (item.lifecycle !== 'active' || !item.generation_id) {
        throw learningError('LEARNING_SOURCE_INELIGIBLE', 'The Study Item is not eligible for learning', 409);
      }
      const scheduleRow = this.db.prepare(`
        SELECT *, version AS schedule_version, last_event_id AS schedule_last_event_id,
          algorithm_id AS schedule_algorithm_id, algorithm_version AS schedule_algorithm_version,
          parameters_hash AS schedule_parameters_hash, updated_at_utc AS schedule_updated_at_utc
        FROM learning_schedule_states WHERE study_item_id = ?
      `).get(item.id);
      const before = mapSchedule(scheduleRow ? { ...scheduleRow, study_item_id: item.id } : null);
      const actualVersion = before ? before.version : 0;
      if (actualVersion !== validated.input.expectedScheduleVersion) {
        throw learningError(
          'LEARNING_SCHEDULE_CONFLICT',
          'The schedule changed; reload the current item before rating',
          409,
          { expectedVersion: validated.input.expectedScheduleVersion, actualVersion }
        );
      }
      const queue = this.db.prepare('SELECT * FROM learning_daily_queues WHERE id = ?').get(session.queue_id);
      const result = this.scheduler.schedule({
        state: schedulerState(before),
        rating: validated.input.rating,
        reviewedAtUtc: nowUtc,
      });
      const day = learningDay(nowUtc, queue.time_zone);
      const nextVersion = actualVersion + 1;
      const eventInsert = this.db.prepare(`
        INSERT INTO learning_review_events(
          event_key, request_hash, study_item_id, session_id, queue_entry_id,
          rating, response_ms, occurred_at_utc, learning_day, time_zone, content_hash,
          before_state_json, after_state_json, algorithm_id, algorithm_version,
          parameters_hash, public_explanation_json, created_at_utc
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        validated.input.eventKey,
        validated.requestHash,
        item.id,
        session.id,
        entry.id,
        validated.input.rating,
        validated.input.responseMs,
        nowUtc,
        day,
        queue.time_zone,
        item.content_hash,
        stableJson(before),
        stableJson({ ...result.afterState, version: nextVersion }),
        result.algorithm.algorithmId,
        result.algorithm.algorithmVersion,
        result.algorithm.parametersHash,
        stableJson(result.publicExplanation),
        nowUtc
      );
      eventId = Number(eventInsert.lastInsertRowid);
      const after = result.afterState;
      if (before) {
        const updated = this.db.prepare(`
          UPDATE learning_schedule_states SET
            fsrs_state = ?, due_at_utc = ?, last_reviewed_at_utc = ?, stability = ?, difficulty = ?,
            elapsed_days = ?, scheduled_days = ?, reps = ?, lapses = ?, step = ?, version = ?,
            last_event_id = ?, algorithm_id = ?, algorithm_version = ?, parameters_hash = ?, updated_at_utc = ?
          WHERE study_item_id = ? AND version = ?
        `).run(
          after.fsrsState, after.dueAtUtc, after.lastReviewedAtUtc, after.stability, after.difficulty,
          after.elapsedDays, after.scheduledDays, after.reps, after.lapses, after.step, nextVersion,
          eventId, result.algorithm.algorithmId, result.algorithm.algorithmVersion,
          result.algorithm.parametersHash, nowUtc, item.id, actualVersion
        );
        if (updated.changes !== 1) {
          throw learningError('LEARNING_SCHEDULE_CONFLICT', 'The schedule changed during review submission', 409);
        }
      } else {
        this.db.prepare(`
          INSERT INTO learning_schedule_states(
            study_item_id, fsrs_state, due_at_utc, last_reviewed_at_utc, stability, difficulty,
            elapsed_days, scheduled_days, reps, lapses, step, version, last_event_id,
            algorithm_id, algorithm_version, parameters_hash, updated_at_utc
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
        `).run(
          item.id, after.fsrsState, after.dueAtUtc, after.lastReviewedAtUtc, after.stability, after.difficulty,
          after.elapsedDays, after.scheduledDays, after.reps, after.lapses, after.step,
          eventId, result.algorithm.algorithmId, result.algorithm.algorithmVersion,
          result.algorithm.parametersHash, nowUtc
        );
      }
      const shortTerm = Boolean(result.publicExplanation.shortTerm);
      this.db.prepare(`
        UPDATE learning_queue_entries SET
          reason = ?, bucket = ?, provider_score = ?, explanation_json = ?,
          available_at_utc = ?, due_at_utc = ?, status = ?,
          attempts = attempts + 1, last_event_id = ?, updated_at_utc = ?
        WHERE id = ?
      `).run(
        shortTerm ? 'difficult-reappearance' : entry.reason,
        shortTerm ? 5 : entry.bucket,
        shortTerm ? null : entry.provider_score,
        shortTerm ? stableJson({
          code: 'difficult-reappearance',
          label: '本日再次练习',
          provider: { id: 'base-policy', version: '1', score: null },
        }) : entry.explanation_json,
        shortTerm ? after.dueAtUtc : null,
        after.dueAtUtc,
        shortTerm ? 'deferred' : 'completed',
        eventId,
        nowUtc,
        entry.id
      );
      this._activateNext(Number(session.id), Number(session.queue_id), nowUtc);
      const remaining = Number(this.db.prepare(`
        SELECT COUNT(*) AS count FROM learning_queue_entries
        WHERE queue_id = ? AND status IN ('pending', 'deferred', 'active', 'skipped')
      `).get(session.queue_id).count);
      if (remaining === 0) {
        this.db.prepare(`
          UPDATE learning_sessions SET status = 'completed', current_entry_id = NULL,
            revealed_entry_id = NULL, revealed_at_utc = NULL, last_activity_at_utc = ?, ended_at_utc = ?
          WHERE id = ?
        `).run(nowUtc, nowUtc, session.id);
        this.db.prepare(`UPDATE learning_daily_queues SET status = 'completed', updated_at_utc = ? WHERE id = ?`)
          .run(nowUtc, session.queue_id);
      }
    });

    const event = this.db.prepare('SELECT * FROM learning_review_events WHERE id = ?').get(eventId);
    return this._reviewResponse(event, { idempotent });
  }

  getReviewByKey(eventKey) {
    const key = String(eventKey || '').trim();
    const event = this.db.prepare('SELECT * FROM learning_review_events WHERE event_key = ?').get(key);
    if (!event) throw learningError('LEARNING_REVIEW_NOT_FOUND', 'No review exists for this event key', 404);
    return this._reviewResponse(event, { idempotent: true });
  }

  getItem(itemId) {
    const id = integer(itemId, 'itemId', { min: 1 });
    const row = this.db.prepare(`
      SELECT si.*, g.phrase, g.card_type, g.folder_name, g.base_filename,
        g.markdown_content, g.en_translation, g.ja_translation, g.zh_translation,
        g.generation_date
      FROM study_items si
      LEFT JOIN generations g ON g.id = si.generation_id
      WHERE si.id = ?
    `).get(id);
    if (!row) throw learningError('LEARNING_ITEM_NOT_FOUND', 'Study Item not found', 404);
    if (row.lifecycle === 'archived') throw learningError('LEARNING_ITEM_ARCHIVED', 'The Study Item is archived', 410);
    if (row.lifecycle !== 'active' || !row.generation_id) {
      throw learningError('LEARNING_SOURCE_INELIGIBLE', 'The Study Item is not eligible for learning', 409);
    }
    const locator = parseJson(row.unit_locator_json, {});
    if (row.unit_kind === 'textbook_en' || row.unit_kind === 'textbook_ja') {
      const expression = this.db.prepare(`
        SELECT er.*, e.expression_key, tr.id AS track_id, tr.track_number, tr.title AS track_title,
          c.course_key, c.title AS course_title
        FROM textbook_expression_revisions er
        JOIN textbook_expressions e ON e.id = er.expression_id
        JOIN textbook_track_revisions rev ON rev.id = er.revision_id
        JOIN textbook_tracks tr ON tr.id = rev.track_id
        JOIN textbook_courses c ON c.id = tr.course_id
        WHERE er.id = ?
        LIMIT 1
      `).get(Number(locator.expressionRevisionId || 0));
      if (!expression) {
        throw learningError('LEARNING_SOURCE_INELIGIBLE', 'The textbook expression backing this Study Item is missing', 409);
      }
      const direction = row.unit_kind === 'textbook_en' ? 'en' : 'ja';
      const targetLanguages = [direction];
      const targetText = direction === 'en' ? expression.official_en_text : expression.official_ja_text;
      const markdown = [
        `### ${expression.course_title} · Track ${String(expression.track_number).padStart(2, '0')} · ${expression.expression_key}`,
        '',
        `- **中文提示**: ${expression.zh_cue_text}`,
        `- **English**: ${expression.official_en_text}`,
        `- **日本語**: ${expression.ja_ruby_html || expression.official_ja_text}`,
      ].join('\n');
      const scheduleRow = this.db.prepare(`
        SELECT *, version AS schedule_version, last_event_id AS schedule_last_event_id,
          algorithm_id AS schedule_algorithm_id, algorithm_version AS schedule_algorithm_version,
          parameters_hash AS schedule_parameters_hash, updated_at_utc AS schedule_updated_at_utc
        FROM learning_schedule_states WHERE study_item_id = ?
      `).get(row.id);
      const scheduleState = mapSchedule(scheduleRow ? { ...scheduleRow, study_item_id: row.id } : null);
      return {
        id: Number(row.id),
        unitKind: row.unit_kind,
        unitKey: row.unit_key,
        locator,
        lifecycle: row.lifecycle,
        contentRevision: Number(row.content_revision),
        source: {
          generationId: Number(row.generation_id),
          cardType: row.card_type,
          title: `${expression.track_title} · ${expression.expression_key}`,
          folder: row.folder_name,
          baseFilename: row.base_filename,
          generationDate: row.generation_date,
          contentHash: row.content_hash,
        },
        prompt: { language: 'zh', text: expression.zh_cue_text, targetLanguages },
        answer: { targetText, markdown },
        scheduleState,
        expectedScheduleVersion: scheduleState?.version || 0,
        audioFiles: [],
        highlightReference: null,
      };
    }
    const targetLanguages = row.unit_kind === 'scenario_bilingual' ? ['en', 'ja']
      : row.unit_kind === 'trilingual_en' ? ['en']
        : row.unit_kind === 'whole_card' ? ['en', 'ja'] : ['ja'];
    const unitMarkdown = extractStudyUnitMarkdown(row.markdown_content, row.unit_kind, locator);
    const promptText = row.unit_kind === 'scenario_bilingual'
      ? (labeledValue(unitMarkdown, '中文') || row.phrase)
      : row.unit_kind === 'grammar_ja' ? row.phrase : (row.zh_translation || row.phrase);
    const targetText = row.unit_kind === 'scenario_bilingual' ? {
      en: labeledValue(unitMarkdown, '英文'),
      ja: labeledValue(unitMarkdown, '日本語'),
    } : row.unit_kind === 'trilingual_en' ? row.en_translation
      : row.unit_kind === 'trilingual_ja' || row.unit_kind === 'grammar_ja' ? row.ja_translation : null;
    const audioFiles = this.db.prepare(`
      SELECT id, language, text, filename_suffix, file_path, tts_provider, tts_model, tts_voice, status
      FROM audio_files WHERE generation_id = ? ORDER BY language, filename_suffix
    `).all(row.generation_id).filter((audio) => targetLanguages.includes(audio.language))
      .filter((audio) => row.unit_kind !== 'scenario_bilingual' || scenarioAudioMatches(audio, locator));
    const highlight = this.db.prepare(`
      SELECT id, source_hash, version, updated_at FROM card_highlights
      WHERE folder_name = ? AND base_filename = ? ORDER BY version DESC LIMIT 1
    `).get(row.folder_name, row.base_filename) || null;
    const scheduleRow = this.db.prepare(`
      SELECT *, version AS schedule_version, last_event_id AS schedule_last_event_id,
        algorithm_id AS schedule_algorithm_id, algorithm_version AS schedule_algorithm_version,
        parameters_hash AS schedule_parameters_hash, updated_at_utc AS schedule_updated_at_utc
      FROM learning_schedule_states WHERE study_item_id = ?
    `).get(row.id);
    const scheduleState = mapSchedule(scheduleRow ? { ...scheduleRow, study_item_id: row.id } : null);
    return {
      id: Number(row.id),
      unitKind: row.unit_kind,
      unitKey: row.unit_key,
      locator,
      lifecycle: row.lifecycle,
      contentRevision: Number(row.content_revision),
      source: {
        generationId: Number(row.generation_id),
        cardType: row.card_type,
        title: row.phrase,
        folder: row.folder_name,
        baseFilename: row.base_filename,
        generationDate: row.generation_date,
        contentHash: row.content_hash,
      },
      prompt: { language: 'zh', text: promptText, targetLanguages },
      answer: { targetText, markdown: unitMarkdown },
      scheduleState,
      expectedScheduleVersion: scheduleState?.version || 0,
      audioFiles,
      highlightReference: highlight ? {
        id: Number(highlight.id),
        sourceHash: highlight.source_hash,
        version: Number(highlight.version),
        updatedAt: highlight.updated_at,
      } : null,
    };
  }
}

module.exports = {
  DEFAULT_ACTION_GOAL,
  DEFAULT_NEW_LIMIT,
  LearningService,
  buildQueueCandidates,
  mapSchedule,
};
