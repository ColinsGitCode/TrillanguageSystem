'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const annotationsDomain = require('../../storage/db/annotations');

const FORBIDDEN_RUNTIME_REFERENCES = [
  ['legacy-card-api', '/api/highlights/by-file'],
  ['legacy-textbook-api', '/api/textbooks/tracks/:id/highlights'],
  ['shadow-status-api', '/api/annotations/shadow-status'],
  ['shadow-reader', 'annotationShadowReadService'],
  ['shadow-flag', 'CARD_ANNOTATIONS_SHADOW_READ_ENABLED'],
  ['compat-write-flag', 'CARD_ANNOTATIONS_COMPAT_WRITE_ENABLED'],
  ['legacy-getter', 'getCardHighlight'],
  ['legacy-writer', 'saveCardHighlight'],
  ['legacy-deleter', 'deleteCardHighlight'],
];

const RUNTIME_DIRECTORIES = ['app', 'lib', 'routes', 'services'];
const RUNTIME_FILES = ['server.js', 'server.mjs', 'docker-compose.yml', '.env.example'];
const IGNORED_RUNTIME_FILES = new Set([
  'services/annotations/application/runAnnotationObservation.js',
]);
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.ts', '.tsx', '.json', '.yml', '.yaml']);

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function stableHash(value) {
  return sha256(JSON.stringify(value));
}

function countBy(rows, selector) {
  const counts = new Map();
  rows.forEach((row) => {
    const key = String(selector(row));
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return Object.fromEntries([...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function walkSourceFiles(root, relativePath, output) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) return;
  const stat = fs.statSync(absolute);
  if (stat.isFile()) {
    if (SOURCE_EXTENSIONS.has(path.extname(absolute)) || RUNTIME_FILES.includes(relativePath)) {
      output.push(relativePath);
    }
    return;
  }
  fs.readdirSync(absolute, { withFileTypes: true }).forEach((entry) => {
    walkSourceFiles(root, path.join(relativePath, entry.name), output);
  });
}

function scanRuntimeReferences(repositoryRoot) {
  const files = [];
  RUNTIME_DIRECTORIES.forEach((directory) => walkSourceFiles(repositoryRoot, directory, files));
  RUNTIME_FILES.forEach((file) => walkSourceFiles(repositoryRoot, file, files));
  const matches = [];
  files.sort().forEach((relativePath) => {
    if (IGNORED_RUNTIME_FILES.has(relativePath)) return;
    const lines = fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8').split(/\r?\n/u);
    lines.forEach((line, index) => {
      FORBIDDEN_RUNTIME_REFERENCES.forEach(([code, needle]) => {
        if (line.includes(needle)) {
          matches.push({ code, file: relativePath, line: index + 1 });
        }
      });
    });
  });
  return {
    checkedFiles: files.length,
    sourceHash: stableHash(files.map((file) => [
      file,
      sha256(fs.readFileSync(path.join(repositoryRoot, file))),
    ])),
    matches,
  };
}

function snapshotRows(db) {
  const annotations = db.prepare(`
    SELECT
      id, target_kind, target_id, target_revision, projection_version,
      quote_exact, quote_prefix, quote_suffix, position_start, position_end,
      annotation_kind, color, note_text, status, source_content_hash,
      legacy_highlight_id, version, created_at_utc, updated_at_utc
    FROM card_annotations
    ORDER BY id
  `).all();
  const legacyRows = db.prepare(`
    SELECT
      id, generation_id, folder_name, base_filename, source_hash, version,
      html_content, mark_count, highlighted_chars, updated_by, created_at, updated_at
    FROM card_highlights
    ORDER BY id
  `).all().map((row) => ({
    ...row,
    html_content: sha256(row.html_content),
  }));
  const migrationEvents = db.prepare(`
    SELECT
      id, migration_plan_hash, legacy_highlight_id, legacy_run_ordinal,
      annotation_id, outcome, reason_code, source_fingerprint, created_at_utc
    FROM card_annotation_migration_events
    ORDER BY id
  `).all();
  return {
    annotations,
    legacyRows,
    migrationEvents,
    annotationStateHash: stableHash(annotations),
    legacySnapshotHash: stableHash(legacyRows),
    migrationFactsHash: stableHash(migrationEvents),
  };
}

function activeTargetDiagnostics(db, annotations) {
  const missing = [];
  const revisionDrift = [];
  annotations.filter((row) => row.status === 'active').forEach((row) => {
    const target = annotationsDomain.resolveTarget(db, row.target_kind, row.target_id);
    if (!target) {
      missing.push({
        annotationId: row.id,
        targetKind: row.target_kind,
        targetId: Number(row.target_id),
      });
      return;
    }
    const targetRevisionMatches = String(row.target_revision) === String(target.targetRevision);
    const sourceHashMatches = !row.source_content_hash
      || !target.sourceContentHash
      || row.source_content_hash === target.sourceContentHash;
    if (!targetRevisionMatches || !sourceHashMatches) {
      revisionDrift.push({
        annotationId: row.id,
        targetKind: row.target_kind,
        targetId: Number(row.target_id),
        targetRevisionMatches,
        sourceHashMatches,
      });
    }
  });
  return { missing, revisionDrift };
}

function migrationTriggersPresent(db) {
  const required = new Set([
    'card_annotation_migration_events_update_block',
    'card_annotation_migration_events_delete_block',
  ]);
  const present = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'trigger' AND name LIKE 'card_annotation_migration_events_%'
  `).all().map((row) => row.name);
  return {
    present,
    missing: [...required].filter((name) => !present.includes(name)),
  };
}

function buildAnnotationObservation({
  db,
  repositoryRoot,
  annotationsEnabled = true,
  baseline = null,
  observedAtUtc = new Date().toISOString(),
}) {
  db.pragma('query_only = ON');
  const before = snapshotRows(db);
  const targetDiagnostics = activeTargetDiagnostics(db, before.annotations);
  const malformedSelectors = before.annotations.filter((row) => (
    !String(row.quote_exact || '').trim()
    || Number(row.position_start) < 0
    || Number(row.position_end) <= Number(row.position_start)
  )).map((row) => row.id);
  const duplicateActiveAnchors = db.prepare(`
    SELECT
      target_kind, target_id, projection_version, position_start, position_end,
      annotation_kind, COUNT(*) AS count
    FROM card_annotations
    WHERE status = 'active'
    GROUP BY
      target_kind, target_id, projection_version, position_start, position_end,
      annotation_kind
    HAVING COUNT(*) > 1
  `).all();
  const triggers = migrationTriggersPresent(db);
  const runtime = scanRuntimeReferences(repositoryRoot);
  const integrity = db.pragma('quick_check', { simple: true });
  const foreignKeyViolations = db.pragma('foreign_key_check');
  const latestMigrationAt = before.migrationEvents.at(-1)?.created_at_utc || null;
  const liveAnnotations = latestMigrationAt
    ? before.annotations.filter((row) => row.created_at_utc > latestMigrationAt)
    : [];
  const after = snapshotRows(db);

  const gates = {
    databaseIntegrity: integrity === 'ok',
    foreignKeysValid: foreignKeyViolations.length === 0,
    activeTargetsExist: targetDiagnostics.missing.length === 0,
    activeRevisionsCurrent: targetDiagnostics.revisionDrift.length === 0,
    selectorsValid: malformedSelectors.length === 0,
    activeAnchorsUnique: duplicateActiveAnchors.length === 0,
    migrationEventsImmutable: triggers.missing.length === 0,
    runtimeLegacyReferencesAbsent: runtime.matches.length === 0,
    canonicalFeatureEnabled: Boolean(annotationsEnabled),
    noObservedDatabaseMutation: before.annotationStateHash === after.annotationStateHash
      && before.legacySnapshotHash === after.legacySnapshotHash
      && before.migrationFactsHash === after.migrationFactsHash,
    legacySnapshotFrozen: baseline
      ? baseline.snapshots?.legacySnapshotHash === after.legacySnapshotHash
      : null,
    migrationFactsFrozen: baseline
      ? baseline.snapshots?.migrationFactsHash === after.migrationFactsHash
      : null,
  };
  const requiredGates = Object.values(gates).filter((value) => value !== null);
  const report = {
    version: 'ca-r1-annotation-observation-v1',
    observedAtUtc,
    readOnly: true,
    overallPass: requiredGates.every(Boolean),
    gates,
    summary: {
      annotations: before.annotations.length,
      statuses: countBy(before.annotations, (row) => row.status),
      targetKinds: countBy(before.annotations, (row) => row.target_kind),
      annotationKinds: countBy(before.annotations, (row) => row.annotation_kind),
      colors: countBy(before.annotations, (row) => row.color || '<none>'),
      activeTargets: new Set(before.annotations
        .filter((row) => row.status === 'active')
        .map((row) => `${row.target_kind}:${row.target_id}`)).size,
      migrationEvents: before.migrationEvents.length,
      migrationOutcomes: countBy(before.migrationEvents, (row) => row.outcome),
      liveAnnotationsAfterMigration: liveAnnotations.length,
      legacyRows: before.legacyRows.length,
      legacyLastUpdatedAt: before.legacyRows.reduce(
        (latest, row) => !latest || row.updated_at > latest ? row.updated_at : latest,
        null
      ),
    },
    diagnostics: {
      activeMissingTargets: targetDiagnostics.missing,
      activeRevisionDrift: targetDiagnostics.revisionDrift,
      malformedSelectorIds: malformedSelectors,
      duplicateActiveAnchors,
      orphanedAnnotations: before.annotations
        .filter((row) => row.status === 'orphaned')
        .map((row) => ({
          annotationId: row.id,
          targetKind: row.target_kind,
          targetId: Number(row.target_id),
          legacyHighlightId: row.legacy_highlight_id == null
            ? null
            : Number(row.legacy_highlight_id),
          updatedAtUtc: row.updated_at_utc,
        })),
      foreignKeyViolations,
      missingMigrationTriggers: triggers.missing,
      runtimeLegacyReferences: runtime.matches,
    },
    runtime: {
      checkedFiles: runtime.checkedFiles,
      sourceHash: runtime.sourceHash,
    },
    snapshots: {
      annotationStateHash: after.annotationStateHash,
      legacySnapshotHash: after.legacySnapshotHash,
      migrationFactsHash: after.migrationFactsHash,
    },
  };
  return {
    ...report,
    reportHash: stableHash(report),
  };
}

module.exports = {
  FORBIDDEN_RUNTIME_REFERENCES,
  buildAnnotationObservation,
  scanRuntimeReferences,
  snapshotRows,
};
