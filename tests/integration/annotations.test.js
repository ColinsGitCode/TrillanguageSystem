'use strict';

process.env.CARD_ANNOTATIONS_ENABLED = '1';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  api,
  resetState,
  dbService,
  closeServer,
} = require('./_harness');

const HASH = '6'.repeat(64);
const MARKDOWN = '# hello\n\nfoo bar baz';
const ID = '018f0f96-5a90-7d75-a2c6-86559b5de941';

function seedGeneration() {
  return Number(dbService.db.prepare(`
    INSERT INTO generations(
      phrase, phrase_language, card_type, source_mode, llm_provider, llm_model,
      folder_name, base_filename, md_file_path, html_file_path, meta_file_path,
      markdown_content, content_hash, generation_date, request_id
    ) VALUES (
      'hello', 'en', 'trilingual', 'input', 'deepseek', 'deepseek-v4-pro',
      '20260727', 'hello', '/tmp/hello.md', '/tmp/hello.html', '/tmp/hello.json',
      ?, ?, '2026-07-27', 'annotation-route-integration'
    )
  `).run(MARKDOWN, HASH).lastInsertRowid);
}

function payload(generationId, overrides = {}) {
  return {
    id: ID,
    targetKind: 'generation',
    targetId: generationId,
    expectedTargetRevision: HASH,
    selector: {
      projectionVersion: 'card-visible-text-v1',
      textQuote: {
        type: 'TextQuoteSelector',
        exact: 'bar',
        prefix: 'hello foo ',
        suffix: ' baz',
      },
      textPosition: {
        type: 'TextPositionSelector',
        start: 10,
        end: 13,
      },
    },
    annotationKind: 'highlight',
    color: 'red',
    ...overrides,
  };
}

test.beforeEach(resetState);
test.after(async () => { await closeServer(); });

test('Cards Factory annotation API writes only canonical annotations', async () => {
  const generationId = seedGeneration();

  const empty = await api(
    'GET',
    `/api/annotations?targetKind=generation&targetId=${generationId}`
  );
  assert.equal(empty.status, 200);
  assert.equal(empty.body.target.targetRevision, HASH);
  assert.deepEqual(empty.body.annotations, []);

  const created = await api('POST', '/api/annotations', {
    body: payload(generationId),
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.annotation.selector.textQuote.exact, 'bar');
  assert.equal(created.body.compatibility, undefined);

  const listed = await api(
    'GET',
    `/api/annotations?targetKind=generation&targetId=${generationId}`
  );
  assert.equal(listed.status, 200);
  assert.equal(listed.body.annotations.length, 1);

  assert.equal(
    dbService.db.prepare('SELECT COUNT(*) AS count FROM card_highlights').get().count,
    0
  );

  const removed = await api('DELETE', `/api/annotations/${ID}`, {
    body: { expectedVersion: 1 },
  });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.annotation.status, 'deleted');

  assert.equal(
    dbService.db.prepare('SELECT COUNT(*) AS count FROM card_highlights').get().count,
    0
  );
});

test('rejects stale target revisions before any write', async () => {
  const generationId = seedGeneration();
  const response = await api('POST', '/api/annotations', {
    body: payload(generationId, { expectedTargetRevision: '7'.repeat(64) }),
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'ANNOTATION_TARGET_REVISION_CONFLICT');
  assert.equal(dbService.listCardAnnotations('generation', generationId).length, 0);
});

test('keeps expression-level textbook annotations behind their later phase gate', async () => {
  const response = await api(
    'GET',
    '/api/annotations?targetKind=textbook_expression&targetId=1'
  );
  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'ANNOTATION_CONSUMER_NOT_ENABLED');
});
