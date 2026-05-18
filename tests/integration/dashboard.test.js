'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { api, resetState, closeServer } = require('./_harness');

test.before(() => resetState());
test.after(async () => { await closeServer(); });

test.describe('/api/dashboard/*', () => {
  test.beforeEach(() => resetState());

  for (const path of [
    '/api/dashboard/review-stats',
    '/api/dashboard/fewshot-stats',
    '/api/dashboard/highlight-stats',
  ]) {
    test.it(`GET ${path} returns 200 + object on empty DB`, async () => {
      const res = await api('GET', path);
      assert.equal(res.status, 200, `expected 200 from ${path}, got ${res.status}`);
      assert.ok(res.body && typeof res.body === 'object');
    });
  }

  test.it('GET /api/dashboard/highlight-stats reflects an inserted highlight', async () => {
    await api('PUT', '/api/highlights/by-file', {
      body: {
        folder: 'dash-folder',
        base: 'dash-base',
        sourceHash: 'h1',
        html: '<p><mark class="study-highlight-red">test</mark></p>',
        version: 1
      }
    });
    const res = await api('GET', '/api/dashboard/highlight-stats');
    assert.equal(res.status, 200);
    // The shape varies; just assert it now has at least one non-zero counter somewhere.
    assert.ok(JSON.stringify(res.body).includes('1'), 'expected at least one count of 1 after insert');
  });
});
