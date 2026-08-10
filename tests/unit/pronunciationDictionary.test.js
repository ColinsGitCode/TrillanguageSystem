'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createDictionaryReader } = require('../../services/pronunciation/pronunciationPorts');

test('versioned Japanese pronunciation dictionary has valid unique accepted entries', () => {
  const reader = createDictionaryReader();
  const entries = reader.entries();

  assert.equal(reader.version(), 'ja-pronunciation-v2');
  assert.ok(entries.length >= 11);

  const surfaces = new Set();
  for (const entry of entries) {
    assert.equal(typeof entry.surface, 'string');
    assert.ok(entry.surface.length > 0);
    assert.equal(typeof entry.reading, 'string');
    assert.match(entry.reading, /^[ぁ-ゖー]+$/u);
    assert.ok(['word', 'kanji', 'phrase'].includes(entry.unitKind));
    assert.equal(typeof entry.reason, 'string');
    assert.ok(entry.reason.length > 0);
    assert.equal(surfaces.has(entry.surface), false, `duplicate surface: ${entry.surface}`);
    surfaces.add(entry.surface);
  }

  assert.deepEqual(
    entries.find((entry) => entry.surface === '一人'),
    {
      surface: '一人',
      reading: 'ひとり',
      unitKind: 'word',
      reason: 'irregular counter reading',
    },
  );
  assert.deepEqual(entries.find((entry) => entry.surface === 'リフレッシュ')?.foreignOrigin, {
    language: '英语',
    term: 'refresh',
    source: 'curated',
  });
});

test('dictionary reader returns defensive entry copies', () => {
  const reader = createDictionaryReader();
  const first = reader.entries();
  first[0].reading = '改変';

  assert.notEqual(reader.entries()[0].reading, '改変');
});
