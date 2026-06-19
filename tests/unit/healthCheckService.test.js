'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function clearHealthModuleCache() {
  [
    '../../services/observability/healthCheckService',
    '../../lib/serverConfig',
  ].forEach((modulePath) => {
    delete require.cache[require.resolve(modulePath)];
  });
}

function loadHealthCheckService() {
  clearHealthModuleCache();
  return require('../../services/observability/healthCheckService').HealthCheckService;
}

function withEnv(values, fn) {
  const saved = {};
  for (const key of Object.keys(values)) {
    saved[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(values)) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
      clearHealthModuleCache();
    });
}

test.describe('HealthCheckService DeepSeek health', () => {
  test.it('reports missing DeepSeek key as degraded critical health outside E2E mode', async (t) => {
    const recordsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'health-records-'));
    t.after(() => fs.rmSync(recordsPath, { recursive: true, force: true }));

    await withEnv({
      E2E_TEST_MODE: undefined,
      DEEPSEEK_API_KEY: '',
      DEEPSEEK_BASE_URL: '',
      DEEPSEEK_MODEL: '',
      LLM_BASE_URL: '',
      TTS_EN_ENDPOINT: '',
      TTS_JA_ENDPOINT: '',
      OCR_PROVIDER: '',
      OCR_TESSERACT_ENDPOINT: '',
      RECORDS_PATH: recordsPath,
      LOG_SILENT: '1',
    }, async () => {
      const HealthCheckService = loadHealthCheckService();

      const health = await HealthCheckService.checkAll();
      const deepSeekApi = health.services.find((service) => service.name === 'DeepSeek API');

      assert.ok(deepSeekApi, 'DeepSeek API service should be present');
      assert.equal(deepSeekApi.type, 'llm');
      assert.equal(deepSeekApi.critical, true);
      assert.equal(deepSeekApi.status, 'offline');
      assert.equal(deepSeekApi.message, 'DeepSeek API key is not configured');
      assert.equal(deepSeekApi.details?.fixtureSafe, false);

      assert.equal(health.system.overallStatus, 'degraded');
      assert.equal(health.system.criticalOnline, false);
      assert.deepEqual(
        health.system.criticalServices.find((service) => service.name === 'DeepSeek API'),
        {
          name: 'DeepSeek API',
          status: 'offline',
          message: 'DeepSeek API key is not configured',
        }
      );
    });
  });
});

test.describe('HealthCheckService Japanese TTS health', () => {
  test.it('checks Style-Bert-VITS2 primary and VOICEVOX fallback independently', async (t) => {
    const recordsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'health-records-'));
    t.after(() => fs.rmSync(recordsPath, { recursive: true, force: true }));

    const originalFetch = global.fetch;
    t.after(() => { global.fetch = originalFetch; });

    global.fetch = async (url) => {
      const href = String(url);
      if (href === 'http://sbv2:5000/status') {
        return Response.json({ devices: ['cpu'] });
      }
      if (href === 'http://voicevox:50021/version') {
        return new Response('0.21.0', { status: 200 });
      }
      throw new Error(`unexpected fetch ${href}`);
    };

    await withEnv({
      E2E_TEST_MODE: undefined,
      DEEPSEEK_API_KEY: '',
      DEEPSEEK_BASE_URL: '',
      DEEPSEEK_MODEL: '',
      LLM_BASE_URL: '',
      TTS_EN_ENDPOINT: '',
      TTS_JA_TYPE: 'style_bert_vits2',
      TTS_JA_SBV2_ENDPOINT: 'http://sbv2:5000',
      TTS_JA_ENDPOINT: 'http://voicevox:50021',
      OCR_PROVIDER: '',
      OCR_TESSERACT_ENDPOINT: '',
      RECORDS_PATH: recordsPath,
      LOG_SILENT: '1',
    }, async () => {
      const HealthCheckService = loadHealthCheckService();
      const health = await HealthCheckService.checkAll();

      const primary = health.services.find((service) => service.name === 'TTS Japanese Primary (Style-Bert-VITS2)');
      const fallback = health.services.find((service) => service.name === 'TTS Japanese Fallback (VOICEVOX)');

      assert.ok(primary, 'primary Japanese TTS service should be present');
      assert.ok(fallback, 'fallback Japanese TTS service should be present');
      assert.equal(primary.status, 'online');
      assert.equal(primary.details.endpoint, 'http://sbv2:5000');
      assert.equal(fallback.status, 'online');
      assert.equal(fallback.details.endpoint, 'http://voicevox:50021');
      assert.equal(fallback.details.version, '0.21.0');
    });
  });
});
