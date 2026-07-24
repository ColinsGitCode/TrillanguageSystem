'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { api, resetState, closeServer, dbService } = require('./_harness');
const { executeCardGeneration } = require('../../services/application/executeCardGeneration');

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
    assert.equal(res.body.admission.status, 'eligible');
    assert.equal(res.body.admission.contentHash.length, 64);
    const persisted = dbService.getGenerationById(res.body.generationId);
    assert.equal(persisted.content_hash, res.body.admission.contentHash);
    const tags = dbService.listCardTags(res.body.generationId);
    assert.equal(tags.filter((tag) => tag.namespace === 'lang').length, 1);
    assert.equal(tags.filter((tag) => tag.namespace === 'src').length, 1);
  });

  test.it('rejects a historical duplicate unless create-version is explicit', async () => {
    const first = await api('POST', '/api/generate', { body: { phrase: 'duplicate admission card' } });
    assert.equal(first.status, 200);

    const rejected = await api('POST', '/api/generate', { body: { phrase: '  DUPLICATE ADMISSION CARD  ' } });
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.code, 'CARD_DUPLICATE_EXISTS');
    assert.equal(dbService.getTotalCount(), 1);

    const version = await api('POST', '/api/generate', {
      body: { phrase: 'duplicate admission card', duplicate_policy: 'create-version' },
    });
    assert.equal(version.status, 200);
    assert.equal(version.body.duplicate_policy, 'create-version');
    assert.equal(dbService.getTotalCount(), 2);
  });

  test.it('keeps HTTP and direct invocation result contracts in parity', async () => {
    const direct = await executeCardGeneration({
      phrase: 'direct parity fixture',
      cardType: 'scenario_phrase',
      sourceMode: 'input',
      requestedProvider: 'deepseek',
    });
    const http = await api('POST', '/api/generate', {
      body: {
        phrase: 'http parity fixture',
        card_type: 'scenario_phrase',
        source_mode: 'input',
      },
    });

    assert.equal(http.status, 200);
    assert.deepEqual(Object.keys(http.body).sort(), Object.keys(direct).sort());
    assert.equal(http.body.card_type, direct.card_type);
    assert.equal(http.body.source_mode, direct.source_mode);
    assert.equal(http.body.provider_requested, direct.provider_requested);
    assert.equal(http.body.provider_used, direct.provider_used);
    assert.equal(http.body.fallback, direct.fallback);
    assert.equal(http.body.audio, direct.audio);
    assert.deepEqual(
      Object.keys(http.body.llm_output).sort(),
      Object.keys(direct.llm_output).sort()
    );
    assert.deepEqual(
      Object.keys(http.body.observability).sort(),
      Object.keys(direct.observability).sort()
    );
  });

  test.it('persists the generation: subsequent /api/history sees it', async () => {
    const created = await api('POST', '/api/generate', {
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
      body: {
        phrase: '保育园早上送孩子，说明昨晚有点咳嗽',
        card_type: 'scenario_phrase'
      }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.card_type, 'scenario_phrase');
    assert.equal(res.body.llm_output.audio_tasks.length, 40);
    assert.equal(
      (res.body.llm_output.markdown_content.match(/^###\s+\d{2}\./gm) || []).length,
      20
    );

    const hist = await api('GET', '/api/history?page=1&limit=10');
    assert.equal(hist.status, 200);
    const found = hist.body.records.find((r) => r.id === res.body.generationId);
    assert.ok(found, 'scenario generation should appear in history');
    assert.equal(found.card_type, 'scenario_phrase');
  });

  // Throttle is short-circuited only by process-level E2E_TEST_MODE; there is
  // no request header that production clients can use to bypass it.
  test.it('E2E mode remains deterministic without a production bypass header', async () => {
    const res = await api('POST', '/api/generate', {
      body: { phrase: 'test-only throttle bypass path' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
  });
});
