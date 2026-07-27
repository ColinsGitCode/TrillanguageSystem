'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { snapshotRecords } = require('../../scripts/tests/selectionTtsDataIntegrity');

test('selection TTS records snapshot detects content changes and ignores SQLite files', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'selection-tts-records-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '2026.07.27'));
  fs.writeFileSync(path.join(root, '2026.07.27', 'card.md'), '# stable card\n');
  fs.writeFileSync(path.join(root, 'trilingual_records.db'), 'ignored database bytes');

  const first = snapshotRecords(root);
  fs.writeFileSync(path.join(root, 'trilingual_records.db'), 'changed database bytes');
  const databaseOnlyChange = snapshotRecords(root);
  assert.equal(databaseOnlyChange.aggregateSha256, first.aggregateSha256);

  fs.writeFileSync(path.join(root, '2026.07.27', 'card.md'), '# changed card\n');
  const cardChange = snapshotRecords(root);
  assert.notEqual(cardChange.aggregateSha256, first.aggregateSha256);
});
