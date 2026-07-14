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
  LEARNING_P0_TABLES,
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

test.after(() => databaseModule.close());

test.describe('versioned migration runner', () => {
  test.it('registers 001 on a new database and creates all LA-P0 tables', () => {
    const service = new DatabaseService(':memory:');
    try {
      assert.deepEqual(service.migrationResult, {
        applied: ['001'],
        skipped: [],
        baselineRegistered: false,
      });
      const versions = service.db.prepare(
        'SELECT version, is_baseline FROM schema_migrations ORDER BY version'
      ).all();
      assert.deepEqual(versions, [{ version: '001', is_baseline: 0 }]);
      const tables = new Set(service.db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table'"
      ).all().map((row) => row.name));
      LEARNING_P0_TABLES.forEach((table) => assert.ok(tables.has(table), table));
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
