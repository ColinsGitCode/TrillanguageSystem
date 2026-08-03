'use strict';

const budgets = require('../../config/ui-performance-budgets.json');
const log = require('../../lib/logger').child({ module: 'ui-performance' });

const MAX_METRICS_PER_BATCH = 12;
const ALLOWED_ROUTES = new Set([
  '/',
  '/learn',
  '/learn/plan',
  '/learn/history',
  '/learn/session',
  '/textbooks',
  '/knowledge',
]);
const ALLOWED_CONTEXT = {
  'card-modal-open': new Set(['cold', 'warm']),
  'route-transition': new Set(['client']),
};

class UiPerformanceValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UiPerformanceValidationError';
    this.code = 'UI_PERFORMANCE_INVALID';
    this.status = 400;
  }
}

function metricRating(name, value) {
  const budget = budgets.metrics[name];
  if (!budget) return 'unknown';
  if (value <= budget.good) return 'good';
  if (value <= budget.needsAttention) return 'needs_attention';
  return 'poor';
}

function sanitizeRoute(value) {
  const route = String(value || '').trim();
  return ALLOWED_ROUTES.has(route) ? route : '/other';
}

function sanitizeMetric(input) {
  if (!input || typeof input !== 'object') {
    throw new UiPerformanceValidationError('Each metric must be an object');
  }
  const name = String(input.name || '').trim();
  if (!Object.hasOwn(budgets.metrics, name)) {
    throw new UiPerformanceValidationError(`Unsupported UI performance metric: ${name || 'missing'}`);
  }
  const value = Number(input.value);
  if (!Number.isFinite(value) || value < 0 || value > 60_000) {
    throw new UiPerformanceValidationError(`Invalid value for UI performance metric: ${name}`);
  }
  const allowedContext = ALLOWED_CONTEXT[name];
  const context = allowedContext?.has(String(input.context || ''))
    ? String(input.context)
    : null;
  return {
    name,
    value: Math.round(value * 1000) / 1000,
    unit: budgets.metrics[name].unit,
    rating: metricRating(name, value),
    route: sanitizeRoute(input.route),
    context,
  };
}

function sanitizeUiPerformancePayload(payload) {
  if (!payload || typeof payload !== 'object' || payload.version !== 1) {
    throw new UiPerformanceValidationError('Unsupported UI performance payload version');
  }
  if (!Array.isArray(payload.metrics) || payload.metrics.length < 1) {
    throw new UiPerformanceValidationError('UI performance payload must contain metrics');
  }
  if (payload.metrics.length > MAX_METRICS_PER_BATCH) {
    throw new UiPerformanceValidationError(
      `UI performance payload exceeds ${MAX_METRICS_PER_BATCH} metrics`
    );
  }
  return {
    version: 1,
    workspaceMode: payload.workspaceMode === 'sandbox' ? 'sandbox' : 'owner',
    metrics: payload.metrics.map(sanitizeMetric),
  };
}

function recordUiPerformance(payload, context = {}) {
  const sanitized = sanitizeUiPerformancePayload(payload);
  const deploymentExposure = ['local', 'private', 'public'].includes(context.deploymentExposure)
    ? context.deploymentExposure
    : 'unknown';
  log.info({
    workspaceMode: context.workspaceMode === 'sandbox'
      ? 'sandbox'
      : sanitized.workspaceMode,
    deploymentExposure,
    metrics: sanitized.metrics,
  }, 'ui performance sample');
  return sanitized;
}

module.exports = {
  ALLOWED_ROUTES,
  MAX_METRICS_PER_BATCH,
  UiPerformanceValidationError,
  metricRating,
  recordUiPerformance,
  sanitizeMetric,
  sanitizeRoute,
  sanitizeUiPerformancePayload,
};
