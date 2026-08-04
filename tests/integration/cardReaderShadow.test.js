'use strict';

process.env.CARD_READER_V3_SHADOW_ENABLED = '1';
process.env.CARD_READER_V3_SHADOW_MAX_MARKDOWN_CHARS = '200000';

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
  });
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
