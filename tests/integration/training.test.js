'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { api, resetState, closeServer } = require('./_harness');

test.before(() => resetState());
test.after(async () => { await closeServer(); });

test.describe('/api/training/*', () => {
  test.beforeEach(() => resetState());

  test.it('GET /api/training/backfill/summary returns 0-shaped counters on empty DB', async () => {
    const res = await api('GET', '/api/training/backfill/summary');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.summary && typeof res.body.summary === 'object');
    assert.equal(res.body.summary.totalGenerations, 0);
    assert.equal(res.body.summary.missingTraining, 0);
  });

  test.it('GET /api/training/by-generation/:id 400 for invalid id', async () => {
    const res = await api('GET', '/api/training/by-generation/0');
    assert.equal(res.status, 400);
  });

  test.it('GET /api/training/by-generation/:id 404 for unknown id', async () => {
    const res = await api('GET', '/api/training/by-generation/9999');
    assert.equal(res.status, 404);
  });

  test.it('GET /api/training/by-file 400 when folder/base missing', async () => {
    const res = await api('GET', '/api/training/by-file');
    assert.equal(res.status, 400);
  });

  test.it('Round-trip: /api/generate (E2E) persists a training asset, then /api/training/by-generation finds it', async () => {
    const created = await api('POST', '/api/generate', {
      headers: { 'X-Generation-Job-Worker': '1' },
      body: { phrase: 'training round-trip seed' }
    });
    assert.equal(created.status, 200);
    const generationId = created.body.generationId;
    assert.ok(generationId > 0);

    const byGen = await api('GET', `/api/training/by-generation/${generationId}`);
    assert.equal(byGen.status, 200);
    assert.equal(byGen.body.success, true);
    assert.equal(byGen.body.training.generationId, generationId);
  });
});
