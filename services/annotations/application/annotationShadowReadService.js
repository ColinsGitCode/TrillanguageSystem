'use strict';

const {
  CONTEXT_LENGTH,
  extractInferredContinuousRuns,
} = require('./buildAnnotationMigrationPlan');
const { createLegacyAnnotationId } = require('../domain/annotationIdentity');

const CONSUMERS = new Set(['cards-factory', 'textbook', 'review']);

function emptyCounters() {
  return {
    observed: 0,
    matched: 0,
    mismatched: 0,
    noLegacy: 0,
    errors: 0,
  };
}

function normalizeLegacyHighlight(highlight) {
  if (!highlight) return null;
  const id = Number(highlight.id);
  const htmlContent = String(highlight.htmlContent ?? highlight.html_content ?? '');
  return Number.isSafeInteger(id) && id > 0 && htmlContent
    ? { id, htmlContent }
    : null;
}

class AnnotationShadowReadService {
  constructor({
    dbService,
    enabled = false,
    logger,
    projectionLoader = () => import('../../../app/features/card-modal/text-projection.mjs'),
  } = {}) {
    if (!dbService) throw new TypeError('AnnotationShadowReadService requires dbService');
    this.dbService = dbService;
    this.enabled = Boolean(enabled);
    this.logger = logger;
    this.projectionLoader = projectionLoader;
    this.pending = new Set();
    this.counters = emptyCounters();
    this.byConsumer = {};
    this.lastDiagnostic = null;
  }

  _consumerCounters(consumer) {
    if (!this.byConsumer[consumer]) this.byConsumer[consumer] = emptyCounters();
    return this.byConsumer[consumer];
  }

  _record(consumer, outcome, diagnostic) {
    this.counters.observed += 1;
    this.counters[outcome] += 1;
    const consumerCounters = this._consumerCounters(consumer);
    consumerCounters.observed += 1;
    consumerCounters[outcome] += 1;
    this.lastDiagnostic = diagnostic;
  }

  async _compare({ consumer, legacyHighlight, targetKind, targetId }) {
    const legacy = normalizeLegacyHighlight(legacyHighlight);
    if (!legacy) {
      const diagnostic = {
        consumer,
        outcome: 'noLegacy',
        targetKind,
        targetId: Number(targetId),
        reasonCode: 'legacy-highlight-absent',
      };
      this._record(consumer, 'noLegacy', diagnostic);
      this.logger?.debug?.(diagnostic, 'annotation shadow read skipped without legacy highlight');
      return diagnostic;
    }

    const projection = await this.projectionLoader();
    const runs = extractInferredContinuousRuns(legacy.htmlContent, projection);
    const expected = new Map(runs.map((run, index) => {
      const id = createLegacyAnnotationId({
        highlightId: legacy.id,
        runOrdinal: index + 1,
        quote: run.quote,
        prefix: run.prefix,
        suffix: run.suffix,
      });
      return [id, run];
    }));
    const annotations = this.dbService.listCardAnnotationsByLegacyHighlightId(legacy.id);
    const actual = new Map(annotations.map((annotation) => [annotation.id, annotation]));
    const target = this.dbService.resolveCardAnnotationTarget(targetKind, targetId);

    let missing = 0;
    let unexpected = 0;
    let quoteMismatch = 0;
    let targetMismatch = 0;
    for (const [id, run] of expected) {
      const annotation = actual.get(id);
      if (!annotation) {
        missing += 1;
        continue;
      }
      if (annotation.selector.textQuote.exact !== run.quote) quoteMismatch += 1;
      if (
        annotation.targetKind !== targetKind
        || annotation.targetId !== Number(targetId)
        || !target
        || annotation.targetRevision !== target.targetRevision
      ) {
        targetMismatch += 1;
      }
    }
    for (const id of actual.keys()) {
      if (!expected.has(id)) unexpected += 1;
    }

    const matched = missing === 0
      && unexpected === 0
      && quoteMismatch === 0
      && targetMismatch === 0;
    const diagnostic = {
      consumer,
      outcome: matched ? 'matched' : 'mismatched',
      targetKind,
      targetId: Number(targetId),
      legacyHighlightId: legacy.id,
      expectedCount: expected.size,
      actualCount: actual.size,
      missing,
      unexpected,
      quoteMismatch,
      targetMismatch,
      projectionVersion: 'card-visible-text-v1',
      contextLength: CONTEXT_LENGTH,
    };
    this._record(consumer, diagnostic.outcome, diagnostic);
    const level = matched ? 'debug' : 'warn';
    this.logger?.[level]?.(diagnostic, 'annotation shadow read comparison');
    return diagnostic;
  }

  observe(input = {}) {
    if (!this.enabled) return Promise.resolve({ scheduled: false, reasonCode: 'shadow-read-disabled' });
    const consumer = String(input.consumer || '');
    if (!CONSUMERS.has(consumer)) {
      return Promise.resolve({ scheduled: false, reasonCode: 'consumer-unsupported' });
    }
    let task;
    task = this._compare({ ...input, consumer }).catch((error) => {
      const diagnostic = {
        consumer,
        outcome: 'errors',
        targetKind: input.targetKind,
        targetId: Number(input.targetId),
        reasonCode: error.code || 'annotation-shadow-read-failed',
      };
      this._record(consumer, 'errors', diagnostic);
      this.logger?.warn?.({ ...diagnostic, err: error }, 'annotation shadow read failed');
      return diagnostic;
    }).finally(() => {
      this.pending.delete(task);
    });
    this.pending.add(task);
    return task;
  }

  async flush() {
    while (this.pending.size) await Promise.all([...this.pending]);
    return this.snapshot();
  }

  snapshot() {
    return {
      enabled: this.enabled,
      pending: this.pending.size,
      ...this.counters,
      byConsumer: JSON.parse(JSON.stringify(this.byConsumer)),
      lastDiagnostic: this.lastDiagnostic ? { ...this.lastDiagnostic } : null,
    };
  }

  resetForTests() {
    this.counters = emptyCounters();
    this.byConsumer = {};
    this.lastDiagnostic = null;
  }
}

module.exports = {
  AnnotationShadowReadService,
  CONSUMERS,
  normalizeLegacyHighlight,
};
