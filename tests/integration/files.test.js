'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { api, resetState, closeServer } = require('./_harness');

test.before(() => resetState());
test.after(async () => { await closeServer(); });

test.describe('/api/folders + /api/highlights/by-file + /api/records/by-file', () => {
  test.beforeEach(() => resetState());

  test.it('GET /api/folders → folders:[] on empty RECORDS_PATH', async () => {
    const res = await api('GET', '/api/folders');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.folders));
  });

  test.it('GET /api/highlights/by-file 400 when params missing', async () => {
    const res = await api('GET', '/api/highlights/by-file?folder=a&base=b');
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'folder, base and sourceHash are required');
  });

  test.it('GET /api/highlights/by-file → highlight:null when nothing saved', async () => {
    const res = await api('GET', '/api/highlights/by-file?folder=20260101&base=hello&sourceHash=h1');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.highlight, null);
  });

  test.it('PUT then GET round-trip for highlights, with mark count derived from HTML', async () => {
    const put = await api('PUT', '/api/highlights/by-file', {
      body: {
        folder: '20260101',
        base: 'hello',
        sourceHash: 'h1',
        html: '<p>Hello <mark class="study-highlight-red">world</mark>!</p>',
        version: 1,
        updatedBy: 'integration-test'
      }
    });
    assert.equal(put.status, 200);
    assert.equal(put.body.success, true);
    assert.equal(put.body.highlight.markCount, 1);

    const get = await api('GET', '/api/highlights/by-file?folder=20260101&base=hello&sourceHash=h1');
    assert.equal(get.status, 200);
    assert.equal(get.body.highlight.markCount, 1);
    assert.equal(get.body.highlight.updatedBy, 'integration-test');
  });

  test.it('PUT /api/highlights/by-file rejects empty html', async () => {
    const res = await api('PUT', '/api/highlights/by-file', {
      body: { folder: 'a', base: 'b', sourceHash: 'c', html: '' }
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'html is required');
  });

  test.it('DELETE /api/highlights/by-file removes the saved version', async () => {
    await api('PUT', '/api/highlights/by-file', {
      body: { folder: 'fA', base: 'fB', sourceHash: 'fH', html: '<p>x</p>' }
    });
    const del = await api('DELETE', '/api/highlights/by-file?folder=fA&base=fB&sourceHash=fH');
    assert.equal(del.status, 200);
    assert.equal(del.body.success, true);
    assert.ok(del.body.deleted >= 1);

    const after = await api('GET', '/api/highlights/by-file?folder=fA&base=fB&sourceHash=fH');
    assert.equal(after.body.highlight, null);
  });

  test.it('GET /api/records/by-file 400 when folder or base missing', async () => {
    const res = await api('GET', '/api/records/by-file?folder=only');
    assert.equal(res.status, 400);
  });
});
