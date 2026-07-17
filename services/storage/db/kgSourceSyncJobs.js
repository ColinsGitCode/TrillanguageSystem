'use strict';

const crypto = require('node:crypto');

const SOURCE_KINDS = new Set(['study_item', 'textbook_expression']);
const OPERATIONS = new Set(['active', 'absent']);
const LANGUAGES = new Set(['', 'en', 'ja']);

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeDescriptor(input = {}) {
  const operation = String(input.operation || 'active').trim();
  const sourceKind = String(input.sourceKind || '').trim();
  const sourceRefId = Number(input.sourceRefId);
  const sourceRevision = Number(input.sourceRevision);
  const language = String(input.language || '').trim();
  const sourceContentHash = String(input.sourceContentHash || '').trim().toLowerCase();
  if (!OPERATIONS.has(operation)) throw new TypeError(`Unsupported KG sync operation: ${operation}`);
  if (!SOURCE_KINDS.has(sourceKind)) throw new TypeError(`Unsupported KG sync source kind: ${sourceKind}`);
  if (!Number.isSafeInteger(sourceRefId) || sourceRefId <= 0) throw new TypeError('sourceRefId must be a positive integer');
  if (!Number.isSafeInteger(sourceRevision) || sourceRevision <= 0) throw new TypeError('sourceRevision must be a positive integer');
  if (!LANGUAGES.has(language)) throw new TypeError(`Unsupported KG sync language: ${language}`);
  if (!/^[a-f0-9]{64}$/u.test(sourceContentHash)) throw new TypeError('sourceContentHash must be a SHA-256 digest');
  if (sourceKind === 'study_item' && language) throw new TypeError('study_item KG sync jobs must use an empty language');
  if (sourceKind === 'textbook_expression' && !language) {
    throw new TypeError('textbook_expression KG sync jobs require en or ja');
  }
  return { operation, sourceKind, sourceRefId, sourceRevision, language, sourceContentHash };
}

function jobDto(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    operation: row.operation,
    sourceKind: row.source_kind,
    sourceRefId: Number(row.source_ref_id),
    sourceRevision: Number(row.source_revision),
    language: row.language,
    sourceContentHash: row.source_content_hash,
    status: row.status,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    retryAfterTs: row.retry_after_ts == null ? null : Number(row.retry_after_ts),
    errorCode: row.error_code,
    errorMessage: row.error_message,
    planHash: row.plan_hash,
    result: parseJson(row.result_json, {}),
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
    startedAtUtc: row.started_at_utc,
    finishedAtUtc: row.finished_at_utc,
  };
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_error) {
    return fallback;
  }
}

function enqueueJob(db, input, options = {}) {
  const descriptor = normalizeDescriptor(input);
  const now = options.now || new Date().toISOString();
  const maxAttempts = Math.min(Math.max(Number(options.maxAttempts || 3), 1), 10);
  const planHash = options.planHash || null;
  const result = db.prepare(`
    INSERT OR IGNORE INTO kg_source_sync_jobs(
      operation, source_kind, source_ref_id, source_revision, language,
      source_content_hash, status, attempts, max_attempts, plan_hash,
      result_json, created_at_utc, updated_at_utc
    ) VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, '{}', ?, ?)
  `).run(
    descriptor.operation, descriptor.sourceKind, descriptor.sourceRefId,
    descriptor.sourceRevision, descriptor.language, descriptor.sourceContentHash,
    maxAttempts, planHash, now, now
  );
  let row = db.prepare(`
    SELECT * FROM kg_source_sync_jobs
    WHERE operation = ? AND source_kind = ? AND source_ref_id = ?
      AND source_revision = ? AND language = ? AND source_content_hash = ?
  `).get(
    descriptor.operation, descriptor.sourceKind, descriptor.sourceRefId,
    descriptor.sourceRevision, descriptor.language, descriptor.sourceContentHash
  );
  let requeued = false;
  if (result.changes !== 1 && options.requeueTerminal === true && ['succeeded', 'superseded'].includes(row?.status)) {
    requeued = db.prepare(`
      UPDATE kg_source_sync_jobs
      SET status='queued', attempts=0, retry_after_ts=NULL, error_code=NULL,
          error_message=NULL, result_json='{}', started_at_utc=NULL,
          finished_at_utc=NULL, updated_at_utc=?
      WHERE id=? AND status IN ('succeeded', 'superseded')
    `).run(now, row.id).changes === 1;
    row = db.prepare('SELECT * FROM kg_source_sync_jobs WHERE id = ?').get(row.id);
  }
  return { inserted: result.changes === 1, requeued, job: jobDto(row) };
}

function enqueueJobs(db, descriptors, options = {}) {
  const transaction = db.transaction(() => {
    const jobs = [];
    let inserted = 0;
    let requeued = 0;
    for (const descriptor of descriptors || []) {
      const result = enqueueJob(db, descriptor, options);
      jobs.push(result.job);
      inserted += result.inserted ? 1 : 0;
      requeued += result.requeued ? 1 : 0;
    }
    return { inserted, requeued, existing: jobs.length - inserted - requeued, jobs };
  });
  return transaction();
}

function claimNextJob(db, options = {}) {
  const nowMs = Number(options.nowMs ?? Date.now());
  const now = options.now || new Date(nowMs).toISOString();
  const transaction = db.transaction(() => {
    const row = db.prepare(`
      SELECT * FROM kg_source_sync_jobs
      WHERE status = 'queued' AND (retry_after_ts IS NULL OR retry_after_ts <= ?)
      ORDER BY id
      LIMIT 1
    `).get(nowMs);
    if (!row) return null;
    const updated = db.prepare(`
      UPDATE kg_source_sync_jobs
      SET status = 'running', attempts = attempts + 1, retry_after_ts = NULL,
          error_code = NULL, error_message = NULL, started_at_utc = ?,
          finished_at_utc = NULL, updated_at_utc = ?
      WHERE id = ? AND status = 'queued'
    `).run(now, now, row.id);
    if (updated.changes !== 1) return null;
    return jobDto(db.prepare('SELECT * FROM kg_source_sync_jobs WHERE id = ?').get(row.id));
  });
  return transaction();
}

function finishJob(db, id, status, result = {}, options = {}) {
  if (!['succeeded', 'superseded'].includes(status)) throw new TypeError(`Unsupported terminal KG sync status: ${status}`);
  const now = options.now || new Date().toISOString();
  const updated = db.prepare(`
    UPDATE kg_source_sync_jobs
    SET status = ?, result_json = ?, retry_after_ts = NULL, error_code = NULL,
        error_message = NULL, finished_at_utc = ?, updated_at_utc = ?
    WHERE id = ? AND status = 'running'
  `).run(status, stableJson(result || {}), now, now, Number(id));
  return updated.changes === 1;
}

function failJob(db, id, error, options = {}) {
  const row = db.prepare('SELECT * FROM kg_source_sync_jobs WHERE id = ?').get(Number(id));
  if (!row || row.status !== 'running') return null;
  const now = options.now || new Date().toISOString();
  const retryable = options.retryable !== false && Number(row.attempts) < Number(row.max_attempts);
  const retryAfterTs = retryable ? Number(options.retryAfterTs || Date.now() + 5000) : null;
  const status = retryable ? 'queued' : 'failed';
  db.prepare(`
    UPDATE kg_source_sync_jobs
    SET status = ?, retry_after_ts = ?, error_code = ?, error_message = ?,
        result_json = ?, finished_at_utc = ?, updated_at_utc = ?
    WHERE id = ? AND status = 'running'
  `).run(
    status, retryAfterTs, String(error?.code || 'KG_SOURCE_SYNC_FAILED'),
    String(error?.message || error || 'KG source sync failed').slice(0, 2000),
    stableJson({ retryable, errorHash: sha256(String(error?.stack || error || 'unknown')) }),
    retryable ? null : now, now, Number(id)
  );
  return jobDto(db.prepare('SELECT * FROM kg_source_sync_jobs WHERE id = ?').get(Number(id)));
}

function recoverStaleRunningJobs(db, options = {}) {
  const nowMs = Number(options.nowMs ?? Date.now());
  const staleBefore = options.staleBefore || new Date(nowMs - Number(options.staleAfterMs || 300_000)).toISOString();
  const now = options.now || new Date(nowMs).toISOString();
  return db.prepare(`
    UPDATE kg_source_sync_jobs
    SET status = 'queued', retry_after_ts = ?, error_code = 'KG_SOURCE_SYNC_RECOVERED',
        error_message = 'Recovered stale running job after process restart',
        started_at_utc = NULL, updated_at_utc = ?
    WHERE status = 'running' AND started_at_utc < ?
  `).run(nowMs, now, staleBefore).changes;
}

function nextRetryTs(db) {
  const row = db.prepare(`
    SELECT MIN(retry_after_ts) AS retry_after_ts
    FROM kg_source_sync_jobs WHERE status = 'queued' AND retry_after_ts IS NOT NULL
  `).get();
  return row?.retry_after_ts == null ? null : Number(row.retry_after_ts);
}

function summary(db) {
  const counts = Object.fromEntries(db.prepare(`
    SELECT status, COUNT(*) AS count FROM kg_source_sync_jobs GROUP BY status ORDER BY status
  `).all().map((row) => [row.status, Number(row.count)]));
  return {
    queued: counts.queued || 0,
    running: counts.running || 0,
    succeeded: counts.succeeded || 0,
    failed: counts.failed || 0,
    superseded: counts.superseded || 0,
    total: Object.values(counts).reduce((total, count) => total + count, 0),
  };
}

function listJobs(db, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 100), 1), 1000);
  return db.prepare('SELECT * FROM kg_source_sync_jobs ORDER BY id DESC LIMIT ?').all(limit).map(jobDto);
}

module.exports = {
  claimNextJob,
  enqueueJob,
  enqueueJobs,
  failJob,
  finishJob,
  jobDto,
  listJobs,
  nextRetryTs,
  normalizeDescriptor,
  recoverStaleRunningJobs,
  stableJson,
  summary,
};
