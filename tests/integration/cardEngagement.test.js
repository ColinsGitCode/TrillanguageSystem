'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { api, closeServer, dbService, resetState } = require('./_harness');
const { seedStudyItem } = require('../helpers/learningFixtures');
const { CardEngagementPlanningSignalReader } = require('../../services/cardEngagement/cardEngagementPlanningSignalReader');

const scope = {
  version: 1,
  languages: ['en'],
  cardTypes: ['trilingual'],
  dateRange: null,
  tags: [],
};

function seedScheduledCard() {
  const seeded = seedStudyItem(dbService.db, {
    phrase: 'engagement fixture',
    unitKey: 'engagement-fixture-en',
  });
  dbService.db.prepare(`
    INSERT INTO learning_schedule_states(
      study_item_id, fsrs_state, due_at_utc, last_reviewed_at_utc,
      stability, difficulty, elapsed_days, scheduled_days, reps, lapses, step,
      version, last_event_id, algorithm_id, algorithm_version, parameters_hash,
      updated_at_utc
    ) VALUES (?, 'review', '2099-08-03T00:00:00.000Z', '2026-08-01T00:00:00.000Z',
      3, 5, 1, 7, 1, 0, 0, 1, NULL, 'fsrs', '6', ?,
      '2026-08-01T00:00:00.000Z')
  `).run(seeded.studyItemId, 'f'.repeat(64));
  return seeded;
}

test.beforeEach(resetState);
test.after(closeServer);

test('preflights an existing card, records metrics and adds it to today without moving it', async () => {
  const seeded = seedScheduledCard();
  await api('PUT', '/api/learning/plan', {
    body: { expectedRevision: 0, scope, dailyActionGoal: 5, dailyNewLimit: 1 },
  });
  const preflightKey = `preflight:${crypto.randomUUID()}`;
  const preflight = await api('POST', '/api/generation-jobs/preflight', {
    body: {
      phrase: 'engagement fixture',
      card_type: 'trilingual',
      interaction_key: preflightKey,
    },
  });
  assert.equal(preflight.status, 200);
  assert.equal(preflight.body.duplicates.length, 1);
  assert.equal(preflight.body.duplicates[0].generationId, seeded.generationId);
  assert.equal(preflight.body.duplicates[0].folderName, '20260714');

  const repeated = await api('POST', '/api/generation-jobs/preflight', {
    body: {
      phrase: 'engagement fixture',
      card_type: 'trilingual',
      interaction_key: preflightKey,
    },
  });
  assert.equal(repeated.status, 200);
  assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM card_engagement_events').get().count, 2);

  const before = await api('GET', `/api/card-engagement/generations/${seeded.generationId}/stats`);
  assert.equal(before.body.stats.generationRequests, 1);
  assert.equal(before.body.stats.duplicateHits, 1);
  assert.equal(before.body.stats.successfulVersions, 1);

  const sibling = seedStudyItem(dbService.db, {
    phrase: 'engagement fixture',
    unitKey: 'engagement-fixture-version-two',
    base: 'engagement-fixture-version-two',
  });
  const attention = new CardEngagementPlanningSignalReader({ db: dbService.db }).readPlanningSignal({
    generationId: sibling.generationId,
  }, { nowUtc: new Date().toISOString() });
  assert.equal(attention.score, 3);
  assert.equal(attention.reasons[0].code, 'repeated-generation-query');

  const added = await api('POST', `/api/learning/generations/${seeded.generationId}/add-to-today`, {
    body: { requestKey: `add-today:${crypto.randomUUID()}` },
  });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  assert.equal(added.body.learning.queued, 1);
  assert.equal(added.body.learning.total, 1);

  const today = await api('GET', '/api/card-engagement/today');
  assert.equal(today.status, 200, JSON.stringify(today.body));
  assert.deepEqual(today.body.cards.map((card) => card.id), [seeded.generationId]);
  assert.equal(today.body.cards[0].folder, '20260714');

  const after = await api('GET', `/api/card-engagement/generations/${seeded.generationId}/stats`);
  assert.equal(after.body.stats.addedToToday, 1);
  assert.ok(after.body.stats.attentionScore > 0);
  const history = await api('GET', '/api/learning/history?range=30');
  assert.equal(history.body.engagement.generationRequests, 1);
  assert.equal(history.body.engagement.duplicateHits, 1);
  assert.equal(history.body.engagement.addedToToday, 1);
});

test('keeps engagement facts append-only', async () => {
  const seeded = seedScheduledCard();
  const recorded = await api('POST', '/api/card-engagement/events', {
    body: {
      eventKey: `card-open:${crypto.randomUUID()}`,
      generationId: seeded.generationId,
      phrase: 'engagement fixture',
      cardType: 'trilingual',
      eventKind: 'existing_card_opened',
      sourceSurface: 'card_modal',
    },
  });
  assert.equal(recorded.status, 200);
  assert.throws(
    () => dbService.db.prepare('UPDATE card_engagement_events SET learning_day = learning_day').run(),
    /immutable/u
  );
  assert.throws(
    () => dbService.db.prepare('DELETE FROM card_engagement_events').run(),
    /immutable/u
  );
  assert.ok(dbService.deleteGeneration(seeded.generationId));
  const retained = dbService.db.prepare(
    'SELECT generation_id FROM card_engagement_events WHERE event_key = ?'
  ).get(recorded.body.event.eventKey);
  assert.equal(Number(retained.generation_id), seeded.generationId);
});
