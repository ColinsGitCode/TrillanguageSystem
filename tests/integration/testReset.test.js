'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { api, resetState, closeServer } = require('./_harness');

test.before(() => resetState());
test.after(async () => { await closeServer(); });

test.describe('POST /api/_test/reset (mounted only under E2E_TEST_MODE=1)', () => {
  test.it('POST /api/_test/reset returns ok:true', async () => {
    const res = await api('POST', '/api/_test/reset');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  test.it('reset wipes prior generations: /api/history goes empty', async () => {
    // Seed
    const created = await api('POST', '/api/generate', {
      headers: { 'X-Generation-Job-Worker': '1' },
      body: { phrase: 'will be wiped' }
    });
    assert.equal(created.status, 200);
    const before = await api('GET', '/api/history?page=1&limit=10');
    assert.equal(before.body.records.length, 1);

    // Reset
    const reset = await api('POST', '/api/_test/reset');
    assert.equal(reset.status, 200);

    const after = await api('GET', '/api/history?page=1&limit=10');
    assert.equal(after.body.records.length, 0);
    assert.equal(after.body.pagination.total, 0);
  });
});
