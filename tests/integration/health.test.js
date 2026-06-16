'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DEEPSEEK_API_KEY = '';
process.env.DEEPSEEK_BASE_URL = '';
process.env.DEEPSEEK_MODEL = '';
process.env.GEMINI_API_KEY = '';
process.env.GEMINI_MODE = '';

const { api, closeServer } = require('./_harness');

test.after(async () => { await closeServer(); });

test.describe('/api/health + removed /api/gemini/auth/* routes', () => {
  test.it('GET /api/health returns online DeepSeek API health in E2E mode without a key', async () => {
    const res = await api('GET', '/api/health');
    assert.equal(res.status, 200);
    assert.ok(res.body && typeof res.body === 'object');
    assert.equal(res.body.e2e_test_mode, true, 'e2e_test_mode should be reflected');

    const services = Array.isArray(res.body.services) ? res.body.services : [];
    const serviceNames = services.map((service) => service.name);
    assert.ok(
      serviceNames.every((name) => !/gemini/i.test(name)),
      `health services should not expose Gemini LLM checks: ${serviceNames.join(', ')}`
    );

    const deepSeekApi = services.find((service) => service.name === 'DeepSeek API');
    assert.ok(deepSeekApi, 'DeepSeek API health service should be present');
    assert.equal(deepSeekApi.type, 'llm');
    assert.equal(deepSeekApi.critical, true);
    assert.equal(deepSeekApi.status, 'online');
    assert.equal(deepSeekApi.details?.model, 'deepseek-v4-flash');
    assert.equal(deepSeekApi.details?.fixtureSafe, true);
  });

  [
    ['GET', '/api/gemini/auth/status'],
    ['POST', '/api/gemini/auth/start'],
    ['POST', '/api/gemini/auth/submit'],
    ['POST', '/api/gemini/auth/cancel'],
  ].forEach(([method, route]) => {
    test.it(`${method} ${route} returns Express 404`, async () => {
      const res = await api(method, route, { body: method === 'POST' ? {} : undefined });

      assert.equal(res.status, 404);
    });
  });
});
