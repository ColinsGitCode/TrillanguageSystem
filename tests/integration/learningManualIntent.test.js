'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { api, closeServer, dbService, resetState } = require('./_harness');
const { seedStudyItem } = require('../helpers/learningFixtures');

const scope = {
  version: 1,
  languages: ['en'],
  cardTypes: ['trilingual'],
  dateRange: null,
  tags: [],
};

function seedScheduledItem(phrase) {
  const seeded = seedStudyItem(dbService.db, { phrase, unitKey: `${phrase}-en` });
  dbService.db.prepare(`
    INSERT INTO learning_schedule_states(
      study_item_id, fsrs_state, due_at_utc, last_reviewed_at_utc,
      stability, difficulty, elapsed_days, scheduled_days, reps, lapses, step,
      version, last_event_id, algorithm_id, algorithm_version, parameters_hash,
      updated_at_utc
    ) VALUES (?, 'review', '2099-07-20T01:00:00.000Z', '2026-07-13T01:00:00.000Z',
      3, 5, 1, 7, 1, 0, 0, 1, NULL, 'fsrs', '6', ?,
      '2026-07-13T01:00:00.000Z')
  `).run(seeded.studyItemId, 'f'.repeat(64));
  return seeded;
}

test.beforeEach(() => resetState());
test.after(() => closeServer());

test('manual queue intent API recovers state and uses the normal review transaction', async () => {
  const scheduled = seedScheduledItem('api-manual-scheduled');
  const fresh = seedStudyItem(dbService.db, { phrase: 'api-manual-fresh', unitKey: 'api-manual-fresh-en' });
  const empty = await api('GET', '/api/learning/manual-queue-intents/today');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.intents, []);
  assert.equal(empty.body.emptyReason, 'not-created');

  await api('PUT', '/api/learning/plan', {
    body: { expectedRevision: 0, scope, dailyActionGoal: 5, dailyNewLimit: 1 },
  });
  const beforeSchedule = dbService.db.prepare(
    'SELECT * FROM learning_schedule_states WHERE study_item_id = ?'
  ).get(scheduled.studyItemId);
  const key = crypto.randomUUID();
  const added = await api('POST', '/api/learning/manual-queue-intents', {
    body: { intentKey: key, studyItemId: scheduled.studyItemId, confirmed: true },
  });
  assert.equal(added.status, 200);
  assert.equal(added.body.intent.status, 'active');
  assert.equal(added.body.entry.reason, 'manual-lookup');
  assert.equal(added.body.entry.bucket, 5);
  assert.equal(added.body.capacity.used, 1);
  assert.deepEqual(
    dbService.db.prepare('SELECT * FROM learning_schedule_states WHERE study_item_id = ?').get(scheduled.studyItemId),
    beforeSchedule
  );
  assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM learning_review_events').get().count, 0);

  const recovered = await api('GET', '/api/learning/manual-queue-intents/today');
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.intents[0].intentKey, key);
  assert.equal(recovered.body.intents[0].entry.reason, 'manual-lookup');

  const retried = await api('POST', '/api/learning/manual-queue-intents', {
    body: { intentKey: key, studyItemId: scheduled.studyItemId, confirmed: true },
  });
  assert.equal(retried.body.idempotent, true);
  assert.equal(retried.body.intent.id, added.body.intent.id);

  const freshRejected = await api('POST', '/api/learning/manual-queue-intents', {
    body: { intentKey: crypto.randomUUID(), studyItemId: fresh.studyItemId, confirmed: true },
  });
  assert.equal(freshRejected.status, 409);
  assert.equal(freshRejected.body.code, 'LEARNING_MANUAL_INTENT_INELIGIBLE');

  const started = await api('POST', '/api/learning/sessions', { body: { queueId: added.body.intent.queueId } });
  assert.equal(started.status, 200);
  assert.equal(started.body.session.currentEntry.studyItemId, scheduled.studyItemId);
  await api('POST', `/api/learning/sessions/${started.body.session.id}/reveal`, {
    body: { queueEntryId: started.body.session.currentEntry.id },
  });
  const reviewed = await api('POST', `/api/learning/sessions/${started.body.session.id}/reviews`, {
    body: {
      eventKey: crypto.randomUUID(),
      queueEntryId: started.body.session.currentEntry.id,
      studyItemId: scheduled.studyItemId,
      rating: 4,
      expectedScheduleVersion: 1,
      responseMs: 800,
    },
  });
  assert.equal(reviewed.status, 200);
  const after = await api('GET', '/api/learning/manual-queue-intents/today');
  assert.equal(after.body.intents[0].status, 'completed');
  assert.equal(after.body.intents[0].completionReviewEventId, reviewed.body.reviewEvent.id);

  const history = await api('GET', '/api/learning/history?range=7');
  assert.equal(history.body.overview.manualAssigned, 1);
  assert.equal(history.body.overview.manualReviewed, 1);
  assert.equal(history.body.overview.manualCompletionRate, 1);
});
