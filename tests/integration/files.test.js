'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { api, resetState, closeServer } = require('./_harness');
const { serverInstance } = require('../../server.js');

// node:http sends the path as written; fetch and URL would normalize "." away.
function rawGet(requestPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port: serverInstance.address().port, path: requestPath, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.on('error', reject);
    request.end();
  });
}

test.before(() => resetState());
test.after(async () => { await closeServer(); });

test.describe('/api/folders + /api/records/by-file', () => {
  test.beforeEach(() => resetState());

  test.it('GET /api/folders returns an array', async () => {
    const response = await api('GET', '/api/folders');
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.folders));
  });

  test.it('retires legacy highlight and shadow-read endpoints', async () => {
    const requests = [
      ['GET', '/api/highlights/by-file?folder=20260101&base=hello&sourceHash=h1'],
      ['PUT', '/api/highlights/by-file', { body: {} }],
      ['DELETE', '/api/highlights/by-file?folder=20260101&base=hello&sourceHash=h1'],
      ['GET', '/api/annotations/shadow-status'],
    ];
    for (const [method, url, options] of requests) {
      const response = await api(method, url, options);
      assert.equal(response.status, 404);
    }
  });

  test.it('GET /api/records/by-file rejects a missing base', async () => {
    const response = await api('GET', '/api/records/by-file?folder=only');
    assert.equal(response.status, 400);
  });
});

test.describe('/api/folders/:folder/files/:file', () => {
  const records = process.env.RECORDS_PATH;
  const audio = Buffer.alloc(2048, 7);
  test.before(() => {
    fs.mkdirSync(path.join(records, '20260101'), { recursive: true });
    fs.mkdirSync(path.join(records, '20260101x'), { recursive: true });
    fs.writeFileSync(path.join(records, '20260101', 'clip_ja_1.wav'), audio);
    fs.writeFileSync(path.join(records, '20260101x', 'secret.md'), 'sibling folder');
    fs.writeFileSync(path.join(records, 'root-secret.db'), 'records root');
  });

  test.it('streams card audio with byte ranges and a short private cache', async () => {
    const full = await rawGet('/api/folders/20260101/files/clip_ja_1.wav');
    assert.equal(full.status, 200);
    assert.equal(full.headers['content-type'], 'audio/wav');
    assert.equal(full.headers['accept-ranges'], 'bytes');
    assert.equal(full.headers['cache-control'], 'private, max-age=600');
    assert.ok(full.headers.etag);
    assert.equal(full.body.length, audio.length);

    // Safari plays media only from a server that answers range requests.
    const range = await rawGet('/api/folders/20260101/files/clip_ja_1.wav', { Range: 'bytes=0-1' });
    assert.equal(range.status, 206);
    assert.equal(range.headers['content-range'], `bytes 0-1/${audio.length}`);
    assert.equal(range.body.length, 2);

    const revalidated = await rawGet('/api/folders/20260101/files/clip_ja_1.wav', { 'If-None-Match': full.headers.etag });
    assert.equal(revalidated.status, 304);
  });

  test.it('never reads outside the named folder', async () => {
    for (const requestPath of [
      '/api/folders/20260101/files/..%2F20260101x%2Fsecret.md',
      '/api/folders/./files/root-secret.db',
      '/api/folders/%2E/files/root-secret.db',
      '/api/folders/20260101/files/..%2Froot-secret.db',
    ]) {
      const response = await rawGet(requestPath);
      assert.equal(response.status, 404, requestPath);
      assert.equal(response.body.toString().includes('records root'), false, requestPath);
      assert.equal(response.body.toString().includes('sibling folder'), false, requestPath);
    }
  });
});
