'use strict';

// Shared boot harness for L2 route-integration tests.
// What it does:
//   1. Pins env (DB → :memory:, E2E_TEST_MODE=1, PORT=0 for a random free
//      port, LOG_SILENT=1, blank TTS endpoints, mktemp RECORDS_PATH) BEFORE
//      requiring server.js so module-load-time singletons (dbService, log,
//      etc.) pick up the test values.
//   2. Requires server.js — this boots the real Express stack on the random
//      port and returns the live serverInstance.
//   3. Exposes a tiny zero-dep request helper (`api`) that builds the URL
//      against the actual bound port and returns `{ status, headers, body }`
//      where `body` is auto-parsed as JSON when applicable.
//   4. Exposes `resetState()` which truncates every project DB table via
//      the test-only `dbService.truncateAllForTests()`. Call before each
//      test to keep them isolated.
//
// Each test FILE is run in its own subprocess by `node --test`, so this
// module is required once per file — and the harness itself is therefore
// re-entrant-safe at the file level.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpRecords = fs.mkdtempSync(path.join(os.tmpdir(), 'integration-records-'));

process.env.DB_PATH = ':memory:';
process.env.E2E_TEST_MODE = '1';
process.env.PORT = '0';
process.env.LOG_SILENT = '1';
process.env.TTS_EN_ENDPOINT = '';
process.env.TTS_JA_ENDPOINT = '';
process.env.RECORDS_PATH = tmpRecords;

// Require AFTER env is pinned. server.js calls app.listen(PORT, cb)
// synchronously; the bound port is only known once 'listening' fires.
const { serverInstance } = require('../../server.js');
const dbService = require('../../services/databaseService');

let baseUrlPromise = null;
function getBaseUrl() {
  if (baseUrlPromise) return baseUrlPromise;
  baseUrlPromise = new Promise((resolve) => {
    if (serverInstance.listening) {
      const { port } = serverInstance.address();
      resolve(`http://127.0.0.1:${port}`);
      return;
    }
    serverInstance.once('listening', () => {
      const { port } = serverInstance.address();
      resolve(`http://127.0.0.1:${port}`);
    });
  });
  return baseUrlPromise;
}

async function api(method, route, { body, headers } = {}) {
  const base = await getBaseUrl();
  const init = {
    method: method.toUpperCase(),
    headers: { ...headers }
  };
  if (body !== undefined) {
    init.headers['content-type'] = init.headers['content-type'] || 'application/json';
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch(base + route, init);
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  let parsed = text;
  if (ct.includes('application/json')) {
    try { parsed = text ? JSON.parse(text) : null; } catch (_err) { parsed = text; }
  }
  return { status: res.status, headers: Object.fromEntries(res.headers), body: parsed, rawText: text };
}

function resetState() {
  dbService.truncateAllForTests();
}

function closeServer() {
  return new Promise((resolve) => serverInstance.close(() => resolve()));
}

module.exports = {
  api,
  resetState,
  dbService,
  getBaseUrl,
  closeServer,
};
