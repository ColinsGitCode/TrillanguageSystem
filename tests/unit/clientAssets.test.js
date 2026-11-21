'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const express = require('express');
const { clientAssets } = require('../../lib/clientAssets');
const { encodeClientAssets } = require('../../scripts/build/encodeClientAssets');

test('hashed bundles negotiate lossless encodings; HTML and private endpoints never inherit their cache', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-assets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const assets = path.join(root, 'client/assets');
  fs.mkdirSync(assets, { recursive: true });
  const file = 'factory-ABc_d123.js';
  const original = Buffer.from('const title = "学习卡";\n'.repeat(80));
  fs.writeFileSync(path.join(assets, file), original);
  fs.writeFileSync(path.join(assets, 'unversioned.js'), original);
  fs.writeFileSync(path.join(root, 'client/index.html'), 'viewer');
  encodeClientAssets(root);
  const app = express().use(clientAssets(root)).get('/api/private', (_req, res) => res.set('Cache-Control', 'no-store').send('private'));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const get = (url, headers = {}) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: url, headers, agent: false }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
  for (const [offer, expected, decode] of [
    ['br, gzip', 'br', zlib.brotliDecompressSync], ['gzip', 'gzip', zlib.gunzipSync],
    ['br;q=0, gzip;q=0', undefined, b => b], [null, undefined, b => b],
  ]) {
    const headers = offer ? { 'Accept-Encoding': offer } : {};
    const result = await get('/assets/' + file, headers);
    assert.equal(result.status, 200);
    assert.equal(result.headers['content-encoding'], expected);
    assert.match(result.headers.vary, /Accept-Encoding/i);
    assert.match(result.headers['cache-control'], /max-age=31536000, immutable/);
    assert.deepEqual(decode(result.body), original);
    assert.equal((await get('/assets/' + file, { ...headers, 'If-None-Match': result.headers.etag })).status, 304);
  }
  for (const url of ['/index.html', '/assets/unversioned.js', '/api/private']) {
    const { headers } = await get(url, { 'Accept-Encoding': 'br' });
    assert.doesNotMatch(headers['cache-control'], /immutable/u);
    assert.equal(headers['content-encoding'], undefined);
  }
  assert.equal((await get('/encoded/' + file + '.br')).status, 404);
});
