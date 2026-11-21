'use strict';

process.env.TEST_KG_ENABLED = '0';

const assert = require('node:assert/strict');
const test = require('node:test');
const { api, resetState, dbService, closeServer } = require('./_harness');

test.beforeEach(() => resetState());
test.after(async () => closeServer());

test('KG API is unavailable when its default-off feature flag is disabled', async () => {
  const response = await api('GET', '/api/kg/search?q=handoff');
  assert.equal(response.status, 404);
  assert.equal(response.body.code, 'KG_FEATURE_DISABLED');
});

test('Activity Center hides persisted KG attention when disabled without hiding other domains or writing data', async () => {
  dbService.db.prepare(`
    INSERT INTO kg_resolution_cases(
      case_key, case_kind, language, kp_kind_hint, normalized_input,
      candidates_json, status, revision, created_at_utc, updated_at_utc
    ) VALUES (?, 'ambiguous-surface', 'ja', 'lexeme', 'hidden-kg-case', '[]', 'open', 1, ?, ?)
  `).run('k'.repeat(64), '2026-07-30T12:00:00.000Z', '2026-07-30T12:00:00.000Z');
  const created = await api('POST', '/api/generation-jobs', {
    body: { phrase: 'activity with KG disabled', card_type: 'trilingual' },
  });
  assert.equal(created.status, 200);

  const casesBefore = dbService.db.prepare('SELECT * FROM kg_resolution_cases').all();
  const changesBefore = dbService.db.prepare('SELECT total_changes() AS count').get().count;
  const response = await api('GET', '/api/activity');
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.body.success, true);
  assert.equal(response.body.items.some((item) => item.source === 'knowledge'), false);
  assert.equal(response.rawText.includes('hidden-kg-case'), false);
  const generation = response.body.items.find((item) => item.kind === 'generation-job');
  assert.ok(generation, 'Disabling KG must not hide persisted card generation work');
  assert.equal(generation.id, String(created.body.job.id));
  assert.equal(generation.status, 'queued');
  assert.deepEqual(response.body.summary, { active: 1, needsAttention: 0, total: 1 });
  assert.deepEqual(response.body.sources.find((source) => source.id === 'knowledge'), {
    id: 'knowledge', status: 'available',
  });
  assert.deepEqual(dbService.db.prepare('SELECT * FROM kg_resolution_cases').all(), casesBefore);
  assert.equal(dbService.db.prepare('SELECT total_changes() AS count').get().count, changesBefore);
});
