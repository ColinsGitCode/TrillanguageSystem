'use strict';

// Generation-jobs domain extracted from databaseService.js as the first
// slice of the planned big-file domain split. Functions take `db` as their
// first argument (the better-sqlite3 connection); databaseService.js still
// exposes thin wrapper methods so external callers don't change.

const { safeJsonParse } = require('./helpers');

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    jobType: row.job_type || 'trilingual',
    phraseRaw: row.phrase_raw || row.phrase_normalized,
    phraseNormalized: row.phrase_normalized,
    sourceMode: row.source_mode || null,
    targetFolder: row.target_folder || '',
    provider: row.llm_provider || 'gemini',
    llmModel: row.llm_model || '',
    enableCompare: Number(row.enable_compare || 0) === 1,
    status: row.status,
    attempts: Number(row.attempts || 0),
    maxRetries: Number(row.max_retries || 0),
    errorMessage: row.error_message || '',
    retryAfterTs: Number(row.retry_after_ts || 0) || null,
    sourceContext: safeJsonParse(row.source_context_json, {}),
    createdByClient: row.created_by_client || '',
    resultGenerationId: row.result_generation_id ? Number(row.result_generation_id) : null,
    resultFolder: row.result_folder || '',
    resultBaseFilename: row.result_base_filename || '',
    requestPayload: safeJsonParse(row.request_payload_json, {}),
    resultSummary: safeJsonParse(row.result_summary_json, null),
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    clearedAt: row.cleared_at
  };
}

function mapEventRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0),
    jobId: Number(row.job_id || 0),
    eventType: String(row.event_type || '').trim() || 'unknown',
    payload: safeJsonParse(row.payload_json, {}),
    createdAt: row.created_at || ''
  };
}

function create(db, payload = {}) {
  const stmt = db.prepare(`
    INSERT INTO generation_jobs (
      job_type, phrase_raw, phrase_normalized, source_mode, target_folder,
      llm_provider, llm_model, enable_compare, status, attempts, max_retries,
      source_context_json, created_by_client, request_payload_json
    ) VALUES (
      @jobType, @phraseRaw, @phraseNormalized, @sourceMode, @targetFolder,
      @provider, @llmModel, @enableCompare, 'queued', 0, @maxRetries,
      @sourceContextJson, @createdByClient, @requestPayloadJson
    )
  `);

  const result = stmt.run({
    jobType: String(payload.jobType || 'trilingual').trim() || 'trilingual',
    phraseRaw: String(payload.phraseRaw || payload.phraseNormalized || '').trim(),
    phraseNormalized: String(payload.phraseNormalized || '').trim(),
    sourceMode: payload.sourceMode ? String(payload.sourceMode).trim() : null,
    targetFolder: payload.targetFolder ? String(payload.targetFolder).trim() : null,
    provider: String(payload.provider || 'gemini').trim() || 'gemini',
    llmModel: payload.llmModel ? String(payload.llmModel).trim() : null,
    enableCompare: payload.enableCompare ? 1 : 0,
    maxRetries: Math.max(0, Number(payload.maxRetries == null ? 2 : payload.maxRetries)),
    sourceContextJson: JSON.stringify(payload.sourceContext || {}),
    createdByClient: payload.createdByClient ? String(payload.createdByClient) : null,
    requestPayloadJson: JSON.stringify(payload.requestPayload || {})
  });

  return getById(db, result.lastInsertRowid);
}

function appendEvent(db, jobId, eventType, payload = {}) {
  const numericId = Number(jobId);
  if (!numericId) return null;
  db.prepare(`
    INSERT INTO generation_job_events (job_id, event_type, payload_json)
    VALUES (@jobId, @eventType, @payloadJson)
  `).run({
    jobId: numericId,
    eventType: String(eventType || 'unknown').trim() || 'unknown',
    payloadJson: JSON.stringify(payload || {})
  });
  return true;
}

function listEvents(db, { jobId = 0, limit = 20 } = {}) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit || 20)));
  const numericJobId = Number(jobId || 0);
  const rows = numericJobId > 0
    ? db.prepare(`
        SELECT *
        FROM generation_job_events
        WHERE job_id = ?
        ORDER BY id ASC
        LIMIT ?
      `).all(numericJobId, safeLimit)
    : db.prepare(`
        SELECT *
        FROM generation_job_events
        ORDER BY id DESC
        LIMIT ?
      `).all(safeLimit).reverse();
  return rows.map((row) => mapEventRow(row));
}

function getById(db, jobId) {
  const row = db.prepare(`
    SELECT *
    FROM generation_jobs
    WHERE id = ?
    LIMIT 1
  `).get(Number(jobId || 0));
  return mapRow(row);
}

function list(db, limit = 30) {
  const rows = db.prepare(`
    SELECT *
    FROM generation_jobs
    WHERE cleared_at IS NULL
    ORDER BY id DESC
    LIMIT ?
  `).all(Math.max(1, Number(limit || 30)));
  return rows.map((row) => mapRow(row));
}

function getSummary(db) {
  const counts = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
    FROM generation_jobs
    WHERE cleared_at IS NULL
  `).get();
  const activeRow = db.prepare(`
    SELECT *
    FROM generation_jobs
    WHERE cleared_at IS NULL
      AND status = 'running'
    ORDER BY started_at DESC, id DESC
    LIMIT 1
  `).get();
  return {
    total: Number(counts.total || 0),
    queued: Number(counts.queued || 0),
    running: Number(counts.running || 0),
    success: Number(counts.success || 0),
    failed: Number(counts.failed || 0),
    cancelled: Number(counts.cancelled || 0),
    activeJob: mapRow(activeRow)
  };
}

function hasActiveDuplicate(db, phraseNormalized, jobType = 'trilingual') {
  const row = db.prepare(`
    SELECT id
    FROM generation_jobs
    WHERE cleared_at IS NULL
      AND status IN ('queued', 'running', 'failed')
      AND phrase_normalized = ?
      AND job_type = ?
    LIMIT 1
  `).get(String(phraseNormalized || '').trim(), String(jobType || 'trilingual').trim());
  return Boolean(row);
}

function update(db, jobId, patch = {}) {
  const fields = [];
  const params = { jobId: Number(jobId || 0) };

  const fieldMap = [
    ['status', 'status'],
    ['attempts', 'attempts'],
    ['maxRetries', 'max_retries'],
    ['errorMessage', 'error_message'],
    ['retryAfterTs', 'retry_after_ts'],
    ['llmModel', 'llm_model'],
    ['sourceMode', 'source_mode'],
    ['targetFolder', 'target_folder'],
    ['resultGenerationId', 'result_generation_id'],
    ['resultFolder', 'result_folder'],
    ['resultBaseFilename', 'result_base_filename'],
    ['createdByClient', 'created_by_client'],
    ['startedAt', 'started_at'],
    ['finishedAt', 'finished_at'],
    ['clearedAt', 'cleared_at']
  ];

  fieldMap.forEach(([inputKey, column]) => {
    if (patch[inputKey] === undefined) return;
    fields.push(`${column} = @${inputKey}`);
    params[inputKey] = patch[inputKey];
  });

  if (patch.sourceContext !== undefined) {
    fields.push('source_context_json = @sourceContextJson');
    params.sourceContextJson = JSON.stringify(patch.sourceContext || {});
  }
  if (patch.requestPayload !== undefined) {
    fields.push('request_payload_json = @requestPayloadJson');
    params.requestPayloadJson = JSON.stringify(patch.requestPayload || {});
  }
  if (patch.resultSummary !== undefined) {
    fields.push('result_summary_json = @resultSummaryJson');
    params.resultSummaryJson = JSON.stringify(patch.resultSummary || {});
  }

  if (!fields.length) return getById(db, jobId);

  db.prepare(`UPDATE generation_jobs SET ${fields.join(', ')} WHERE id = @jobId`).run(params);
  return getById(db, jobId);
}

function recoverStaleRunning(db) {
  const affected = db.prepare(`
    UPDATE generation_jobs
    SET status = 'queued',
        error_message = '服务重启后恢复：原执行中任务已重新排队。',
        retry_after_ts = NULL,
        started_at = NULL,
        finished_at = NULL
    WHERE cleared_at IS NULL
      AND status = 'running'
  `).run();
  return Number(affected.changes || 0);
}

function takeNextQueued(db) {
  const tx = db.transaction(() => {
    const row = db.prepare(`
      SELECT *
      FROM generation_jobs
      WHERE cleared_at IS NULL
        AND status = 'queued'
        AND (retry_after_ts IS NULL OR retry_after_ts <= CAST(strftime('%s','now') AS INTEGER) * 1000)
      ORDER BY id ASC
      LIMIT 1
    `).get();
    if (!row) return null;

    const nextAttempts = Number(row.attempts || 0) + 1;
    db.prepare(`
      UPDATE generation_jobs
      SET status = 'running',
          attempts = ?,
          retry_after_ts = NULL,
          started_at = CURRENT_TIMESTAMP,
          finished_at = NULL,
          error_message = NULL
      WHERE id = ?
    `).run(nextAttempts, row.id);

    return db.prepare(`SELECT * FROM generation_jobs WHERE id = ? LIMIT 1`).get(row.id);
  });

  return mapRow(tx());
}

function retry(db, jobId) {
  const result = db.prepare(`
    UPDATE generation_jobs
    SET status = 'queued',
        error_message = NULL,
        retry_after_ts = NULL,
        started_at = NULL,
        finished_at = NULL,
        cleared_at = NULL
    WHERE id = ?
      AND status = 'failed'
  `).run(Number(jobId || 0));
  return result.changes > 0 ? getById(db, jobId) : null;
}

function clearCompleted(db) {
  const result = db.prepare(`
    UPDATE generation_jobs
    SET cleared_at = CURRENT_TIMESTAMP
    WHERE cleared_at IS NULL
      AND status IN ('success', 'cancelled')
  `).run();
  return Number(result.changes || 0);
}

function cancel(db, jobId) {
  const result = db.prepare(`
    UPDATE generation_jobs
    SET status = 'cancelled',
        retry_after_ts = NULL,
        finished_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND cleared_at IS NULL
      AND status = 'queued'
  `).run(Number(jobId || 0));
  return result.changes > 0 ? getById(db, jobId) : null;
}

function getNextQueuedRetryTs(db) {
  const row = db.prepare(`
    SELECT MIN(retry_after_ts) AS retry_after_ts
    FROM generation_jobs
    WHERE cleared_at IS NULL
      AND status = 'queued'
      AND retry_after_ts IS NOT NULL
      AND retry_after_ts > CAST(strftime('%s','now') AS INTEGER) * 1000
  `).get();
  const ts = Number(row?.retry_after_ts || 0);
  return Number.isFinite(ts) && ts > 0 ? ts : null;
}

module.exports = {
  mapRow,
  mapEventRow,
  create,
  appendEvent,
  listEvents,
  getById,
  list,
  getSummary,
  hasActiveDuplicate,
  update,
  recoverStaleRunning,
  takeNextQueued,
  retry,
  clearCompleted,
  cancel,
  getNextQueuedRetryTs,
};
