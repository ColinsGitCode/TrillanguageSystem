'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  metricRating,
  sanitizeRoute,
  sanitizeUiPerformancePayload,
  UiPerformanceValidationError,
} = require('../../services/observability/uiPerformanceService');

test.describe('UI performance telemetry contract', () => {
  test.it('accepts only bounded, content-free metric fields', () => {
    const result = sanitizeUiPerformancePayload({
      version: 1,
      workspaceMode: 'sandbox',
      metrics: [
        {
          name: 'card-modal-open',
          value: 432.12345,
          route: '/learn/session',
          context: 'cold',
          selectedText: 'must not survive',
        },
      ],
    });
    assert.deepEqual(result, {
      version: 1,
      workspaceMode: 'sandbox',
      metrics: [{
        name: 'card-modal-open',
        value: 432.123,
        unit: 'ms',
        rating: 'good',
        route: '/learn/session',
        context: 'cold',
      }],
    });
  });

  test.it('buckets unknown paths instead of recording user-controlled URLs', () => {
    assert.equal(sanitizeRoute('/textbooks?query=private'), '/other');
    assert.equal(sanitizeRoute('/textbooks'), '/textbooks');
  });

  test.it('applies the public UI budget ratings', () => {
    assert.equal(metricRating('lcp', 2_300), 'good');
    assert.equal(metricRating('lcp', 3_000), 'needs_attention');
    assert.equal(metricRating('lcp', 5_000), 'poor');
    assert.equal(metricRating('cls', 0.08), 'good');
  });

  test.it('rejects unsupported metrics and oversized batches', () => {
    assert.throws(
      () => sanitizeUiPerformancePayload({
        version: 1,
        metrics: [{ name: 'raw-card-content', value: 1 }],
      }),
      UiPerformanceValidationError
    );
    assert.throws(
      () => sanitizeUiPerformancePayload({
        version: 1,
        metrics: Array.from({ length: 13 }, () => ({ name: 'fcp', value: 100 })),
      }),
      UiPerformanceValidationError
    );
  });
});
