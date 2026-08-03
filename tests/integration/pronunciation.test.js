'use strict';

process.env.PRONUNCIATION_OVERLAY_ENABLED = '1';
process.env.PRONUNCIATION_ACTIONS_ENABLED = '1';

const assert = require('node:assert/strict');
const test = require('node:test');
const { api, closeServer, dbService, resetState } = require('./_harness');

test.beforeEach(() => resetState());
test.after(closeServer);

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
