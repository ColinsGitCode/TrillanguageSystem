'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'three-lans-runtime-'));
process.env.DB_PATH = ':memory:';
process.env.E2E_TEST_MODE = '1';
process.env.LOG_SILENT = '1';
process.env.RECORDS_PATH = path.join(tmpRoot, 'owner-records');

const { createApp } = require('../../lib/httpRuntime');
const { resolveWorkspacePolicy } = require('../../lib/workspaceAccess');
const { sanitizePublicUrl } = require('../../routes/runtime');
const { SandboxQuotaService } = require('../../services/sandbox/sandboxQuotaService');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
      });
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test.describe('/api/runtime and workspace access middleware', () => {
  test.it('reports the default owner boundary without internal filesystem paths', async () => {
    const policy = resolveWorkspacePolicy({});
    const { server, baseUrl } = await listen(createApp({ workspacePolicy: policy }));
    try {
      const response = await fetch(`${baseUrl}/api/runtime`);
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(body.workspace.mode, 'owner');
      assert.equal(body.workspace.access, 'read-write');
      assert.equal(body.workspace.capabilities.ownerData, true);
      assert.equal(body.support.feedbackUrl, null);
      assert.deepEqual(body.observability.uiPerformance, {
        enabled: false,
        sampleRate: 0,
      });
      assert.equal(JSON.stringify(body).includes(tmpRoot), false);
    } finally {
      await close(server);
    }
  });

  test.it('accepts bounded UI performance metrics without recording page content', async () => {
    const policy = resolveWorkspacePolicy({});
    const { server, baseUrl } = await listen(createApp({ workspacePolicy: policy }));
    try {
      const accepted = await fetch(`${baseUrl}/api/ui-performance`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          version: 1,
          workspaceMode: 'owner',
          metrics: [{
            name: 'route-transition',
            value: 245.8,
            route: '/learn',
            context: 'client',
            phrase: 'must not be accepted',
          }],
        }),
      });
      assert.equal(accepted.status, 202);
      assert.equal((await accepted.json()).accepted, 1);

      const rejected = await fetch(`${baseUrl}/api/ui-performance`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          version: 1,
          metrics: [{ name: 'card-content', value: 1 }],
        }),
      });
      const rejectedBody = await rejected.json();
      assert.equal(rejected.status, 400);
      assert.equal(rejectedBody.code, 'UI_PERFORMANCE_INVALID');
    } finally {
      await close(server);
    }
  });

  test.it('allows reads but rejects writes before domain routes in a read-only sandbox', async () => {
    const workspaceId = 'sandbox_runtime_01';
    const instanceRoot = path.join(tmpRoot, workspaceId);
    const policy = resolveWorkspacePolicy({
      WORKSPACE_MODE: 'sandbox',
      DEPLOYMENT_EXPOSURE: 'public',
      SANDBOX_INSTANCE_ID: workspaceId,
      SANDBOX_STORAGE_ROOT: tmpRoot,
      DB_PATH: path.join(instanceRoot, 'records', 'records.db'),
      RECORDS_PATH: path.join(instanceRoot, 'records'),
      TEXTBOOK_SOURCE_ROOT: path.join(instanceRoot, 'source'),
      TEXTBOOK_WORK_PATH: path.join(instanceRoot, 'work'),
      SELECTION_TTS_CACHE_PATH: path.join(instanceRoot, 'tts-cache'),
    });
    const { server, baseUrl } = await listen(createApp({ workspacePolicy: policy }));
    try {
      const runtimeResponse = await fetch(`${baseUrl}/api/runtime`);
      const runtime = await runtimeResponse.json();
      assert.equal(runtime.workspace.mode, 'sandbox');
      assert.equal(runtime.workspace.access, 'read-only');

      const readResponse = await fetch(`${baseUrl}/api/history`);
      assert.equal(readResponse.status, 200);

      const writeResponse = await fetch(`${baseUrl}/api/learning/queues/today`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const writeBody = await writeResponse.json();
      assert.equal(writeResponse.status, 403);
      assert.equal(writeBody.code, 'WORKSPACE_READ_ONLY');
      assert.equal(writeBody.details.workspaceMode, 'sandbox');
      assert.equal(JSON.stringify(writeBody).includes(instanceRoot), false);
    } finally {
      await close(server);
    }
  });

  test.it('reports sandbox expiry and enforces a persistent high-cost quota', async () => {
    const workspaceId = 'sandbox_runtime_quota';
    const instanceRoot = path.join(tmpRoot, workspaceId);
    const expiresAtUtc = '2026-07-31T10:00:00.000Z';
    const policy = resolveWorkspacePolicy({
      WORKSPACE_MODE: 'sandbox',
      DEPLOYMENT_EXPOSURE: 'public',
      SANDBOX_INSTANCE_ID: workspaceId,
      SANDBOX_STORAGE_ROOT: tmpRoot,
      SANDBOX_WRITE_ENABLED: 'true',
      SANDBOX_HIGH_COST_ENABLED: 'true',
      SANDBOX_EXPIRES_AT_UTC: expiresAtUtc,
      SANDBOX_RESET_SUPPORTED: 'true',
      DB_PATH: path.join(instanceRoot, 'database', 'records.db'),
      RECORDS_PATH: path.join(instanceRoot, 'records'),
      TEXTBOOK_SOURCE_ROOT: path.join(instanceRoot, 'source'),
      TEXTBOOK_WORK_PATH: path.join(instanceRoot, 'work'),
      SELECTION_TTS_CACHE_PATH: path.join(instanceRoot, 'tts-cache'),
    });
    const quotaService = new SandboxQuotaService(policy, {
      generation: 1,
      ocr: 0,
      tts: 0,
      storageBytes: 1_000_000,
    });
    const { server, baseUrl } = await listen(createApp({
      workspacePolicy: policy,
      sandboxQuotaService: quotaService,
    }));
    try {
      const runtimeResponse = await fetch(`${baseUrl}/api/runtime`);
      const runtime = await runtimeResponse.json();
      assert.equal(runtime.workspace.access, 'read-write');
      assert.equal(runtime.workspace.resetSupported, true);
      assert.equal(runtime.sandbox.expiresAtUtc, expiresAtUtc);
      assert.equal(runtime.sandbox.quota.categories.generation.remaining, 1);

      const first = await fetch(`${baseUrl}/api/generation-jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      assert.notEqual(first.status, 429);
      assert.equal(first.headers.get('x-sandbox-quota-remaining'), '0');

      const second = await fetch(`${baseUrl}/api/generation-jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const body = await second.json();
      assert.equal(second.status, 429);
      assert.equal(body.code, 'SANDBOX_QUOTA_EXCEEDED');
      assert.equal(body.details.category, 'generation');
      assert.equal(body.details.quota.remaining, 0);
      assert.equal(JSON.stringify(body).includes(instanceRoot), false);
    } finally {
      await close(server);
      fs.rmSync(instanceRoot, { recursive: true, force: true });
    }
  });

  test.it('exposes only safe public feedback URLs', async () => {
    assert.equal(sanitizePublicUrl('https://support.example.com/three-lans'), 'https://support.example.com/three-lans');
    assert.equal(sanitizePublicUrl('mailto:support@example.com'), 'mailto:support@example.com');
    assert.equal(sanitizePublicUrl('javascript:alert(1)'), null);
    assert.equal(sanitizePublicUrl('http://internal.example.com'), null);

    const previous = process.env.PUBLIC_FEEDBACK_URL;
    process.env.PUBLIC_FEEDBACK_URL = 'https://support.example.com/three-lans';
    const policy = resolveWorkspacePolicy({});
    const { server, baseUrl } = await listen(createApp({ workspacePolicy: policy }));
    try {
      const response = await fetch(`${baseUrl}/api/runtime`);
      const body = await response.json();
      assert.equal(body.support.feedbackUrl, 'https://support.example.com/three-lans');
    } finally {
      if (previous === undefined) delete process.env.PUBLIC_FEEDBACK_URL;
      else process.env.PUBLIC_FEEDBACK_URL = previous;
      await close(server);
    }
  });

  test.it('reports first-use progress from persisted facts without creating learning state', async () => {
    const policy = resolveWorkspacePolicy({});
    const { server, baseUrl } = await listen(createApp({ workspacePolicy: policy }));
    try {
      const response = await fetch(`${baseUrl}/api/onboarding`);
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(body.success, true);
      assert.equal(body.version, 1);
      assert.equal(body.steps.length, 4);
      assert.equal(typeof body.completedCount, 'number');
      assert.equal(body.steps.some((step) => step.id === 'review'), true);
    } finally {
      await close(server);
    }
  });
});
