'use strict';

process.env.DB_PATH = ':memory:';
process.env.LOG_SILENT = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { AnnotationService } = require('../../services/annotations/annotationService');
const { LearningService } = require('../../services/learning/application/learningService');
const databaseModule = require('../../services/storage/databaseService');
const { DatabaseService } = databaseModule;
const { seedStudyItem } = require('../helpers/learningFixtures');

test.after(() => databaseModule.close());

test('keeps the legacy highlight read when canonical annotations are disabled', async () => {
  const dbService = new DatabaseService(':memory:');
  try {
    const seeded = seedStudyItem(dbService.db, {
      phrase: 'legacy review annotation',
      folder: '20260727',
      base: 'legacy-review-annotation',
    });
    const legacy = dbService.upsertCardHighlight({
      generationId: seeded.generationId,
      folderName: '20260727',
      baseFilename: 'legacy-review-annotation',
      sourceHash: seeded.contentHash,
      htmlContent: '<div><mark class="study-highlight-red">legacy</mark></div>',
      version: 1,
    });
    const service = new LearningService({ db: dbService.db });
    const item = await service.getItem(seeded.studyItemId);

    assert.equal(item.highlightReference.id, legacy.id);
    assert.equal(item.annotationReference, null);
  } finally {
    dbService.close();
  }
});

test('uses canonical annotation metadata and ignores legacy highlight rows when enabled', async () => {
  const dbService = new DatabaseService(':memory:');
  try {
    const seeded = seedStudyItem(dbService.db, {
      phrase: 'canonical review annotation',
      folder: '20260727',
      base: 'canonical-review-annotation',
    });
    dbService.upsertCardHighlight({
      generationId: seeded.generationId,
      folderName: '20260727',
      baseFilename: 'canonical-review-annotation',
      sourceHash: seeded.contentHash,
      htmlContent: '<div><mark class="study-highlight-red">legacy</mark></div>',
      version: 1,
    });
    const annotationService = new AnnotationService({ dbService });
    const target = annotationService.resolveTarget('generation', seeded.generationId);
    annotationService.create({
      id: crypto.randomUUID(),
      targetKind: 'generation',
      targetId: seeded.generationId,
      expectedTargetRevision: target.targetRevision,
      selector: {
        projectionVersion: 'card-visible-text-v1',
        textQuote: { exact: 'canonical', prefix: '', suffix: ' review annotation' },
        textPosition: { start: 0, end: 9 },
      },
      annotationKind: 'highlight',
      color: 'red',
    });
    const service = new LearningService({
      db: dbService.db,
      annotationsEnabled: true,
      annotationService,
    });
    const item = await service.getItem(seeded.studyItemId);

    assert.equal(item.highlightReference, null);
    assert.equal(item.annotationReference.targetKind, 'generation');
    assert.equal(item.annotationReference.targetId, seeded.generationId);
    assert.equal(item.annotationReference.count, 1);
    assert.equal(item.annotationReference.source, 'card_annotations');
  } finally {
    dbService.close();
  }
});
