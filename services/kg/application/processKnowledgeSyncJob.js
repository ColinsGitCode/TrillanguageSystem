'use strict';

const { KnowledgeGraphService } = require('./knowledgeGraphService');
const {
  analyzeSource,
  sourceBundleForJob,
} = require('./buildKnowledgeBackfillManifest');
const {
  analysisForResolvedCandidate,
  persistUnresolvedCandidate,
} = require('./applyKnowledgeBackfill');
const { rebuildKnowledgeProjections } = require('./rebuildKnowledgeProjections');
const { analyzeJapaneseForm } = require('../domain/japaneseFormAnalysis');
const { sha256, stableJson } = require('../domain/knowledgeIdentity');

const SYNC_RULE_VERSION = 'kg-r2-incremental-sync-v1';

function bundleFingerprint(bundle) {
  return sha256(stableJson({ sources: bundle?.sources || [], unresolved: bundle?.unresolved || [] }));
}

function sourceHasCurrentEvidence(db, source) {
  return Boolean(db.prepare(`
    SELECT id FROM kg_evidence
    WHERE source_kind = ? AND source_ref_id = ? AND source_revision = ?
      AND language = ? AND source_content_hash = ? AND lifecycle = 'active'
    LIMIT 1
  `).get(
    source.sourceKind,
    Number(source.sourceRefId),
    Number(source.sourceRevision),
    source.language,
    source.sourceContentHash
  ));
}

function detachEvidence(service, job, options = {}) {
  const preserveCurrent = options.preserveCurrent === true;
  const lifecycle = preserveCurrent ? 'superseded' : 'orphaned';
  const evidenceRows = service.repo.listActiveEvidenceForSource(job.sourceKind, job.sourceRefId, job.language);
  const affectedPointIds = new Set();
  let detached = 0;
  for (const evidence of evidenceRows) {
    if (preserveCurrent
      && Number(evidence.source_revision) === Number(job.sourceRevision)
      && evidence.source_content_hash === job.sourceContentHash) {
      continue;
    }
    const payload = {
      evidenceId: Number(evidence.id),
      sourceKind: job.sourceKind,
      sourceRefId: Number(job.sourceRefId),
      fromRevision: Number(evidence.source_revision),
      fromContentHash: evidence.source_content_hash,
      lifecycle,
    };
    service.repo.ensureResolutionEvent({
      eventKey: `maintenance:evidence-detached:${evidence.id}:${lifecycle}`,
      requestHash: sha256(stableJson(payload)),
      action: 'evidence-detached',
      actorKind: 'maintenance',
      ruleVersion: SYNC_RULE_VERSION,
      inputHash: evidence.source_content_hash,
      outputHash: sha256(stableJson({ evidenceId: Number(evidence.id), lifecycle })),
      payloadJson: JSON.stringify(payload),
      publicReason: lifecycle === 'orphaned'
        ? 'The source is no longer active, so this evidence was orphaned.'
        : 'A newer source revision replaced this evidence.',
      occurredAtUtc: options.now,
      createdAtUtc: options.now,
    });
    for (const pointId of service.repo.transitionEvidenceLifecycle({
      evidenceId: Number(evidence.id),
      lifecycle,
      now: options.now,
    })) affectedPointIds.add(pointId);
    detached += 1;
  }
  return { detached, affectedPointIds };
}

async function processKnowledgeSyncJob({
  db,
  job,
  now = new Date().toISOString(),
  analyzeJapanese = analyzeJapaneseForm,
} = {}) {
  if (!db) throw new TypeError('processKnowledgeSyncJob requires db');
  if (!job) throw new TypeError('processKnowledgeSyncJob requires job');
  const initialBundle = job.operation === 'active' ? sourceBundleForJob(db, job) : null;
  if (job.operation === 'active' && initialBundle.current) {
    initialBundle.analyzed = [];
    for (const source of initialBundle.sources) {
      if (sourceHasCurrentEvidence(db, source)) continue;
      initialBundle.analyzed.push(await analyzeSource(source, analyzeJapanese));
    }
  }

  const service = new KnowledgeGraphService({ db, clock: () => now, analyzeJapanese });
  return service.repo.transaction(() => {
    const currentBundle = job.operation === 'active' ? sourceBundleForJob(db, job) : null;
    const sourceIsCurrent = Boolean(
      currentBundle?.current
      && bundleFingerprint(currentBundle) === bundleFingerprint(initialBundle)
    );
    const detach = detachEvidence(service, job, {
      preserveCurrent: sourceIsCurrent,
      now,
    });
    const pointIds = new Set(detach.affectedPointIds);

    if (job.sourceKind === 'study_item') {
      db.prepare('DELETE FROM kg_planning_signals WHERE study_item_id = ?').run(Number(job.sourceRefId));
    }

    if (!sourceIsCurrent) {
      if (pointIds.size) rebuildKnowledgeProjections({ db, now, pointIds: [...pointIds] });
      return {
        terminalStatus: 'superseded',
        sourceCurrent: false,
        detachedEvidence: detach.detached,
        affectedPointIds: [...pointIds].sort((left, right) => left - right),
      };
    }

    let resolved = 0;
    let unresolved = 0;
    let skipped = currentBundle.unresolved.length;
    for (const candidate of initialBundle.analyzed) {
      if (candidate.status === 'resolved') {
        const persisted = service.persistResolvedAnalysis(analysisForResolvedCandidate(candidate), now);
        const point = service.repo.getPointById(persisted.pointId);
        service.persistEvidenceCandidate(candidate.evidence, point, now);
        pointIds.add(Number(point.id));
        resolved += 1;
      } else {
        const result = persistUnresolvedCandidate(service, candidate, now);
        if (result.materialized) unresolved += 1;
        else skipped += 1;
      }
    }
    const projection = pointIds.size
      ? rebuildKnowledgeProjections({ db, now, pointIds: [...pointIds] })
      : { mode: 'incremental', pointCount: 0, signalCount: 0, computedAtUtc: now };
    return {
      terminalStatus: 'succeeded',
      sourceCurrent: true,
      resolved,
      unresolved,
      skipped,
      detachedEvidence: detach.detached,
      affectedPointIds: [...pointIds].sort((left, right) => left - right),
      projection,
    };
  });
}

module.exports = {
  SYNC_RULE_VERSION,
  detachEvidence,
  processKnowledgeSyncJob,
};
