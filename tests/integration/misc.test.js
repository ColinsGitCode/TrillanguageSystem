'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { api, resetState, closeServer } = require('./_harness');

test.before(() => resetState());
test.after(async () => { await closeServer(); });

test.describe('DELETE /api/records/:id', () => {
  test.beforeEach(() => resetState());

  test.it('DELETE /api/records/:id 404 when the record does not exist', async () => {
    const res = await api('DELETE', '/api/records/9999');
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Record not found');
  });

  test.it('DELETE /api/records/:id round-trip: create via /api/generate, delete, then 404', async () => {
    const created = await api('POST', '/api/generate', {
      headers: { 'X-Generation-Job-Worker': '1' },
      body: { phrase: 'misc delete me' }
    });
    assert.equal(created.status, 200);
    const id = created.body.generationId;

    const del = await api('DELETE', `/api/records/${id}`);
    assert.equal(del.status, 200);
    assert.equal(del.body.success, true);

    // Now the record is gone.
    const verify = await api('GET', `/api/history/${id}`);
    assert.equal(verify.status, 404);
  });
});
