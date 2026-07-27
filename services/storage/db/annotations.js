'use strict';

const crypto = require('node:crypto');
const { safeJsonParse } = require('./helpers');

const TARGET_KINDS = new Set(['generation', 'textbook_track', 'textbook_expression']);
const STATUSES = new Set(['active', 'orphaned', 'deleted']);

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function mapAnnotation(row) {
  if (!row) return null;
  return {
    id: row.id,
    targetKind: row.target_kind,
    targetId: Number(row.target_id),
    targetRevision: row.target_revision,
    selector: {
      projectionVersion: row.projection_version,
      textQuote: {
        type: 'TextQuoteSelector',
        exact: row.quote_exact,
        prefix: row.quote_prefix,
        suffix: row.quote_suffix,
      },
      textPosition: {
        type: 'TextPositionSelector',
        start: Number(row.position_start),
        end: Number(row.position_end),
      },
    },
    annotationKind: row.annotation_kind,
    color: row.color,
    noteText: row.note_text,
    status: row.status,
    sourceContentHash: row.source_content_hash,
    legacyHighlightId: row.legacy_highlight_id == null ? null : Number(row.legacy_highlight_id),
    legacyPayload: safeJsonParse(row.legacy_payload_json, null),
    version: Number(row.version),
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
  };
}

function mapMigrationEvent(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    migrationPlanHash: row.migration_plan_hash,
    legacyHighlightId: Number(row.legacy_highlight_id),
    legacyRunOrdinal: Number(row.legacy_run_ordinal),
    annotationId: row.annotation_id,
    outcome: row.outcome,
    reasonCode: row.reason_code,
    sourceFingerprint: row.source_fingerprint,
    createdAtUtc: row.created_at_utc,
  };
}

function resolveTarget(db, targetKind, targetId) {
  const id = Number(targetId);
  if (!TARGET_KINDS.has(targetKind) || !Number.isSafeInteger(id) || id <= 0) return null;

  if (targetKind === 'generation') {
    const row = db.prepare(`
      SELECT id, content_hash FROM generations WHERE id = ?
    `).get(id);
    return row ? {
      targetKind,
      targetId: Number(row.id),
      targetRevision: row.content_hash,
      sourceContentHash: row.content_hash,
    } : null;
  }

  if (targetKind === 'textbook_track') {
    const row = db.prepare(`
      SELECT track.id, track.current_revision_id, revision.content_hash
      FROM textbook_tracks track
      LEFT JOIN textbook_track_revisions revision ON revision.id = track.current_revision_id
      WHERE track.id = ?
    `).get(id);
    return row ? {
      targetKind,
      targetId: Number(row.id),
      targetRevision: row.current_revision_id == null ? null : String(row.current_revision_id),
      sourceContentHash: row.content_hash || null,
    } : null;
  }

  const row = db.prepare(`
    SELECT expression.id, expression_revision.en_unit_hash, expression_revision.ja_unit_hash
    FROM textbook_expressions expression
    JOIN textbook_tracks track ON track.id = expression.track_id
    LEFT JOIN textbook_expression_revisions expression_revision
      ON expression_revision.expression_id = expression.id
      AND expression_revision.revision_id = track.current_revision_id
    WHERE expression.id = ?
  `).get(id);
  if (!row) return null;
  const contentHash = row.en_unit_hash && row.ja_unit_hash
    ? sha256(`${row.en_unit_hash}:${row.ja_unit_hash}`)
    : null;
  return {
    targetKind,
    targetId: Number(row.id),
    targetRevision: contentHash,
    sourceContentHash: contentHash,
  };
}

function getById(db, id) {
  return mapAnnotation(db.prepare('SELECT * FROM card_annotations WHERE id = ?').get(String(id)));
}

function listByTarget(db, targetKind, targetId, options = {}) {
  const requested = Array.isArray(options.statuses) && options.statuses.length
    ? options.statuses
    : ['active', 'orphaned'];
  const statuses = [...new Set(requested.filter((status) => STATUSES.has(status)))];
  if (!statuses.length) return [];
  return db.prepare(`
    SELECT * FROM card_annotations
    WHERE target_kind = ? AND target_id = ?
      AND status IN (${statuses.map(() => '?').join(', ')})
    ORDER BY position_start, position_end, created_at_utc, id
  `).all(targetKind, Number(targetId), ...statuses).map(mapAnnotation);
}

function listByLegacyHighlightId(db, legacyHighlightId) {
  return db.prepare(`
    SELECT * FROM card_annotations
    WHERE legacy_highlight_id = ? AND status IN ('active', 'orphaned')
    ORDER BY position_start, position_end, created_at_utc, id
  `).all(Number(legacyHighlightId)).map(mapAnnotation);
}

function insert(db, annotation) {
  db.prepare(`
    INSERT INTO card_annotations(
      id, target_kind, target_id, target_revision, projection_version,
      quote_exact, quote_prefix, quote_suffix, position_start, position_end,
      annotation_kind, color, note_text, status, source_content_hash,
      legacy_highlight_id, legacy_payload_json, version, created_at_utc, updated_at_utc
    ) VALUES (
      @id, @targetKind, @targetId, @targetRevision, @projectionVersion,
      @quoteExact, @quotePrefix, @quoteSuffix, @positionStart, @positionEnd,
      @annotationKind, @color, @noteText, @status, @sourceContentHash,
      @legacyHighlightId, @legacyPayloadJson, 1, @createdAtUtc, @updatedAtUtc
    )
  `).run({
    color: null,
    noteText: null,
    status: 'active',
    sourceContentHash: null,
    legacyHighlightId: null,
    legacyPayloadJson: null,
    ...annotation,
  });
  return getById(db, annotation.id);
}

function update(db, id, expectedVersion, patch, updatedAtUtc) {
  const result = db.prepare(`
    UPDATE card_annotations
    SET color = @color,
      note_text = @noteText,
      version = version + 1,
      updated_at_utc = @updatedAtUtc
    WHERE id = @id AND version = @expectedVersion AND status <> 'deleted'
  `).run({
    id: String(id),
    expectedVersion: Number(expectedVersion),
    color: patch.color,
    noteText: patch.noteText,
    updatedAtUtc,
  });
  return result.changes ? getById(db, id) : null;
}

function softDelete(db, id, expectedVersion, updatedAtUtc) {
  const result = db.prepare(`
    UPDATE card_annotations
    SET status = 'deleted', version = version + 1, updated_at_utc = @updatedAtUtc
    WHERE id = @id AND version = @expectedVersion AND status <> 'deleted'
  `).run({
    id: String(id),
    expectedVersion: Number(expectedVersion),
    updatedAtUtc,
  });
  return result.changes ? getById(db, id) : null;
}

function appendMigrationEvent(db, event) {
  const result = db.prepare(`
    INSERT INTO card_annotation_migration_events(
      migration_plan_hash, legacy_highlight_id, legacy_run_ordinal,
      annotation_id, outcome, reason_code, source_fingerprint, created_at_utc
    ) VALUES (
      @migrationPlanHash, @legacyHighlightId, @legacyRunOrdinal,
      @annotationId, @outcome, @reasonCode, @sourceFingerprint, @createdAtUtc
    )
  `).run({
    annotationId: null,
    reasonCode: null,
    ...event,
  });
  return mapMigrationEvent(db.prepare(
    'SELECT * FROM card_annotation_migration_events WHERE id = ?'
  ).get(Number(result.lastInsertRowid)));
}

function listMigrationEvents(db, migrationPlanHash) {
  return db.prepare(`
    SELECT * FROM card_annotation_migration_events
    WHERE migration_plan_hash = ?
    ORDER BY legacy_highlight_id, legacy_run_ordinal
  `).all(String(migrationPlanHash)).map(mapMigrationEvent);
}

function getStats(db, { dateFrom, dateTo, provider, cardType } = {}) {
  const conditions = ["annotation.status = 'active'"];
  const params = {};
  if (dateFrom) {
    conditions.push('COALESCE(generation.generation_date, date(annotation.updated_at_utc)) >= @dateFrom');
    params.dateFrom = dateFrom;
  }
  if (dateTo) {
    conditions.push('COALESCE(generation.generation_date, date(annotation.updated_at_utc)) <= @dateTo');
    params.dateTo = dateTo;
  }
  if (provider) {
    conditions.push('generation.llm_provider = @provider');
    params.provider = provider;
  }
  if (cardType) {
    conditions.push('generation.card_type = @cardType');
    params.cardType = cardType;
  }
  const joins = `
    LEFT JOIN textbook_tracks track
      ON annotation.target_kind = 'textbook_track' AND track.id = annotation.target_id
    LEFT JOIN generations generation
      ON generation.id = CASE
        WHEN annotation.target_kind = 'generation' THEN annotation.target_id
        WHEN annotation.target_kind = 'textbook_track' THEN track.generation_id
        ELSE NULL
      END
  `;
  const where = conditions.join(' AND ');
  const overview = db.prepare(`
    SELECT
      COUNT(*) AS totalAnnotations,
      COUNT(DISTINCT annotation.target_kind || ':' || annotation.target_id) AS annotatedTargets,
      SUM(CASE WHEN annotation.annotation_kind = 'highlight' THEN 1 ELSE 0 END) AS highlights,
      SUM(CASE WHEN annotation.annotation_kind = 'note' THEN 1 ELSE 0 END) AS notes,
      SUM(CASE WHEN annotation.annotation_kind = 'highlight' THEN length(annotation.quote_exact) ELSE 0 END)
        AS highlightedChars,
      MAX(annotation.updated_at_utc) AS lastUpdatedAt
    FROM card_annotations annotation
    ${joins}
    WHERE ${where}
  `).get(params);
  const byCardType = db.prepare(`
    SELECT COALESCE(generation.card_type, annotation.target_kind) AS cardType,
      COUNT(DISTINCT annotation.target_kind || ':' || annotation.target_id) AS targets,
      COUNT(*) AS annotations
    FROM card_annotations annotation
    ${joins}
    WHERE ${where}
    GROUP BY COALESCE(generation.card_type, annotation.target_kind)
    ORDER BY annotations DESC
  `).all(params);
  const trend = db.prepare(`
    SELECT date(annotation.updated_at_utc) AS day,
      COUNT(DISTINCT annotation.target_kind || ':' || annotation.target_id) AS targets,
      COUNT(*) AS annotations
    FROM card_annotations annotation
    ${joins}
    WHERE ${where}
    GROUP BY date(annotation.updated_at_utc)
    ORDER BY day DESC
    LIMIT 90
  `).all(params);
  return {
    overview: {
      totalAnnotations: Number(overview?.totalAnnotations || 0),
      annotatedTargets: Number(overview?.annotatedTargets || 0),
      highlights: Number(overview?.highlights || 0),
      notes: Number(overview?.notes || 0),
      highlightedChars: Number(overview?.highlightedChars || 0),
      lastUpdatedAt: overview?.lastUpdatedAt || null,
    },
    byCardType,
    trend,
  };
}

module.exports = {
  TARGET_KINDS,
  STATUSES,
  appendMigrationEvent,
  getById,
  getStats,
  insert,
  listByLegacyHighlightId,
  listByTarget,
  listMigrationEvents,
  mapAnnotation,
  mapMigrationEvent,
  resolveTarget,
  softDelete,
  update,
};
