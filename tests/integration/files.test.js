'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { api, resetState, closeServer } = require('./_harness');

test.before(() => resetState());
test.after(async () => { await closeServer(); });

test.describe('/api/folders + /api/records/by-file', () => {
  test.beforeEach(() => resetState());

  test.it('GET /api/folders returns an array', async () => {
    const response = await api('GET', '/api/folders');
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.folders));
  });

  test.it('retires legacy highlight and shadow-read endpoints', async () => {
    const requests = [
      ['GET', '/api/highlights/by-file?folder=20260101&base=hello&sourceHash=h1'],
      ['PUT', '/api/highlights/by-file', { body: {} }],
      ['DELETE', '/api/highlights/by-file?folder=20260101&base=hello&sourceHash=h1'],
      ['GET', '/api/annotations/shadow-status'],
    ];
    for (const [method, url, options] of requests) {
      const response = await api(method, url, options);
      assert.equal(response.status, 404);
    }
  });

  test.it('GET /api/records/by-file rejects a missing base', async () => {
    const response = await api('GET', '/api/records/by-file?folder=only');
    assert.equal(response.status, 400);
  });
});
