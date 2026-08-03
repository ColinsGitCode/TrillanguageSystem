'use strict';

const crypto = require('node:crypto');
const { textbookError } = require('../../textbooks/textbookErrors');

const KINDS = new Set(['release', 'tts', 'sync']);
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

function nowIso() {
  return new Date().toISOString();
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function payloadHash(value) {
  return crypto.createHash('sha256').update(stableJson(value || {})).digest('hex');
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || '');
  } catch {
    return fallback;
  }
}

function mapOperation(row) {
  if (!row) return null;
  return { ...row, result: parseJson(row.result_json, {}) };
}

function getOperationByIdempotencyKey(db, idempotencyKey) {
  const key = String(idempotencyKey || '').trim();
  if (!key) return null;
  return mapOperation(db.prepare(`
    SELECT * FROM textbook_operations WHERE idempotency_key = ?
  `).get(key));
}

function appendEvent(db, operationId, event = {}, timestamp = nowIso()) {
  const sequence = Number(db.prepare(`
    SELECT COALESCE(MAX(sequence), 0) + 1 AS value
    FROM textbook_operation_events WHERE operation_id = ?
  `).get(Number(operationId)).value);
  const operation = db.prepare('SELECT status FROM textbook_operations WHERE id = ?').get(Number(operationId));
  if (!operation) throw textbookError('TEXTBOOK_OPERATION_NOT_FOUND', 404);
  const status = event.status || operation.status;
  db.prepare(`
    INSERT INTO textbook_operation_events(
      operation_id, sequence, event_type, step, status,
      public_summary, error_code, retryable, occurred_at_utc
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    Number(operationId),
    sequence,
    event.eventType || 'status',
    event.step || null,
    status,
    event.publicSummary || null,
    event.errorCode || null,
    event.retryable ? 1 : 0,
    timestamp
  );
  return sequence;
}

function createOperation(db, trackId, payload = {}) {
  const kind = String(payload.kind || '');
  const idempotencyKey = String(payload.idempotencyKey || '').trim();
  if (!KINDS.has(kind)) throw textbookError('TEXTBOOK_OPERATION_KIND_INVALID', 400);
  if (!idempotencyKey || idempotencyKey.length > 160) {
    throw textbookError('TEXTBOOK_IDEMPOTENCY_KEY_INVALID', 400);
  }
  const timestamp = nowIso();
  const commandPayload = payload.payload || {};
  const hash = payloadHash(commandPayload);
  return db.transaction(() => {
    const existing = getOperationByIdempotencyKey(db, idempotencyKey);
    if (existing) {
      const sameIdentity = Number(existing.track_id) === Number(trackId)
        && existing.kind === kind
        && String(existing.preview_revision || '') === String(payload.previewRevision || '')
        && existing.payload_hash === hash;
      if (!sameIdentity) throw textbookError('TEXTBOOK_IDEMPOTENCY_CONFLICT', 409);
      return existing;
    }
    const track = db.prepare(`
      SELECT id, COALESCE(pending_revision_id, current_revision_id) AS revision_id
      FROM textbook_tracks WHERE id = ?
    `).get(Number(trackId));
    if (!track) throw textbookError('TEXTBOOK_TRACK_NOT_FOUND', 404);
    if (!track.revision_id) throw textbookError('TEXTBOOK_REVISION_NOT_FOUND', 409);
    const active = db.prepare(`
      SELECT id FROM textbook_operations
      WHERE track_id = ? AND kind = ? AND status IN ('queued', 'running')
    `).get(Number(trackId), kind);
    if (active) throw textbookError('TEXTBOOK_OPERATION_ACTIVE', 409, { operationId: active.id });
    const operationId = Number(db.prepare(`
      INSERT INTO textbook_operations(
        track_id, track_revision_id, kind, status, idempotency_key, payload_hash,
        preview_revision, result_json, public_summary, created_at_utc, updated_at_utc
      ) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      Number(trackId),
      Number(track.revision_id),
      kind,
      idempotencyKey,
      hash,
      payload.previewRevision || null,
      JSON.stringify({ command: commandPayload, steps: {} }),
      '已加入后台队列',
      timestamp,
      timestamp
    ).lastInsertRowid);
    appendEvent(db, operationId, {
      eventType: 'created',
      status: 'queued',
      publicSummary: '后台任务已创建',
    }, timestamp);
    return getOperation(db, operationId);
  })();
}

function getOperation(db, operationId) {
  return mapOperation(db.prepare('SELECT * FROM textbook_operations WHERE id = ?').get(Number(operationId)));
}

function listEvents(db, operationId) {
  return db.prepare(`
    SELECT * FROM textbook_operation_events
    WHERE operation_id = ?
    ORDER BY sequence
  `).all(Number(operationId));
}

function claimOperation(db, operationId) {
  const timestamp = nowIso();
  return db.transaction(() => {
    const result = db.prepare(`
      UPDATE textbook_operations
      SET status = 'running', attempts = attempts + 1, started_at_utc = ?,
        finished_at_utc = NULL, error_code = NULL, updated_at_utc = ?
      WHERE id = ? AND status = 'queued'
    `).run(timestamp, timestamp, Number(operationId));
    if (!result.changes) return null;
    appendEvent(db, operationId, {
      eventType: 'claimed',
      status: 'running',
      publicSummary: '后台处理已开始',
    }, timestamp);
    return getOperation(db, operationId);
  })();
}

function updateStep(db, operationId, step, status, options = {}) {
  const timestamp = nowIso();
  return db.transaction(() => {
    const operation = getOperation(db, operationId);
    if (!operation) throw textbookError('TEXTBOOK_OPERATION_NOT_FOUND', 404);
    const result = operation.result || {};
    result.steps = {
      ...(result.steps || {}),
      [step]: {
        status,
        errorCode: options.errorCode || null,
        retryable: Boolean(options.retryable),
        summary: options.publicSummary || null,
        ...(Object.hasOwn(options, 'result') ? { result: options.result } : {}),
      },
    };
    db.prepare(`
      UPDATE textbook_operations
      SET current_step = ?, result_json = ?, public_summary = ?, updated_at_utc = ?
      WHERE id = ?
    `).run(step, JSON.stringify(result), options.publicSummary || operation.public_summary, timestamp, Number(operationId));
    appendEvent(db, operationId, {
      eventType: 'step',
      step,
      status,
      publicSummary: options.publicSummary,
      errorCode: options.errorCode,
      retryable: options.retryable,
    }, timestamp);
    return getOperation(db, operationId);
  })();
}

function finishOperation(db, operationId, status, options = {}) {
  if (!['succeeded', 'partially_failed', 'failed', 'cancelled'].includes(status)) {
    throw textbookError('TEXTBOOK_OPERATION_STATUS_INVALID', 400);
  }
  const timestamp = nowIso();
  return db.transaction(() => {
    const operation = getOperation(db, operationId);
    if (!operation) throw textbookError('TEXTBOOK_OPERATION_NOT_FOUND', 404);
    const result = { ...(operation.result || {}), ...(options.result || {}) };
    db.prepare(`
      UPDATE textbook_operations
      SET status = ?, result_json = ?, public_summary = ?, error_code = ?,
        finished_at_utc = ?, updated_at_utc = ?
      WHERE id = ?
    `).run(
      status,
      JSON.stringify(result),
      options.publicSummary || status,
      options.errorCode || null,
      TERMINAL.has(status) || status === 'partially_failed' ? timestamp : null,
      timestamp,
      Number(operationId)
    );
    appendEvent(db, operationId, {
      eventType: 'finished',
      status,
      publicSummary: options.publicSummary,
      errorCode: options.errorCode,
      retryable: status === 'failed' || status === 'partially_failed',
    }, timestamp);
    return getOperation(db, operationId);
  })();
}

function retryOperation(db, operationId) {
  const timestamp = nowIso();
  return db.transaction(() => {
    const operation = getOperation(db, operationId);
    if (!operation) throw textbookError('TEXTBOOK_OPERATION_NOT_FOUND', 404);
    if (!['failed', 'partially_failed', 'cancelled'].includes(operation.status)) {
      throw textbookError('TEXTBOOK_OPERATION_NOT_RETRYABLE', 409);
    }
    const result = { ...(operation.result || {}) };
    delete result.cancelRequested;
    delete result.cancelRequestedAtUtc;
    result.steps = Object.fromEntries(
      Object.entries(result.steps || {}).map(([step, value]) => [
        step,
        value?.status === 'succeeded'
          ? value
          : {
              ...value,
              status: 'queued',
              errorCode: null,
              retryable: false,
              summary: '等待继续',
            },
      ])
    );
    db.prepare(`
      UPDATE textbook_operations
      SET status = 'queued', error_code = NULL, finished_at_utc = NULL,
        current_step = NULL, result_json = ?,
        public_summary = '未完成步骤已重新加入队列', updated_at_utc = ?
      WHERE id = ?
    `).run(JSON.stringify(result), timestamp, Number(operationId));
    appendEvent(db, operationId, {
      eventType: 'retry',
      status: 'queued',
      publicSummary: '仅未完成步骤重新加入队列',
    }, timestamp);
    return getOperation(db, operationId);
  })();
}

function requestCancellation(db, operationId) {
  const timestamp = nowIso();
  return db.transaction(() => {
    const operation = getOperation(db, operationId);
    if (!operation) throw textbookError('TEXTBOOK_OPERATION_NOT_FOUND', 404);
    if (!['queued', 'running'].includes(operation.status)) {
      throw textbookError('TEXTBOOK_OPERATION_NOT_CANCELLABLE', 409);
    }
    const result = {
      ...(operation.result || {}),
      cancelRequested: true,
      cancelRequestedAtUtc: timestamp,
    };
    const queued = operation.status === 'queued';
    db.prepare(`
      UPDATE textbook_operations
      SET status = ?, result_json = ?, public_summary = ?,
        finished_at_utc = ?, updated_at_utc = ?
      WHERE id = ?
    `).run(
      queued ? 'cancelled' : 'running',
      JSON.stringify(result),
      queued ? '任务已取消，尚未开始处理' : '正在停止当前步骤',
      queued ? timestamp : null,
      timestamp,
      Number(operationId)
    );
    appendEvent(db, operationId, {
      eventType: queued ? 'cancelled' : 'cancel_requested',
      status: queued ? 'cancelled' : 'running',
      publicSummary: queued ? '任务已取消，尚未开始处理' : '已请求停止当前步骤',
      retryable: true,
    }, timestamp);
    return getOperation(db, operationId);
  })();
}

function isCancellationRequested(db, operationId) {
  return Boolean(getOperation(db, operationId)?.result?.cancelRequested);
}

function recoverStale(db) {
  const timestamp = nowIso();
  return db.transaction(() => {
    const stale = db.prepare("SELECT * FROM textbook_operations WHERE status = 'running'").all().map(mapOperation);
    for (const row of stale) {
      const cancelled = Boolean(row.result?.cancelRequested);
      db.prepare(`
        UPDATE textbook_operations
        SET status = ?, public_summary = ?, finished_at_utc = ?, updated_at_utc = ?
        WHERE id = ?
      `).run(
        cancelled ? 'cancelled' : 'queued',
        cancelled ? '停止请求已在服务重启后完成' : '服务重启后恢复',
        cancelled ? timestamp : null,
        timestamp,
        row.id
      );
      appendEvent(db, row.id, {
        eventType: cancelled ? 'cancelled' : 'restart-recovery',
        status: cancelled ? 'cancelled' : 'queued',
        publicSummary: cancelled ? '停止请求已在服务重启后完成' : '服务重启后恢复',
        retryable: cancelled,
      }, timestamp);
    }
    return stale.length;
  })();
}

function listQueued(db) {
  return db.prepare(`
    SELECT id FROM textbook_operations WHERE status = 'queued' ORDER BY id
  `).all().map((row) => Number(row.id));
}

function listRecent(db, limit = 30) {
  const safeLimit = Math.min(Math.max(Number(limit || 30), 1), 100);
  return db.prepare(`
    SELECT operation.*, track.title AS track_title, track.track_number,
      course.title AS course_title
    FROM textbook_operations operation
    JOIN textbook_tracks track ON track.id = operation.track_id
    JOIN textbook_courses course ON course.id = track.course_id
    ORDER BY operation.id DESC
    LIMIT ?
  `).all(safeLimit).map(mapOperation);
}

module.exports = {
  appendEvent,
  claimOperation,
  createOperation,
  finishOperation,
  getOperation,
  getOperationByIdempotencyKey,
  isCancellationRequested,
  listEvents,
  listQueued,
  listRecent,
  payloadHash,
  recoverStale,
  requestCancellation,
  retryOperation,
  updateStep,
};
