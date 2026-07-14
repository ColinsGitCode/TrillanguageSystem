'use strict';

process.env.DB_PATH = ':memory:';
process.env.LOG_SILENT = '1';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { LearningService } = require('../../services/learning/application/learningService');
const { DatabaseService } = require('../../services/storage/databaseService');
const { seedStudyItem } = require('../helpers/learningFixtures');

const scope = {
  version: 1,
  languages: ['en'],
  cardTypes: ['trilingual'],
  dateRange: null,
  tags: [],
};

test('review event, schedule, queue and session roll back as one transaction', () => {
  const dbService = new DatabaseService(':memory:');
  const parametersHash = 'f'.repeat(64);
  const scheduler = {
    describe: () => ({
      algorithmId: 'fsrs',
      algorithmVersion: '6',
      adapterId: 'test',
      adapterVersion: '1',
      parameters: {},
      parametersHash,
    }),
    schedule: () => ({
      afterState: {
        fsrsState: 'invalid-state',
        dueAtUtc: '2026-07-15T01:00:00.000Z',
        lastReviewedAtUtc: '2026-07-14T01:00:00.000Z',
        stability: 1,
        difficulty: 5,
        elapsedDays: 0,
        scheduledDays: 1,
        reps: 1,
        lapses: 0,
        step: 0,
      },
      algorithm: { algorithmId: 'fsrs', algorithmVersion: '6', parametersHash },
      publicExplanation: { shortTerm: false },
    }),
  };
  const service = new LearningService({
    db: dbService.db,
    scheduler,
    now: () => '2026-07-14T01:00:00.000Z',
  });
  try {
    const item = seedStudyItem(dbService.db, { phrase: 'atomic fixture', unitKey: 'atomic-en' });
    service.putPlan({ expectedRevision: 0, scope, dailyActionGoal: 5, dailyNewLimit: 1 });
    const queue = service.ensureTodayQueue();
    const started = service.startSession({ queueId: queue.id });
    const entry = started.session.currentEntry;
    service.reveal(started.session.id, { queueEntryId: entry.id });
    assert.throws(() => service.submitReview(started.session.id, {
      eventKey: crypto.randomUUID(),
      queueEntryId: entry.id,
      studyItemId: item.studyItemId,
      rating: 3,
      expectedScheduleVersion: 0,
      responseMs: 1000,
    }), /CHECK constraint failed/u);
    assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM learning_review_events').get().count, 0);
    assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM learning_schedule_states').get().count, 0);
    const entryAfter = dbService.db.prepare('SELECT status, attempts, last_event_id FROM learning_queue_entries WHERE id = ?').get(entry.id);
    assert.deepEqual(entryAfter, { status: 'active', attempts: 0, last_event_id: null });
    assert.equal(dbService.db.prepare('SELECT revealed_entry_id FROM learning_sessions WHERE id = ?').get(started.session.id).revealed_entry_id, entry.id);
  } finally {
    dbService.close();
  }
});
