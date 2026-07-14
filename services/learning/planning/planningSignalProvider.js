'use strict';

const { performance } = require('node:perf_hooks');

const CONTRACT_VERSION = 1;
const MAX_ABS_SCORE = 100;

function finiteScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) throw new TypeError('Planning signal score must be finite');
  return Math.max(-MAX_ABS_SCORE, Math.min(MAX_ABS_SCORE, score));
}

function publicReason(reason) {
  if (!reason || typeof reason !== 'object') return null;
  const code = String(reason.code || '').trim();
  const label = String(reason.label || '').trim();
  if (!code || !label) return null;
  return { code: code.slice(0, 80), label: label.slice(0, 160) };
}

class PlanningSignalProvider {
  constructor({ id, version, kind = 'heuristic', maxDurationMs = 10 } = {}) {
    if (!id || !version) throw new TypeError('PlanningSignalProvider requires id and version');
    this.id = String(id);
    this.version = String(version);
    this.kind = String(kind);
    this.maxDurationMs = Number(maxDurationMs);
    if (!Number.isFinite(this.maxDurationMs) || this.maxDurationMs <= 0) {
      throw new TypeError('PlanningSignalProvider maxDurationMs must be positive');
    }
  }

  describe() {
    return {
      id: this.id,
      version: this.version,
      kind: this.kind,
      maxDurationMs: this.maxDurationMs,
    };
  }

  evaluate() {
    throw new Error('PlanningSignalProvider.evaluate must be implemented');
  }
}

function normalizeSignal(provider, signal) {
  if (signal === null || signal === undefined) return null;
  if (typeof signal !== 'object') throw new TypeError('Planning signal must be an object or null');
  const groups = [...new Set((signal.groups || []).map((value) => String(value).trim().slice(0, 120)).filter(Boolean))]
    .sort().slice(0, 12);
  const reasons = (signal.reasons || []).map(publicReason).filter(Boolean).slice(0, 8);
  const evidence = (signal.evidence || []).slice(0, 12).map((item) => ({
    source: String(item.source || 'unknown'),
    ruleVersion: item.ruleVersion ? String(item.ruleVersion) : null,
    ruleKey: item.ruleKey ? String(item.ruleKey) : null,
  }));
  return {
    providerId: provider.id,
    providerVersion: provider.version,
    providerKind: provider.kind,
    score: finiteScore(signal.score ?? 0),
    groups,
    reasons,
    evidence,
  };
}

function emptyDiagnostics(providers) {
  return Object.fromEntries(providers.map((provider) => [provider.id, {
    id: provider.id,
    version: provider.version,
    kind: provider.kind,
    applied: 0,
    empty: 0,
    failed: 0,
    timedOut: 0,
  }]));
}

class CompositePlanningSignalProvider {
  constructor({ providers = [], clock = () => performance.now() } = {}) {
    this.providers = [...providers];
    if (new Set(this.providers.map((provider) => provider.id)).size !== this.providers.length) {
      throw new TypeError('Planning provider ids must be unique');
    }
    this.clock = clock;
  }

  describe() {
    return {
      contractVersion: CONTRACT_VERSION,
      providers: this.providers.map((provider) => provider.describe()),
    };
  }

  createDiagnostics() {
    return emptyDiagnostics(this.providers);
  }

  evaluate(studyItem, context = {}) {
    const signals = [];
    const diagnostics = this.createDiagnostics();
    for (const provider of this.providers) {
      const startedAt = this.clock();
      try {
        const raw = provider.evaluate(studyItem, context);
        if (raw && typeof raw.then === 'function') {
          Promise.resolve(raw).catch(() => {});
          throw new TypeError('Planning providers must be synchronous and side-effect free');
        }
        const elapsedMs = Math.max(0, this.clock() - startedAt);
        if (elapsedMs > provider.maxDurationMs) {
          diagnostics[provider.id].timedOut += 1;
          continue;
        }
        const signal = normalizeSignal(provider, raw);
        if (!signal) {
          diagnostics[provider.id].empty += 1;
          continue;
        }
        diagnostics[provider.id].applied += 1;
        signals.push(signal);
      } catch (_error) {
        diagnostics[provider.id].failed += 1;
      }
    }
    if (!signals.length) return { score: null, signals: [], diagnostics };
    const score = Math.max(-MAX_ABS_SCORE, Math.min(MAX_ABS_SCORE,
      signals.reduce((total, signal) => total + signal.score, 0)));
    return { score, signals, diagnostics };
  }
}

function mergePlanningDiagnostics(target, source) {
  for (const [providerId, values] of Object.entries(source || {})) {
    if (!target[providerId]) target[providerId] = { ...values, applied: 0, empty: 0, failed: 0, timedOut: 0 };
    for (const field of ['applied', 'empty', 'failed', 'timedOut']) {
      target[providerId][field] += Number(values[field] || 0);
    }
  }
  return target;
}

module.exports = {
  CONTRACT_VERSION,
  CompositePlanningSignalProvider,
  PlanningSignalProvider,
  mergePlanningDiagnostics,
  normalizeSignal,
};
