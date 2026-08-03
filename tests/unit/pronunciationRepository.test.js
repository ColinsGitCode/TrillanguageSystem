'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
const repository = require('../../services/storage/db/pronunciation');

function schema(db) {
  db.exec(fs.readFileSync(path.join(__dirname, '../../database/schema.sql'), 'utf8'));
}

test('repository writes a document and append-only correction events', () => {
  const db = new Database(':memory:');
  schema(db);
  try {
    const created = repository.createDocument(db, {
      targetKind: 'generation', targetId: 1, sourceContentHash: 'a'.repeat(64),
      documentHash: 'b'.repeat(64), analyzerVersion: 'test', dictionaryVersion: 'test',
      now: '2026-08-03T00:00:00.000Z',
      tokens: [{ tokenKey: 'token:1', surface: '一人', startCodePoint: 0, endCodePoint: 2, readingRaw: 'イチニン', readingHiragana: 'いちにん', unitKind: 'word', source: 'analyzer', ruleVersion: 'test', evidence: {}, components: [] }],
    });
    assert.equal(created.created, true);
    assert.equal(repository.listTokens(db, created.document.id).length, 1);
    const event = repository.appendCorrection(db, {
      documentId: created.document.id, tokenKey: 'token:1', eventKey: 'repo-event-1',
      eventType: 'reading', payloadHash: 'c'.repeat(64), payloadJson: '{}', expectedRevision: 1,
      now: '2026-08-03T00:00:00.000Z',
    });
    assert.equal(event.idempotent, false);
    assert.equal(repository.appendCorrection(db, {
      documentId: created.document.id, tokenKey: 'token:1', eventKey: 'repo-event-1',
      eventType: 'reading', payloadHash: 'c'.repeat(64), payloadJson: '{}', expectedRevision: 1,
    }).idempotent, true);
    assert.throws(() => repository.appendCorrection(db, {
      documentId: created.document.id, tokenKey: 'token:1', eventKey: 'repo-event-1',
      eventType: 'reading', payloadHash: 'd'.repeat(64), payloadJson: '{}', expectedRevision: 1,
    }), (error) => error.code === 'PRONUNCIATION_EVENT_CONFLICT');
    assert.throws(() => db.prepare('DELETE FROM pronunciation_correction_events').run(), /immutable/u);
  } finally {
    db.close();
  }
});
