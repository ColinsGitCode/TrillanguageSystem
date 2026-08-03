'use strict';

const defaultDbService = require('../storage/databaseService');

const STEP_DEFINITIONS = [
  {
    id: 'content',
    title: '准备学习内容',
    description: '创建一张合格学习卡，或发布已校对的教材内容。',
    href: '/',
    actionLabel: '打开 Cards Factory',
  },
  {
    id: 'plan',
    title: '建立学习计划',
    description: '选择语言、卡型和每日学习负担。',
    href: '/learn/plan',
    actionLabel: '建立学习计划',
  },
  {
    id: 'queue',
    title: '生成今日队列',
    description: '确认今天要学的到期内容和新内容。',
    href: '/learn',
    actionLabel: '查看今日学习',
  },
  {
    id: 'review',
    title: '完成第一次主动回忆',
    description: '揭示答案后提交一次真实的四档评分。',
    href: '/learn',
    actionLabel: '开始第一次复习',
  },
];

class OnboardingService {
  constructor(options = {}) {
    this.dbService = options.dbService || defaultDbService;
  }

  getState() {
    const db = this.dbService.db;
    const facts = {
      content: Boolean(db.prepare(`
        SELECT 1
        FROM study_items
        WHERE lifecycle = 'active'
        LIMIT 1
      `).get()),
      plan: Boolean(db.prepare('SELECT 1 FROM learning_plans WHERE id = 1 LIMIT 1').get()),
      queue: Boolean(db.prepare('SELECT 1 FROM learning_daily_queues LIMIT 1').get()),
      review: Boolean(db.prepare('SELECT 1 FROM learning_review_events LIMIT 1').get()),
    };
    const activeSession = db.prepare(`
      SELECT id FROM learning_sessions
      WHERE status = 'active'
      ORDER BY id DESC
      LIMIT 1
    `).get();
    const steps = STEP_DEFINITIONS.map((definition) => ({
      ...definition,
      complete: facts[definition.id],
      href: definition.id === 'review' && activeSession ? '/learn/session' : definition.href,
      actionLabel: definition.id === 'review' && activeSession ? '继续第一次复习' : definition.actionLabel,
    }));
    const completedCount = steps.filter((step) => step.complete).length;
    const nextStep = steps.find((step) => !step.complete) || null;
    return {
      version: 1,
      completed: completedCount === steps.length,
      completedCount,
      total: steps.length,
      steps,
      nextStep,
    };
  }
}

module.exports = new OnboardingService();
module.exports.OnboardingService = OnboardingService;
