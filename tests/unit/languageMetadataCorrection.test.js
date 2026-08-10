'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const domain = require('../../services/storage/db/languageMetadata');
const {
  createLanguageMetadataCorrectionService,
} = require('../../services/languageMetadata/application/correctionService');

const SCHEMA = fs.readFileSync(path.join(__dirname, '../../database/schema.sql'), 'utf8');
const HASH = 'a'.repeat(64);
const MARKDOWN = '# t\n## 2. 日本語:\n- **例句1**: データを使う。';

function setup() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  const generation = { id: 7, content_hash: HASH, markdown_content: MARKDOWN };
  const dbService = {
    getGenerationById: (id) => Number(id) === 7 ? generation : null,
    getTextbookExpression: () => null,
    listLanguageMetadataProposals: (options) => domain.listProposals(db, options),
    insertLanguageMetadataProposal: (payload) => domain.insertProposal(db, payload),
  };
  return {
    db,
    service: createLanguageMetadataCorrectionService({
      dbService,
      now: () => '2026-08-11T00:00:00.000Z',
    }),
  };
}

function validPayload(originTerm = 'data') {
  return {
    targetKind: 'generation',
    targetId: 7,
    sourceContentHash: HASH,
    surface: 'データ',
    startCodePoint: 15,
    endCodePoint: 18,
    originTerm,
    originLanguage: 'en',
  };
}

test('human correction is server-validated, idempotent, and replaceable', () => {
  const { service } = setup();
  const first = service.correct(validPayload('data'));
  assert.equal(first.created, true);
  assert.equal(first.replaced, false);

  const replay = service.correct(validPayload('data'));
  assert.equal(replay.idempotent, true);
  assert.equal(replay.proposal.id, first.proposal.id);

  const replacement = service.correct(validPayload('datum'));
  assert.equal(replacement.created, true);
  assert.equal(replacement.replaced, true);
  assert.equal(replacement.proposal.supersedesProposalId, first.proposal.id);
  assert.equal(replacement.proposal.value.originTerm, 'datum');
});

test('human correction rejects missing targets, stale hashes, and forged ranges', () => {
  const { service } = setup();
  assert.throws(
    () => service.correct({ ...validPayload(), targetId: 999 }),
    (error) => error.code === 'LANGUAGE_METADATA_TARGET_NOT_FOUND' && error.status === 404
  );
  assert.throws(
    () => service.correct({ ...validPayload(), sourceContentHash: 'b'.repeat(64) }),
    (error) => error.code === 'LANGUAGE_METADATA_SOURCE_CONFLICT' && error.status === 409
  );
  assert.throws(
    () => service.correct({ ...validPayload(), startCodePoint: 0, endCodePoint: 3 }),
    (error) => error.code === 'LANGUAGE_METADATA_CORRECTION_INVALID' && error.status === 400
  );
});
