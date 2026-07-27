'use strict';

process.env.DB_PATH = ':memory:';
process.env.LOG_SILENT = '1';

const assert = require('node:assert/strict');
const test = require('node:test');
const databaseModule = require('../../services/storage/databaseService');
const { DatabaseService } = databaseModule;
const { AnnotationService } = require('../../services/annotations/annotationService');

const HASH = 'a'.repeat(64);
const NOW = '2026-07-27T01:02:03.000Z';

function seedGeneration(db, {
  hash = HASH,
  markdown = '# hello\n\nfoo bar baz',
  requestId = `annotation-${Math.random()}`,
} = {}) {
  return Number(db.prepare(`
    INSERT INTO generations(
      phrase, phrase_language, card_type, source_mode, llm_provider, llm_model,
      folder_name, base_filename, md_file_path, html_file_path, meta_file_path,
      markdown_content, content_hash, generation_date, request_id
    ) VALUES (
      'hello', 'en', 'trilingual', 'input', 'deepseek', 'deepseek-v4-pro',
      '20260727', 'hello', '/tmp/hello.md', '/tmp/hello.html', '/tmp/hello.json',
      ?, ?, '2026-07-27', ?
    )
  `).run(markdown, hash, requestId).lastInsertRowid);
}

function selector(exact = 'bar', start = 10) {
  return {
    projectionVersion: 'card-visible-text-v1',
    textQuote: {
      type: 'TextQuoteSelector',
      exact,
      prefix: 'foo ',
      suffix: ' baz',
    },
    textPosition: {
      type: 'TextPositionSelector',
      start,
      end: start + exact.length,
    },
  };
}

function payload(generationId, overrides = {}) {
  return {
    id: '018f0f96-5a90-7d75-a2c6-86559b5de924',
    targetKind: 'generation',
    targetId: generationId,
    expectedTargetRevision: HASH,
    selector: selector(),
    annotationKind: 'highlight',
    color: 'red',
    ...overrides,
  };
}

test.after(() => databaseModule.close());

test.describe('AnnotationService', () => {
  test.it('creates, lists, updates, and soft-deletes an annotation', () => {
    const dbService = new DatabaseService(':memory:');
    try {
      const generationId = seedGeneration(dbService.db);
      const service = new AnnotationService({ dbService, now: () => NOW });
      const created = service.create(payload(generationId));

      assert.equal(created.targetRevision, HASH);
      assert.equal(created.selector.textQuote.exact, 'bar');
      assert.equal(created.version, 1);
      assert.equal(created.legacyPayload, undefined);
      assert.deepEqual(
        service.list('generation', generationId).annotations.map((item) => item.id),
        [created.id]
      );

      const updated = service.update(created.id, {
        expectedVersion: 1,
        color: 'yellow',
      });
      assert.equal(updated.color, 'yellow');
      assert.equal(updated.version, 2);

      assert.deepEqual(service.remove(created.id, { expectedVersion: 2 }), {
        id: created.id,
        status: 'deleted',
        version: 3,
      });
      assert.deepEqual(service.list('generation', generationId).annotations, []);
      assert.throws(
        () => service.get(created.id),
        (error) => error.code === 'ANNOTATION_NOT_FOUND' && error.status === 404
      );
    } finally {
      dbService.close();
    }
  });

  test.it('rejects stale target revisions and invalid UTF-16 selector positions', () => {
    const dbService = new DatabaseService(':memory:');
    try {
      const generationId = seedGeneration(dbService.db);
      const service = new AnnotationService({ dbService, now: () => NOW });

      assert.throws(
        () => service.create(payload(generationId, {
          expectedTargetRevision: 'b'.repeat(64),
        })),
        (error) => error.code === 'ANNOTATION_TARGET_REVISION_CONFLICT'
          && error.status === 409
      );
      assert.throws(
        () => service.create(payload(generationId, {
          selector: {
            ...selector('A😀B', 4),
            textPosition: {
              type: 'TextPositionSelector',
              start: 4,
              end: 7,
            },
          },
        })),
        (error) => error.code === 'ANNOTATION_SELECTOR_INVALID'
          && error.details?.reason === 'position-must-use-utf16-and-match-exact'
      );
    } finally {
      dbService.close();
    }
  });

  test.it('returns conflicts for duplicate active anchors and stale versions', () => {
    const dbService = new DatabaseService(':memory:');
    try {
      const generationId = seedGeneration(dbService.db);
      const service = new AnnotationService({ dbService, now: () => NOW });
      const created = service.create(payload(generationId));

      assert.throws(
        () => service.create(payload(generationId, {
          id: '018f0f96-5a90-7d75-a2c6-86559b5de925',
        })),
        (error) => error.code === 'ANNOTATION_CONFLICT' && error.status === 409
      );
      assert.throws(
        () => service.update(created.id, { expectedVersion: 99, color: 'green' }),
        (error) => error.code === 'ANNOTATION_VERSION_CONFLICT' && error.status === 409
      );
    } finally {
      dbService.close();
    }
  });

  test.it('keeps migration events append-only', () => {
    const dbService = new DatabaseService(':memory:');
    try {
      const planHash = 'c'.repeat(64);
      const event = dbService.appendCardAnnotationMigrationEvent({
        migrationPlanHash: planHash,
        legacyHighlightId: 1,
        legacyRunOrdinal: 1,
        annotationId: null,
        outcome: 'skipped',
        reasonCode: 'target-unresolved',
        sourceFingerprint: 'd'.repeat(64),
        createdAtUtc: NOW,
      });
      assert.equal(event.outcome, 'skipped');
      assert.equal(dbService.listCardAnnotationMigrationEvents(planHash).length, 1);
      assert.throws(
        () => dbService.db.prepare(
          'UPDATE card_annotation_migration_events SET outcome = ? WHERE id = ?'
        ).run('failed', event.id),
        /immutable/u
      );
      assert.throws(
        () => dbService.db.prepare(
          'DELETE FROM card_annotation_migration_events WHERE id = ?'
        ).run(event.id),
        /immutable/u
      );
    } finally {
      dbService.close();
    }
  });

  test.it('reports statistics from active canonical annotations only', () => {
    const dbService = new DatabaseService(':memory:');
    try {
      const firstGenerationId = seedGeneration(dbService.db, {
        requestId: 'annotation-stats-first',
      });
      const secondGenerationId = seedGeneration(dbService.db, {
        hash: 'b'.repeat(64),
        requestId: 'annotation-stats-second',
      });
      const service = new AnnotationService({ dbService, now: () => NOW });
      const first = service.create(payload(firstGenerationId, {
        id: '018f0f96-5a90-7d75-a2c6-86559b5de930',
      }));
      service.create(payload(secondGenerationId, {
        id: '018f0f96-5a90-7d75-a2c6-86559b5de931',
        expectedTargetRevision: 'b'.repeat(64),
      }));

      let stats = dbService.getAnnotationStats({
        provider: 'deepseek',
        cardType: 'trilingual',
      });
      assert.deepEqual(stats.overview, {
        totalAnnotations: 2,
        annotatedTargets: 2,
        highlights: 2,
        notes: 0,
        highlightedChars: 6,
        lastUpdatedAt: NOW,
      });
      assert.deepEqual(stats.byCardType, [{
        cardType: 'trilingual',
        targets: 2,
        annotations: 2,
      }]);

      service.remove(first.id, { expectedVersion: first.version });
      stats = dbService.getAnnotationStats();
      assert.equal(stats.overview.totalAnnotations, 1);
      assert.equal(stats.overview.annotatedTargets, 1);
      assert.equal(stats.overview.highlights, 1);
    } finally {
      dbService.close();
    }
  });
});
