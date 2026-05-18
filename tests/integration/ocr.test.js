'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { api, resetState, closeServer } = require('./_harness');

test.before(() => resetState());
test.after(async () => { await closeServer(); });

test.describe('POST /api/ocr', () => {
  test.it('400 when image missing', async () => {
    const res = await api('POST', '/api/ocr', { body: {} });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'No image');
  });

  test.it('E2E fixture returns the deterministic OCR text + provider:e2e-fixture', async () => {
    const res = await api('POST', '/api/ocr', { body: { image: 'data:image/png;base64,xxx' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.provider, 'e2e-fixture');
    assert.ok(res.body.text && res.body.text.length > 0);
  });

  test.it('E2E fixture branch wins even for unknown provider request', async () => {
    // The E2E_TEST_MODE short-circuit fires before the provider switch.
    const res = await api('POST', '/api/ocr', { body: { image: 'x', provider: 'definitely-not-real' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.provider, 'e2e-fixture');
  });
});
