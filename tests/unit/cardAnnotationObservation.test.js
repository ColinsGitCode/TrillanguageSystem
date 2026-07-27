'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const {
  buildAnnotationObservation,
} = require('../../services/annotations/application/runAnnotationObservation');
const { seedStudyItem } = require('../helpers/learningFixtures');

function testDatabase() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '../../database/schema.sql'), 'utf8'));
  return db;
}

function testRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-r1-source-'));
  fs.mkdirSync(path.join(root, 'app'), { recursive: true });
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'routes'), { recursive: true });
  fs.mkdirSync(path.join(root, 'services'), { recursive: true });
  fs.writeFileSync(path.join(root, 'server.js'), "'use strict';\n");
  return root;
}

function seedAnnotation(db, overrides = {}) {
  const generation = seedStudyItem(db, {
    phrase: overrides.phrase || 'annotation observation',
    unitKey: overrides.unitKey || 'ca-r1',
  });
  const nowUtc = '2026-07-27T01:00:00.000Z';
  db.prepare(`
    INSERT INTO card_annotations(
      id, target_kind, target_id, target_revision, projection_version,
      quote_exact, quote_prefix, quote_suffix, position_start, position_end,
      annotation_kind, color, status, source_content_hash,
      version, created_at_utc, updated_at_utc
    ) VALUES (
      @id, 'generation', @targetId, @targetRevision, 'card-visible-text-v1',
      'annotation', '', '', 0, 10,
      'highlight', 'red', @status, @sourceContentHash,
      1, @nowUtc, @nowUtc
    )
  `).run({
    id: overrides.id || 'ca-r1-annotation',
    targetId: overrides.targetId || generation.generationId,
    targetRevision: generation.contentHash,
    sourceContentHash: generation.contentHash,
    status: overrides.status || 'active',
    nowUtc,
  });
  return generation;
}

test('CA-R1 observation passes for a healthy canonical annotation store without writing', () => {
  const db = testDatabase();
  const repositoryRoot = testRepository();
  try {
    seedAnnotation(db);
    const before = Number(db.prepare('SELECT total_changes() AS count').get().count);
    const report = buildAnnotationObservation({
      db,
      repositoryRoot,
      annotationsEnabled: true,
      observedAtUtc: '2026-07-27T02:00:00.000Z',
    });
    const after = Number(db.prepare('SELECT total_changes() AS count').get().count);

    assert.equal(report.overallPass, true);
    assert.equal(report.readOnly, true);
    assert.equal(report.gates.activeTargetsExist, true);
    assert.equal(report.gates.runtimeLegacyReferencesAbsent, true);
    assert.equal(report.summary.annotations, 1);
    assert.equal(before, after);
  } finally {
    db.close();
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('CA-R1 observation fails closed for a missing active target and legacy runtime reference', () => {
  const db = testDatabase();
  const repositoryRoot = testRepository();
  try {
    seedAnnotation(db, { targetId: 999 });
    fs.writeFileSync(
      path.join(repositoryRoot, 'routes', 'legacy.js'),
      "router.get('/api/highlights/by-file', handler);\n"
    );
    const report = buildAnnotationObservation({ db, repositoryRoot, annotationsEnabled: true });

    assert.equal(report.overallPass, false);
    assert.equal(report.gates.activeTargetsExist, false);
    assert.equal(report.gates.runtimeLegacyReferencesAbsent, false);
    assert.equal(report.diagnostics.activeMissingTargets.length, 1);
    assert.equal(report.diagnostics.runtimeLegacyReferences[0].code, 'legacy-card-api');
  } finally {
    db.close();
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('CA-R1 baseline comparison detects a write to the frozen legacy snapshot', () => {
  const db = testDatabase();
  const repositoryRoot = testRepository();
  try {
    seedAnnotation(db);
    const baseline = buildAnnotationObservation({ db, repositoryRoot, annotationsEnabled: true });
    db.pragma('query_only = OFF');
    db.prepare(`
      INSERT INTO card_highlights(
        folder_name, base_filename, source_hash, html_content, mark_count, highlighted_chars
      ) VALUES ('20260727', 'legacy', ?, '<mark>legacy</mark>', 1, 6)
    `).run('a'.repeat(64));
    const report = buildAnnotationObservation({
      db,
      repositoryRoot,
      annotationsEnabled: true,
      baseline,
    });

    assert.equal(report.overallPass, false);
    assert.equal(report.gates.legacySnapshotFrozen, false);
  } finally {
    db.close();
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
  }
});
