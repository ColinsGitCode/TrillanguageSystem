'use strict';

// knowledge_issues domain extracted from databaseService.js. Owns the
// replace-by-job (transactional) write path plus the filtered list read.
// Functions take `db` first.

const crypto = require('crypto');
const { safeJsonParse } = require('./helpers');

function replace(db, issues = [], jobId = null) {
  const clearStmt = db.prepare(`
    DELETE FROM knowledge_issues
    WHERE last_job_id = ?
  `);
  const insertStmt = db.prepare(`
    INSERT INTO knowledge_issues (
      issue_type, severity, generation_id, phrase, fingerprint,
      detail_json, resolved, last_job_id, created_at, updated_at
    ) VALUES (
      @issueType, @severity, @generationId, @phrase, @fingerprint,
      @detailJson, 0, @lastJobId, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT(issue_type, fingerprint) DO UPDATE SET
      severity = excluded.severity,
      generation_id = excluded.generation_id,
      phrase = excluded.phrase,
      detail_json = excluded.detail_json,
      resolved = 0,
      last_job_id = excluded.last_job_id,
      updated_at = CURRENT_TIMESTAMP
  `);

  const transaction = db.transaction((rows) => {
    if (jobId) clearStmt.run(Number(jobId));
    let count = 0;
    for (const item of rows) {
      insertStmt.run({
        issueType: String(item.issueType || 'unknown'),
        severity: String(item.severity || 'medium'),
        generationId: item.generationId ? Number(item.generationId) : null,
        phrase: item.phrase || null,
        fingerprint: String(item.fingerprint || crypto.randomBytes(8).toString('hex')),
        detailJson: JSON.stringify(item.detail || {}),
        lastJobId: jobId ? Number(jobId) : null
      });
      count += 1;
    }
    return count;
  });

  return transaction(Array.isArray(issues) ? issues : []);
}

function list(db, { issueType, severity, resolved, limit = 100 } = {}) {
  const conditions = ['1=1'];
  const params = { limit: Math.max(1, Number(limit || 100)) };
  if (issueType) {
    conditions.push('issue_type = @issueType');
    params.issueType = String(issueType);
  }
  if (severity) {
    conditions.push('severity = @severity');
    params.severity = String(severity);
  }
  if (resolved !== undefined) {
    conditions.push('resolved = @resolved');
    params.resolved = resolved ? 1 : 0;
  }

  const sql = `
    SELECT *
    FROM knowledge_issues
    WHERE ${conditions.join(' AND ')}
    ORDER BY updated_at DESC
    LIMIT @limit
  `;
  const rows = db.prepare(sql).all(params);
  return rows.map((row) => ({
    id: row.id,
    issueType: row.issue_type,
    severity: row.severity,
    generationId: row.generation_id,
    phrase: row.phrase,
    fingerprint: row.fingerprint,
    detail: safeJsonParse(row.detail_json, {}),
    resolved: Boolean(row.resolved),
    lastJobId: row.last_job_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

module.exports = {
  replace,
  list,
};
