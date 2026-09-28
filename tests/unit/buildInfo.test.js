'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readBuildInfo, buildInfoFromEnv } = require('../../lib/buildInfo');
const { writeBuildInfo } = require('../../scripts/build/writeBuildInfo');

const unknown = { commit: null, builtAtUtc: null, dirty: null, sourceHash: null };
const env = {
  BUILD_COMMIT: 'a'.repeat(40), BUILD_TIME: '2026-09-26T00:00:00Z',
  BUILD_DIRTY: 'true', BUILD_SOURCE_HASH: 'b'.repeat(64),
};

function temporaryFile(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-info-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'build-info.json');
}

test('missing build metadata is unknown, with sanitized environment fallback for non-image runs', (t) => {
  const filePath = temporaryFile(t);
  assert.deepEqual(readBuildInfo({ filePath, env: {} }), unknown);
  assert.deepEqual(readBuildInfo({ filePath, env }), {
    commit: env.BUILD_COMMIT, builtAtUtc: '2026-09-26T00:00:00.000Z',
    dirty: true, sourceHash: env.BUILD_SOURCE_HASH,
  });
  assert.equal(fs.existsSync(filePath), false, 'read path must not create metadata');
  assert.deepEqual(buildInfoFromEnv({
    BUILD_COMMIT: '/private/path', BUILD_TIME: 'invalid', BUILD_DIRTY: 'maybe', BUILD_SOURCE_HASH: 'secret',
  }), unknown);
  assert.equal(buildInfoFromEnv({ BUILD_DIRTY: 'false' }).dirty, false);
});

test('baked metadata is authoritative and exposes only sanitized public fields', (t) => {
  const filePath = temporaryFile(t);
  const baked = writeBuildInfo({ filePath, env });
  fs.writeFileSync(filePath, JSON.stringify({ ...baked, secret: 'not-public', localPath: '/private' }));
  assert.deepEqual(readBuildInfo({ filePath, env: { ...env, BUILD_COMMIT: 'c'.repeat(40) } }), baked);
});

test('damaged or non-object baked metadata does not fall back to environment claims', (t) => {
  const filePath = temporaryFile(t);
  for (const contents of [
    'invalid JSON', 'null', '[]', '{"dirty":"false","commit":"invalid"}',
    JSON.stringify({ sourceHash: ['a'.repeat(64)] }),
  ]) {
    fs.writeFileSync(filePath, contents);
    assert.deepEqual(readBuildInfo({ filePath, env }), unknown);
  }
});

test('raw Docker builds record real build time without inventing a commit or clean status', (t) => {
  const filePath = temporaryFile(t);
  const start = Date.now();
  const info = writeBuildInfo({ filePath, env: {} });
  assert.ok(Date.parse(info.builtAtUtc) >= start);
  assert.ok(Date.parse(info.builtAtUtc) <= Date.now());
  assert.equal(info.commit, null);
  assert.equal(info.dirty, null);
});

test('invalid explicit build arguments fail before producing metadata', (t) => {
  const filePath = temporaryFile(t);
  for (const key of Object.keys(env)) {
    assert.throws(() => writeBuildInfo({ filePath, env: { ...env, [key]: 'invalid' } }), new RegExp(key));
    assert.equal(fs.existsSync(filePath), false);
  }
});
