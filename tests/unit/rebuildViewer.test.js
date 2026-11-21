'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { collectBuildMetadata, rebuildViewer } = require('../../scripts/build/rebuildViewer');

function repository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init');
  fs.writeFileSync(path.join(root, '.gitignore'), '.env\nbuild-info.json\n');
  fs.writeFileSync(path.join(root, 'source.js'), 'original');
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture');
  return root;
}

test('source fingerprint is stable and detects tracked edits, additions, and deletions without reading ignored secrets', (t) => {
  const root = repository(t);
  const clean = collectBuildMetadata(root);
  assert.equal(clean.dirty, false);
  assert.match(clean.commit, /^[a-f0-9]{40}$/u);
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=do-not-fingerprint');
  fs.writeFileSync(path.join(root, 'build-info.json'), '{}');
  assert.equal(collectBuildMetadata(root).sourceHash, clean.sourceHash);
  assert.equal(collectBuildMetadata(root).dirty, false);

  fs.writeFileSync(path.join(root, 'source.js'), 'changed');
  const changed = collectBuildMetadata(root);
  assert.equal(changed.dirty, true);
  assert.notEqual(changed.sourceHash, clean.sourceHash);
  fs.writeFileSync(path.join(root, 'new.txt'), 'untracked');
  const added = collectBuildMetadata(root);
  assert.notEqual(added.sourceHash, changed.sourceHash);
  fs.unlinkSync(path.join(root, 'source.js'));
  assert.notEqual(collectBuildMetadata(root).sourceHash, added.sourceHash);
});

test('deployment passes metadata and restarts viewer only without dependencies or volume operations', (t) => {
  const root = repository(t);
  const calls = [];
  const info = rebuildViewer({ root, run: (command, args) => calls.push({ command, args }) });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, 'docker');
  assert.ok(calls[0].args.includes(`BUILD_COMMIT=${info.commit}`));
  assert.ok(calls[0].args.includes('BUILD_DIRTY=false'));
  assert.ok(calls[0].args.includes(`BUILD_SOURCE_HASH=${info.sourceHash}`));
  assert.ok(calls[0].args.includes(`BUILD_TIME=${info.builtAtUtc}`));
  assert.equal(calls[0].args.at(-1), 'viewer');
  assert.deepEqual(calls[1].args, [
    'compose', '-p', 'three_lans_system', 'up', '-d', '--no-build', '--no-deps', 'viewer',
  ]);
});

test('a runtime directory recreates the viewer with its own configuration', (t) => {
  const root = repository(t);
  fs.writeFileSync(path.join(root, 'docker-compose.yml'), 'name: three_lans_system\n');
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-runtime-'));
  t.after(() => fs.rmSync(runtimeDir, { recursive: true, force: true }));
  fs.copyFileSync(path.join(root, 'docker-compose.yml'), path.join(runtimeDir, 'docker-compose.yml'));
  fs.writeFileSync(path.join(runtimeDir, '.env'), 'SECRET=runtime');
  const calls = [];
  rebuildViewer({ root, runtimeDir, run: (command, args, options) => calls.push({ command, args, cwd: options.cwd }) });
  assert.equal(calls.length, 2);
  // The image is built from the checkout ...
  assert.equal(calls[0].cwd, root);
  assert.deepEqual(calls[0].args.slice(0, 4), ['compose', '-p', 'three_lans_system', 'build']);
  // ... and the container is recreated from the runtime directory.
  const composeFile = path.join(runtimeDir, 'docker-compose.yml');
  assert.equal(calls[1].cwd, runtimeDir);
  assert.deepEqual(calls[1].args, [
    'compose', '-p', 'three_lans_system', '--project-directory', runtimeDir, '-f', composeFile,
    'up', '-d', '--no-build', '--no-deps', '--pull', 'never', 'viewer',
  ]);
});

test('a runtime directory that is incomplete or out of sync stops before building', (t) => {
  const root = repository(t);
  fs.writeFileSync(path.join(root, 'docker-compose.yml'), 'name: three_lans_system\n');
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-runtime-'));
  t.after(() => fs.rmSync(runtimeDir, { recursive: true, force: true }));
  let calls = 0;
  const run = () => { calls += 1; };
  fs.writeFileSync(path.join(runtimeDir, 'docker-compose.yml'), 'name: three_lans_system\n');
  assert.throws(() => rebuildViewer({ root, runtimeDir, run }), /missing .*\.env/u);
  fs.writeFileSync(path.join(runtimeDir, '.env'), 'SECRET=runtime');
  fs.writeFileSync(path.join(runtimeDir, 'docker-compose.yml'), 'name: three_lans_system\nservices: {}\n');
  assert.throws(() => rebuildViewer({ root, runtimeDir, run }), /differs from this checkout/u);
  assert.equal(calls, 0);
});

test('a build failure leaves the running viewer untouched', (t) => {
  const root = repository(t);
  let calls = 0;
  assert.throws(() => rebuildViewer({ root, run: () => {
    calls += 1;
    throw new Error('build failed');
  } }), /build failed/u);
  assert.equal(calls, 1);
});

test('source changes during build prevent deploying a mislabeled image', (t) => {
  const root = repository(t);
  let calls = 0;
  assert.throws(() => rebuildViewer({ root, run: () => {
    calls += 1;
    fs.writeFileSync(path.join(root, 'source.js'), 'changed during build');
  } }), /Source changed during build/u);
  assert.equal(calls, 1);
});
