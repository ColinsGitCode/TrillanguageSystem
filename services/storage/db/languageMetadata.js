'use strict';

// JLM-A0 storage for extraction jobs and metadata proposals.
//
// The job row is the evidence that an extraction was attempted. Without it a
// provider timeout is indistinguishable from "this card has no loanwords", so
// job creation happens before the provider call and survives its failure.

function mapJob(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    jobKey: row.job_key,
    targetKind: row.target_kind,
    targetId: Number(row.target_id),
    sourceContentHash: row.source_content_hash,
    metadataKind: row.metadata_kind,
    extractionVersion: row.extraction_version,
    status: row.status,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    lastErrorCode: row.last_error_code,
    model: row.model,
    promptVersion: row.prompt_version,
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
  };
}

function mapProposal(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    proposalKey: row.proposal_key,
    jobId: row.job_id === null ? null : Number(row.job_id),
    targetKind: row.target_kind,
    targetId: Number(row.target_id),
    sourceContentHash: row.source_content_hash,
    metadataKind: row.metadata_kind,
    surface: row.surface,
    startCodePoint: Number(row.start_codepoint),
    endCodePoint: Number(row.end_codepoint),
    value: row.value_json ? JSON.parse(row.value_json) : {},
    confidence: row.confidence,
    origin: row.origin,
    status: row.status,
    model: row.model,
    promptVersion: row.prompt_version,
    responseHash: row.response_hash,
    supersedesProposalId: row.supersedes_proposal_id === null
      ? null
      : Number(row.supersedes_proposal_id),
    decidedBy: row.decided_by,
    decidedAtUtc: row.decided_at_utc,
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
  };
}

// Idempotent on job_key: re-enqueueing the same body version returns the
// existing job rather than creating a duplicate attempt.
function ensureJob(db, payload) {
  db.prepare(`
    INSERT INTO language_metadata_jobs(
      job_key, target_kind, target_id, source_content_hash, metadata_kind,
      extraction_version, status, attempts, max_attempts, created_at_utc, updated_at_utc
    ) VALUES (
      @jobKey, @targetKind, @targetId, @sourceContentHash, @metadataKind,
      @extractionVersion, 'queued', 0, @maxAttempts, @nowUtc, @nowUtc
    )
    ON CONFLICT(job_key) DO NOTHING
  `).run({ maxAttempts: 3, ...payload });
  return mapJob(db.prepare('SELECT * FROM language_metadata_jobs WHERE job_key = ?').get(payload.jobKey));
}

function markJobRunning(db, jobId, nowUtc) {
  const changes = db.prepare(`
    UPDATE language_metadata_jobs
    SET status = 'running', attempts = attempts + 1, updated_at_utc = @nowUtc
    WHERE id = @jobId
      AND status IN ('queued', 'failed')
      AND attempts < max_attempts
  `).run({ jobId, nowUtc }).changes;
  return changes ? getJob(db, jobId) : null;
}

function getJob(db, jobId) {
  return mapJob(db.prepare('SELECT * FROM language_metadata_jobs WHERE id = ?').get(Number(jobId)));
}

function claimNextJob(db, nowUtc) {
  const transaction = db.transaction(() => {
    const row = db.prepare(`
      SELECT id
      FROM language_metadata_jobs
      WHERE status IN ('queued', 'failed')
        AND attempts < max_attempts
      ORDER BY CASE status WHEN 'queued' THEN 0 ELSE 1 END, updated_at_utc ASC, id ASC
      LIMIT 1
    `).get();
    return row ? markJobRunning(db, row.id, nowUtc) : null;
  });
  return transaction();
}

function recoverRunningJobs(db, nowUtc) {
  return db.prepare(`
    UPDATE language_metadata_jobs
    SET status = CASE WHEN attempts >= max_attempts THEN 'abandoned' ELSE 'failed' END,
        last_error_code = COALESCE(last_error_code, 'WORKER_RESTARTED'),
        updated_at_utc = @nowUtc
    WHERE status = 'running'
  `).run({ nowUtc }).changes;
}

function finishJob(db, jobId, payload) {
  // A job that has burned its attempts becomes 'abandoned' rather than staying
  // 'failed', so the read side can tell "will retry" from "gave up".
  db.prepare(`
    UPDATE language_metadata_jobs
    SET status = CASE
          WHEN @status = 'failed' AND attempts >= max_attempts THEN 'abandoned'
          ELSE @status
        END,
        last_error_code = @lastErrorCode,
        model = COALESCE(@model, model),
        prompt_version = COALESCE(@promptVersion, prompt_version),
        updated_at_utc = @nowUtc
    WHERE id = @jobId
  `).run({ model: null, promptVersion: null, lastErrorCode: null, ...payload, jobId });
  return mapJob(db.prepare('SELECT * FROM language_metadata_jobs WHERE id = ?').get(jobId));
}

function getJobByKey(db, jobKey) {
  return mapJob(db.prepare('SELECT * FROM language_metadata_jobs WHERE job_key = ?').get(jobKey));
}

function listJobs(db, { targetKind, targetId } = {}) {
  return db.prepare(`
    SELECT * FROM language_metadata_jobs
    WHERE target_kind = @targetKind AND target_id = @targetId
    ORDER BY id DESC
  `).all({ targetKind, targetId }).map(mapJob);
}

/**
 * Inserts a proposal, or reports a conflict when the same key already carries a
 * different value. JLM-D0 §7 forbids silently overwriting: an identical replay
 * is idempotent, a contradictory one must surface for human inspection.
 */
function insertProposal(db, payload) {
  const existing = db.prepare('SELECT * FROM language_metadata_proposals WHERE proposal_key = ?')
    .get(payload.proposalKey);
  if (existing) {
    const sameValue = existing.value_json === payload.valueJson
      && existing.surface === payload.surface
      && Number(existing.start_codepoint) === Number(payload.startCodePoint)
      && Number(existing.end_codepoint) === Number(payload.endCodePoint);
    return { proposal: mapProposal(existing), created: false, conflict: !sameValue };
  }
  const result = db.prepare(`
    INSERT INTO language_metadata_proposals(
      proposal_key, job_id, target_kind, target_id, source_content_hash, metadata_kind,
      surface, start_codepoint, end_codepoint, value_json, confidence, origin, status,
      model, prompt_version, response_hash, supersedes_proposal_id, created_at_utc, updated_at_utc
    ) VALUES (
      @proposalKey, @jobId, @targetKind, @targetId, @sourceContentHash, @metadataKind,
      @surface, @startCodePoint, @endCodePoint, @valueJson, @confidence, @origin, @status,
      @model, @promptVersion, @responseHash, @supersedesProposalId, @nowUtc, @nowUtc
    )
  `).run({
    jobId: null, model: null, promptVersion: null, responseHash: null,
    supersedesProposalId: null, origin: 'llm', status: 'pending', ...payload,
  });
  return {
    proposal: mapProposal(db.prepare('SELECT * FROM language_metadata_proposals WHERE id = ?').get(result.lastInsertRowid)),
    created: true,
    conflict: false,
  };
}

function listProposals(db, { targetKind, targetId, sourceContentHash } = {}) {
  const clauses = ['target_kind = @targetKind', 'target_id = @targetId'];
  const params = { targetKind, targetId };
  if (sourceContentHash) {
    clauses.push('source_content_hash = @sourceContentHash');
    params.sourceContentHash = sourceContentHash;
  }
  return db.prepare(`
    SELECT * FROM language_metadata_proposals
    WHERE ${clauses.join(' AND ')}
    ORDER BY start_codepoint ASC, id ASC
  `).all(params).map(mapProposal);
}

// Candidates are bound to the body version that produced them. When the body
// changes the old ranges may point at different characters, so they are retired
// rather than reused.
function markStaleForOtherHashes(db, { targetKind, targetId, sourceContentHash, nowUtc }) {
  return db.prepare(`
    UPDATE language_metadata_proposals
    SET status = 'stale', updated_at_utc = @nowUtc
    WHERE target_kind = @targetKind AND target_id = @targetId
      AND source_content_hash <> @sourceContentHash
      AND status IN ('pending', 'accepted')
  `).run({ targetKind, targetId, sourceContentHash, nowUtc }).changes;
}

function getProposal(db, id) {
  return mapProposal(db.prepare('SELECT * FROM language_metadata_proposals WHERE id = ?').get(Number(id)));
}

/**
 * Records a human decision on a candidate. Optimistic on the current status so
 * two reviewers cannot silently overwrite each other; the caller turns a false
 * return into a 409 rather than retrying.
 */
function decideProposal(db, { id, expectedStatus, status, decidedBy, nowUtc }) {
  const changes = db.prepare(`
    UPDATE language_metadata_proposals
    SET status = @status, decided_by = @decidedBy, decided_at_utc = @nowUtc, updated_at_utc = @nowUtc
    WHERE id = @id AND status = @expectedStatus
  `).run({ id: Number(id), expectedStatus, status, decidedBy: decidedBy || 'user', nowUtc }).changes;
  return changes ? getProposal(db, id) : null;
}

module.exports = {
  claimNextJob,
  decideProposal,
  getJob,
  getProposal,
  ensureJob,
  finishJob,
  getJobByKey,
  insertProposal,
  listJobs,
  listProposals,
  mapJob,
  mapProposal,
  markJobRunning,
  markStaleForOtherHashes,
  recoverRunningJobs,
};
