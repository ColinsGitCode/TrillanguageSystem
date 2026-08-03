'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const rootDir = path.resolve(__dirname, '../..');

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function waitForExit(child, timeoutMs = 10_000) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitForGateway(baseUrl, child, diagnostics, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Gateway exited before becoming ready:\n${diagnostics()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/__gateway/health`);
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Gateway readiness timed out: ${lastError?.message || 'unknown'}\n${diagnostics()}`);
}

function sessionClient(baseUrl) {
  let cookie = '';
  return {
    get cookie() {
      return cookie;
    },
    async request(requestPath, options = {}) {
      const headers = new Headers(options.headers || {});
      if (cookie) headers.set('Cookie', cookie);
      if (options.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      const response = await fetch(`${baseUrl}${requestPath}`, {
        ...options,
        headers,
        redirect: 'manual',
      });
      const setCookies = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [response.headers.get('set-cookie')].filter(Boolean);
      if (setCookies.length) {
        cookie = setCookies[0].split(';', 1)[0];
      }
      const raw = await response.text();
      let body = null;
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      }
      return { response, body };
    },
  };
}

async function main() {
  if (!fs.existsSync(path.join(rootDir, 'build/server/index.js'))) {
    throw new Error('Public sandbox acceptance requires a production build. Run npm run build:react first.');
  }

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'three-lans-public-sandbox-'));
  const gatewayPort = await findFreePort();
  const childPortStart = await findFreePort();
  const baseUrl = `http://127.0.0.1:${gatewayPort}`;
  let stdout = '';
  let stderr = '';
  let child;

  const diagnostics = () => [
    stdout ? `stdout:\n${stdout.slice(-4_000)}` : '',
    stderr ? `stderr:\n${stderr.slice(-4_000)}` : '',
  ].filter(Boolean).join('\n');

  try {
    child = spawn(process.execPath, ['sandbox-gateway.mjs'], {
      cwd: rootDir,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(gatewayPort),
        PUBLIC_SANDBOX_COOKIE_SECRET: 'acceptance-only-cookie-secret-0000000000000000',
        PUBLIC_SANDBOX_COOKIE_SECURE: 'false',
        PUBLIC_SANDBOX_MAX_SESSIONS: '4',
        PUBLIC_SANDBOX_PORT_START: String(childPortStart),
        PUBLIC_SANDBOX_PORT_END: String(Math.min(65_535, childPortStart + 20)),
        PUBLIC_SANDBOX_RETENTION_MINUTES: '10',
        PUBLIC_SANDBOX_WRITE_ENABLED: 'true',
        PUBLIC_SANDBOX_HIGH_COST_ENABLED: 'true',
        PUBLIC_SANDBOX_QUOTA_GENERATIONS: '1',
        PUBLIC_SANDBOX_QUOTA_OCR: '1',
        PUBLIC_SANDBOX_QUOTA_TTS: '1',
        PUBLIC_SANDBOX_QUOTA_STORAGE_BYTES: String(64 * 1024 * 1024),
        SANDBOX_STORAGE_ROOT: temporaryRoot,
        LEARNING_TIMEZONE: 'Asia/Tokyo',
        RECORDS_TIMEZONE: 'Asia/Tokyo',
        TTS_EN_ENDPOINT: '',
        TTS_JA_ENDPOINT: '',
        LOG_SILENT: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    await waitForGateway(baseUrl, child, diagnostics);

    const anonymousTelemetry = await fetch(`${baseUrl}/api/ui-performance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        version: 1,
        workspaceMode: 'sandbox',
        metrics: [{ name: 'fcp', value: 900, route: '/' }],
      }),
    });
    assert.equal(anonymousTelemetry.status, 204);
    const beforeSessions = await fetch(`${baseUrl}/__gateway/health`).then((response) => response.json());
    assert.equal(beforeSessions.activeSandboxes, 0, 'Telemetry must not allocate a sandbox');

    const first = sessionClient(baseUrl);
    const second = sessionClient(baseUrl);
    const firstRuntime = await first.request('/api/runtime');
    const secondRuntime = await second.request('/api/runtime');
    assert.equal(firstRuntime.response.status, 200);
    assert.equal(secondRuntime.response.status, 200);
    assert.equal(firstRuntime.body.workspace.mode, 'sandbox');
    assert.equal(secondRuntime.body.workspace.mode, 'sandbox');
    assert.notEqual(firstRuntime.body.workspace.workspaceId, secondRuntime.body.workspace.workspaceId);
    assert.equal(firstRuntime.body.workspace.capabilities.ownerData, false);
    assert.equal(secondRuntime.body.workspace.capabilities.ownerData, false);
    assert.equal(firstRuntime.body.observability.uiPerformance.enabled, true);

    const telemetry = await first.request('/api/ui-performance', {
      method: 'POST',
      body: JSON.stringify({
        version: 1,
        workspaceMode: 'sandbox',
        metrics: [{
          name: 'card-modal-open',
          value: 420,
          route: '/',
          context: 'cold',
        }],
      }),
    });
    assert.equal(telemetry.response.status, 202);
    assert.equal(telemetry.body.accepted, 1);

    const firstHistory = await first.request('/api/history?page=1&limit=10');
    const secondHistory = await second.request('/api/history?page=1&limit=10');
    assert.equal(firstHistory.body.pagination.total, 3);
    assert.equal(secondHistory.body.pagination.total, 3);

    const recordId = firstHistory.body.records[0].id;
    const deletion = await first.request(`/api/records/${recordId}`, { method: 'DELETE' });
    assert.equal(deletion.response.status, 200);
    const firstAfterDelete = await first.request('/api/history?page=1&limit=10');
    const secondAfterDelete = await second.request('/api/history?page=1&limit=10');
    assert.equal(firstAfterDelete.body.pagination.total, 2);
    assert.equal(secondAfterDelete.body.pagination.total, 3);

    const quotaAttempt = () => first.request('/api/generation-jobs', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const firstQuotaAttempt = await quotaAttempt();
    assert.equal(firstQuotaAttempt.response.status, 400);
    const exhaustedAttempt = await quotaAttempt();
    assert.equal(exhaustedAttempt.response.status, 429);
    assert.equal(exhaustedAttempt.body.code, 'SANDBOX_QUOTA_EXCEEDED');
    assert.equal(exhaustedAttempt.body.details.category, 'generation');

    const firstIdBeforeReset = firstRuntime.body.workspace.workspaceId;
    const secondIdBeforeReset = secondRuntime.body.workspace.workspaceId;
    const reset = await first.request('/api/sandbox/reset', {
      method: 'POST',
      headers: { 'X-Sandbox-Action': 'reset' },
    });
    assert.equal(reset.response.status, 200);
    assert.equal(reset.body.reset, true);

    const firstRuntimeAfterReset = await first.request('/api/runtime');
    const secondRuntimeAfterReset = await second.request('/api/runtime');
    assert.notEqual(firstRuntimeAfterReset.body.workspace.workspaceId, firstIdBeforeReset);
    assert.equal(secondRuntimeAfterReset.body.workspace.workspaceId, secondIdBeforeReset);
    const firstHistoryAfterReset = await first.request('/api/history?page=1&limit=10');
    const secondHistoryAfterReset = await second.request('/api/history?page=1&limit=10');
    assert.equal(firstHistoryAfterReset.body.pagination.total, 3);
    assert.equal(secondHistoryAfterReset.body.pagination.total, 3);
    assert.equal(firstRuntimeAfterReset.body.sandbox.quota.categories.generation.used, 0);

    const gatewayHealth = await fetch(`${baseUrl}/__gateway/health`).then((response) => response.json());
    assert.equal(gatewayHealth.activeSandboxes, 2);
    assert.equal(gatewayHealth.capacity, 4);

    process.stdout.write('public sandbox acceptance OK (2 isolated sessions, quota, reset)\n');
  } catch (error) {
    error.message = `${error.message}\n${diagnostics()}`;
    throw error;
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await waitForExit(child);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    const sandboxDirectories = fs.existsSync(temporaryRoot)
      ? fs.readdirSync(temporaryRoot).filter((name) => name.startsWith('sbx_'))
      : [];
    assert.deepEqual(sandboxDirectories, [], 'Gateway shutdown must remove every sandbox directory');
    assert.equal(
      fs.existsSync(path.join(temporaryRoot, '.sandbox-gateway.lock')),
      false,
      'Gateway shutdown must release the storage-root lock'
    );
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
