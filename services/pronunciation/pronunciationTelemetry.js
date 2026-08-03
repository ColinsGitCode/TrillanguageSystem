'use strict';

const EVENT_TYPES = new Set(['token', 'action', 'state', 'lifecycle', 'request']);
const UI_SURFACES = new Set(['card-modal', 'textbook', 'review']);
const TOKEN_SOURCES = new Set(['textbook', 'manual', 'dictionary', 'analyzer', 'rule', 'llm-proposal', 'legacy-ruby']);
const TOKEN_STATUSES = new Set(['accepted', 'unresolved', 'rejected', 'superseded', 'partial', 'stale', 'error']);
const ACTIONS = new Set(['tts', 'copy', 'knowledge', 'generate-card', 'correction', 'selection']);
const OUTCOMES = new Set(['started', 'success', 'error', 'aborted', 'ready', 'partial', 'stale', 'unresolved', 'legacy-hit', 'open', 'close', 'start', 'end']);
const RESOURCES = new Set(['controller', 'listener', 'request']);
const REQUEST_KINDS = new Set(['pronunciation', 'correction', 'tts', 'knowledge', 'generation']);
const MAX_COUNTERS = 256;

const state = {
  startedAtUtc: new Date().toISOString(),
  totalEvents: 0,
  rejectedEvents: 0,
  counters: new Map(),
  gauges: {
    activeControllers: 0,
    activeListeners: 0,
    activeRequests: 0,
    maxActiveControllers: 0,
    maxActiveListeners: 0,
    maxActiveRequests: 0,
  },
};

function boundedInt(value, fallback = null, max = 120000) {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.min(Math.round(number), max);
}

function optionalString(value, allowed, maxLength = 64) {
  if (value == null || value === '') return null;
  const normalized = String(value).trim();
  if (!normalized || normalized.length > maxLength || !allowed.has(normalized)) return null;
  return normalized;
}

function errorCode(value) {
  if (value == null || value === '') return null;
  const normalized = String(value).trim();
  return /^[A-Z0-9_.:-]{1,80}$/u.test(normalized) ? normalized : 'UNSAFE_ERROR_CODE';
}

function invalid(message, code = 'PRONUNCIATION_TELEMETRY_INVALID') {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  return error;
}

function validateEvent(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw invalid('Telemetry event must be an object');
  }
  const forbiddenKeys = ['text', 'phrase', 'surface', 'reading', 'exact', 'prefix', 'suffix', 'markdown', 'content', 'html'];
  const forbidden = forbiddenKeys.find((key) => Object.prototype.hasOwnProperty.call(payload, key));
  if (forbidden) throw invalid(`Telemetry field is not allowed: ${forbidden}`, 'PRONUNCIATION_TELEMETRY_CONTENT_REJECTED');
  const eventType = String(payload.eventType || '').trim();
  if (!EVENT_TYPES.has(eventType)) throw invalid('Telemetry eventType is invalid');
  return {
    eventType,
    uiSurface: optionalString(payload.uiSurface, UI_SURFACES),
    tokenSource: optionalString(payload.tokenSource, TOKEN_SOURCES),
    tokenStatus: optionalString(payload.tokenStatus, TOKEN_STATUSES),
    action: optionalString(payload.action, ACTIONS),
    outcome: optionalString(payload.outcome, OUTCOMES),
    resource: optionalString(payload.resource, RESOURCES),
    requestKind: optionalString(payload.requestKind, REQUEST_KINDS),
    errorCode: errorCode(payload.errorCode),
    durationMs: boundedInt(payload.durationMs),
    length: boundedInt(payload.length, null, 300),
    queueWaitMs: boundedInt(payload.queueWaitMs, null),
    statusCode: boundedInt(payload.statusCode, null, 599),
  };
}

function counterKey(event) {
  return [
    event.eventType, event.uiSurface || '-', event.tokenSource || '-', event.tokenStatus || '-',
    event.action || '-', event.outcome || '-', event.resource || '-', event.requestKind || '-',
    event.errorCode || '-',
  ].join('|');
}

function updateGauge(event) {
  if (event.eventType !== 'lifecycle' || !event.resource) return;
  const key = event.resource === 'controller'
    ? 'activeControllers'
    : event.resource === 'listener' ? 'activeListeners' : 'activeRequests';
  const delta = ['start', 'open'].includes(event.outcome) ? 1 : ['end', 'close', 'aborted'].includes(event.outcome) ? -1 : 0;
  state.gauges[key] = Math.max(0, state.gauges[key] + delta);
  const maxKey = `max${key[0].toUpperCase()}${key.slice(1)}`;
  state.gauges[maxKey] = Math.max(state.gauges[maxKey], state.gauges[key]);
}

function record(payload) {
  const event = validateEvent(payload);
  updateGauge(event);
  const key = counterKey(event);
  const existing = state.counters.get(key);
  if (!existing && state.counters.size >= MAX_COUNTERS) {
    state.rejectedEvents += 1;
    return { accepted: false, reason: 'counter-limit' };
  }
  const counter = existing || {
    key, count: 0, durationTotalMs: 0, durationMaxMs: 0, lengthTotal: 0,
    lengthMax: 0, queueWaitTotalMs: 0, statusCodes: {},
  };
  counter.count += 1;
  if (event.durationMs != null) {
    counter.durationTotalMs += event.durationMs;
    counter.durationMaxMs = Math.max(counter.durationMaxMs, event.durationMs);
  }
  if (event.length != null) {
    counter.lengthTotal += event.length;
    counter.lengthMax = Math.max(counter.lengthMax, event.length);
  }
  if (event.queueWaitMs != null) counter.queueWaitTotalMs += event.queueWaitMs;
  if (event.statusCode != null) {
    const code = String(event.statusCode);
    counter.statusCodes[code] = (counter.statusCodes[code] || 0) + 1;
  }
  state.counters.set(key, counter);
  state.totalEvents += 1;
  return { accepted: true };
}

function snapshot() {
  return {
    version: 'pronunciation-telemetry-v1',
    readOnlyContent: true,
    startedAtUtc: state.startedAtUtc,
    totalEvents: state.totalEvents,
    rejectedEvents: state.rejectedEvents,
    gauges: { ...state.gauges },
    counters: [...state.counters.values()].sort((left, right) => left.key.localeCompare(right.key)),
  };
}

function reset() {
  state.startedAtUtc = new Date().toISOString();
  state.totalEvents = 0;
  state.rejectedEvents = 0;
  state.counters.clear();
  Object.keys(state.gauges).forEach((key) => { state.gauges[key] = 0; });
}

module.exports = { record, reset, snapshot, validateEvent };
