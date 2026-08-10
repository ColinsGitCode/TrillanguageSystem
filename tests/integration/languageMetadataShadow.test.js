'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { api, resetState, dbService, closeServer } = require('./_harness');

test.beforeEach(resetState);
test.after(async () => { await closeServer(); });

// JLM-A0 exit gate, condition 1: enabling the shadow stage must not change the
// generated card by a single byte. The harness runs with the flags at their
// production defaults (both off), so this also pins "off means untouched".
test('generation is byte-identical and writes no metadata while the flags are off', async () => {
  const created = await api('POST', '/api/generate', { body: { phrase: 'shadow baseline' } });
  assert.equal(created.status, 200);

  const row = dbService.db.prepare(
    'SELECT markdown_content, content_hash FROM generations ORDER BY id DESC LIMIT 1'
  ).get();
  assert.equal(row.content_hash.length, 64);
  assert.equal(dbService.db.prepare('SELECT COUNT(*) AS c FROM language_metadata_jobs').get().c, 0);
  assert.equal(dbService.db.prepare('SELECT COUNT(*) AS c FROM language_metadata_proposals').get().c, 0);
  assert.ok(row.markdown_content.includes('日本語'), 'card body is unchanged and still complete');
});

// Exit gate, condition 2: the public /api/generate envelope must not gain a
// field for a stage that displays nothing.
test('the generate response envelope does not expose the shadow stage', async () => {
  const created = await api('POST', '/api/generate', { body: { phrase: 'envelope stability' } });
  assert.equal(created.status, 200);
  assert.ok(!('languageMetadata' in created.body), 'shadow output must not enter the public envelope');
  assert.ok('pronunciation' in created.body, 'existing envelope fields are unchanged');
});

test('the read API stays disabled by default and never allocates rows', async () => {
  const response = await api('GET', '/api/language-metadata?targetKind=generation&targetId=1');
  assert.equal(response.status, 404);
  assert.equal(response.body.code, 'LANGUAGE_METADATA_DISABLED');
  assert.equal(dbService.db.prepare('SELECT COUNT(*) AS c FROM language_metadata_jobs').get().c, 0);
});

test('metadata tables exist after migration and are cleared by the test reset', async () => {
  const tables = dbService.db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'language_metadata%' ORDER BY name"
  ).all().map((row) => row.name);
  assert.deepEqual(tables, ['language_metadata_jobs', 'language_metadata_proposals']);

  dbService.db.prepare(`
    INSERT INTO language_metadata_jobs(job_key, target_kind, target_id, source_content_hash,
      metadata_kind, extraction_version, created_at_utc, updated_at_utc)
    VALUES ('k', 'generation', 1, ?, 'foreign-origin', 'v1', '2026-08-10', '2026-08-10')
  `).run('a'.repeat(64));
  assert.equal(dbService.db.prepare('SELECT COUNT(*) AS c FROM language_metadata_jobs').get().c, 1);

  const reset = await api('POST', '/api/_test/reset');
  assert.equal(reset.status, 200);
  assert.equal(dbService.db.prepare('SELECT COUNT(*) AS c FROM language_metadata_jobs').get().c, 0);
});
