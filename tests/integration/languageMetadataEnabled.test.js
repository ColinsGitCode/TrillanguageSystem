'use strict';

process.env.TEST_LANGUAGE_METADATA_ENABLED = '1';
process.env.TEST_LANGUAGE_METADATA_EXTRACTION_ENABLED = '0';

const assert = require('node:assert/strict');
const test = require('node:test');
const { api, resetState, dbService, closeServer } = require('./_harness');

const HASH = 'a'.repeat(64);
const MARKDOWN = '# t\n## 2. 日本語:\n- **例句1**: データを使う。';

function insertGeneration() {
  return Number(dbService.db.prepare(`
    INSERT INTO generations(
      phrase, card_type, llm_provider, folder_name, base_filename,
      md_file_path, html_file_path, markdown_content, content_hash
    ) VALUES ('fixture', 'trilingual', 'deepseek', '20260811', 'fixture',
      'fixture.md', 'fixture.html', ?, ?)
  `).run(MARKDOWN, HASH).lastInsertRowid);
}

test.beforeEach(resetState);
test.after(async () => { await closeServer(); });

test('manual correction validates the real target and replaces the displayed human fact', async () => {
  const generationId = insertGeneration();
  const payload = {
    targetKind: 'generation',
    targetId: generationId,
    sourceContentHash: HASH,
    surface: 'データ',
    startCodePoint: 15,
    endCodePoint: 18,
    originTerm: 'data',
    originLanguage: 'en',
  };
  const first = await api('POST', '/api/language-metadata/corrections', { body: payload });
  assert.equal(first.status, 201);
  const second = await api('POST', '/api/language-metadata/corrections', {
    body: { ...payload, originTerm: 'datum' },
  });
  assert.equal(second.status, 201);
  assert.equal(second.body.replaced, true);
  assert.equal(second.body.proposal.value.originTerm, 'datum');
  assert.equal(second.body.proposal.supersedesProposalId, first.body.proposal.id);
});

test('manual correction rejects forged targets, hashes, and ranges without writing', async () => {
  const generationId = insertGeneration();
  const base = {
    targetKind: 'generation', targetId: generationId, sourceContentHash: HASH,
    surface: 'データ', startCodePoint: 15, endCodePoint: 18,
    originTerm: 'data', originLanguage: 'en',
  };
  const missing = await api('POST', '/api/language-metadata/corrections', {
    body: { ...base, targetId: 999999 },
  });
  assert.equal(missing.status, 404);
  const stale = await api('POST', '/api/language-metadata/corrections', {
    body: { ...base, sourceContentHash: 'b'.repeat(64) },
  });
  assert.equal(stale.status, 409);
  const forged = await api('POST', '/api/language-metadata/corrections', {
    body: { ...base, startCodePoint: 0, endCodePoint: 3 },
  });
  assert.equal(forged.status, 400);
  assert.equal(dbService.db.prepare('SELECT COUNT(*) AS c FROM language_metadata_proposals').get().c, 0);
});

test('manual job compensation is idempotent and does not call the provider in the request', async () => {
  const generationId = insertGeneration();
  const first = await api('POST', '/api/language-metadata/jobs', { body: { generationId } });
  assert.equal(first.status, 202);
  assert.equal(first.body.status, 'queued');
  const second = await api('POST', '/api/language-metadata/jobs', { body: { generationId } });
  assert.equal(second.status, 202);
  assert.equal(second.body.jobId, first.body.jobId);
  assert.equal(dbService.db.prepare('SELECT COUNT(*) AS c FROM language_metadata_jobs').get().c, 1);
});
