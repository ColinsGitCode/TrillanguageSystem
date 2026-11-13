'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const expressRequire = createRequire(require.resolve('express'));

test('all installed lockfile copies meet the six production security patch floors', () => {
  const lock = require('../../package-lock.json');
  const floors = { dompurify: '3.4.17', 'proxy-addr': '2.0.8', 'body-parser': '1.20.9', 'fast-uri': '3.1.9', qs: '6.16.1', 'source-map-js': '1.2.2' };
  for (const [name, floor] of Object.entries(floors)) {
    const copies = Object.entries(lock.packages).filter(([path]) => path.endsWith(`/node_modules/${name}`) || path === `node_modules/${name}`);
    assert(copies.length, `Missing dependency: ${name}`);
    for (const [path, entry] of copies) {
      const actual = entry.version.split('.').map(Number);
      const minimum = floor.split('.').map(Number);
      const different = actual.findIndex((value, index) => value !== minimum[index]);
      assert(!entry.version.includes('-') && (different < 0 || actual[different] > minimum[different]), `${path}: ${entry.version} is below ${floor}`);
    }
  }
});

test('proxy trust cannot be widened to arbitrary IPv4 clients by an IPv6 prefix', () => {
  const proxyaddr = expressRequire('proxy-addr');
  const remoteAddress = '203.0.113.25';
  for (const subnet of ['::ffff:10.0.0.0/8', '::/1']) {
    const trust = proxyaddr.compile(subnet);
    assert.equal(trust(remoteAddress), false);
    assert.equal(proxyaddr({ socket: { remoteAddress }, headers: { 'x-forwarded-for': '10.20.30.40' } }, trust), remoteAddress);
  }
  const mapped = proxyaddr.compile('::ffff:10.0.0.0/104');
  assert.equal(mapped('10.20.30.40'), true);
  assert.equal(mapped(remoteAddress), false);
  const trusted = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '198.51.100.9' } };
  assert.equal(proxyaddr(trusted, proxyaddr.compile('loopback')), '198.51.100.9');
});

test('DOMPurify scrubs split template expressions inside an attached shadow root', () => {
  const dom = new JSDOM('');
  try {
    const host = dom.window.document.createElement('div');
    dom.window.document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    for (const text of ['{', '{', '7 * 7', '}', '}']) {
      shadow.append(dom.window.document.createTextNode(text), dom.window.document.createElement('iframe'));
    }
    const purifier = createDOMPurify(dom.window);
    purifier.sanitize(host, { IN_PLACE: true, SAFE_FOR_TEMPLATES: true, FORBID_TAGS: ['iframe'] });
    assert(!shadow.textContent.includes('{{'));
    assert.equal(shadow.querySelector('iframe'), null);
  } finally {
    dom.window.close();
  }
});

test('textbook sanitizer retains ruby/highlights and rejects executable markup', () => {
  const { sanitizeHighlightDocument } = require('../../services/textbooks/textbookHighlightService');
  const track = { id: 1, expressions: [{ expression_id: 2, lifecycle: 'active', official_en_text: 'Hello.', official_ja_text: '\u65e5\u672c\u8a9e', zh_cue_text: '\u4f60\u597d' }] };
  const html = '<div data-textbook-track-id="1"><section data-textbook-expression-id="2">'
    + '<div data-textbook-language="en"><mark class="study-highlight-red" onclick="alert(1)">Hello.</mark></div>'
    + '<div data-textbook-language="ja"><ruby>\u65e5<rt>\u306b\u3061</rt></ruby>\u672c\u8a9e</div>'
    + '<div data-textbook-language="zh">\u4f60\u597d<script>alert(1)</script></div></section></div>';
  const safe = sanitizeHighlightDocument(html, track);
  assert.match(safe, /<ruby>/);
  assert.match(safe, /study-highlight-red/);
  assert.doesNotMatch(safe, /onclick|<script|alert\(/i);
  assert.equal(sanitizeHighlightDocument(safe, track), safe);
});

test('qs tolerates hostile own toString values without losing normal form parsing', () => {
  const qs = expressRequire('qs');
  for (const encodeValuesOnly of [false, true]) {
    assert.doesNotThrow(() => qs.stringify({ filters: [{ toString: 42 }] }, { arrayFormat: 'comma', encodeValuesOnly }));
  }
  assert.deepEqual(qs.parse('word[en]=hello&word[ja]=test'), { word: { en: 'hello', ja: 'test' } });
  assert.equal(Object.prototype.polluted, undefined);
  qs.parse('__proto__[polluted]=true&constructor[prototype][polluted]=true');
  assert.equal(Object.prototype.polluted, undefined);
});

test('fast-uri does not serialize port text into a different authority', () => {
  const uri = require('fast-uri');
  let serialized;
  try {
    serialized = uri.serialize({ scheme: 'https', host: 'safe.example', port: '443@other.example', path: '/' });
  } catch (error) {
    assert.match(error.message, /port|invalid/i);
  }
  if (serialized) {
    assert.equal(new URL(serialized).hostname, 'safe.example');
  }
  assert.equal(uri.serialize(uri.parse('https://safe.example:443/docs')), 'https://safe.example/docs');
});

test('indexed source maps reject unbounded and invalid section offsets before traversal', () => {
  const { SourceMapConsumer } = require('source-map-js');
  const map = { version: 3, sources: ['test.js'], names: [], mappings: 'AAAA' };
  for (const line of [Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => new SourceMapConsumer({ version: 3, sections: [{ offset: { line, column: 0 }, map }] }), /offset/i);
  }
  const consumer = new SourceMapConsumer({ version: 3, sections: [{ offset: { line: 0, column: 0 }, map }] });
  const mappings = [];
  consumer.eachMapping(mapping => mappings.push(mapping));
  assert.equal(mappings.length, 1);
  assert.equal(mappings[0].source, 'test.js');
  assert.equal(mappings[0].generatedLine, 1);
});

// A child confines any regression that terminates the parser process to this test.
async function exerciseCompressedParser() {
  const assert = require('node:assert/strict');
  const express = require('express');
  const http = require('node:http');
  const { gzipSync } = require('node:zlib');
  const app = express();
  app.use(express.json({ limit: '1kb' }));
  app.post('/echo', (req, res) => res.json(req.body));
  app.get('/health', (_req, res) => res.send('ok'));
  app.use((error, _req, res, _next) => res.status(error.status || 400).end());
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const request = (payload, trailing) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/echo', method: 'POST', headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error('Request timeout')));
    if (trailing) { req.write(payload); setTimeout(() => req.end(trailing), 20); }
    else req.end(payload);
  });
  try {
    const compressed = gzipSync('{"ok":true}');
    assert.equal(await request(compressed), 200);
    const result = await request(compressed, Buffer.from([0xde, 0xad, 0xbe, 0xef]));
    assert([200, 400].includes(result));
    await new Promise(resolve => setTimeout(resolve, 75));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/health`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'ok');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

test('compressed JSON with trailing bytes cannot terminate the Express process', () => {
  const child = spawnSync(process.execPath, ['-e', `(${exerciseCompressedParser.toString()})().catch(error => { console.error(error); process.exit(1); });`], { cwd: process.cwd(), encoding: 'utf8', timeout: 8000 });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr || child.stdout);
});
