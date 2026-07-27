'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SelectionTtsCache } = require('../../services/selectionTts/selectionTtsCache');

test('selection TTS cache stores, reads, expires and evicts oldest audio', async (t) => {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'selection-tts-cache-'));
  t.after(() => fs.rmSync(rootPath, { recursive: true, force: true }));
  let now = 1000;
  const cache = new SelectionTtsCache({
    rootPath,
    ttlMs: 1000,
    maxBytes: 6,
    clock: () => now,
  });
  assert.equal(await cache.get('missing'), null);
  assert.equal(await cache.set('one', Buffer.from('1234'), { contentType: 'audio/mpeg' }), true);
  const hit = await cache.get('one');
  assert.equal(hit.buffer.toString(), '1234');
  assert.equal(hit.metadata.contentType, 'audio/mpeg');

  now = 1500;
  assert.equal(await cache.set('two', Buffer.from('5678'), { contentType: 'audio/mpeg' }), true);
  assert.equal(await cache.get('one'), null);
  assert.equal((await cache.get('two')).buffer.toString(), '5678');

  now = 3000;
  assert.equal(await cache.get('two'), null);
});

test('selection TTS cache fails closed on corrupt metadata', async (t) => {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'selection-tts-cache-corrupt-'));
  t.after(() => fs.rmSync(rootPath, { recursive: true, force: true }));
  const cache = new SelectionTtsCache({ rootPath });
  fs.writeFileSync(path.join(rootPath, 'bad.audio'), 'audio');
  fs.writeFileSync(path.join(rootPath, 'bad.json'), '{broken');
  assert.equal(await cache.get('bad'), null);
});
