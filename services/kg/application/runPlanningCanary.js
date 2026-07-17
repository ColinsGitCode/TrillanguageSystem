'use strict';

const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { GraphPlanningSignalReader, READ_SIGNAL_SQL } = require('../storage/graphPlanningSignalReader');
const { LearningService, buildQueueCandidates } = require('../../learning/application/learningService');
const { DEFAULT_SCOPE } = require('../../learning/domain/planScope');
const { DEFAULT_TIME_ZONE, dayBounds, learningDay } = require('../../learning/time/learningTime');
const { createDefaultPlanningSignalProvider } = require('../../learning/planning/defaultPlanningSignalProvider');

const REPORT_VERSION = 'kg-r1-planning-canary-v1';
const DEFAULT_DAILY_ACTION_GOAL = 20;
const DEFAULT_DAILY_NEW_LIMIT = 20;
const DEFAULT_ITERATIONS = 500;
const READER_P95_TARGET_MS = 5;
const READER_HARD_BUDGET_MS = 10;

const OBSERVED_TABLES = Object.freeze([
  'kg_points',
  'kg_evidence',
  'kg_lookup_events',
  'kg_resolution_cases',
  'kg_resolution_events',
  'kg_point_transitions',
  'kg_point_stats',
  'kg_planning_signals',
  'study_items',
  'learning_profiles',
  'learning_plans',
  'learning_source_admissions',
  'learning_schedule_states',
  'learning_daily_queues',
  'learning_queue_entries',
  'learning_sessions',
  'learning_review_events',
  'learning_manual_queue_intents',
]);

function positiveInteger(value, label, fallback) {
  const resolved = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return resolved;
}

function utcInstant(value) {
  const parsed = new Date(value || Date.now());
  if (Number.isNaN(parsed.getTime())) throw new TypeError('nowUtc must be a valid instant');
  return parsed.toISOString();
}

function countTables(db) {
  return Object.fromEntries(OBSERVED_TABLES.map((table) => [
    table,
    Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count),
  ]));
}

function groupedCounts(db, sql) {
  return Object.fromEntries(db.prepare(sql).all().map((row) => [
    String(row.key),
    Number(row.count),
  ]));
}

function observationSnapshot(db) {
  const tables = countTables(db);
  const signals = db.prepare(`
    SELECT COUNT(*) AS count, MIN(score) AS min_score, MAX(score) AS max_score,
      AVG(score) AS average_score, MAX(computed_at_utc) AS latest_computed_at_utc
    FROM kg_planning_signals
  `).get();
  const latestLookup = db.prepare(`
    SELECT id, interaction_kind, language, normalized_input, point_id,
      resolution_case_id, occurred_at_utc, learning_day, time_zone
    FROM kg_lookup_events ORDER BY id DESC LIMIT 1
  `).get() || null;
  return {
    tables,
    lookups: {
      byResolution: groupedCounts(db, `
        SELECT CASE WHEN point_id IS NOT NULL THEN 'resolved' ELSE 'unresolved' END AS key,
          COUNT(*) AS count
        FROM kg_lookup_events GROUP BY key ORDER BY key
      `),
      byLanguage: groupedCounts(db, `
        SELECT language AS key, COUNT(*) AS count
        FROM kg_lookup_events GROUP BY language ORDER BY language
      `),
      latest: latestLookup ? {
        id: Number(latestLookup.id),
        interactionKind: latestLookup.interaction_kind,
        language: latestLookup.language,
        normalizedInput: latestLookup.normalized_input,
        pointId: latestLookup.point_id === null ? null : Number(latestLookup.point_id),
        resolutionCaseId: latestLookup.resolution_case_id === null
          ? null : Number(latestLookup.resolution_case_id),
        occurredAtUtc: latestLookup.occurred_at_utc,
        learningDay: latestLookup.learning_day,
        timeZone: latestLookup.time_zone,
      } : null,
    },
    resolutionCases: {
      byStatus: groupedCounts(db, `
        SELECT status AS key, COUNT(*) AS count
        FROM kg_resolution_cases GROUP BY status ORDER BY status
      `),
      openByKind: groupedCounts(db, `
        SELECT case_kind AS key, COUNT(*) AS count
        FROM kg_resolution_cases WHERE status = 'open' GROUP BY case_kind ORDER BY case_kind
      `),
    },
    planningSignals: {
      count: Number(signals.count),
      minimumScore: signals.min_score === null ? null : Number(signals.min_score),
      maximumScore: signals.max_score === null ? null : Number(signals.max_score),
      averageScore: signals.average_score === null ? null : Number(signals.average_score.toFixed(4)),
      latestComputedAtUtc: signals.latest_computed_at_utc || null,
    },
    learningState: {
      hasProfile: tables.learning_profiles > 0,
      hasPlan: tables.learning_plans > 0,
      hasPersistedQueue: tables.learning_daily_queues > 0,
      hasScheduleState: tables.learning_schedule_states > 0,
      hasReviewEvents: tables.learning_review_events > 0,
    },
  };
}

function stableShape(result) {
  return result.entries.map((entry) => ({
    studyItemId: Number(entry.studyItemId),
    bucket: Number(entry.bucket),
    availableAtUtc: entry.availableAtUtc || null,
    dueAtUtc: entry.dueAtUtc || null,
  })).sort((left, right) => left.studyItemId - right.studyItemId);
}

function entryIds(result) {
  return result.entries.map((entry) => Number(entry.studyItemId));
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function percentile(samples, fraction) {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

function milliseconds(value) {
  return Number(value.toFixed(4));
}

function readerPerformance(db, reader, iterations) {
  const signalIds = db.prepare('SELECT study_item_id FROM kg_planning_signals ORDER BY study_item_id')
    .all().map((row) => Number(row.study_item_id));
  const candidateIds = db.prepare("SELECT id FROM study_items WHERE lifecycle = 'active' ORDER BY id LIMIT 32")
    .all().map((row) => Number(row.id));
  const probeIds = [...new Set([...signalIds, ...candidateIds])];
  if (!probeIds.length) return {
    iterations: 0,
    signalProbeCount: signalIds.length,
    p50Ms: null,
    p95Ms: null,
    p99Ms: null,
    maxMs: null,
    overHardBudgetCount: 0,
  };
  for (const studyItemId of probeIds) reader.readPlanningSignal({ studyItemId });
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const studyItemId = probeIds[index % probeIds.length];
    const startedAt = performance.now();
    reader.readPlanningSignal({ studyItemId });
    samples.push(performance.now() - startedAt);
  }
  return {
    iterations,
    signalProbeCount: signalIds.length,
    p50Ms: milliseconds(percentile(samples, 0.5)),
    p95Ms: milliseconds(percentile(samples, 0.95)),
    p99Ms: milliseconds(percentile(samples, 0.99)),
    maxMs: milliseconds(Math.max(...samples)),
    overHardBudgetCount: samples.filter((sample) => sample > READER_HARD_BUDGET_MS).length,
  };
}

function signalSource(entry) {
  return entry.explanation?.provider?.sources?.find((source) => source.providerId === 'graph-contract') || null;
}

function buildSelection({ rows, tagData, scope, bounds, nowUtc, dailyActionGoal, dailyNewLimit, provider }) {
  return buildQueueCandidates(
    rows,
    tagData.keys,
    scope,
    bounds,
    nowUtc,
    dailyNewLimit,
    dailyActionGoal,
    0,
    provider,
    tagData.signals
  );
}

function runPlanningCanary({
  db,
  nowUtc,
  timeZone = DEFAULT_TIME_ZONE,
  scope = DEFAULT_SCOPE,
  dailyActionGoal = DEFAULT_DAILY_ACTION_GOAL,
  dailyNewLimit = DEFAULT_DAILY_NEW_LIMIT,
  iterations = DEFAULT_ITERATIONS,
} = {}) {
  if (!db) throw new TypeError('runPlanningCanary requires a SQLite database');
  const observedAtUtc = utcInstant(nowUtc);
  const actionGoal = positiveInteger(dailyActionGoal, 'dailyActionGoal', DEFAULT_DAILY_ACTION_GOAL);
  const newLimit = positiveInteger(dailyNewLimit, 'dailyNewLimit', DEFAULT_DAILY_NEW_LIMIT);
  const sampleIterations = positiveInteger(iterations, 'iterations', DEFAULT_ITERATIONS);
  db.pragma('query_only = ON');

  const integrity = db.pragma('integrity_check', { simple: true });
  const foreignKeyViolations = db.pragma('foreign_key_check');
  const before = observationSnapshot(db);
  const day = learningDay(observedAtUtc, timeZone);
  const bounds = dayBounds(day, timeZone);
  const learning = new LearningService({ db, now: () => observedAtUtc });
  const rows = learning._candidateRows();
  const tagData = learning._tagDataByGeneration(rows);
  const graphReader = new GraphPlanningSignalReader({ db, enabled: true });
  const queryPlan = db.prepare(`EXPLAIN QUERY PLAN ${READ_SIGNAL_SQL}`).all(1)
    .map((row) => String(row.detail || ''));

  let networkCalls = 0;
  const originalFetch = global.fetch;
  global.fetch = (..._args) => {
    networkCalls += 1;
    throw new Error('Network access is forbidden during KG planning canary');
  };

  let baseline;
  let enabled;
  let degraded;
  try {
    const common = {
      rows,
      tagData,
      scope,
      bounds,
      nowUtc: observedAtUtc,
      dailyActionGoal: actionGoal,
      dailyNewLimit: newLimit,
    };
    baseline = buildSelection({
      ...common,
      provider: createDefaultPlanningSignalProvider(),
    });
    enabled = buildSelection({
      ...common,
      provider: createDefaultPlanningSignalProvider({ graphSignalReader: graphReader }),
    });
    degraded = buildSelection({
      ...common,
      provider: createDefaultPlanningSignalProvider({
        graphSignalReader: { readPlanningSignal() { throw new Error('canary-forced-reader-failure'); } },
      }),
    });
  } finally {
    if (originalFetch === undefined) delete global.fetch;
    else global.fetch = originalFetch;
  }

  const performanceResult = readerPerformance(db, graphReader, sampleIterations);
  const after = observationSnapshot(db);
  const baselineShape = stableShape(baseline);
  const enabledShape = stableShape(enabled);
  const baselineIds = entryIds(baseline);
  const enabledIds = entryIds(enabled);
  const degradedIds = entryIds(degraded);
  const graphEntries = enabled.entries.filter(signalSource).map((entry) => ({
    studyItemId: Number(entry.studyItemId),
    providerScore: Number(entry.providerScore),
    graphSignal: signalSource(entry),
    baselinePosition: baselineIds.indexOf(Number(entry.studyItemId)),
    enabledPosition: enabledIds.indexOf(Number(entry.studyItemId)),
  }));
  const stableShapeMatches = jsonEqual(baselineShape, enabledShape);
  const selectedSetMatches = jsonEqual(
    [...baselineIds].sort((a, b) => a - b),
    [...enabledIds].sort((a, b) => a - b)
  );
  const failureFallbackMatches = jsonEqual(baselineIds, degradedIds)
    && jsonEqual(baselineShape, stableShape(degraded));
  const noMutation = jsonEqual(before.tables, after.tables);
  const gates = {
    sqliteIntegrityOk: integrity === 'ok',
    foreignKeysOk: foreignKeyViolations.length === 0,
    signalProjectionAvailable: before.planningSignals.count > 0,
    graphSignalApplied: graphEntries.length > 0,
    selectedSetMatches,
    baseKeysMatch: stableShapeMatches,
    failureFallbackMatches,
    readerUsesPrimaryKeyLookup: queryPlan.some((detail) => /INTEGER PRIMARY KEY|PRIMARY KEY|rowid/iu.test(detail)),
    readerP95BelowTarget: performanceResult.p95Ms !== null
      && performanceResult.p95Ms < READER_P95_TARGET_MS,
    readerNeverExceededHardBudget: performanceResult.overHardBudgetCount === 0,
    noNetworkCalls: networkCalls === 0,
    noObservedTableMutation: noMutation,
  };
  const report = {
    reportVersion: REPORT_VERSION,
    generatedAtUtc: observedAtUtc,
    mode: 'read-only-same-snapshot-canary',
    configuration: {
      timeZone,
      learningDay: day,
      bounds,
      scope,
      dailyActionGoal: actionGoal,
      dailyNewLimit: newLimit,
      completedActions: 0,
      readerIterations: sampleIterations,
      readerP95TargetMs: READER_P95_TARGET_MS,
      providerHardBudgetMs: READER_HARD_BUDGET_MS,
    },
    observationBefore: before,
    observationAfter: after,
    canary: {
      candidateRowCount: rows.length,
      baseline: {
        ids: baselineIds,
        summary: baseline.summary,
        diagnostics: baseline.planning.diagnostics,
      },
      enabled: {
        ids: enabledIds,
        summary: enabled.summary,
        diagnostics: enabled.planning.diagnostics,
      },
      forcedFailure: {
        ids: degradedIds,
        diagnostics: degraded.planning.diagnostics,
      },
      graphEntries,
      orderChanged: !jsonEqual(baselineIds, enabledIds),
      changedPositions: enabledIds.filter((id, index) => baselineIds[index] !== id).length,
      queryPlan,
      networkCalls,
    },
    readerPerformance: performanceResult,
    gates,
    overallPass: Object.values(gates).every(Boolean),
  };
  report.reportHash = crypto.createHash('sha256').update(JSON.stringify(report)).digest('hex');
  return report;
}

module.exports = {
  DEFAULT_DAILY_ACTION_GOAL,
  DEFAULT_DAILY_NEW_LIMIT,
  DEFAULT_ITERATIONS,
  OBSERVED_TABLES,
  REPORT_VERSION,
  runPlanningCanary,
};
