'use strict';

process.env.DB_PATH = ':memory:';
process.env.LOG_SILENT = '1';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const databaseModule = require('../../services/storage/databaseService');
const { DatabaseService } = databaseModule;
const {
  BASELINE_VERSION,
  CARD_ANNOTATION_P3_TABLES,
  CARD_ENGAGEMENT_TABLES,
  KG_P1_TABLES,
  KG_R2_TABLES,
  LEARNING_P3_TABLES,
  LEARNING_P0_TABLES,
  LOCAL_GLOSSARY_TABLES,
  MANUAL_TAG_TABLES,
  PRONUNCIATION_TABLES,
  TEXTBOOK_P1_TABLES,
  TEXTBOOK_WORKFLOW_TABLES,
  runMigrations,
} = require('../../services/storage/db/migrationRunner');

function schemaObjects(db) {
  return db.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%'
      AND type IN ('table', 'index', 'trigger', 'view')
    ORDER BY type, name
  `).all();
}

function textbookManifestForMigration() {
  const hash = (value) => value.repeat(64).slice(0, 64);
  return {
    schemaVersion: 'textbook-track-manifest/v1',
    course: { key: 'migration-course', title: 'Migration Course', sourceNotice: 'Synthetic' },
    track: { number: 1, displayOrder: 1, title: 'Migration Track' },
    revision: { number: 1 },
    assets: [{
      assetKey: 'source:01',
      kind: 'source_image',
      ordinal: 1,
      relativePath: 'synthetic/source.png',
      sha256: hash('a'),
      byteSize: 1,
      mimeType: 'image/png',
    }],
    expressions: [{
      key: 'expr:01',
      ordinal: 1,
      official: {
        en: { text: 'Migration English', sourceSpan: { assetKey: 'source:01' } },
        ja: { text: '移行日本語', sourceSpan: { assetKey: 'source:01' } },
      },
      derived: {
        zhCue: '迁移中文',
        rubySegments: [{ text: '移行日本語' }],
        analysis: { phrases: [], grammar: [] },
      },
      confidence: { pairing: 1, en: 1, ja: 1, zhCue: 1, ruby: 1 },
      unitHashes: { en: hash('b'), ja: hash('c') },
    }],
    import: {
      skillName: 'import-textbook-track',
      skillVersion: '1.0.0',
      inputSummary: {},
    },
    integrity: { sourceFingerprint: hash('d'), contentHash: hash('e') },
  };
}

test.after(() => databaseModule.close());

test.describe('versioned migration runner', () => {
  test.it('registers 001-013 on a new database and creates every product table', () => {
    const service = new DatabaseService(':memory:');
    try {
      assert.deepEqual(service.migrationResult, {
        applied: ['001', '002', '003', '004', '005', '006', '007', '008', '009', '010', '011', '012', '013'],
        skipped: [],
        baselineRegistered: false,
      });
      const versions = service.db.prepare(
        'SELECT version, is_baseline FROM schema_migrations ORDER BY version'
      ).all();
      assert.deepEqual(versions, [
        { version: '001', is_baseline: 0 },
        { version: '002', is_baseline: 0 },
        { version: '003', is_baseline: 0 },
        { version: '004', is_baseline: 0 },
        { version: '005', is_baseline: 0 },
        { version: '006', is_baseline: 0 },
        { version: '007', is_baseline: 0 },
        { version: '008', is_baseline: 0 },
        { version: '009', is_baseline: 0 },
        { version: '010', is_baseline: 0 },
        { version: '011', is_baseline: 0 },
        { version: '012', is_baseline: 0 },
        { version: '013', is_baseline: 0 },
      ]);
      const tables = new Set(service.db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table'"
      ).all().map((row) => row.name));
      LEARNING_P0_TABLES.forEach((table) => assert.ok(tables.has(table), table));
      TEXTBOOK_P1_TABLES.forEach((table) => assert.ok(tables.has(table), table));
      KG_P1_TABLES.forEach((table) => assert.ok(tables.has(table), table));
      LEARNING_P3_TABLES.forEach((table) => assert.ok(tables.has(table), table));
      KG_R2_TABLES.forEach((table) => assert.ok(tables.has(table), table));
      TEXTBOOK_WORKFLOW_TABLES.forEach((table) => assert.ok(tables.has(table), table));
      CARD_ANNOTATION_P3_TABLES.forEach((table) => assert.ok(tables.has(table), table));
      MANUAL_TAG_TABLES.forEach((table) => assert.ok(tables.has(table), table));
      CARD_ENGAGEMENT_TABLES.forEach((table) => assert.ok(tables.has(table), table));
      PRONUNCIATION_TABLES.forEach((table) => assert.ok(tables.has(table), table));
      LOCAL_GLOSSARY_TABLES.forEach((table) => assert.ok(tables.has(table), table));
      assert.deepEqual(
        service.db.prepare("PRAGMA foreign_key_list('card_engagement_events')").all(),
        []
      );
    } finally {
      service.close();
    }
  });

  test.it('registers the pre-LA baseline and converges to the new-install schema', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'three-lans-migration-'));
    const dbPath = path.join(tempDir, 'legacy.db');
    const schema = fs.readFileSync(path.join(__dirname, '../../database/schema.sql'), 'utf8');
    const marker = '-- 迁移基础设施: schema_migrations';
    const markerIndex = schema.indexOf(marker);
    assert.ok(markerIndex > 0);

    const legacy = new Database(dbPath);
    legacy.exec(schema.slice(0, markerIndex));
    legacy.close();

    const migrated = new DatabaseService(dbPath);
    const fresh = new DatabaseService(':memory:');
    try {
      const versions = migrated.db.prepare(
        'SELECT version, is_baseline FROM schema_migrations ORDER BY version'
      ).all();
      assert.deepEqual(versions, [
        { version: BASELINE_VERSION, is_baseline: 1 },
        { version: '001', is_baseline: 0 },
        { version: '002', is_baseline: 0 },
        { version: '003', is_baseline: 0 },
        { version: '004', is_baseline: 0 },
        { version: '005', is_baseline: 0 },
        { version: '006', is_baseline: 0 },
        { version: '007', is_baseline: 0 },
        { version: '008', is_baseline: 0 },
        { version: '009', is_baseline: 0 },
        { version: '010', is_baseline: 0 },
        { version: '011', is_baseline: 0 },
        { version: '012', is_baseline: 0 },
        { version: '013', is_baseline: 0 },
      ]);
      assert.deepEqual(schemaObjects(migrated.db), schemaObjects(fresh.db));
    } finally {
      migrated.close();
      fresh.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test.it('rejects a changed migration after its checksum is recorded', () => {
    const service = new DatabaseService(':memory:');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'three-lans-checksum-'));
    try {
      const source = path.join(__dirname, '../../database/migrations/001_learning_assistance_p0.sql');
      const target = path.join(tempDir, '001_learning_assistance_p0.sql');
      fs.writeFileSync(target, `${fs.readFileSync(source, 'utf8')}\n-- changed\n`);
      assert.throws(
        () => runMigrations(service.db, { migrationsDir: tempDir }),
        /Migration checksum mismatch/u
      );
    } finally {
      service.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test.it('backfills review facts only for a published revision with no workflow projection', () => {
    const service = new DatabaseService(':memory:');
    try {
      const imported = service.importTextbookDraft({
        manifest: textbookManifestForMigration(),
        manifestRelativePath: 'synthetic/manifest.json',
        manifestHash: 'f'.repeat(64),
      });
      const timestamp = '2026-07-23T00:00:00.000Z';
      service.db.prepare(`
        UPDATE textbook_track_revisions
        SET status = 'published', verified_at_utc = ?
        WHERE id = ?
      `).run(timestamp, imported.revision_id);
      service.db.prepare(`
        UPDATE textbook_tracks
        SET status = 'published', current_revision_id = ?, pending_revision_id = NULL,
          published_at_utc = ?, updated_at_utc = ?
        WHERE id = ?
      `).run(imported.revision_id, timestamp, timestamp, imported.id);
      service.db.prepare(
        'DELETE FROM textbook_expression_review_states WHERE track_revision_id = ?'
      ).run(imported.revision_id);
      service.db.prepare("DELETE FROM schema_migrations WHERE version = '008'").run();

      const result = runMigrations(service.db);
      assert.deepEqual(result.applied, ['008']);
      const review = service.getTextbookReviewSummary(imported.revision_id);
      assert.equal(review.total, 1);
      assert.equal(review.confirmed, 1);
      assert.equal(review.rows[0].reviewer, 'workflow-migration-008');
      assert.equal(review.rows[0].confirmed_at_utc, timestamp);
    } finally {
      service.close();
    }
  });

  test.it('enforces admission enums, identity anchors, and singleton active session', () => {
    const service = new DatabaseService(':memory:');
    const hash = 'a'.repeat(64);
    try {
      const generationId = Number(service.db.prepare(`
        INSERT INTO generations(
          phrase, phrase_language, card_type, source_mode, llm_provider, llm_model,
          folder_name, base_filename, md_file_path, html_file_path, meta_file_path,
          markdown_content, content_hash, generation_date, request_id
        ) VALUES (?, 'en', 'trilingual', 'input', 'deepseek', 'deepseek-v4-pro',
          '20260714', 'migration', '/tmp/migration.md', '/tmp/migration.html', '/tmp/migration.json',
          '# migration', ?, '2026-07-14', 'migration-constraints')
      `).run('migration constraints', hash).lastInsertRowid);
      const insertAdmission = service.db.prepare(`
        INSERT INTO learning_source_admissions(
          generation_id, status, content_hash, reasons_json, decision_version, state_version,
          materialization_disposition, identity_anchor_generation_id, admission_source,
          evaluated_at_utc, created_at_utc, updated_at_utc
        ) VALUES (?, ?, ?, '[]', 'v1', 'state-v1', ?, ?, 'dp7', ?, ?, ?)
      `);
      const now = '2026-07-14T00:00:00.000Z';
      assert.throws(
        () => insertAdmission.run(generationId, 'invalid', hash, 'create-items', generationId, now, now, now),
        /CHECK constraint failed/u
      );
      assert.throws(
        () => insertAdmission.run(generationId, 'eligible', hash, 'create-items', generationId + 1, now, now, now),
        /CHECK constraint failed/u
      );
      insertAdmission.run(generationId, 'eligible', hash, 'create-items', generationId, now, now, now);
      service.db.prepare(`
        INSERT INTO learning_profiles(
          id, time_zone, scheduler_id, scheduler_version, scheduler_adapter,
          parameters_json, parameters_hash, revision, created_at_utc, updated_at_utc
        ) VALUES (1, 'Asia/Shanghai', 'fsrs', '6', 'ts-fsrs@5.4.1', '{}', ?, 1, ?, ?)
      `).run(hash, now, now);
      service.db.prepare(`
        INSERT INTO learning_plans(id, status, scope_json, revision, created_at_utc, updated_at_utc)
        VALUES (1, 'active', '{}', 1, ?, ?)
      `).run(now, now);
      const itemId = Number(service.db.prepare(`
        INSERT INTO study_items(
          generation_id, source_generation_id, unit_key, unit_kind, unit_locator_json,
          content_hash, lifecycle, created_at_utc, updated_at_utc
        ) VALUES (?, ?, 'en', 'trilingual_en', '{}', ?, 'active', ?, ?)
      `).run(generationId, generationId, hash, now, now).lastInsertRowid);
      const queueId = Number(service.db.prepare(`
        INSERT INTO learning_daily_queues(
          plan_id, learning_day, time_zone, plan_revision, profile_revision,
          status, snapshot_json, created_at_utc, updated_at_utc
        ) VALUES (1, '2026-07-14', 'Asia/Shanghai', 1, 1, 'active', '{}', ?, ?)
      `).run(now, now).lastInsertRowid);
      service.db.prepare(`
        INSERT INTO learning_queue_entries(
          queue_id, study_item_id, reason, bucket, status, created_at_utc, updated_at_utc
        ) VALUES (?, ?, 'new', 6, 'active', ?, ?)
      `).run(queueId, itemId, now, now);
      const insertSession = service.db.prepare(`
        INSERT INTO learning_sessions(queue_id, status, started_at_utc, last_activity_at_utc)
        VALUES (?, 'active', ?, ?)
      `);
      insertSession.run(queueId, now, now);
      assert.throws(() => insertSession.run(queueId, now, now), /UNIQUE constraint failed/u);
    } finally {
      service.close();
    }
  });
});
