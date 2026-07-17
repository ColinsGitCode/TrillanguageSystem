'use strict';

const { KnowledgeGraphService } = require('./knowledgeGraphService');
const { buildKnowledgeBackfillManifest } = require('./buildKnowledgeBackfillManifest');
const { rebuildKnowledgeProjections } = require('./rebuildKnowledgeProjections');
const { buildSurfaceIdentity, sha256, stableJson } = require('../domain/knowledgeIdentity');

const APPLY_VERSION = 'kg-r0-backfill-apply-v1';
const FACT_TABLES = [
  'kg_points',
  'kg_surface_forms',
  'kg_evidence',
  'kg_resolution_cases',
  'kg_resolution_events',
  'kg_point_transitions',
  'kg_point_surface_links',
  'kg_point_evidence_links',
  'kg_lookup_events',
];
const REPORT_TABLES = [...FACT_TABLES, 'kg_point_stats', 'kg_planning_signals'];

function backfillError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function normalizeHash(value) {
  const hash = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(hash)) {
    throw backfillError('KG_BACKFILL_MANIFEST_INVALID', 'expectedManifestHash must be a SHA-256 hex digest');
  }
  return hash;
}

function tableCounts(db, tables = REPORT_TABLES) {
  return Object.fromEntries(tables.map((table) => [
    table,
    Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count),
  ]));
}

function countDelta(before, after) {
  return Object.fromEntries(Object.keys(after).map((key) => [key, after[key] - (before[key] || 0)]));
}

function reasonCounts(candidates) {
  return (candidates || []).reduce((counts, candidate) => {
    const reason = candidate.reason || 'unknown';
    counts[reason] = (counts[reason] || 0) + 1;
    return counts;
  }, {});
}

function analysisForResolvedCandidate(candidate) {
  const point = candidate.point;
  const surface = candidate.surface;
  if (!point?.pointKey || !surface?.surfaceKey || !candidate?.source?.text) {
    throw backfillError('KG_BACKFILL_MANIFEST_INVALID', 'Resolved candidate is missing deterministic identity data');
  }
  return {
    status: 'analyzed',
    input: candidate.source.text,
    normalizedInput: surface.normalizedSurface,
    canonicalForm: point.canonicalForm,
    lemmaReading: point.canonicalReading || '',
    surfaceReading: surface.normalizedReading || '',
    pointIdentity: point,
    surfaceIdentity: surface,
    relation: candidate.relation,
    language: point.language,
    kind: candidate.kind,
    analyzer: candidate.analyzer || null,
    tokens: candidate.tokens || [],
    lemmaTokens: candidate.lemmaTokens || [],
    inputHash: candidate.inputHash || sha256(candidate.source.text),
    outputHash: candidate.outputHash || sha256(stableJson({ point, surface, relation: candidate.relation })),
  };
}

function analysisForUnresolvedCandidate(candidate) {
  const source = candidate.source || {};
  const analysis = candidate.analysis || {};
  const normalizedInput = String(analysis.normalizedInput || source.text || '').trim();
  if (!normalizedInput || !candidate.evidence) return null;
  const language = source.language || candidate.evidence.language;
  return {
    input: source.text,
    normalizedInput,
    kind: candidate.kind || 'lexeme',
    language,
    reason: candidate.reason || 'unsupported-analysis',
    details: analysis.details || {},
    analyzer: analysis.analyzer || null,
    tokens: analysis.tokens || [],
    inputHash: analysis.inputHash || sha256(normalizedInput),
    outputHash: analysis.outputHash || sha256(stableJson({
      status: 'unresolved', reason: candidate.reason || 'unsupported-analysis', tokens: analysis.tokens || [],
    })),
    surfaceIdentity: buildSurfaceIdentity({ language, surfaceText: normalizedInput }),
  };
}

function ensureCandidateSources(repo, manifest) {
  const evidence = [
    ...(manifest.candidates || []).map((candidate) => candidate.evidence?.evidence),
    ...(manifest.unresolved || []).map((candidate) => candidate.evidence),
  ].filter(Boolean);
  for (const entry of evidence) {
    if (!repo.sourceContentMatches(entry)) {
      throw backfillError(
        'KG_BACKFILL_SOURCE_DRIFT',
        'A source changed after the approved manifest was produced',
        { evidenceKey: entry.evidenceKey, sourceKind: entry.sourceKind, sourceRefId: entry.sourceRefId }
      );
    }
  }
}

function persistUnresolvedCandidate(service, candidate, now) {
  const analysis = analysisForUnresolvedCandidate(candidate);
  if (!analysis) return { materialized: false, reason: candidate.reason || 'missing-analysis' };
  const surface = service.repo.insertSurface(analysis.surfaceIdentity, {
    input: analysis.input,
    status: analysis.reason === 'unsupported-token' ? 'unsupported' : 'unresolved',
    analyzer: analysis.analyzer,
    tokens: analysis.tokens,
    inputHash: analysis.inputHash,
    outputHash: analysis.outputHash,
  }, now);
  const evidence = service.repo.insertEvidence(candidate.evidence, now);
  const caseKey = sha256(stableJson({
    version: 'kg-resolution-case-v1',
    language: analysis.language,
    kind: analysis.kind,
    surfaceKey: analysis.surfaceIdentity.surfaceKey,
    reason: analysis.reason,
  }));
  const resolutionCase = service.repo.insertCase({
    caseKey,
    caseKind: analysis.reason === 'ambiguous-kana-input' ? 'ambiguous-surface' : 'unsupported-analysis',
    language: analysis.language,
    kindHint: analysis.kind,
    surfaceFormId: Number(surface.id),
    evidenceId: Number(evidence.id),
    normalizedInput: analysis.normalizedInput,
    candidatesJson: '[]',
    now,
  });
  const payload = { caseId: resolutionCase.id, reason: analysis.reason, details: analysis.details };
  service.repo.ensureResolutionEvent({
    eventKey: `rule:case-opened:${caseKey}`,
    requestHash: sha256(stableJson(payload)),
    caseId: resolutionCase.id,
    action: 'case-opened',
    actorKind: 'rule',
    analyzerId: analysis.analyzer?.id || null,
    analyzerVersion: analysis.analyzer?.version || null,
    ruleVersion: analysis.analyzer?.ruleVersion || null,
    inputHash: analysis.inputHash,
    outputHash: analysis.outputHash,
    payloadJson: JSON.stringify(payload),
    publicReason: `Input remains unresolved: ${analysis.reason}.`,
    occurredAtUtc: now,
    createdAtUtc: now,
  });
  return { materialized: true, caseId: resolutionCase.id, reason: analysis.reason };
}

async function applyKnowledgeBackfill({
  db,
  expectedManifestHash,
  now = new Date().toISOString(),
  buildManifest = buildKnowledgeBackfillManifest,
  analyzeJapanese,
} = {}) {
  if (!db) throw new TypeError('applyKnowledgeBackfill requires db');
  const expectedHash = normalizeHash(expectedManifestHash);
  const manifest = await buildManifest({ db, now, analyzeJapanese });
  if (manifest.manifestHash !== expectedHash) {
    throw backfillError('KG_BACKFILL_MANIFEST_MISMATCH', 'The approved manifest hash does not match the current source snapshot', {
      expectedManifestHash: expectedHash,
      actualManifestHash: manifest.manifestHash,
    });
  }

  const service = new KnowledgeGraphService({ db, clock: () => now });
  const before = tableCounts(db);
  const existingFacts = FACT_TABLES.reduce((total, table) => total + before[table], 0);
  if (existingFacts > 0) {
    throw backfillError('KG_BACKFILL_NOT_PRISTINE', 'KG backfill requires an empty fact store', { existingFacts, before });
  }
  ensureCandidateSources(service.repo, manifest);

  const result = service.repo.transaction(() => {
    let resolvedApplied = 0;
    for (const candidate of manifest.candidates || []) {
      const persisted = service.persistResolvedAnalysis(analysisForResolvedCandidate(candidate), now);
      const point = service.repo.getPointById(persisted.pointId);
      service.persistEvidenceCandidate(candidate.evidence, point, now);
      resolvedApplied += 1;
    }
    const unresolved = (manifest.unresolved || []).map((candidate) => persistUnresolvedCandidate(service, candidate, now));
    const projection = rebuildKnowledgeProjections({ db, now });
    const after = tableCounts(db);
    return { resolvedApplied, unresolved, projection, after };
  });

  const materializedUnresolved = result.unresolved.filter((entry) => entry.materialized);
  const skippedUnresolved = result.unresolved.filter((entry) => !entry.materialized);
  const reportBody = {
    schemaVersion: APPLY_VERSION,
    mode: 'apply',
    manifestHash: manifest.manifestHash,
    manifestVersion: manifest.schemaVersion,
    appliedAtUtc: now,
    sourceSummary: manifest.summary,
    before,
    after: result.after,
    inserted: countDelta(before, result.after),
    resolvedApplied: result.resolvedApplied,
    unresolved: {
      total: result.unresolved.length,
      materialized: materializedUnresolved.length,
      skipped: skippedUnresolved.length,
      reasonCounts: reasonCounts(manifest.unresolved),
      skippedReasons: reasonCounts(skippedUnresolved),
    },
    projection: result.projection,
  };
  return {
    ...reportBody,
    reportHash: sha256(stableJson(reportBody)),
  };
}

module.exports = {
  APPLY_VERSION,
  FACT_TABLES,
  applyKnowledgeBackfill,
  analysisForResolvedCandidate,
  analysisForUnresolvedCandidate,
  persistUnresolvedCandidate,
  tableCounts,
};
