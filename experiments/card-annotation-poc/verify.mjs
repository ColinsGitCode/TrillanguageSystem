import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createGzip } from 'node:zlib';
import { chromium } from '@playwright/test';

const PORT = 5198;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: import.meta.dirname, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/recogito-poc.html`);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for Recogito POC server');
}

async function gzipSize(file) {
  return new Promise((resolve, reject) => {
    let size = 0;
    createReadStream(file)
      .pipe(createGzip({ level: 9 }))
      .on('data', (chunk) => { size += chunk.length; })
      .on('end', () => resolve(size))
      .on('error', reject);
  });
}

await run(process.execPath, [
  '--test',
  'anchor-contract.test.mjs',
  'migration-identity.test.mjs',
  'recogito-compat.test.mjs',
]);
await run('node_modules/.bin/vite', ['build']);
const server = spawn(
  'node_modules/.bin/vite',
  ['--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
  { cwd: import.meta.dirname, stdio: 'ignore' }
);

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto(`${BASE_URL}/recogito-poc.html`);
  await page.waitForFunction(() => Boolean(window.recogitoPoc));
  const result = await page.evaluate(() => window.recogitoPoc);
  if (!result.markupUnchanged) {
    console.log(JSON.stringify({ markupBefore: result.markupBefore, markupAfter: result.markupAfter }, null, 2));
  }

  assert.deepEqual(result.selectors, [
    { quote: '食', start: 0, end: 1 },
    { quote: 'べる', start: 1, end: 3 },
  ]);
  assert.equal(result.annotationCount, 1);
  assert.equal(result.rawSelectorCount, 3);
  assert.equal(result.rubyText, '食た');
  assert.equal(result.readingText, 'た');
  assert.equal(result.markupUnchanged, false);
  assert.equal(result.sourceMarkupUnchanged, true);
  assert.equal(result.highlightLayerCount, 1);
  assert.equal(consoleErrors.length, 0);

  const output = new URL('./dist/recogito.js', import.meta.url);
  const bytes = (await stat(output)).size;
  const gzipBytes = await gzipSize(output);
  console.log(JSON.stringify({
    nodeContractTests: 11,
    browserCompatibility: 'pass',
    bundleBytes: bytes,
    bundleGzipBytes: gzipBytes,
    ...result,
  }, null, 2));
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
