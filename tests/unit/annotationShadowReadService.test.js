'use strict';

process.env.DB_PATH = ':memory:';
process.env.LOG_SILENT = '1';

const assert = require('node:assert/strict');
const test = require('node:test');
const databaseModule = require('../../services/storage/databaseService');
const { DatabaseService } = databaseModule;
const {
  applyAnnotationMigrationPlan,
} = require('../../services/annotations/application/applyAnnotationMigrationPlan');
const {
  buildAnnotationMigrationPlan,
} = require('../../services/annotations/application/buildAnnotationMigrationPlan');
const {
  AnnotationShadowReadService,
} = require('../../services/annotations/application/annotationShadowReadService');

const HASH = '6'.repeat(64);

function seedGeneration(db) {
  return Number(db.prepare(`
    INSERT INTO generations(
      phrase, phrase_language, card_type, source_mode, llm_provider, llm_model,
      folder_name, base_filename, md_file_path, html_file_path, meta_file_path,
      markdown_content, content_hash, generation_date, request_id
    ) VALUES (
      'hello', 'en', 'trilingual', 'input', 'deepseek', 'deepseek-v4-pro',
      '20260727', 'hello', '/tmp/hello.md', '/tmp/hello.html', '/tmp/hello.json',
      '# hello\n\nfoo bar baz', ?, '2026-07-27', 'annotation-shadow'
    )
  `).run(HASH).lastInsertRowid);
}

test.after(() => databaseModule.close());

test('compares migrated annotations for all supported consumers without changing legacy output', async () => {
  const dbService = new DatabaseService(':memory:');
  try {
    const generationId = seedGeneration(dbService.db);
    const highlight = dbService.upsertCardHighlight({
      generationId,
      folderName: '20260727',
      baseFilename: 'hello',
      sourceHash: HASH,
      htmlContent: '<div><h1>hello</h1><p>foo <mark class="study-highlight-red">bar</mark> baz</p></div>',
    });
    const plan = await buildAnnotationMigrationPlan({ db: dbService.db });
    applyAnnotationMigrationPlan({
      dbService,
      plan,
      expectedPlanHash: plan.planHash,
    });
    const service = new AnnotationShadowReadService({ dbService, enabled: true });

    for (const consumer of ['cards-factory', 'textbook', 'review']) {
      await service.observe({
        consumer,
        legacyHighlight: highlight,
        targetKind: 'generation',
        targetId: generationId,
      });
    }

    const snapshot = service.snapshot();
    assert.equal(snapshot.observed, 3);
    assert.equal(snapshot.matched, 3);
    assert.equal(snapshot.mismatched, 0);
    assert.equal(snapshot.byConsumer['cards-factory'].matched, 1);
    assert.equal(snapshot.byConsumer.textbook.matched, 1);
    assert.equal(snapshot.byConsumer.review.matched, 1);
    assert.equal(snapshot.lastDiagnostic.legacyHighlightId, highlight.id);
    assert.equal('quote' in snapshot.lastDiagnostic, false);
  } finally {
    dbService.close();
  }
});

test('isolates comparison failures and is inert while disabled', async () => {
  const fakeDbService = {
    listCardAnnotationsByLegacyHighlightId() {
      throw new Error('synthetic read failure');
    },
    resolveCardAnnotationTarget() {
      return null;
    },
  };
  const service = new AnnotationShadowReadService({
    dbService: fakeDbService,
    enabled: true,
    projectionLoader: async () => {
      throw new Error('synthetic projection failure');
    },
  });
  const diagnostic = await service.observe({
    consumer: 'cards-factory',
    legacyHighlight: { id: 1, htmlContent: '<mark class="study-highlight-red">x</mark>' },
    targetKind: 'generation',
    targetId: 1,
  });
  assert.equal(diagnostic.outcome, 'errors');
  assert.equal(service.snapshot().errors, 1);

  const disabled = new AnnotationShadowReadService({
    dbService: fakeDbService,
    enabled: false,
  });
  assert.deepEqual(await disabled.observe({ consumer: 'cards-factory' }), {
    scheduled: false,
    reasonCode: 'shadow-read-disabled',
  });
  assert.equal(disabled.snapshot().observed, 0);
});
