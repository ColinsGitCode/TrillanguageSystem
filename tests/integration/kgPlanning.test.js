'use strict';

process.env.KG_ENABLED = '1';
process.env.KG_PLANNING_ENABLED = '1';
process.env.KG_LLM_ENRICHMENT_ENABLED = '0';

const assert = require('node:assert/strict');
const test = require('node:test');
const { api, closeServer, dbService, resetState } = require('./_harness');
const { seedStudyItem } = require('../helpers/learningFixtures');

const scope = {
  version: 1,
  languages: ['en', 'ja'],
  cardTypes: ['trilingual'],
  dateRange: null,
  tags: [],
};

test.beforeEach(() => resetState());
test.after(() => closeServer());

test('KG-P2 reorders only the selected base set and persists a public provider explanation', async () => {
  const first = seedStudyItem(dbService.db, { phrase: 'first item', unitKey: 'kg-p2-first' });
  const second = seedStudyItem(dbService.db, { phrase: 'second item', unitKey: 'kg-p2-second' });
  const third = seedStudyItem(dbService.db, { phrase: 'third item', unitKey: 'kg-p2-third' });
  dbService.db.prepare(`
    INSERT INTO kg_planning_signals(
      study_item_id, score, point_ids_json, groups_json, reasons_json,
      evidence_json, signal_version, source_watermark_json, computed_at_utc
    ) VALUES (?, 24, '[17]', '["lookup-difficulty"]',
      '[{"code":"recent-lookup","label":"近期重复检索，建议在基础队列内提前复习"}]',
      '[{"source":"kg-lookup-signal-v1"}]', 'kg-lookup-signal-v1', '{}',
      '2026-07-16T03:00:00.000Z')
  `).run(second.studyItemId);
  const factsBefore = dbService.db.prepare('SELECT COUNT(*) AS count FROM kg_lookup_events').get().count;

  await api('PUT', '/api/learning/plan', {
    body: { expectedRevision: 0, scope, dailyActionGoal: 20, dailyNewLimit: 3 },
  });
  const response = await api('POST', '/api/learning/queues/today');

  assert.equal(response.status, 200);
  const entries = response.body.queue.entries;
  assert.deepEqual(new Set(entries.map((entry) => entry.studyItemId)), new Set([
    first.studyItemId,
    second.studyItemId,
    third.studyItemId,
  ]));
  assert.equal(entries[0].studyItemId, second.studyItemId);
  assert.equal(entries[0].providerScore, 24);
  assert.equal(response.body.queue.snapshot.planning.diagnostics['graph-contract'].applied, 1);
  const graph = entries[0].explanation.provider.sources.find((source) => source.providerId === 'graph-contract');
  assert.deepEqual(graph.reasons, [{
    code: 'recent-lookup',
    label: '近期重复检索，建议在基础队列内提前复习',
  }]);
  assert.deepEqual(graph.evidence, [{
    source: 'kg-lookup-signal-v1',
    ruleVersion: 'kg-lookup-signal-v1',
    ruleKey: 'point:17',
  }]);
  assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM kg_lookup_events').get().count, factsBefore);
  assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM learning_review_events').get().count, 0);
  assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM learning_schedule_states').get().count, 0);
});
