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

function seedScheduledItem(db, phrase, dueAtUtc = '2026-07-20T01:00:00.000Z') {
  const seeded = seedStudyItem(db, { phrase, unitKey: `${phrase}-en` });
  db.prepare(`
    INSERT INTO learning_schedule_states(
      study_item_id, fsrs_state, due_at_utc, last_reviewed_at_utc,
      stability, difficulty, elapsed_days, scheduled_days, reps, lapses, step,
      version, last_event_id, algorithm_id, algorithm_version, parameters_hash,
      updated_at_utc
    ) VALUES (?, 'review', ?, '2026-07-13T01:00:00.000Z',
      3, 5, 1, 7, 1, 0, 0, 1, NULL, 'fsrs', '6', ?,
      '2026-07-13T01:00:00.000Z')
  `).run(seeded.studyItemId, dueAtUtc, 'f'.repeat(64));
  return seeded;
}

test('manual intent adds a scheduled item atomically without changing FSRS and completes on review', () => {
  const database = new DatabaseService(':memory:');
  const first = seedScheduledItem(database.db, 'manual-first');
  const second = seedScheduledItem(database.db, 'manual-second');
  const now = { value: '2026-07-14T01:00:00.000Z' };
  const service = new LearningService({ db: database.db, now: () => now.value });
  try {
    service.putPlan({ expectedRevision: 0, scope, dailyActionGoal: 5, dailyNewLimit: 1 });
    const beforeSchedule = database.db.prepare(
      'SELECT * FROM learning_schedule_states WHERE study_item_id = ?'
    ).get(first.studyItemId);
    const firstKey = crypto.randomUUID();
    const added = service.addManualQueueIntent({
      intentKey: firstKey,
      studyItemId: first.studyItemId,
      confirmed: true,
    });
    assert.equal(added.idempotent, false);
    assert.equal(added.alreadyQueued, false);
    assert.equal(added.intent.status, 'active');
    assert.equal(added.entry.bucket, 5);
    assert.equal(added.entry.reason, 'manual-lookup');
    assert.equal(added.entry.explanation.source, 'manual-intent');
    assert.equal(added.capacity.used, 1);
    assert.deepEqual(
      database.db.prepare('SELECT * FROM learning_schedule_states WHERE study_item_id = ?').get(first.studyItemId),
      beforeSchedule
    );
    assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM learning_review_events').get().count, 0);

    const retried = service.addManualQueueIntent({
      intentKey: firstKey,
      studyItemId: first.studyItemId,
      confirmed: true,
    });
    assert.equal(retried.idempotent, true);
    assert.equal(retried.intent.id, added.intent.id);
    assert.throws(() => service.addManualQueueIntent({
      intentKey: firstKey,
      studyItemId: second.studyItemId,
      confirmed: true,
    }), (error) => error.code === 'LEARNING_IDEMPOTENCY_CONFLICT');

    const started = service.startSession({ queueId: added.intent.queueId });
    const currentBeforeAppend = started.session.currentEntry.id;
    const appended = service.addManualQueueIntent({
      intentKey: crypto.randomUUID(),
      studyItemId: second.studyItemId,
      confirmed: true,
    });
    assert.equal(appended.intent.status, 'active');
    assert.equal(service.getActiveSession().session.currentEntry.id, currentBeforeAppend);

    service.reveal(started.session.id, { queueEntryId: currentBeforeAppend });
    const reviewed = service.submitReview(started.session.id, {
      eventKey: crypto.randomUUID(),
      queueEntryId: currentBeforeAppend,
      studyItemId: first.studyItemId,
      rating: 4,
      expectedScheduleVersion: 1,
      responseMs: 1200,
    });
    const completed = database.db.prepare(
      'SELECT * FROM learning_manual_queue_intents WHERE id = ?'
    ).get(added.intent.id);
    assert.equal(completed.status, 'completed');
    assert.equal(Number(completed.completion_review_event_id), reviewed.reviewEvent.id);
    assert.equal(service.getTodayManualQueueIntents().intents[0].status, 'completed');

    const history = service.getHistory({ range: '7' });
    assert.equal(history.overview.manualAssigned, 2);
    assert.equal(history.overview.manualReviewed, 1);
    assert.equal(history.overview.manualCompletionRate, 0.5);
    const today = history.daily.find((day) => day.learningDay === '2026-07-14');
    assert.equal(today.manualAssigned, 2);
    assert.equal(today.manualReviewed, 1);
  } finally {
    database.close();
  }
});

test('manual intent rejects fresh or already-reviewed items and preserves an existing natural queue entry', () => {
  const database = new DatabaseService(':memory:');
  const fresh = seedStudyItem(database.db, { phrase: 'manual-fresh', unitKey: 'manual-fresh-en' });
  const due = seedScheduledItem(database.db, 'manual-due', '2026-07-14T02:00:00.000Z');
  const service = new LearningService({
    db: database.db,
    now: () => '2026-07-14T01:00:00.000Z',
  });
  try {
    service.putPlan({ expectedRevision: 0, scope, dailyActionGoal: 5, dailyNewLimit: 1 });
    assert.throws(() => service.addManualQueueIntent({
      intentKey: crypto.randomUUID(),
      studyItemId: fresh.studyItemId,
      confirmed: true,
    }), (error) => error.code === 'LEARNING_MANUAL_INTENT_INELIGIBLE');

    const existing = service.addManualQueueIntent({
      intentKey: crypto.randomUUID(),
      studyItemId: due.studyItemId,
      confirmed: true,
    });
    assert.equal(existing.alreadyQueued, true);
    assert.equal(existing.intent, null);
    assert.ok(existing.entry.bucket <= 4);
    assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM learning_manual_queue_intents').get().count, 0);

    const queue = service.getTodayQueue().queue;
    const started = service.startSession({ queueId: queue.id });
    const currentEntry = started.session.currentEntry;
    const currentSchedule = database.db.prepare(`
      SELECT version
      FROM learning_schedule_states
      WHERE study_item_id = ?
    `).get(currentEntry.studyItemId);
    service.reveal(started.session.id, { queueEntryId: currentEntry.id });
    service.submitReview(started.session.id, {
      eventKey: crypto.randomUUID(),
      queueEntryId: currentEntry.id,
      studyItemId: currentEntry.studyItemId,
      rating: 4,
      expectedScheduleVersion: currentSchedule?.version ?? 0,
      responseMs: 600,
    });
    assert.throws(() => service.addManualQueueIntent({
      intentKey: crypto.randomUUID(),
      studyItemId: currentEntry.studyItemId,
      confirmed: true,
    }), (error) => error.code === 'LEARNING_MANUAL_INTENT_ALREADY_REVIEWED_TODAY');
  } finally {
    database.close();
  }
});

test('manual intent enforces daily capacity and expires unfinished prior-day intents', () => {
  const database = new DatabaseService(':memory:');
  const items = Array.from({ length: 6 }, (_, index) => seedScheduledItem(database.db, `manual-cap-${index + 1}`));
  const now = { value: '2026-07-14T01:00:00.000Z' };
  const service = new LearningService({ db: database.db, now: () => now.value });
  try {
    service.putPlan({ expectedRevision: 0, scope, dailyActionGoal: 5, dailyNewLimit: 0 });
    for (const item of items.slice(0, 5)) {
      service.addManualQueueIntent({
        intentKey: crypto.randomUUID(),
        studyItemId: item.studyItemId,
        confirmed: true,
      });
    }
    assert.throws(() => service.addManualQueueIntent({
      intentKey: crypto.randomUUID(),
      studyItemId: items[5].studyItemId,
      confirmed: true,
    }), (error) => error.code === 'LEARNING_MANUAL_INTENT_LIMIT_REACHED');

    now.value = '2026-07-15T01:00:00.000Z';
    service.ensureTodayQueue();
    assert.equal(database.db.prepare(`
      SELECT COUNT(*) AS count FROM learning_manual_queue_intents WHERE status = 'expired'
    `).get().count, 5);
  } finally {
    database.close();
  }
});

test('manual intent rejects an active session bound to another queue', () => {
  const database = new DatabaseService(':memory:');
  const scheduled = seedScheduledItem(database.db, 'manual-session-conflict');
  const service = new LearningService({
    db: database.db,
    now: () => '2026-07-14T01:00:00.000Z',
  });
  try {
    service.putPlan({ expectedRevision: 0, scope, dailyActionGoal: 5, dailyNewLimit: 0 });
    service.ensureTodayQueue();
    const oldQueueId = Number(database.db.prepare(`
      INSERT INTO learning_daily_queues(
        plan_id, learning_day, time_zone, plan_revision, profile_revision,
        status, snapshot_json, created_at_utc, updated_at_utc
      ) VALUES (1, '2026-07-13', 'Asia/Shanghai', 1, 1, 'active', '{}', ?, ?)
    `).run('2026-07-13T01:00:00.000Z', '2026-07-13T01:00:00.000Z').lastInsertRowid);
    database.db.prepare(`
      INSERT INTO learning_sessions(queue_id, status, started_at_utc, last_activity_at_utc)
      VALUES (?, 'active', ?, ?)
    `).run(oldQueueId, '2026-07-13T01:00:00.000Z', '2026-07-13T01:00:00.000Z');
    assert.throws(() => service.addManualQueueIntent({
      intentKey: crypto.randomUUID(),
      studyItemId: scheduled.studyItemId,
      confirmed: true,
    }), (error) => error.code === 'LEARNING_ACTIVE_SESSION_CONFLICT');
    assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM learning_manual_queue_intents').get().count, 0);
  } finally {
    database.close();
  }
});
