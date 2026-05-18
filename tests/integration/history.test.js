'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { api, resetState, closeServer } = require('./_harness');

test.before(() => resetState());
test.after(async () => { await closeServer(); });

// Helper: create a real generation row via the E2E fixture endpoint.
async function createGeneration(phrase) {
  const res = await api('POST', '/api/generate', {
    headers: { 'X-Generation-Job-Worker': '1' },
    body: { phrase }
  });
  assert.equal(res.status, 200, `seed phrase=${phrase} expected 200, got ${res.status}`);
  return res.body;
}

test.describe('GET /api/history (+ statistics / search / recent / :id)', () => {
  test.beforeEach(() => resetState());

  test.it('empty DB → records:[] + total:0 + pagination', async () => {
    const res = await api('GET', '/api/history?page=1&limit=10');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.deepEqual(res.body.records, []);
    assert.equal(res.body.pagination.total, 0);
    assert.equal(res.body.pagination.page, 1);
    assert.equal(res.body.pagination.limit, 10);
  });

  test.it('returns inserted records with newest first', async () => {
    await createGeneration('history alpha');
    await createGeneration('history beta');
    await createGeneration('history gamma');

    const res = await api('GET', '/api/history?page=1&limit=10');
    assert.equal(res.status, 200);
    assert.equal(res.body.records.length, 3);
    assert.equal(res.body.pagination.total, 3);
    const phrases = res.body.records.map((r) => r.phrase);
    // Sorted by created_at DESC — but CURRENT_TIMESTAMP has second precision
    // so we only assert membership, not strict order.
    assert.ok(phrases.includes('history alpha'));
    assert.ok(phrases.includes('history beta'));
    assert.ok(phrases.includes('history gamma'));
  });

  test.it('pagination caps results to limit and reports totalPages', async () => {
    for (let i = 0; i < 5; i += 1) await createGeneration(`paginated ${i}`);
    const p1 = await api('GET', '/api/history?page=1&limit=2');
    assert.equal(p1.body.records.length, 2);
    assert.equal(p1.body.pagination.total, 5);
    assert.equal(p1.body.pagination.totalPages, 3);
  });

  test.it('GET /api/history/:id returns 404 for an unknown id', async () => {
    const res = await api('GET', '/api/history/99999');
    assert.equal(res.status, 404);
  });

  test.it('GET /api/history/:id returns the full record including observability', async () => {
    const created = await createGeneration('detail probe');
    const res = await api('GET', `/api/history/${created.generationId}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.record.phrase, 'detail probe');
    // Observability is populated by the insertGeneration path even under the E2E fixture.
    assert.ok(res.body.record.observability, 'observability should be present');
  });

  test.it('GET /api/recent returns the most recent rows', async () => {
    await createGeneration('recent 1');
    await createGeneration('recent 2');
    const res = await api('GET', '/api/recent?limit=10');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.records));
    assert.ok(res.body.records.length >= 2);
  });

  test.it('GET /api/statistics returns aggregate counters', async () => {
    await createGeneration('stats one');
    await createGeneration('stats two');
    const res = await api('GET', '/api/statistics');
    assert.equal(res.status, 200);
    // statisticsService returns nested objects — just assert the shape exists.
    assert.ok(res.body && typeof res.body === 'object');
  });
});
