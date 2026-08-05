'use strict';

process.env.CARD_READER_V3_SHADOW_ENABLED = '1';
process.env.CARD_READER_V3_SHADOW_MAX_MARKDOWN_CHARS = '200000';
process.env.CARD_READER_V3_CANARY_ENABLED = '1';
process.env.CARD_READER_V3_CANARY_GENERATION_IDS = '1,2';

const assert = require('node:assert/strict');
const test = require('node:test');
const { api, closeServer, dbService, resetState } = require('./_harness');

test.beforeEach(() => resetState());
test.after(closeServer);

test('shadow config advertises the internal comparator without exposing card content', async () => {
  const response = await api('GET', '/api/card-reader/shadow/config');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    success: true,
    enabled: true,
    version: 'card-reader-shadow-v1',
    canaryEnabled: true,
    canaryGenerationIds: [1, 2],
  });
});

test('allowlisted trilingual Canary returns CardDocument without SQLite writes', async () => {
  const generated = await api('POST', '/api/generate', {
    body: { phrase: 'card reader canary fixture', card_type: 'trilingual' },
  });
  assert.equal(generated.status, 200);
  assert.equal(generated.body.generationId, 1);
  const beforeChanges = dbService.db.prepare('SELECT total_changes() AS count').get().count;

  const response = await api('GET', '/api/card-reader/canary?generationId=1');

  const afterChanges = dbService.db.prepare('SELECT total_changes() AS count').get().count;
  assert.equal(response.status, 200);
  assert.equal(afterChanges, beforeChanges);
  assert.equal(response.body.canary.rendererVersion, 3);
  assert.equal(response.body.canary.document.version, 'card-document-v1');
  assert.deepEqual(response.body.canary.document.sections.map((section) => section.language), ['en', 'ja', 'zh']);
  assert.equal(JSON.stringify(response.body.canary).includes('<script'), false);
});

test('Canary rejects non-allowlisted and non-trilingual generations', async () => {
  const trilingual = await api('POST', '/api/generate', {
    body: { phrase: 'allowlisted trilingual', card_type: 'trilingual' },
  });
  const grammar = await api('POST', '/api/generate', {
    body: { phrase: '〜なくなった', card_type: 'grammar_ja' },
  });
  assert.equal(trilingual.body.generationId, 1);
  assert.equal(grammar.body.generationId, 2);

  const grammarResponse = await api('GET', '/api/card-reader/canary?generationId=2');
  assert.equal(grammarResponse.status, 409);
  assert.equal(grammarResponse.body.code, 'CARD_READER_V3_CANARY_CARD_TYPE_UNSUPPORTED');

  const missing = await api('GET', '/api/card-reader/canary?generationId=999');
  assert.equal(missing.status, 404);
});

test('shadow comparison is read-only and returns a bounded parity report', async () => {
  const generated = await api('POST', '/api/generate', {
    body: { phrase: 'card reader shadow fixture', card_type: 'trilingual' },
  });
  assert.equal(generated.status, 200);
  const generationId = generated.body.generationId;
  const beforeChanges = dbService.db.prepare('SELECT total_changes() AS count').get().count;

  const response = await api('GET', `/api/card-reader/shadow?generationId=${generationId}`);

  const afterChanges = dbService.db.prepare('SELECT total_changes() AS count').get().count;
  assert.equal(response.status, 200);
  assert.equal(afterChanges, beforeChanges);
  assert.equal(response.body.report.generationId, generationId);
  assert.equal(response.body.report.parity, true);
  assert.equal(response.body.report.matches.visibleText, true);
  assert.equal(response.body.report.matches.sectionLanguages, true);
  assert.equal(response.body.report.matches.audioNodes, true);
  assert.equal(response.body.report.sourceContentHash.length, 64);
  assert.ok(response.body.report.durationMs >= 0);
  assert.equal(JSON.stringify(response.body.report).includes('card reader shadow fixture'), false);
  assert.equal('document' in response.body.report, false);
  assert.equal('markdown' in response.body.report, false);
});

test('shadow route validates ids and missing generations', async () => {
  const invalid = await api('GET', '/api/card-reader/shadow?generationId=nope');
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, 'CARD_READER_SHADOW_GENERATION_INVALID');

  const missing = await api('GET', '/api/card-reader/shadow?generationId=999999');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, 'CARD_READER_SHADOW_GENERATION_NOT_FOUND');
});
