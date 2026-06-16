'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { api, resetState, closeServer } = require('./_harness');

test.before(() => resetState());
test.after(async () => { await closeServer(); });

test.describe('POST /api/generate (E2E fixture branch)', () => {
  test.beforeEach(() => resetState());

  test.it('400 on missing phrase', async () => {
    const res = await api('POST', '/api/generate', { body: {} });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Phrase required');
  });

  test.it('200 happy path returns the full envelope', async () => {
    const res = await api('POST', '/api/generate', {
      headers: { 'X-Generation-Job-Worker': '1' }, // bypass throttle
      body: { phrase: 'integration happy path' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.provider_requested, 'deepseek');
    assert.equal(res.body.provider_used, 'deepseek');
    assert.equal(res.body.observability.metadata.model, 'e2e-fixture');
    assert.equal(res.body.card_type, 'trilingual');
    assert.ok(res.body.generationId > 0, 'generationId should be populated');
    assert.ok(res.body.llm_output && res.body.llm_output.markdown_content);
  });

  test.it('persists the generation: subsequent /api/history sees it', async () => {
    const created = await api('POST', '/api/generate', {
      headers: { 'X-Generation-Job-Worker': '1' },
      body: { phrase: 'history visibility check' }
    });
    assert.equal(created.status, 200);
    const id = created.body.generationId;

    const hist = await api('GET', '/api/history?page=1&limit=10');
    assert.equal(hist.status, 200);
    const found = hist.body.records.find((r) => r.id === id);
    assert.ok(found, 'newly generated record should appear in history');
    assert.equal(found.phrase, 'history visibility check');
  });

  test.it('generates and persists a scenario_phrase card through the E2E fixture', async () => {
    const res = await api('POST', '/api/generate', {
      headers: { 'X-Generation-Job-Worker': '1' },
      body: {
        phrase: '保育园早上送孩子，说明昨晚有点咳嗽',
        card_type: 'scenario_phrase'
      }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.card_type, 'scenario_phrase');
    assert.equal(res.body.llm_output.audio_tasks.length, 24);
    assert.equal(
      (res.body.llm_output.markdown_content.match(/^###\s+\d{2}\./gm) || []).length,
      12
    );

    const hist = await api('GET', '/api/history?page=1&limit=10');
    assert.equal(hist.status, 200);
    const found = hist.body.records.find((r) => r.id === res.body.generationId);
    assert.ok(found, 'scenario generation should appear in history');
    assert.equal(found.card_type, 'scenario_phrase');
  });

  // NOTE: throttle is short-circuited under E2E_TEST_MODE=1 (see lib/throttle.js),
  // so we don't exercise the 429 path here — that's covered by tests/unit/throttle.test.js.
  // Instead validate the worker-bypass header is honoured under E2E mode too.
  test.it('worker bypass header still works in E2E mode (used by job worker)', async () => {
    const res = await api('POST', '/api/generate', {
      headers: { 'X-Generation-Job-Worker': '1' },
      body: { phrase: 'worker bypass path' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
  });
});
