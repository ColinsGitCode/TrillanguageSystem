'use strict';

process.env.CARD_ANNOTATIONS_SHADOW_READ_ENABLED = '1';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  api,
  resetState,
  dbService,
  closeServer,
} = require('./_harness');
const {
  applyAnnotationMigrationPlan,
} = require('../../services/annotations/application/applyAnnotationMigrationPlan');
const {
  buildAnnotationMigrationPlan,
} = require('../../services/annotations/application/buildAnnotationMigrationPlan');
const {
  annotationShadowReadService,
} = require('../../services/annotations/annotationRuntime');

const HASH = '5'.repeat(64);

function seedGeneration() {
  return Number(dbService.db.prepare(`
    INSERT INTO generations(
      phrase, phrase_language, card_type, source_mode, llm_provider, llm_model,
      folder_name, base_filename, md_file_path, html_file_path, meta_file_path,
      markdown_content, content_hash, generation_date, request_id
    ) VALUES (
      'hello', 'en', 'trilingual', 'input', 'deepseek', 'deepseek-v4-pro',
      '20260727', 'hello', '/tmp/hello.md', '/tmp/hello.html', '/tmp/hello.json',
      '# hello\n\nfoo bar baz', ?, '2026-07-27', 'annotation-shadow-integration'
    )
  `).run(HASH).lastInsertRowid);
}

test.beforeEach(() => {
  resetState();
  annotationShadowReadService.resetForTests();
});
test.after(async () => { await closeServer(); });

test('Cards Factory keeps the legacy response while shadow projection matches', async () => {
  const generationId = seedGeneration();
  const highlight = dbService.upsertCardHighlight({
    generationId,
    folderName: '20260727',
    baseFilename: 'hello',
    sourceHash: HASH,
    htmlContent: '<div><h1>hello</h1><p>foo <mark class="study-highlight-red">bar</mark> baz</p></div>',
    version: 3,
    updatedBy: 'integration-test',
  });
  const plan = await buildAnnotationMigrationPlan({ db: dbService.db });
  applyAnnotationMigrationPlan({
    dbService,
    plan,
    expectedPlanHash: plan.planHash,
  });

  const response = await api(
    'GET',
    `/api/highlights/by-file?folder=20260727&base=hello&sourceHash=${HASH}`
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.highlight.id, highlight.id);
  assert.equal(response.body.highlight.htmlContent, highlight.htmlContent);
  assert.equal(response.body.highlight.version, 3);

  await annotationShadowReadService.flush();
  const status = await api('GET', '/api/annotations/shadow-status');
  assert.equal(status.status, 200);
  assert.equal(status.body.shadow.matched, 1);
  assert.equal(status.body.shadow.mismatched, 0);
  assert.equal(status.body.shadow.byConsumer['cards-factory'].matched, 1);
  assert.equal('htmlContent' in status.body.shadow.lastDiagnostic, false);
});
