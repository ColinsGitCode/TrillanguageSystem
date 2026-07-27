'use strict';

const { annotationError } = require('../annotationErrors');

function selectorFields(selector) {
  return {
    projectionVersion: selector.projectionVersion,
    quoteExact: selector.textQuote.exact,
    quotePrefix: selector.textQuote.prefix || '',
    quoteSuffix: selector.textQuote.suffix || '',
    positionStart: Number(selector.textPosition.start),
    positionEnd: Number(selector.textPosition.end),
  };
}

function matchesExisting(existing, item) {
  return existing
    && existing.targetKind === item.targetKind
    && existing.targetId === item.targetId
    && existing.targetRevision === item.targetRevision
    && existing.selector.projectionVersion === item.selector.projectionVersion
    && existing.selector.textQuote.exact === item.selector.textQuote.exact
    && existing.selector.textQuote.prefix === (item.selector.textQuote.prefix || '')
    && existing.selector.textQuote.suffix === (item.selector.textQuote.suffix || '')
    && existing.selector.textPosition.start === item.selector.textPosition.start
    && existing.selector.textPosition.end === item.selector.textPosition.end
    && existing.annotationKind === item.annotationKind
    && existing.color === item.color
    && existing.status === item.status
    && existing.legacyHighlightId === item.legacyHighlightId;
}

function applyAnnotationMigrationPlan({
  dbService,
  plan,
  expectedPlanHash,
  now = () => new Date().toISOString(),
} = {}) {
  if (!dbService || !plan) throw new TypeError('applyAnnotationMigrationPlan requires dbService and plan');
  const expected = String(expectedPlanHash || '').trim();
  if (!/^[a-f0-9]{64}$/u.test(expected) || expected !== plan.planHash) {
    throw annotationError('ANNOTATION_MIGRATION_PLAN_HASH_CONFLICT', 409, {
      actualPlanHash: plan.planHash,
    });
  }
  if (plan.mode !== 'read-only-dry-run' || !Array.isArray(plan.items)) {
    throw annotationError('ANNOTATION_MIGRATION_PLAN_INVALID', 400);
  }

  const previousEvents = dbService.listCardAnnotationMigrationEvents(plan.planHash);
  if (previousEvents.length) {
    if (previousEvents.length !== plan.items.length) {
      throw annotationError('ANNOTATION_MIGRATION_PARTIAL_APPLY', 409, {
        eventCount: previousEvents.length,
        itemCount: plan.items.length,
      });
    }
    return {
      planHash: plan.planHash,
      idempotent: true,
      ...plan.summary,
      events: previousEvents.length,
    };
  }

  const timestamp = now();
  const execute = dbService.db.transaction(() => {
    for (const item of plan.items) {
      if (item.outcome === 'migrated' || item.outcome === 'orphaned') {
        const existing = dbService.getCardAnnotation(item.annotationId);
        if (existing && !matchesExisting(existing, item)) {
          throw annotationError('ANNOTATION_MIGRATION_ID_CONFLICT', 409, {
            annotationId: item.annotationId,
          });
        }
        if (!existing) {
          dbService.createCardAnnotation({
            id: item.annotationId,
            targetKind: item.targetKind,
            targetId: item.targetId,
            targetRevision: item.targetRevision,
            ...selectorFields(item.selector),
            annotationKind: item.annotationKind,
            color: item.color,
            noteText: null,
            status: item.status,
            sourceContentHash: item.sourceContentHash,
            legacyHighlightId: item.legacyHighlightId,
            legacyPayloadJson: JSON.stringify({
              ...item.legacyPayload,
              legacyRunOrdinal: item.legacyRunOrdinal,
              sourceFingerprint: item.sourceFingerprint,
            }),
            createdAtUtc: timestamp,
            updatedAtUtc: timestamp,
          });
        }
      }
      dbService.appendCardAnnotationMigrationEvent({
        migrationPlanHash: plan.planHash,
        legacyHighlightId: item.legacyHighlightId,
        legacyRunOrdinal: item.legacyRunOrdinal,
        annotationId: item.annotationId,
        outcome: item.outcome,
        reasonCode: item.reasonCode,
        sourceFingerprint: item.sourceFingerprint,
        createdAtUtc: timestamp,
      });
    }
  });

  dbService.withBusyRetry(() => execute());
  return {
    planHash: plan.planHash,
    idempotent: false,
    ...plan.summary,
    events: plan.items.length,
  };
}

module.exports = {
  applyAnnotationMigrationPlan,
  matchesExisting,
  selectorFields,
};
