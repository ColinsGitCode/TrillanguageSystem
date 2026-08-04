'use strict';

process.env.PRONUNCIATION_OVERLAY_ENABLED = '1';
process.env.PRONUNCIATION_ACTIONS_ENABLED = '1';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { api, closeServer, dbService, resetState } = require('./_harness');

test.beforeEach(() => resetState());
test.after(closeServer);

function insertLegacyGeneration(markdown) {
  const contentHash = crypto.createHash('sha256').update(markdown).digest('hex');
  return Number(dbService.db.prepare(`
    INSERT INTO generations(
      phrase, phrase_language, card_type, source_mode, llm_provider, llm_model,
      folder_name, base_filename, md_file_path, html_file_path, meta_file_path,
      markdown_content, content_hash, generation_date, request_id
    ) VALUES ('legacy pronunciation read', 'ja', 'trilingual', 'input', 'gemini', 'legacy',
      '20260201', 'legacy-pronunciation-read', '/tmp/legacy.md', '/tmp/legacy.html', '/tmp/legacy.json',
      ?, ?, '2026-02-01', ?)
  `).run(markdown, contentHash, crypto.randomUUID()).lastInsertRowid);
}

test('reading an unmaterialized legacy card returns an ephemeral projection without SQLite writes', async () => {
  const generationId = insertLegacyGeneration('# legacy\n\n## 2. 日本語:\n- **例句1**: <ruby>勤務表<rt>きんむひょう</rt></ruby>を確認します。');
  const before = dbService.db.prepare('SELECT COUNT(*) AS count FROM pronunciation_documents').get().count;

  const response = await api('GET', `/api/pronunciation?targetKind=generation&targetId=${generationId}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.document.persisted, false);
  assert.equal(response.body.document.id, null);
  assert.equal(response.body.document.revision, 0);
  assert.ok(response.body.tokens.length > 0);
  assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM pronunciation_documents').get().count, before);
  assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM pronunciation_tokens').get().count, 0);
});

test('generation persists a pronunciation projection and the API returns plain text tokens', async () => {
  const generated = await api('POST', '/api/generate', { body: { phrase: '勤務表', card_type: 'trilingual' } });
  assert.equal(generated.status, 200);
  assert.ok(generated.body.generationId > 0);
  assert.equal(generated.body.llm_output.markdown_content.includes('<ruby>'), false);

  const response = await api('GET', `/api/pronunciation?targetKind=generation&targetId=${generated.body.generationId}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.target.targetKind, 'generation');
  assert.equal(response.body.plainText.includes('<ruby>'), false);
  assert.ok(response.body.tokens.some((token) => token.surface === '勤務表'));
  assert.equal(response.body.document.sourceContentHash.length, 64);
  assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM pronunciation_documents').get().count, 1);
});

test('correction events are idempotent and stale revisions are rejected', async () => {
  const generated = await api('POST', '/api/generate', { body: { phrase: '一人', card_type: 'trilingual' } });
  const pronunciation = await api('GET', `/api/pronunciation?targetKind=generation&targetId=${generated.body.generationId}`);
  assert.equal(pronunciation.status, 200);
  const token = pronunciation.body.tokens.find((item) => item.surface === '一人') || pronunciation.body.tokens[0];
  const payload = {
    targetKind: 'generation',
    targetId: generated.body.generationId,
    tokenKey: token.tokenKey,
    eventKey: 'pronunciation-integration-event-1',
    eventType: 'reading',
    expectedRevision: pronunciation.body.document.revision,
    readingRaw: 'ヒトリ',
    readingHiragana: 'ひとり',
    status: 'accepted',
  };
  const first = await api('POST', '/api/pronunciation/corrections', { body: payload });
  assert.equal(first.status, 201);
  const repeated = await api('POST', '/api/pronunciation/corrections', { body: payload });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.idempotent, true);
  const stale = await api('POST', '/api/pronunciation/corrections', {
    body: { ...payload, eventKey: 'pronunciation-integration-event-2' },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'PRONUNCIATION_REVISION_STALE');
});

test('invalid token and boundary corrections do not append immutable events or advance revision', async () => {
  const generated = await api('POST', '/api/generate', { body: { phrase: '勤務表', card_type: 'trilingual' } });
  const pronunciation = await api('GET', `/api/pronunciation?targetKind=generation&targetId=${generated.body.generationId}`);
  const beforeRevision = pronunciation.body.document.revision;

  const missing = await api('POST', '/api/pronunciation/corrections', { body: {
    targetKind: 'generation',
    targetId: generated.body.generationId,
    tokenKey: 'missing-token',
    eventKey: 'pronunciation-invalid-token-001',
    eventType: 'reading',
    expectedRevision: beforeRevision,
    readingHiragana: 'きんむひょう',
  } });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, 'PRONUNCIATION_TOKEN_NOT_FOUND');

  const token = pronunciation.body.tokens[0];
  const invalidBoundary = await api('POST', '/api/pronunciation/corrections', { body: {
    targetKind: 'generation',
    targetId: generated.body.generationId,
    tokenKey: token.tokenKey,
    eventKey: 'pronunciation-invalid-boundary-001',
    eventType: 'boundary',
    expectedRevision: beforeRevision,
    startCodePoint: -1,
    endCodePoint: 999999,
  } });
  assert.equal(invalidBoundary.status, 422);
  assert.equal(invalidBoundary.body.code, 'PRONUNCIATION_BOUNDARY_INVALID');
  assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM pronunciation_correction_events').get().count, 0);
  assert.equal(
    dbService.db.prepare('SELECT revision FROM pronunciation_documents WHERE id = ?').get(pronunciation.body.document.id).revision,
    beforeRevision
  );
});
