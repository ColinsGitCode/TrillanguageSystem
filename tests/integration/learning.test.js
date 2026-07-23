'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { api, closeServer, dbService, resetState } = require('./_harness');
const { seedStudyItem } = require('../helpers/learningFixtures');

const scope = {
  version: 1,
  languages: ['en', 'ja'],
  cardTypes: ['trilingual', 'grammar_ja', 'scenario_phrase', 'whole_card'],
  dateRange: null,
  tags: [],
};

test.beforeEach(() => resetState());
test.after(() => closeServer());

test.describe('Learning Assistance 2.0 API', () => {
  test.it('keeps GET plan and GET queue read-only before setup', async () => {
    const plan = await api('GET', '/api/learning/plan');
    assert.equal(plan.status, 200);
    assert.equal(plan.body.plan, null);
    assert.equal(plan.body.profile.persisted, false);
    const queue = await api('GET', '/api/learning/queues/today');
    assert.equal(queue.status, 200);
    assert.equal(queue.body.queue, null);
    const history = await api('GET', '/api/learning/history?range=30');
    assert.equal(history.status, 200);
    assert.equal(history.body.overview.totalReviews, 0);
    assert.equal(history.body.overview.currentOverdue, 0);
    assert.equal(history.body.daily.length, 30);
    assert.equal(history.body.dataQuality.historicalSkipMetricsAvailable, false);
    assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM learning_profiles').get().count, 0);
  });

  test.it('rejects unsupported history filters without writing state', async () => {
    const invalidRange = await api('GET', '/api/learning/history?range=365');
    assert.equal(invalidRange.status, 400);
    assert.equal(invalidRange.body.code, 'LEARNING_INVALID_REQUEST');
    const invalidKind = await api('GET', '/api/learning/history?unitKind=audio_only');
    assert.equal(invalidKind.status, 400);
    assert.equal(invalidKind.body.code, 'LEARNING_INVALID_REQUEST');
    assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM learning_review_events').get().count, 0);
  });

  test.it('previews arbitrary scopes and exposes queue-ready item summaries without writes', async () => {
    const english = seedStudyItem(dbService.db, { phrase: 'preview English', unitKey: 'preview-en' });
    seedStudyItem(dbService.db, {
      phrase: 'preview grammar',
      cardType: 'grammar_ja',
      unitKind: 'grammar_ja',
      unitKey: 'preview-grammar',
    });
    dbService.db.prepare(`
      INSERT INTO card_tags(
        generation_id, namespace, value, normalized_value, source, status,
        rule_version, rule_key, evidence_json
      ) VALUES (?, 'topic', 'work', 'work', 'rule', 'active', 'tags-v2', 'topic-work', '{"source":"fixture"}')
    `).run(english.generationId);

    const preview = await api('POST', '/api/learning/plan/preview', {
      body: { scope: { ...scope, languages: ['en'], cardTypes: ['trilingual'], tags: [{ namespace: 'topic', value: 'work' }] } },
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.scopePreview.generationCount, 1);
    assert.equal(preview.body.scopePreview.studyItemCount, 1);
    assert.equal(preview.body.planRevision, 0);
    assert.equal(preview.body.profileRevision, 0);
    assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM learning_plans').get().count, 0);

    const options = await api('GET', '/api/learning/scope-options');
    assert.equal(options.status, 200);
    assert.deepEqual(options.body.dateRange, { min: '2026-07-14', max: '2026-07-14' });
    assert.equal(options.body.tags.find((tag) => tag.namespace === 'topic' && tag.value === 'work').generationCount, 1);

    await api('PUT', '/api/learning/plan', {
      body: { expectedRevision: 0, scope, dailyActionGoal: 5, dailyNewLimit: 2 },
    });
    const ensured = await api('POST', '/api/learning/queues/today');
    assert.equal(ensured.body.queue.entries[0].itemSummary.title, 'preview English');
    assert.equal(ensured.body.queue.entries[0].itemSummary.unitKind, 'trilingual_en');
    assert.equal(ensured.body.queue.snapshot.version, 2);
    assert.equal(ensured.body.queue.snapshot.planning.contractVersion, 1);
    assert.equal(ensured.body.queue.snapshot.planning.diagnostics['heuristic-v1'].applied, 2);
    assert.equal(ensured.body.queue.snapshot.planning.diagnostics['graph-contract'].empty, 2);
    assert.equal(ensured.body.queue.entries[0].providerScore, 0);
    assert.equal(ensured.body.queue.entries[0].explanation.provider.sources[0].providerId, 'heuristic-v1');
    assert.deepEqual(ensured.body.queue.entries[0].explanation.provider.sources[0].evidence, [
      { source: 'rule', ruleVersion: 'tags-v2', ruleKey: 'topic-work' },
    ]);
  });

  test.it('runs plan, queue, resumable session, reveal and idempotent review end to end', async () => {
    const first = seedStudyItem(dbService.db, { phrase: 'first item', unitKey: 'en-first' });
    seedStudyItem(dbService.db, { phrase: 'second item', unitKey: 'en-second' });
    seedStudyItem(dbService.db, { phrase: 'third item', unitKey: 'en-third' });

    const created = await api('PUT', '/api/learning/plan', {
      body: { expectedRevision: 0, scope, dailyActionGoal: 20, dailyNewLimit: 2, timeZone: 'Asia/Shanghai' },
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.plan.revision, 1);
    assert.equal(created.body.scopePreview.studyItemCount, 3);
    const revisedPreview = await api('POST', '/api/learning/plan/preview', { body: { scope } });
    assert.equal(revisedPreview.body.planRevision, 1);
    assert.equal(revisedPreview.body.profileRevision, 1);

    const stale = await api('PUT', '/api/learning/plan', {
      body: { expectedRevision: 0, scope, dailyActionGoal: 20, dailyNewLimit: 2 },
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'LEARNING_PLAN_REVISION_CONFLICT');

    const ensured = await api('POST', '/api/learning/queues/today');
    assert.equal(ensured.status, 200);
    assert.equal(ensured.body.queue.entries.length, 2);
    assert.equal(ensured.body.queue.snapshot.summary.newAvailable, 3);
    const ensuredAgain = await api('POST', '/api/learning/queues/today');
    assert.equal(ensuredAgain.body.queue.id, ensured.body.queue.id);
    assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM learning_daily_queues').get().count, 1);

    const started = await api('POST', '/api/learning/sessions', { body: { queueId: ensured.body.queue.id } });
    assert.equal(started.status, 200);
    assert.equal(started.body.session.currentEntry.studyItemId, first.studyItemId);
    const sessionId = started.body.session.id;
    const entryId = started.body.session.currentEntry.id;

    const recovered = await api('GET', '/api/learning/sessions/active');
    assert.equal(recovered.body.session.id, sessionId);
    assert.equal(recovered.body.session.currentEntry.id, entryId);

    const item = await api('GET', `/api/learning/items/${first.studyItemId}`);
    assert.equal(item.status, 200);
    assert.equal(item.body.item.prompt.text, '中文提示');
    assert.match(item.body.item.answer.markdown, /Fixture learning content/u);

    const eventKey = crypto.randomUUID();
    const reviewBody = {
      eventKey,
      queueEntryId: entryId,
      studyItemId: first.studyItemId,
      rating: 4,
      expectedScheduleVersion: 0,
      responseMs: 1800,
    };
    const blocked = await api('POST', `/api/learning/sessions/${sessionId}/reviews`, { body: reviewBody });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, 'LEARNING_ANSWER_NOT_REVEALED');
    assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM learning_review_events').get().count, 0);

    const revealed = await api('POST', `/api/learning/sessions/${sessionId}/reveal`, { body: { queueEntryId: entryId } });
    assert.equal(revealed.status, 200);
    assert.equal(revealed.body.session.revealedEntryId, entryId);

    const staleSchedule = await api('POST', `/api/learning/sessions/${sessionId}/reviews`, {
      body: { ...reviewBody, eventKey: crypto.randomUUID(), expectedScheduleVersion: 1 },
    });
    assert.equal(staleSchedule.status, 409);
    assert.equal(staleSchedule.body.code, 'LEARNING_SCHEDULE_CONFLICT');
    assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM learning_review_events').get().count, 0);

    const reviewed = await api('POST', `/api/learning/sessions/${sessionId}/reviews`, { body: reviewBody });
    assert.equal(reviewed.status, 200);
    assert.equal(reviewed.body.idempotent, false);
    assert.equal(reviewed.body.reviewEvent.eventKey, eventKey);
    assert.equal(reviewed.body.scheduleState.version, 1);
    assert.equal(reviewed.body.queueProgress.actionCount, 1);
    assert.notEqual(reviewed.body.nextEntry.id, entryId);

    const history = await api('GET', '/api/learning/history?range=7&unitKind=trilingual_en');
    assert.equal(history.status, 200);
    assert.equal(history.body.range.preset, '7');
    assert.equal(history.body.range.unitKind, 'trilingual_en');
    assert.equal(history.body.overview.totalReviews, 1);
    assert.equal(history.body.overview.activeDays, 1);
    assert.equal(history.body.overview.queueDays, 1);
    assert.equal(history.body.overview.startedDays, 1);
    assert.equal(history.body.overview.newAssigned, 2);
    assert.equal(history.body.overview.newReviewed, 1);
    assert.equal(history.body.overview.newConversionRate, 0.5);
    assert.equal(history.body.overview.goalCompletionRate, null);
    assert.equal(history.body.overview.sessionCompletionRate, null);
    assert.equal(history.body.overview.averageResponseMs, 1800);
    assert.equal(history.body.overview.medianResponseMs, 1800);
    assert.equal(history.body.overview.baselineEstablished, false);
    assert.equal(history.body.overview.baselineRemainingDays, 13);
    assert.equal(history.body.ratings.find((rating) => rating.rating === 4).count, 1);
    assert.equal(history.body.breakdown[0].unitKind, 'trilingual_en');
    assert.equal(history.body.breakdown[0].averageRating, 4);
    assert.equal(history.body.recent[0].eventKey, eventKey);
    assert.equal(history.body.recent[0].title, 'first item');
    const reviewedItem = await api('GET', `/api/learning/items/${first.studyItemId}`);
    assert.equal(reviewedItem.body.item.expectedScheduleVersion, 1);
    assert.equal(reviewedItem.body.item.scheduleState.lastEventId, reviewed.body.reviewEvent.id);

    const retried = await api('POST', `/api/learning/sessions/${sessionId}/reviews`, { body: reviewBody });
    assert.equal(retried.status, 200);
    assert.equal(retried.body.idempotent, true);
    assert.equal(retried.body.reviewEvent.id, reviewed.body.reviewEvent.id);
    assert.equal(retried.body.scheduleState.version, 1);
    assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM learning_review_events').get().count, 1);

    const conflictingKey = await api('POST', `/api/learning/sessions/${sessionId}/reviews`, {
      body: { ...reviewBody, rating: 3 },
    });
    assert.equal(conflictingKey.status, 409);
    assert.equal(conflictingKey.body.code, 'LEARNING_IDEMPOTENCY_CONFLICT');

    const lookup = await api('GET', `/api/learning/reviews/by-key/${eventKey}`);
    assert.equal(lookup.status, 200);
    assert.equal(lookup.body.reviewEvent.id, reviewed.body.reviewEvent.id);

    const activeConflict = await api('POST', '/api/learning/plan/pause');
    assert.equal(activeConflict.status, 409);
    assert.equal(activeConflict.body.code, 'LEARNING_ACTIVE_SESSION_CONFLICT');
    const activePutConflict = await api('PUT', '/api/learning/plan', {
      body: { expectedRevision: 1, scope, dailyActionGoal: 20, dailyNewLimit: 2 },
    });
    assert.equal(activePutConflict.status, 409);
    assert.equal(activePutConflict.body.code, 'LEARNING_ACTIVE_SESSION_CONFLICT');

    const ended = await api('POST', `/api/learning/sessions/${sessionId}/end`);
    assert.equal(ended.status, 200);
    assert.equal(ended.body.session.status, 'ended');
    const paused = await api('POST', '/api/learning/plan/pause');
    assert.equal(paused.status, 200);
    assert.equal(paused.body.plan.status, 'paused');
    assert.equal(paused.body.plan.revision, 2);
    const pausedAgain = await api('POST', '/api/learning/plan/pause');
    assert.equal(pausedAgain.body.plan.revision, 2);
  });

  test.it('does not create a second review when schedule state advances before retry', async () => {
    const only = seedStudyItem(dbService.db, { phrase: 'single item', unitKey: 'single-en' });
    await api('PUT', '/api/learning/plan', {
      body: { expectedRevision: 0, scope, dailyActionGoal: 5, dailyNewLimit: 1 },
    });
    const queue = await api('POST', '/api/learning/queues/today');
    const started = await api('POST', '/api/learning/sessions', { body: { queueId: queue.body.queue.id } });
    const session = started.body.session;
    await api('POST', `/api/learning/sessions/${session.id}/reveal`, {
      body: { queueEntryId: session.currentEntry.id },
    });
    const body = {
      eventKey: crypto.randomUUID(),
      queueEntryId: session.currentEntry.id,
      studyItemId: only.studyItemId,
      rating: 4,
      expectedScheduleVersion: 0,
      responseMs: 900,
    };
    const first = await api('POST', `/api/learning/sessions/${session.id}/reviews`, { body });
    assert.equal(first.status, 200);
    const second = await api('POST', `/api/learning/sessions/${session.id}/reviews`, { body });
    assert.equal(second.status, 200);
    assert.equal(second.body.idempotent, true);
    assert.equal(second.body.reviewEvent.id, first.body.reviewEvent.id);
    assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM learning_review_events').get().count, 1);
  });

  test.it('skips without an event and restores skipped work when the session ends', async () => {
    seedStudyItem(dbService.db, { phrase: 'skip first', unitKey: 'skip-first' });
    seedStudyItem(dbService.db, { phrase: 'skip second', unitKey: 'skip-second' });
    await api('PUT', '/api/learning/plan', {
      body: { expectedRevision: 0, scope, dailyActionGoal: 5, dailyNewLimit: 2 },
    });
    const queue = await api('POST', '/api/learning/queues/today');
    const started = await api('POST', '/api/learning/sessions', { body: { queueId: queue.body.queue.id } });
    const firstEntry = started.body.session.currentEntry.id;
    const skipped = await api('POST', `/api/learning/sessions/${started.body.session.id}/skip`, {
      body: { queueEntryId: firstEntry },
    });
    assert.equal(skipped.status, 200);
    assert.notEqual(skipped.body.session.currentEntry.id, firstEntry);
    assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM learning_review_events').get().count, 0);
    await api('POST', `/api/learning/sessions/${started.body.session.id}/end`);
    assert.equal(dbService.db.prepare('SELECT status FROM learning_queue_entries WHERE id = ?').get(firstEntry).status, 'pending');
    const resumed = await api('POST', '/api/learning/sessions', { body: { queueId: queue.body.queue.id } });
    assert.equal(resumed.body.session.currentEntry.id, firstEntry);
  });

  test.it('returns a stable not-found result when an idempotency key was never committed', async () => {
    const missing = await api('GET', `/api/learning/reviews/by-key/${crypto.randomUUID()}`);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, 'LEARNING_REVIEW_NOT_FOUND');
  });

  test.it('increments profile revision and supersedes an unstarted queue when time zone changes', async () => {
    seedStudyItem(dbService.db, { phrase: 'timezone item', unitKey: 'timezone-en' });
    const created = await api('PUT', '/api/learning/plan', {
      body: { expectedRevision: 0, scope, dailyActionGoal: 5, dailyNewLimit: 1, timeZone: 'Asia/Shanghai' },
    });
    assert.equal(created.body.profile.revision, 1);
    const firstQueue = await api('POST', '/api/learning/queues/today');
    const changed = await api('PUT', '/api/learning/plan', {
      body: { expectedRevision: 1, scope, dailyActionGoal: 5, dailyNewLimit: 1, timeZone: 'Asia/Tokyo' },
    });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.plan.revision, 2);
    assert.equal(changed.body.profile.revision, 2);
    assert.equal(changed.body.profile.timeZone, 'Asia/Tokyo');
    assert.equal(
      dbService.db.prepare('SELECT status FROM learning_daily_queues WHERE id = ?').get(firstQueue.body.queue.id).status,
      'superseded'
    );
    const secondQueue = await api('POST', '/api/learning/queues/today');
    assert.notEqual(secondQueue.body.queue.id, firstQueue.body.queue.id);
    assert.equal(secondQueue.body.queue.profileRevision, 2);
    assert.equal(secondQueue.body.queue.timeZone, 'Asia/Tokyo');
  });
});
