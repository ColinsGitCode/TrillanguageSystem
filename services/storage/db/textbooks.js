'use strict';

const { textbookError } = require('../../textbooks/textbookErrors');

function json(value) {
  return JSON.stringify(value ?? {});
}

function nowIso() {
  return new Date().toISOString();
}

function assetRows(manifest) {
  return manifest.assets.map((asset) => ({
    assetKey: asset.assetKey,
    kind: asset.kind,
    ordinal: asset.ordinal,
    relativePath: asset.relativePath,
    sha256: asset.sha256,
    byteSize: asset.byteSize,
    mimeType: asset.mimeType,
    durationMs: asset.durationMs ?? null,
  }));
}

function importDraft(db, { manifest, manifestRelativePath, manifestHash }) {
  const timestamp = nowIso();
  const txn = db.transaction(() => {
    const existingByFingerprint = db.prepare(`
      SELECT r.id AS revision_id, r.track_id, r.manifest_hash, t.course_id, t.track_number
      FROM textbook_track_revisions r
      JOIN textbook_tracks t ON t.id = r.track_id
      WHERE r.source_fingerprint = ?
    `).get(manifest.integrity.sourceFingerprint);
    if (existingByFingerprint) {
      if (existingByFingerprint.manifest_hash === manifestHash) {
        return getTrack(db, existingByFingerprint.track_id);
      }
      throw textbookError('TEXTBOOK_IMPORT_SOURCE_CONFLICT', 409);
    }

    const courseResult = db.prepare(`
      INSERT INTO textbook_courses(course_key, title, source_notice, status, created_at_utc, updated_at_utc)
      VALUES (@courseKey, @title, @sourceNotice, 'active', @timestamp, @timestamp)
      ON CONFLICT(course_key) DO UPDATE SET
        title = excluded.title,
        source_notice = excluded.source_notice,
        updated_at_utc = excluded.updated_at_utc
    `).run({
      courseKey: manifest.course.key,
      title: manifest.course.title,
      sourceNotice: manifest.course.sourceNotice || null,
      timestamp,
    });
    const course = db.prepare('SELECT id FROM textbook_courses WHERE course_key = ?').get(manifest.course.key);
    const courseId = Number(course?.id || courseResult.lastInsertRowid);

    db.prepare(`
      INSERT INTO textbook_tracks(course_id, track_number, display_order, title, status, created_at_utc, updated_at_utc)
      VALUES (?, ?, ?, ?, 'draft', ?, ?)
      ON CONFLICT(course_id, track_number) DO UPDATE SET
        title = excluded.title,
        updated_at_utc = excluded.updated_at_utc
    `).run(courseId, manifest.track.number, manifest.track.displayOrder || manifest.track.number, manifest.track.title, timestamp, timestamp);
    const track = db.prepare(`
      SELECT id FROM textbook_tracks WHERE course_id = ? AND track_number = ?
    `).get(courseId, manifest.track.number);
    const trackId = Number(track.id);

    const sameRevision = db.prepare(`
      SELECT id FROM textbook_track_revisions
      WHERE track_id = ? AND revision_number = ? AND manifest_hash = ?
    `).get(trackId, manifest.revision.number, manifestHash);
    if (sameRevision) {
      db.prepare('UPDATE textbook_tracks SET pending_revision_id = ?, updated_at_utc = ? WHERE id = ?')
        .run(sameRevision.id, timestamp, trackId);
      return getTrack(db, trackId);
    }

    const conflict = db.prepare(`
      SELECT id FROM textbook_track_revisions
      WHERE track_id = ? AND revision_number = ? AND manifest_hash <> ?
    `).get(trackId, manifest.revision.number, manifestHash);
    if (conflict) throw textbookError('TEXTBOOK_IMPORT_REVISION_CONFLICT', 409);

    const revisionId = Number(db.prepare(`
      INSERT INTO textbook_track_revisions(
        track_id, revision_number, parent_revision_id, status, origin,
        manifest_schema_version, manifest_relative_path, manifest_hash, source_fingerprint,
        content_hash, projection_hash, expression_count, skill_name, skill_version,
        skill_input_summary_json, change_summary_json, created_at_utc
      ) VALUES (
        @trackId, @revisionNumber, NULL, 'draft', 'import',
        @schemaVersion, @manifestRelativePath, @manifestHash, @sourceFingerprint,
        @contentHash, @projectionHash, @expressionCount, @skillName, @skillVersion,
        @skillInputSummaryJson, @changeSummaryJson, @timestamp
      )
    `).run({
      trackId,
      revisionNumber: manifest.revision.number,
      schemaVersion: manifest.schemaVersion,
      manifestRelativePath,
      manifestHash,
      sourceFingerprint: manifest.integrity.sourceFingerprint,
      contentHash: manifest.integrity.contentHash,
      projectionHash: manifest.integrity.contentHash,
      expressionCount: manifest.expressions.length,
      skillName: manifest.import.skillName,
      skillVersion: manifest.import.skillVersion,
      skillInputSummaryJson: json(manifest.import.inputSummary),
      changeSummaryJson: json({ imported: true }),
      timestamp,
    }).lastInsertRowid);

    const insertAsset = db.prepare(`
      INSERT INTO textbook_track_assets(
        revision_id, asset_key, kind, ordinal, relative_path, sha256, byte_size,
        mime_type, duration_ms, availability, observed_mtime_ms, verified_at_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', NULL, ?)
    `);
    for (const asset of assetRows(manifest)) {
      insertAsset.run(
        revisionId,
        asset.assetKey,
        asset.kind,
        asset.ordinal,
        asset.relativePath,
        asset.sha256,
        asset.byteSize,
        asset.mimeType,
        asset.durationMs,
        timestamp
      );
    }

    const insertExpression = db.prepare(`
      INSERT INTO textbook_expressions(
        track_id, expression_key, lifecycle, created_revision_id, created_at_utc, updated_at_utc
      ) VALUES (?, ?, 'active', ?, ?, ?)
      ON CONFLICT(track_id, expression_key) DO UPDATE SET
        updated_at_utc = excluded.updated_at_utc
      RETURNING id
    `);
    const lookupExpression = db.prepare(`
      SELECT id FROM textbook_expressions WHERE track_id = ? AND expression_key = ?
    `);
    const insertExpressionRevision = db.prepare(`
      INSERT INTO textbook_expression_revisions(
        revision_id, expression_id, display_ordinal, official_en_text, official_ja_text,
        zh_cue_text, ja_ruby_html, phrase_analysis_json, grammar_points_json,
        confidence_json, source_spans_json, provenance_json, editor_note,
        en_unit_hash, ja_unit_hash, created_at_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const expression of manifest.expressions) {
      const inserted = insertExpression.get(trackId, expression.key, revisionId, timestamp, timestamp);
      const expressionId = Number(inserted?.id || lookupExpression.get(trackId, expression.key).id);
      insertExpressionRevision.run(
        revisionId,
        expressionId,
        expression.ordinal,
        expression.official.en.text,
        expression.official.ja.text,
        expression.derived.zhCue,
        rubyHtml(expression.derived.rubySegments),
        json(expression.derived.analysis?.phrases || []),
        json(expression.derived.analysis?.grammar || []),
        json(expression.confidence),
        json([
          expression.official.en.sourceSpan,
          expression.official.ja.sourceSpan,
        ]),
        json({
          official: { en: 'source-image', ja: 'source-image' },
          derived: { zhCue: 'ai-derived', ruby: 'ai-derived', analysis: 'ai-derived' },
        }),
        expression.editorNote || null,
        expression.unitHashes.en,
        expression.unitHashes.ja,
        timestamp
      );
    }

    db.prepare('UPDATE textbook_tracks SET pending_revision_id = ?, status = ?, updated_at_utc = ? WHERE id = ?')
      .run(revisionId, 'draft', timestamp, trackId);
    return getTrack(db, trackId);
  });
  return txn();
}

function rubyHtml(segments = []) {
  return segments.map((segment) => {
    const text = escapeHtml(segment.text || '');
    if (!segment.reading) return text;
    return `<ruby>${text}<rt>${escapeHtml(segment.reading)}</rt></ruby>`;
  }).join('');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

function listCourses(db) {
  return db.prepare(`
    SELECT c.*,
      COUNT(t.id) AS track_count,
      SUM(CASE WHEN t.status = 'published' THEN 1 ELSE 0 END) AS published_track_count
    FROM textbook_courses c
    LEFT JOIN textbook_tracks t ON t.course_id = c.id
    GROUP BY c.id
    ORDER BY c.updated_at_utc DESC, c.id DESC
  `).all();
}

function getCourse(db, id) {
  const course = db.prepare('SELECT * FROM textbook_courses WHERE id = ?').get(id);
  if (!course) return null;
  const tracks = db.prepare(`
    SELECT t.*, r.expression_count, r.manifest_hash
    FROM textbook_tracks t
    LEFT JOIN textbook_track_revisions r ON r.id = COALESCE(t.current_revision_id, t.pending_revision_id)
    WHERE t.course_id = ?
    ORDER BY t.display_order, t.track_number
  `).all(course.id);
  return { ...course, tracks };
}

function getTrack(db, id) {
  const track = db.prepare(`
    SELECT t.*, c.course_key, c.title AS course_title,
      r.id AS revision_id, r.revision_number, r.status AS revision_status,
      r.expression_count, r.manifest_hash, r.source_fingerprint, r.content_hash
    FROM textbook_tracks t
    JOIN textbook_courses c ON c.id = t.course_id
    LEFT JOIN textbook_track_revisions r ON r.id = COALESCE(t.current_revision_id, t.pending_revision_id)
    WHERE t.id = ?
  `).get(id);
  if (!track) return null;
  return {
    ...track,
    expressions: track.revision_id ? listExpressionsByRevision(db, track.revision_id) : [],
    assets: track.revision_id ? listAssetsByRevision(db, track.revision_id) : [],
  };
}

function verifyRevision(db, revisionId, { expectedTrackStatus } = {}) {
  const timestamp = nowIso();
  const txn = db.transaction(() => {
    const revision = db.prepare(`
      SELECT r.*, t.status AS track_status
      FROM textbook_track_revisions r
      JOIN textbook_tracks t ON t.id = r.track_id
      WHERE r.id = ?
    `).get(revisionId);
    if (!revision) throw textbookError('TEXTBOOK_REVISION_NOT_FOUND', 404);
    if (expectedTrackStatus && revision.track_status !== expectedTrackStatus) {
      throw textbookError('TEXTBOOK_REVISION_CONFLICT', 409);
    }
    if (!['draft', 'verified'].includes(revision.status)) {
      throw textbookError('TEXTBOOK_REVISION_CONFLICT', 409);
    }
    const unavailableAssets = db.prepare(`
      SELECT COUNT(*) AS count
      FROM textbook_track_assets
      WHERE revision_id = ? AND availability <> 'available'
    `).get(revisionId).count;
    if (unavailableAssets > 0) throw textbookError('TEXTBOOK_MEDIA_NOT_FOUND', 409);

    db.prepare(`
      UPDATE textbook_track_revisions
      SET status = 'verified', verified_at_utc = COALESCE(verified_at_utc, ?)
      WHERE id = ?
    `).run(timestamp, revisionId);
    db.prepare(`
      UPDATE textbook_tracks
      SET status = 'verified',
        current_revision_id = ?,
        pending_revision_id = NULL,
        updated_at_utc = ?
      WHERE id = ?
    `).run(revisionId, timestamp, revision.track_id);
    return getTrack(db, revision.track_id);
  });
  return txn();
}

function listExpressionsByRevision(db, revisionId) {
  return db.prepare(`
    SELECT er.*, e.expression_key, e.lifecycle
    FROM textbook_expression_revisions er
    JOIN textbook_expressions e ON e.id = er.expression_id
    WHERE er.revision_id = ?
    ORDER BY er.display_ordinal
  `).all(revisionId);
}

function listAssetsByRevision(db, revisionId) {
  return db.prepare(`
    SELECT * FROM textbook_track_assets
    WHERE revision_id = ?
    ORDER BY kind, ordinal
  `).all(revisionId);
}

function searchExpressions(db, query, limit = 20) {
  return db.prepare(`
    SELECT er.id, e.expression_key, er.display_ordinal,
      er.official_en_text, er.official_ja_text, er.zh_cue_text,
      snippet(textbook_expressions_fts, 0, '<mark>', '</mark>', '...', 20) AS snippet,
      tr.id AS track_id, tr.track_number, tr.title AS track_title,
      c.course_key, c.title AS course_title
    FROM textbook_expressions_fts
    JOIN textbook_expression_revisions er ON er.id = textbook_expressions_fts.rowid
    JOIN textbook_expressions e ON e.id = er.expression_id
    JOIN textbook_track_revisions rev ON rev.id = er.revision_id
    JOIN textbook_tracks tr ON tr.id = rev.track_id
    JOIN textbook_courses c ON c.id = tr.course_id
    WHERE textbook_expressions_fts MATCH @query
    ORDER BY rank
    LIMIT @limit
  `).all({ query, limit });
}

function getAsset(db, id) {
  return db.prepare(`
    SELECT a.*, r.track_id, t.course_id
    FROM textbook_track_assets a
    JOIN textbook_track_revisions r ON r.id = a.revision_id
    JOIN textbook_tracks t ON t.id = r.track_id
    WHERE a.id = ?
  `).get(id);
}

function markAssetAvailability(db, id, availability) {
  return db.prepare(`
    UPDATE textbook_track_assets
    SET availability = ?, verified_at_utc = ?
    WHERE id = ?
  `).run(availability, nowIso(), id);
}

module.exports = {
  importDraft,
  listCourses,
  getCourse,
  getTrack,
  verifyRevision,
  searchExpressions,
  getAsset,
  markAssetAvailability,
};
