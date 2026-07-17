'use strict';

const { publishedTextbookSources, studyItemSources } = require('./buildKnowledgeBackfillManifest');
const { sha256, stableJson } = require('../domain/knowledgeIdentity');

const PLAN_VERSION = 'kg-r2-source-sync-plan-v1';

function descriptorKey(descriptor) {
  return [
    descriptor.operation,
    descriptor.sourceKind,
    descriptor.sourceRefId,
    descriptor.sourceRevision,
    descriptor.language || '',
    descriptor.sourceContentHash,
  ].join(':');
}

function activeDescriptor(source) {
  return {
    operation: 'active',
    sourceKind: source.sourceKind,
    sourceRefId: Number(source.sourceRefId),
    sourceRevision: Number(source.sourceRevision),
    language: source.sourceKind === 'textbook_expression' ? source.language : '',
    sourceContentHash: source.sourceContentHash,
  };
}

function absentDescriptor(evidence) {
  return {
    operation: 'absent',
    sourceKind: evidence.source_kind,
    sourceRefId: Number(evidence.source_ref_id),
    sourceRevision: Number(evidence.source_revision),
    language: evidence.source_kind === 'textbook_expression' ? evidence.language : '',
    sourceContentHash: evidence.source_content_hash,
  };
}

function evidenceMatchesSource(evidence, source) {
  return evidence.source_kind === source.sourceKind
    && Number(evidence.source_ref_id) === Number(source.sourceRefId)
    && Number(evidence.source_revision) === Number(source.sourceRevision)
    && evidence.source_content_hash === source.sourceContentHash
    && evidence.language === source.language;
}

function terminalSkipCoversMissingSource(db, descriptor, matchingEvidenceCount) {
  const row = db.prepare(`
    SELECT result_json FROM kg_source_sync_jobs
    WHERE operation = ? AND source_kind = ? AND source_ref_id = ?
      AND source_revision = ? AND language = ? AND source_content_hash = ?
      AND status = 'succeeded'
      AND COALESCE(json_extract(result_json, '$.skipped'), 0) > 0
    LIMIT 1
  `).get(
    descriptor.operation, descriptor.sourceKind, descriptor.sourceRefId,
    descriptor.sourceRevision, descriptor.language || '', descriptor.sourceContentHash
  );
  if (!row) return false;
  const result = JSON.parse(row.result_json || '{}');
  const expectedMaterialized = Number(result.resolved || 0) + Number(result.unresolved || 0);
  return Number(matchingEvidenceCount) >= expectedMaterialized;
}

function buildKnowledgeSyncPlan({ db } = {}) {
  if (!db) throw new TypeError('buildKnowledgeSyncPlan requires db');
  const study = studyItemSources(db);
  const textbook = publishedTextbookSources(db);
  const currentSources = [...study.sources, ...textbook];
  const activeEvidence = db.prepare(`
    SELECT * FROM kg_evidence
    WHERE lifecycle = 'active' AND source_kind IN ('study_item', 'textbook_expression')
    ORDER BY source_kind, source_ref_id, language, id
  `).all();

  const descriptorMap = new Map();
  const currentGroups = new Map();
  for (const source of currentSources) {
    const descriptor = activeDescriptor(source);
    const key = descriptorKey(descriptor);
    const group = currentGroups.get(key) || { descriptor, sources: [] };
    group.sources.push(source);
    currentGroups.set(key, group);
  }

  for (const { descriptor, sources } of currentGroups.values()) {
    const sourceEvidence = activeEvidence.filter((evidence) => (
      evidence.source_kind === descriptor.sourceKind
      && Number(evidence.source_ref_id) === descriptor.sourceRefId
      && (!descriptor.language || evidence.language === descriptor.language)
    ));
    const missing = sources.some((source) => !sourceEvidence.some((evidence) => evidenceMatchesSource(evidence, source)));
    const matchingEvidenceCount = sourceEvidence.filter((evidence) => (
      Number(evidence.source_revision) === descriptor.sourceRevision
      && evidence.source_content_hash === descriptor.sourceContentHash
    )).length;
    const stale = sourceEvidence.some((evidence) => (
      Number(evidence.source_revision) !== descriptor.sourceRevision
      || evidence.source_content_hash !== descriptor.sourceContentHash
    ));
    if ((missing || stale) && !(missing && !stale
      && terminalSkipCoversMissingSource(db, descriptor, matchingEvidenceCount))) {
      descriptorMap.set(descriptorKey(descriptor), descriptor);
    }
  }

  const currentIdentity = new Set(currentSources.map((source) => (
    `${source.sourceKind}:${source.sourceRefId}:${source.sourceKind === 'textbook_expression' ? source.language : ''}`
  )));
  for (const evidence of activeEvidence) {
    const identity = `${evidence.source_kind}:${evidence.source_ref_id}:${evidence.source_kind === 'textbook_expression' ? evidence.language : ''}`;
    if (currentIdentity.has(identity)) continue;
    const descriptor = absentDescriptor(evidence);
    descriptorMap.set(descriptorKey(descriptor), descriptor);
  }

  const descriptors = [...descriptorMap.values()].sort((left, right) => descriptorKey(left).localeCompare(descriptorKey(right)));
  const summary = {
    activeEligibleStudyItems: study.rowCount,
    currentStudyItemSources: study.sources.length,
    currentTextbookSources: textbook.length,
    activeEvidence: activeEvidence.length,
    activeJobs: descriptors.filter((entry) => entry.operation === 'active').length,
    absentJobs: descriptors.filter((entry) => entry.operation === 'absent').length,
    skippedWholeCardSources: study.unresolved.filter((entry) => entry.reason === 'whole-card-extractor-unavailable').length,
  };
  const hashBody = { schemaVersion: PLAN_VERSION, summary, descriptors };
  return { ...hashBody, planHash: sha256(stableJson(hashBody)) };
}

module.exports = {
  PLAN_VERSION,
  activeDescriptor,
  buildKnowledgeSyncPlan,
  descriptorKey,
};
