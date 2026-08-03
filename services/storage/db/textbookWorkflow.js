'use strict';

const crypto = require('node:crypto');
const { textbookError } = require('../../textbooks/textbookErrors');

const REVIEW_STATES = new Set(['pending', 'needs_attention', 'confirmed']);
const EDITABLE_FIELDS = Object.freeze({
  officialEnText: 'official_en_text',
  officialJaText: 'official_ja_text',
  zhCueText: 'zh_cue_text',
  jaRubyHtml: 'ja_ruby_html',
  phraseAnalysisJson: 'phrase_analysis_json',
  grammarPointsJson: 'grammar_points_json',
  editorNote: 'editor_note',
});

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

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function expressionHashes(row) {
  return {
    en: sha256(stableJson({
      kind: 'textbook_en',
      official: row.official_en_text,
      cue: row.zh_cue_text,
    })),
    ja: sha256(stableJson({
      kind: 'textbook_ja',
      official: row.official_ja_text,
      ruby: row.ja_ruby_html,
      cue: row.zh_cue_text,
    })),
  };
}

function applyAffectedExpressionHashes(row, changedColumns) {
  const hashes = expressionHashes(row);
  const changesEnglish = changedColumns.has('official_en_text') || changedColumns.has('zh_cue_text');
  const changesJapanese = changedColumns.has('official_ja_text')
    || changedColumns.has('ja_ruby_html')
    || changedColumns.has('zh_cue_text');
  return {
    en: changesEnglish ? hashes.en : row.en_unit_hash,
    ja: changesJapanese ? hashes.ja : row.ja_unit_hash,
  };
}

function reviewStateForConfidence(confidenceJson) {
  let confidence = {};
  try {
    confidence = JSON.parse(confidenceJson || '{}');
  } catch {
    return { status: 'needs_attention', reasonCode: 'invalid-confidence' };
  }
  const values = Object.values(confidence).map(Number).filter(Number.isFinite);
  return values.length && Math.min(...values) < 0.85
    ? { status: 'needs_attention', reasonCode: 'low-confidence' }
    : { status: 'pending', reasonCode: null };
}

function ensureReviewStates(db, trackId, revisionId, timestamp = nowIso()) {
  const rows = db.prepare(`
    SELECT er.id AS expression_revision_id, er.expression_id, er.confidence_json
    FROM textbook_expression_revisions er
    WHERE er.revision_id = ?
  `).all(Number(revisionId));
  const insert = db.prepare(`
    INSERT INTO textbook_expression_review_states(
      track_id, track_revision_id, expression_id, expression_revision_id,
      status, reason_code, created_at_utc, updated_at_utc
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(track_revision_id, expression_id) DO NOTHING
  `);
  for (const row of rows) {
    const initial = reviewStateForConfidence(row.confidence_json);
    insert.run(
      Number(trackId),
      Number(revisionId),
      Number(row.expression_id),
      Number(row.expression_revision_id),
      initial.status,
      initial.reasonCode,
      timestamp,
      timestamp
    );
  }
}

function listReviewStates(db, revisionId) {
  return db.prepare(`
    SELECT rs.*, e.expression_key, er.display_ordinal
    FROM textbook_expression_review_states rs
    JOIN textbook_expressions e ON e.id = rs.expression_id
    JOIN textbook_expression_revisions er ON er.id = rs.expression_revision_id
    WHERE rs.track_revision_id = ?
    ORDER BY er.display_ordinal
  `).all(Number(revisionId));
}

function getRevision(db, revisionId) {
  const revision = db.prepare(`
    SELECT r.*, t.title AS track_title, t.status AS track_status
    FROM textbook_track_revisions r
    JOIN textbook_tracks t ON t.id = r.track_id
    WHERE r.id = ?
  `).get(Number(revisionId));
  if (!revision) return null;
  ensureReviewStates(db, revision.track_id, revision.id);
  const expressions = db.prepare(`
    SELECT er.*, e.expression_key, e.lifecycle
    FROM textbook_expression_revisions er
    JOIN textbook_expressions e ON e.id = er.expression_id
    WHERE er.revision_id = ?
    ORDER BY er.display_ordinal
  `).all(Number(revisionId));
  return {
    ...revision,
    expressions,
    review: reviewSummary(db, revisionId),
  };
}

function reviewSummary(db, revisionId) {
  const rows = listReviewStates(db, revisionId);
  return {
    total: rows.length,
    confirmed: rows.filter((row) => row.status === 'confirmed').length,
    needsAttention: rows.filter((row) => row.status === 'needs_attention').length,
    pending: rows.filter((row) => row.status === 'pending').length,
    rows,
  };
}

function listPendingTrackReviews(db, limit = 10) {
  const normalizedLimit = Math.min(Math.max(Number(limit) || 10, 1), 30);
  return db.prepare(`
    SELECT
      t.id AS track_id,
      t.title AS track_title,
      t.track_number,
      t.status AS track_status,
      r.id AS revision_id,
      r.expression_count,
      COUNT(rs.id) AS review_total,
      SUM(CASE WHEN rs.status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
      SUM(CASE WHEN rs.status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN rs.status = 'needs_attention' THEN 1 ELSE 0 END) AS needs_attention,
      MAX(COALESCE(rs.updated_at_utc, t.updated_at_utc)) AS updated_at_utc
    FROM textbook_tracks t
    JOIN textbook_track_revisions r
      ON r.id = COALESCE(t.pending_revision_id, t.current_revision_id)
    LEFT JOIN textbook_expression_review_states rs
      ON rs.track_revision_id = r.id
    WHERE t.status IN ('draft', 'verified')
      AND NOT EXISTS (
        SELECT 1
        FROM textbook_operations op
        WHERE op.track_id = t.id
          AND op.kind = 'release'
          AND op.status IN ('queued', 'running', 'partially_failed', 'failed')
      )
    GROUP BY t.id, r.id
    HAVING t.status = 'verified'
      OR SUM(CASE WHEN rs.status IN ('pending', 'needs_attention') THEN 1 ELSE 0 END) > 0
      OR (COUNT(rs.id) = 0 AND r.expression_count > 0)
    ORDER BY updated_at_utc DESC, t.id DESC
    LIMIT ?
  `).all(normalizedLimit);
}

function updateReviewStates(db, revisionId, payload = {}) {
  const updates = Array.isArray(payload.updates) ? payload.updates : [];
  if (!updates.length || updates.length > 100) {
    throw textbookError('TEXTBOOK_REVIEW_BATCH_INVALID', 400);
  }
  const expressionIds = updates.map((update) => Number(update.expressionId || 0));
  if (expressionIds.some((id) => !id) || new Set(expressionIds).size !== expressionIds.length) {
    throw textbookError('TEXTBOOK_REVIEW_BATCH_INVALID', 400);
  }
  for (const update of updates) {
    if (!REVIEW_STATES.has(String(update.status || ''))) {
      throw textbookError('TEXTBOOK_REVIEW_STATUS_INVALID', 400);
    }
  }
  const timestamp = nowIso();
  return db.transaction(() => {
    const revision = db.prepare(`
      SELECT id, track_id, status FROM textbook_track_revisions WHERE id = ?
    `).get(Number(revisionId));
    if (!revision) throw textbookError('TEXTBOOK_REVISION_NOT_FOUND', 404);
    if (revision.status !== 'draft') throw textbookError('TEXTBOOK_REVIEW_REVISION_LOCKED', 409);
    ensureReviewStates(db, revision.track_id, revision.id, timestamp);
    const readCurrent = db.prepare(`
      SELECT * FROM textbook_expression_review_states
      WHERE track_revision_id = ? AND expression_id = ?
    `);
    const currentRows = updates.map((update) => {
      const current = readCurrent.get(Number(revisionId), Number(update.expressionId));
      if (!current) throw textbookError('TEXTBOOK_EXPRESSION_NOT_FOUND', 404);
      if (update.expressionRevisionId !== undefined
        && Number(update.expressionRevisionId) !== Number(current.expression_revision_id)) {
        throw textbookError('TEXTBOOK_REVISION_CONFLICT', 409);
      }
      return current;
    });
    const updateRow = db.prepare(`
      UPDATE textbook_expression_review_states
      SET status = ?, reason_code = ?, reviewer = ?, confirmed_at_utc = ?,
        revision = revision + 1, updated_at_utc = ?
      WHERE id = ?
    `);
    const readUpdated = db.prepare('SELECT * FROM textbook_expression_review_states WHERE id = ?');
    return updates.map((update, index) => {
      const current = currentRows[index];
      const status = String(update.status);
      const reviewer = status === 'confirmed' ? String(update.reviewer || 'local-user') : null;
      const confirmedAt = status === 'confirmed' ? timestamp : null;
      updateRow.run(
        status,
        update.reasonCode || null,
        reviewer,
        confirmedAt,
        timestamp,
        current.id
      );
      return readUpdated.get(current.id);
    });
  })();
}

function updateReviewState(db, revisionId, expressionId, payload = {}) {
  return updateReviewStates(db, revisionId, {
    updates: [{ ...payload, expressionId }],
  })[0];
}

function normalizePatch(changes = {}) {
  const patch = {};
  for (const [publicName, columnName] of Object.entries(EDITABLE_FIELDS)) {
    if (Object.hasOwn(changes, publicName)) patch[columnName] = changes[publicName];
  }
  return patch;
}

function copyOnWriteRevision(db, revisionId, payload = {}) {
  const timestamp = nowIso();
  return db.transaction(() => {
    const base = db.prepare(`
      SELECT r.*, t.pending_revision_id, t.current_revision_id, t.status AS track_status
      FROM textbook_track_revisions r
      JOIN textbook_tracks t ON t.id = r.track_id
      WHERE r.id = ?
    `).get(Number(revisionId));
    if (!base) throw textbookError('TEXTBOOK_REVISION_NOT_FOUND', 404);
    const expectedId = Number(payload.expectedRevisionId || revisionId);
    const activeRevisionId = Number(base.pending_revision_id || base.current_revision_id || 0);
    if (expectedId !== Number(base.id) || activeRevisionId !== Number(base.id)) {
      throw textbookError('TEXTBOOK_REVISION_CONFLICT', 409, {
        expectedRevisionId: expectedId,
        actualRevisionId: activeRevisionId,
      });
    }
    const expressionId = Number(payload.expressionId || 0);
    const patch = normalizePatch(payload.changes);
    if (!expressionId || !Object.keys(patch).length) {
      throw textbookError('TEXTBOOK_PATCH_INVALID', 400);
    }
    const expressions = db.prepare(`
      SELECT er.*, e.expression_key, e.lifecycle
      FROM textbook_expression_revisions er
      JOIN textbook_expressions e ON e.id = er.expression_id
      WHERE er.revision_id = ?
      ORDER BY er.display_ordinal
    `).all(base.id);
    if (!expressions.some((row) => Number(row.expression_id) === expressionId)) {
      throw textbookError('TEXTBOOK_EXPRESSION_NOT_FOUND', 404);
    }
    ensureReviewStates(db, base.track_id, base.id, timestamp);
    const priorReviews = new Map(listReviewStates(db, base.id).map((row) => [Number(row.expression_id), row]));
    const nextRows = expressions.map((row) => {
      if (Number(row.expression_id) !== expressionId) return { ...row, modified: false };
      const next = { ...row, ...patch, modified: true };
      const provenance = JSON.parse(next.provenance_json || '{}');
      next.provenance_json = JSON.stringify({
        ...provenance,
        userEdited: Object.keys(patch),
      });
      const hashes = applyAffectedExpressionHashes(next, new Set(Object.keys(patch)));
      next.en_unit_hash = hashes.en;
      next.ja_unit_hash = hashes.ja;
      return next;
    });
    const contentHash = sha256(stableJson(nextRows.map((row) => ({
      expressionId: row.expression_id,
      en: row.en_unit_hash,
      ja: row.ja_unit_hash,
      lifecycle: row.lifecycle,
    }))));
    const revisionNumber = Number(db.prepare(`
      SELECT COALESCE(MAX(revision_number), 0) + 1 AS value
      FROM textbook_track_revisions WHERE track_id = ?
    `).get(base.track_id).value);
    const nextRevisionId = Number(db.prepare(`
      INSERT INTO textbook_track_revisions(
        track_id, revision_number, parent_revision_id, status, origin,
        manifest_schema_version, manifest_relative_path, manifest_hash, source_fingerprint,
        content_hash, projection_hash, expression_count, skill_name, skill_version,
        skill_input_summary_json, change_summary_json, created_at_utc
      ) VALUES (?, ?, ?, 'draft', 'user-edit', NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      base.track_id,
      revisionNumber,
      base.id,
      contentHash,
      contentHash,
      nextRows.length,
      base.skill_name,
      base.skill_version,
      base.skill_input_summary_json,
      JSON.stringify({ expressionId, fields: Object.keys(patch) }),
      timestamp
    ).lastInsertRowid);
    db.prepare(`
      INSERT INTO textbook_track_assets(
        revision_id, asset_key, kind, ordinal, relative_path, sha256, byte_size,
        mime_type, duration_ms, availability, observed_mtime_ms, verified_at_utc
      )
      SELECT ?, asset_key, kind, ordinal, relative_path, sha256, byte_size,
        mime_type, duration_ms, availability, observed_mtime_ms, verified_at_utc
      FROM textbook_track_assets WHERE revision_id = ?
    `).run(nextRevisionId, base.id);
    const insertExpressionRevision = db.prepare(`
      INSERT INTO textbook_expression_revisions(
        revision_id, expression_id, display_ordinal, official_en_text, official_ja_text,
        zh_cue_text, ja_ruby_html, phrase_analysis_json, grammar_points_json,
        confidence_json, source_spans_json, provenance_json, editor_note,
        en_unit_hash, ja_unit_hash, created_at_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertReview = db.prepare(`
      INSERT INTO textbook_expression_review_states(
        track_id, track_revision_id, expression_id, expression_revision_id,
        status, reason_code, reviewer, confirmed_at_utc, revision, created_at_utc, updated_at_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);
    for (const row of nextRows) {
      const nextExpressionRevisionId = Number(insertExpressionRevision.run(
        nextRevisionId,
        row.expression_id,
        row.display_ordinal,
        row.official_en_text,
        row.official_ja_text,
        row.zh_cue_text,
        row.ja_ruby_html,
        row.phrase_analysis_json,
        row.grammar_points_json,
        row.confidence_json,
        row.source_spans_json,
        row.provenance_json,
        row.editor_note,
        row.en_unit_hash,
        row.ja_unit_hash,
        timestamp
      ).lastInsertRowid);
      const prior = priorReviews.get(Number(row.expression_id));
      const status = row.modified ? 'needs_attention' : prior?.status || 'pending';
      insertReview.run(
        base.track_id,
        nextRevisionId,
        row.expression_id,
        nextExpressionRevisionId,
        status,
        row.modified ? 'user-edit' : prior?.reason_code || null,
        status === 'confirmed' ? prior?.reviewer || 'local-user' : null,
        status === 'confirmed' ? prior?.confirmed_at_utc || timestamp : null,
        timestamp,
        timestamp
      );
    }
    db.prepare(`
      UPDATE textbook_tracks
      SET pending_revision_id = ?, updated_at_utc = ?
      WHERE id = ?
    `).run(nextRevisionId, timestamp, base.track_id);
    return {
      trackId: Number(base.track_id),
      revisionId: nextRevisionId,
      revisionNumber,
      modifiedExpressionId: expressionId,
      contentHash,
    };
  })();
}

module.exports = {
  copyOnWriteRevision,
  ensureReviewStates,
  expressionHashes,
  getRevision,
  listPendingTrackReviews,
  listReviewStates,
  reviewSummary,
  updateReviewState,
  updateReviewStates,
};
