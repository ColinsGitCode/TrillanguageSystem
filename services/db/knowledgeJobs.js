'use strict';

// Knowledge-jobs lifecycle extracted from databaseService.js. Owns the
// knowledge_jobs row + the knowledge_synonym_jobs_meta side-table for
// synonym_boundary jobs. NOTE: this only covers the job lifecycle (create,
// status patches, cancel, list) plus the synonym-meta upsert/read.
// The deeper knowledge_* data tables (terms/synonym groups/grammar patterns/
// clusters/relations/index) still live in databaseService.js until they
// have their own unit-test layer. Functions take `db` first.

const { safeJsonParse } = require('./helpers');

function create(db, payload = {}) {
  const stmt = db.prepare(`
    INSERT INTO knowledge_jobs (
      job_type, status, scope_json, batch_size, total_batches, done_batches,
      error_batches, engine_version, triggered_by
    ) VALUES (
      @jobType, 'queued', @scopeJson, @batchSize, 0, 0, 0, @engineVersion, @triggeredBy
    )
  `);

  const result = stmt.run({
    jobType: String(payload.jobType || '').trim(),
    scopeJson: JSON.stringify(payload.scope || {}),
    batchSize: Math.max(1, Number(payload.batchSize || 50)),
    engineVersion: String(payload.engineVersion || 'local-v1'),
    triggeredBy: String(payload.triggeredBy || 'owner')
  });

  return getById(db, result.lastInsertRowid);
}

function upsertSynonymMeta(db, jobId, meta = {}) {
  const normalizedJobId = Number(jobId);
  if (!normalizedJobId) return null;
  const stmt = db.prepare(`
    INSERT INTO knowledge_synonym_jobs_meta (
      job_id, model, prompt_version, schema_version, min_candidate_score,
      max_pairs, max_llm_pairs, llm_enabled, candidate_count, success_count,
      failed_count, json_parse_rate, avg_latency_ms, p95_latency_ms,
      options_json, updated_at
    ) VALUES (
      @jobId, @model, @promptVersion, @schemaVersion, @minCandidateScore,
      @maxPairs, @maxLlmPairs, @llmEnabled, @candidateCount, @successCount,
      @failedCount, @jsonParseRate, @avgLatencyMs, @p95LatencyMs,
      @optionsJson, CURRENT_TIMESTAMP
    )
    ON CONFLICT(job_id) DO UPDATE SET
      model = excluded.model,
      prompt_version = excluded.prompt_version,
      schema_version = excluded.schema_version,
      min_candidate_score = excluded.min_candidate_score,
      max_pairs = excluded.max_pairs,
      max_llm_pairs = excluded.max_llm_pairs,
      llm_enabled = excluded.llm_enabled,
      candidate_count = excluded.candidate_count,
      success_count = excluded.success_count,
      failed_count = excluded.failed_count,
      json_parse_rate = excluded.json_parse_rate,
      avg_latency_ms = excluded.avg_latency_ms,
      p95_latency_ms = excluded.p95_latency_ms,
      options_json = excluded.options_json,
      updated_at = CURRENT_TIMESTAMP
  `);

  stmt.run({
    jobId: normalizedJobId,
    model: meta.model ? String(meta.model) : null,
    promptVersion: meta.promptVersion ? String(meta.promptVersion) : null,
    schemaVersion: meta.schemaVersion ? String(meta.schemaVersion) : null,
    minCandidateScore: Number(meta.minCandidateScore == null ? 0.62 : meta.minCandidateScore),
    maxPairs: Math.max(1, Number(meta.maxPairs == null ? 120 : meta.maxPairs)),
    maxLlmPairs: Math.max(0, Number(meta.maxLlmPairs == null ? 24 : meta.maxLlmPairs)),
    llmEnabled: meta.llmEnabled ? 1 : 0,
    candidateCount: Math.max(0, Number(meta.candidateCount || 0)),
    successCount: Math.max(0, Number(meta.successCount || 0)),
    failedCount: Math.max(0, Number(meta.failedCount || 0)),
    jsonParseRate: Number(meta.jsonParseRate || 0),
    avgLatencyMs: Number(meta.avgLatencyMs || 0),
    p95LatencyMs: Number(meta.p95LatencyMs || 0),
    optionsJson: JSON.stringify(meta.options || {})
  });

  return getSynonymMeta(db, normalizedJobId);
}

function getSynonymMeta(db, jobId) {
  const normalizedJobId = Number(jobId);
  if (!normalizedJobId) return null;
  const row = db.prepare(`
    SELECT *
    FROM knowledge_synonym_jobs_meta
    WHERE job_id = ?
    LIMIT 1
  `).get(normalizedJobId);
  if (!row) return null;
  return {
    jobId: row.job_id,
    model: row.model || null,
    promptVersion: row.prompt_version || null,
    schemaVersion: row.schema_version || null,
    minCandidateScore: Number(row.min_candidate_score || 0),
    maxPairs: Number(row.max_pairs || 0),
    maxLlmPairs: Number(row.max_llm_pairs || 0),
    llmEnabled: Number(row.llm_enabled || 0) === 1,
    candidateCount: Number(row.candidate_count || 0),
    successCount: Number(row.success_count || 0),
    failedCount: Number(row.failed_count || 0),
    jsonParseRate: Number(row.json_parse_rate || 0),
    avgLatencyMs: Number(row.avg_latency_ms || 0),
    p95LatencyMs: Number(row.p95_latency_ms || 0),
    options: safeJsonParse(row.options_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function updateStatus(db, jobId, patch = {}) {
  const fields = [];
  const params = { jobId };

  if (patch.status !== undefined) {
    fields.push('status = @status');
    params.status = String(patch.status);
  }
  if (patch.totalBatches !== undefined) {
    fields.push('total_batches = @totalBatches');
    params.totalBatches = Number(patch.totalBatches || 0);
  }
  if (patch.doneBatches !== undefined) {
    fields.push('done_batches = @doneBatches');
    params.doneBatches = Number(patch.doneBatches || 0);
  }
  if (patch.errorBatches !== undefined) {
    fields.push('error_batches = @errorBatches');
    params.errorBatches = Number(patch.errorBatches || 0);
  }
  if (patch.resultSummary !== undefined) {
    fields.push('result_summary_json = @resultSummaryJson');
    params.resultSummaryJson = JSON.stringify(patch.resultSummary || {});
  }
  if (patch.errorMessage !== undefined) {
    fields.push('error_message = @errorMessage');
    params.errorMessage = patch.errorMessage ? String(patch.errorMessage) : null;
  }
  if (patch.startedAt !== undefined) {
    fields.push('started_at = @startedAt');
    params.startedAt = patch.startedAt;
  }
  if (patch.finishedAt !== undefined) {
    fields.push('finished_at = @finishedAt');
    params.finishedAt = patch.finishedAt;
  }

  if (!fields.length) return getById(db, jobId);

  const sql = `UPDATE knowledge_jobs SET ${fields.join(', ')} WHERE id = @jobId`;
  db.prepare(sql).run(params);
  return getById(db, jobId);
}

function getById(db, jobId) {
  const row = db.prepare(`
    SELECT *
    FROM knowledge_jobs
    WHERE id = ?
    LIMIT 1
  `).get(jobId);
  if (!row) return null;
  const synonymMeta = row.job_type === 'synonym_boundary'
    ? getSynonymMeta(db, row.id)
    : null;
  return {
    id: row.id,
    jobType: row.job_type,
    status: row.status,
    scope: safeJsonParse(row.scope_json, {}),
    batchSize: row.batch_size,
    totalBatches: row.total_batches,
    doneBatches: row.done_batches,
    errorBatches: row.error_batches,
    resultSummary: safeJsonParse(row.result_summary_json, null),
    errorMessage: row.error_message || null,
    engineVersion: row.engine_version,
    triggeredBy: row.triggered_by,
    synonymMeta,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  };
}

function list(db, limit = 20) {
  const rows = db.prepare(`
    SELECT *
    FROM knowledge_jobs
    ORDER BY id DESC
    LIMIT ?
  `).all(Math.max(1, Number(limit || 20)));
  return rows.map((row) => {
    const synonymMeta = row.job_type === 'synonym_boundary'
      ? getSynonymMeta(db, row.id)
      : null;
    return {
      id: row.id,
      jobType: row.job_type,
      status: row.status,
      scope: safeJsonParse(row.scope_json, {}),
      batchSize: row.batch_size,
      totalBatches: row.total_batches,
      doneBatches: row.done_batches,
      errorBatches: row.error_batches,
      resultSummary: safeJsonParse(row.result_summary_json, null),
      errorMessage: row.error_message || null,
      engineVersion: row.engine_version,
      triggeredBy: row.triggered_by,
      synonymMeta,
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at
    };
  });
}

function cancel(db, jobId) {
  const result = db.prepare(`
    UPDATE knowledge_jobs
    SET status = 'cancelled', finished_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND status IN ('queued', 'running')
  `).run(jobId);
  return result.changes > 0;
}

module.exports = {
  create,
  upsertSynonymMeta,
  getSynonymMeta,
  updateStatus,
  getById,
  list,
  cancel,
};
