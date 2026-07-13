'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function listFiles(relativePath) {
  const absolute = path.join(root, relativePath);
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(relativePath, entry.name);
    return entry.isDirectory() ? listFiles(child) : [child];
  });
}

function main() {
  const runtime = read('lib/httpRuntime.js');
  const worker = read('services/generation/generationJobService.js');
  const workerExecutor = read('services/application/executeGenerationJob.js');
  const jobStore = read('services/storage/db/generationJobs.js');
  const database = read('services/storage/databaseService.js');
  const activeServerSource = [
    ...listFiles('lib'),
    ...listFiles('routes'),
    ...listFiles('services'),
    'server.js',
    'server.mjs',
  ].filter((file) => /\.(?:js|mjs)$/.test(file)).map(read).join('\n');

  assert.match(runtime, /configureExecutor\(executeGenerationJob\)/);
  assert.match(workerExecutor, /return execute\(commandFromGenerationJob\(job\)\)/);
  assert.doesNotMatch(activeServerSource, /X-Generation-Job-Worker/i);
  assert.doesNotMatch(worker, /https?:\/\/|fetch\(|\/api\/generate/);

  assert.match(database, /busy_timeout/);
  assert.match(jobStore, /UPDATE generation_jobs[\s\S]*RETURNING \*/);
  assert.match(jobStore, /tx\.immediate\(\)/);
  assert.match(runtime, /process\.once\('SIGTERM'/);
  assert.match(runtime, /process\.once\('SIGINT'/);

  const publicFiles = listFiles('public').sort();
  assert.deepEqual(publicFiles, ['public/favicon-lan.svg']);

  process.stdout.write('Architecture completion source gates OK\n');
}

main();
