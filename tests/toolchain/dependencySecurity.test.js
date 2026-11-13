const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { ESLint } = require('eslint');

const root = path.resolve(__dirname, '../..');
const fromEslint = createRequire(require.resolve('eslint'));
const fromConfigArray = createRequire(fromEslint.resolve('@eslint/config-array'));

function isolated(script) {
  const result = spawnSync(process.execPath, ['--max-old-space-size=64', '-e', script], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 1024 * 1024
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /completed/);
}

test('all locked toolchain copies satisfy the patched version floors', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const floors = {
    minimatch: [11, 0, 1],
    'brace-expansion': [5, 0, 12],
    'baseline-browser-mapping': [2, 11, 0],
    browserslist: [4, 28, 7],
    vite: [7, 3, 7]
  };
  for (const [name, floor] of Object.entries(floors)) {
    const copies = Object.entries(lock.packages).filter(([key]) => key.endsWith(`/node_modules/${name}`) || key === `node_modules/${name}`);
    assert.ok(copies.length > 0, `${name} must be present`);
    for (const [key, pkg] of copies) {
      assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
      const version = pkg.version.split('.').map(Number);
      const firstDifference = version.findIndex((part, index) => part !== floor[index]);
      assert.ok(firstDifference === -1 || version[firstDifference] > floor[firstDifference], `${key}@${pkg.version} is below ${floor.join('.')}`);
    }
  }
});

test('the installed dependency tree has no invalid or missing required edges', () => {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ls', '--all', '--json'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).problems || [], []);
});

test('both ESLint consumers retain glob, partial traversal, brace and extglob matching', () => {
  for (const loader of [fromEslint, fromConfigArray]) {
    const { Minimatch, minimatch } = loader('minimatch');
    assert.equal(minimatch('routes/cards.js', '**/*.{js,mjs}'), true);
    assert.equal(minimatch('routes/cards.ts', '**/*.{js,mjs}'), false);
    assert.equal(minimatch('server.mjs', '**/*.@(js|mjs)'), true);
    assert.equal(minimatch('routes/cards.js', '!build/**'), true);
    assert.equal(minimatch('build/server.js', '!build/**'), false);
    const matcher = new Minimatch('services/**/*.js', { dot: true, matchBase: true });
    assert.equal(matcher.match('services/nested', true), true);
    assert.equal(matcher.match('services/nested/example.js'), true);
    assert.equal(matcher.match('routes/example.js'), false);
  }
});

test('ESLint still applies ignore boundaries and reports real JavaScript errors', async () => {
  const eslint = new ESLint({ cwd: root });
  for (const file of ['Docs/example.js', 'build/server.js', 'tests/e2e/example.js', 'node_modules/example.js']) {
    assert.equal(await eslint.isPathIgnored(path.join(root, file)), true, file);
  }
  for (const file of ['routes/example.js', 'tests/toolchain/example.js', 'server.mjs']) {
    assert.equal(await eslint.isPathIgnored(path.join(root, file)), false, file);
  }
  for (const [filePath, text] of [
    ['routes/example.js', "module.exports = require('node:path');"],
    ['example.mjs', "import path from 'node:path'; export default path;"]
  ]) {
    const [result] = await eslint.lintText(text, { filePath });
    assert.equal(result.errorCount, 0, JSON.stringify(result.messages));
  }
  const [invalid] = await eslint.lintText('undefinedSecurityProbe();', { filePath: 'routes/example.js' });
  assert.ok(invalid.messages.some(message => message.ruleId === 'no-undef'));
});

test('glob optimization does not amplify repeated parent traversal patterns', () => {
  // Keep hostile input in a memory- and time-bounded child, never in the test runner.
  isolated(`
    const assert = require('node:assert/strict');
    const { createRequire } = require('node:module');
    const loader = createRequire(require.resolve('eslint'));
    const { Minimatch } = loader('minimatch');
    assert.throws(
      () => new Minimatch('**/../a/b/'.repeat(24) + 'z', { optimizationLevel: 2 }),
      { name: 'RangeError', message: /too many patterns/ }
    );
    console.log('completed');
  `);
});

test('brace rewriting remains bounded for a long unmatched suffix', () => {
  isolated(`
    const assert = require('node:assert/strict');
    const { expand } = require('brace-expansion');
    assert.deepEqual(expand('file-{a,b}.js'), ['file-a.js', 'file-b.js']);
    expand('{a}' + '}'.repeat(128000) + ',z}');
    console.log('completed');
  `);
});

test('invalid Baseline options throw without terminating the calling process', () => {
  isolated(`
    const assert = require('node:assert/strict');
    const { getCompatibleVersions } = require('baseline-browser-mapping');
    assert.throws(() => getCompatibleVersions({ targetYear: 2022, widelyAvailableOnDate: '2022-01-01' }));
    assert.ok(getCompatibleVersions({ targetYear: 2022 }).length > 0);
    console.log('completed');
  `);
});

test('Browserslist ignores inherited object names in custom usage statistics', () => {
  const browserslist = require('browserslist');
  const stats = JSON.parse('{"toString":{"onekey":5},"chrome":{"100":50}}');
  assert.deepEqual(browserslist('chrome 100', { stats }), ['chrome 100']);
  assert.ok(browserslist('last 2 Chrome versions').length >= 2);
});

test('Vite does not let an in-root path collision authorize an outside file', { timeout: 30000 }, async () => {
  const { createServer } = await import('vite');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'three-lans-vite-security-'));
  const project = path.join(temp, 'project');
  const outside = path.join(temp, 'private.js');
  const collision = path.join(project, outside);
  const secret = 'THREE_LANS_OUTSIDE_FILE_MUST_NOT_BE_SERVED';
  let server;
  try {
    fs.mkdirSync(path.dirname(collision), { recursive: true });
    fs.writeFileSync(outside, `export default '${secret}';`);
    fs.writeFileSync(collision, "export default 'safe-mirror';");
    fs.writeFileSync(path.join(project, 'entry.js'), `import value from '${outside}'; console.log(value);`);
    server = await createServer({
      root: project,
      configFile: false,
      logLevel: 'silent',
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { strict: true, allow: [project] } }
    });
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    const entry = await fetch(`${base}/entry.js`);
    assert.equal(entry.status, 200);
    assert.match(await entry.text(), /console\.log/);
    const allowed = await fetch(`${base}${outside}`);
    assert.equal(allowed.status, 200);
    assert.match(await allowed.text(), /safe-mirror/);
    const denied = await fetch(`${base}/@fs${outside}`);
    assert.equal(denied.status, 403);
    assert.equal((await denied.text()).includes(secret), false);
  } finally {
    if (server) await server.close();
    fs.rmSync(temp, { recursive: true });
  }
});
