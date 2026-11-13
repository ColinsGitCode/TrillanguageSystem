'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveGenerationOrigin } = require('../../services/application/generationOrigin');

test('selection defers its destination to execution and retains only bounded provenance', () => {
  const sourceContext = { surface: 'card-modal', generationId: 42, folder: '20000101', baseFilename: 'source' };
  assert.deepEqual(resolveGenerationOrigin({
    sourceMode: 'selection', targetFolder: '19990101', sourceContext: { ...sourceContext, arbitrary: 'discard' },
  }), { targetFolder: '', sourceContext });
});

test('old selection clients retain their source folder without controlling the archive', () => {
  assert.deepEqual(resolveGenerationOrigin({ sourceMode: 'selection', targetFolder: ' 20000101 ' }), {
    targetFolder: '', sourceContext: { folder: '20000101' },
  });
});

test('selection metadata excludes paths, invalid ids, oversized names and arrays', () => {
  for (const value of ['../source', '/absolute', 'a\\b', '.', '..', 'a\nb', 'x'.repeat(129)]) {
    assert.deepEqual(resolveGenerationOrigin({
      sourceMode: 'selection', targetFolder: value,
      sourceContext: { folder: value, baseFilename: 'x'.repeat(256), generationId: -1, surface: 'unknown' },
    }), { targetFolder: '', sourceContext: {} });
  }
  assert.deepEqual(resolveGenerationOrigin({ sourceMode: 'selection', sourceContext: ['source'] }), {
    targetFolder: '', sourceContext: {},
  });
});

test('input, OCR and textbook domain destinations remain unchanged', () => {
  for (const sourceMode of ['input', 'ocr', 'textbook_selection', null]) {
    assert.deepEqual(resolveGenerationOrigin({
      sourceMode, targetFolder: ' custom ', sourceContext: { source: 'textbook_derivation', derivationId: 3 },
    }), { targetFolder: 'custom', sourceContext: { source: 'textbook_derivation', derivationId: 3 } });
  }
});
