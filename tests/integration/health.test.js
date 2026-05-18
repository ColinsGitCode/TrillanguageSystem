'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { api, closeServer } = require('./_harness');

test.after(async () => { await closeServer(); });

test.describe('/api/health + /api/gemini/auth/*', () => {
  test.it('GET /api/health returns the overall status + e2e flag', async () => {
    const res = await api('GET', '/api/health');
    assert.equal(res.status, 200);
    // HealthCheckService.checkAll() returns an object with services and system.
    assert.ok(res.body && typeof res.body === 'object');
    assert.equal(res.body.e2e_test_mode, true, 'e2e_test_mode should be reflected');
  });

  test.it('GET /api/gemini/auth/status returns enabled flag based on GEMINI_MODE', async () => {
    const res = await api('GET', '/api/gemini/auth/status');
    assert.equal(res.status, 200);
    // GEMINI_MODE is unset under the test harness, so default 'host-proxy' applies → enabled=false.
    assert.equal(typeof res.body.enabled, 'boolean');
  });

  test.it('POST /api/gemini/auth/start 400 when CLI not enabled', async () => {
    const res = await api('POST', '/api/gemini/auth/start');
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Gemini CLI not enabled');
  });

  test.it('POST /api/gemini/auth/submit 400 when code missing', async () => {
    const res = await api('POST', '/api/gemini/auth/submit', { body: {} });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Missing authorization code');
  });

  test.it('POST /api/gemini/auth/cancel returns a result object', async () => {
    const res = await api('POST', '/api/gemini/auth/cancel');
    assert.equal(res.status, 200);
    assert.ok(res.body && typeof res.body === 'object');
  });
});
