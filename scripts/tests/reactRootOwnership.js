'use strict';

const { spawn } = require('node:child_process');
const { once } = require('node:events');
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
    if (child.exitCode !== null) throw new Error('React server exited with ' + child.exitCode);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (_err) {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('React server did not become ready: ' + url);
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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'three-lans-react-root-'));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(__dirname, '../..'),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      DB_PATH: path.join(tempDir, 'root.sqlite'),
      RECORDS_PATH: path.join(tempDir, 'records'),
      E2E_TEST_MODE: '1',
      TTS_EN_ENDPOINT: '',
      TTS_JA_ENDPOINT: '',
      LOG_SILENT: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let childOutput = '';
  let shutdownError = null;
  child.stdout.on('data', (chunk) => { childOutput += chunk.toString(); });
  child.stderr.on('data', (chunk) => { childOutput += chunk.toString(); });

  try {
    const baseUrl = 'http://127.0.0.1:' + port;
    await waitFor(baseUrl + '/api/health', child);
    // 创建学习卡 now lives inside the on-demand composer drawer, so the marker
    // is the trigger that server-rendered HTML must still carry.
    await assertResponse(baseUrl, '/', 200, '新建学习卡');
    await assertResponse(baseUrl, '/__rr-poc', 404);
    await assertResponse(baseUrl, '/index.html', 404);
    await assertResponse(baseUrl, '/api/health', 200);
    await assertResponse(baseUrl, '/dashboard.html', 404);
    await assertResponse(baseUrl, '/api/knowledge/jobs', 404);
    process.stdout.write('React Router root ownership OK (' + baseUrl + ')\n');
  } catch (error) {
    error.message += '\nReact server output:\n' + childOutput;
    throw error;
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      const [exitCode, signal] = await exited;
      if (exitCode !== 0) {
        shutdownError = new Error(`React server did not shut down cleanly: code=${exitCode}, signal=${signal}`);
      }
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  if (shutdownError) throw shutdownError;
}

main().catch((error) => {
  process.stderr.write((error.stack || error.message) + '\n');
  process.exit(1);
});
