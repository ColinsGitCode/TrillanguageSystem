'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitFor(url, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error('hybrid server exited with ' + child.exitCode);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (_err) {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('hybrid server did not become ready: ' + url);
}

async function assertResponse(baseUrl, route, status, expectedText) {
  const response = await fetch(baseUrl + route);
  if (response.status !== status) {
    throw new Error(route + ': expected ' + status + ', received ' + response.status);
  }
  const body = await response.text();
  if (expectedText && !body.includes(expectedText)) {
    throw new Error(route + ': missing expected text ' + expectedText);
  }
}

async function main() {
  const port = await getFreePort();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'three-lans-rr-poc-'));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(__dirname, '../..'),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      DB_PATH: path.join(tempDir, 'poc.sqlite'),
      RECORDS_PATH: path.join(tempDir, 'records'),
      E2E_TEST_MODE: '1',
      TTS_EN_ENDPOINT: '',
      TTS_JA_ENDPOINT: '',
      LOG_SILENT: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let childOutput = '';
  child.stdout.on('data', (chunk) => { childOutput += chunk.toString(); });
  child.stderr.on('data', (chunk) => { childOutput += chunk.toString(); });

  try {
    const baseUrl = 'http://127.0.0.1:' + port;
    await waitFor(baseUrl + '/api/health', child);
    await assertResponse(baseUrl, '/', 200, 'Cards Factory');
    await assertResponse(baseUrl, '/__rr-poc', 200, '创建学习卡');
    await assertResponse(baseUrl, '/api/health', 200);
    await assertResponse(baseUrl, '/dashboard.html', 404);
    await assertResponse(baseUrl, '/api/knowledge/jobs', 404);
    process.stdout.write('React Router Cards Factory OK (' + baseUrl + ')\n');
  } catch (error) {
    error.message += '\nHybrid server output:\n' + childOutput;
    throw error;
  } finally {
    child.kill('SIGTERM');
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write((error.stack || error.message) + '\n');
  process.exit(1);
});
