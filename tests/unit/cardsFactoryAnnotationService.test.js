'use strict';

process.env.DB_PATH = ':memory:';
process.env.LOG_SILENT = '1';

const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const databaseModule = require('../../services/storage/databaseService');
const { DatabaseService } = databaseModule;
const {
  CardsFactoryAnnotationService,
} = require('../../services/annotations/application/cardsFactoryAnnotationService');
const {
  loadSharedModules,
  renderCardMarkdown,
} = require('../../services/annotations/application/buildAnnotationMigrationPlan');

const HASH = '9'.repeat(64);
const ID = '018f0f96-5a90-7d75-a2c6-86559b5de931';
const MARKDOWN = '# hello\n\nfoo bar baz';

function seedGeneration(dbService) {
  return Number(dbService.db.prepare(`
    INSERT INTO generations(
      phrase, phrase_language, card_type, source_mode, llm_provider, llm_model,
      folder_name, base_filename, md_file_path, html_file_path, meta_file_path,
      markdown_content, content_hash, generation_date, request_id
    ) VALUES (
      'hello', 'en', 'trilingual', 'input', 'deepseek', 'deepseek-v4-pro',
      '20260727', 'hello', '/tmp/hello.md', '/tmp/hello.html', '/tmp/hello.json',
      ?, ?, '2026-07-27', ?
    )
  `).run(MARKDOWN, HASH, `cards-factory-annotation-${Math.random()}`).lastInsertRowid);
}

async function selectorFor(exact) {
  const shared = await loadSharedModules();
  const rendered = renderCardMarkdown(MARKDOWN, 'trilingual', '20260727', shared.transforms);
  const dom = new JSDOM(`<div id="__root">${rendered}</div>`);
  try {
    const root = dom.window.document.getElementById('__root');
    const map = shared.anchor.buildCanonicalDomMap(root);
    const start = map.text.indexOf(exact);
    return {
      projectionVersion: shared.anchor.PROJECTION_VERSION,
      textQuote: {
        type: 'TextQuoteSelector',
        exact,
        prefix: map.text.slice(Math.max(0, start - 32), start),
        suffix: map.text.slice(start + exact.length, start + exact.length + 32),
      },
      textPosition: {
        type: 'TextPositionSelector',
        start,
        end: start + exact.length,
      },
    };
  } finally {
    dom.window.close();
  }
}

async function createPayload(generationId, overrides = {}) {
  return {
    id: ID,
    targetKind: 'generation',
    targetId: generationId,
    expectedTargetRevision: HASH,
    selector: await selectorFor('bar'),
    annotationKind: 'highlight',
    color: 'red',
    ...overrides,
  };
}

test.after(() => databaseModule.close());

test('creates a canonical annotation without writing legacy HTML', async () => {
  const dbService = new DatabaseService(':memory:');
  try {
    const generationId = seedGeneration(dbService);
    const service = new CardsFactoryAnnotationService({ dbService });
    const result = await service.create(await createPayload(generationId));

    assert.equal(result.annotation.selector.textQuote.exact, 'bar');
    assert.equal(dbService.listCardAnnotations('generation', generationId).length, 1);
    assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM card_highlights').get().count, 0);
  } finally {
    dbService.close();
  }
});

test('rejects a selector that cannot be resolved against current Markdown', async () => {
  const dbService = new DatabaseService(':memory:');
  try {
    const generationId = seedGeneration(dbService);
    const service = new CardsFactoryAnnotationService({ dbService });
    const invalid = await createPayload(generationId);
    invalid.selector.textQuote.exact = 'missing';
    invalid.selector.textPosition.end = invalid.selector.textPosition.start + 7;

    await assert.rejects(
      () => service.create(invalid),
      (error) => error.code === 'ANNOTATION_SELECTOR_ORPHANED' && error.status === 409
    );
    assert.equal(dbService.listCardAnnotations('generation', generationId).length, 0);
    assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM card_highlights').get().count, 0);
  } finally {
    dbService.close();
  }
});

test('soft-delete updates only the canonical annotation', async () => {
  const dbService = new DatabaseService(':memory:');
  try {
    const generationId = seedGeneration(dbService);
    const service = new CardsFactoryAnnotationService({ dbService });
    const created = await service.create(await createPayload(generationId));
    const removed = await service.remove(created.annotation.id, { expectedVersion: 1 });

    assert.equal(removed.annotation.status, 'deleted');
    assert.equal(dbService.listCardAnnotations('generation', generationId).length, 0);
    assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM card_highlights').get().count, 0);
  } finally {
    dbService.close();
  }
});
