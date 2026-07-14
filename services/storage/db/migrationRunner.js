'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MIGRATIONS_DIR = path.join(__dirname, '../../../database/migrations');
const BASELINE_VERSION = '000_pre_learning_assistance';
const BASELINE_NAME = 'Cards Factory schema before Learning Assistance 2.0';
const BASELINE_CHECKSUM = crypto.createHash('sha256').update(BASELINE_NAME).digest('hex');

const LEARNING_P0_TABLES = Object.freeze([
  'learning_profiles',
  'learning_source_admissions',
  'learning_plans',
  'study_items',
  'learning_daily_queues',
  'learning_queue_entries',
  'learning_sessions',
  'learning_review_events',
  'learning_schedule_states',
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function ensureMigrationTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL CHECK (length(checksum) = 64),
      is_baseline INTEGER NOT NULL DEFAULT 0 CHECK (is_baseline IN (0, 1)),
      applied_at_utc TEXT NOT NULL
    );
  `);
}

function listMigrationFiles(migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  if (!fs.existsSync(migrationsDir)) return [];
  const seenVersions = new Set();
  return fs.readdirSync(migrationsDir)
    .filter((filename) => /^\d+_[a-z0-9_]+\.sql$/u.test(filename))
    .sort((left, right) => left.localeCompare(right))
    .map((filename) => {
      const match = /^(\d+)_([a-z0-9_]+)\.sql$/u.exec(filename);
      const [, version, name] = match;
      if (seenVersions.has(version)) throw new Error(`Duplicate migration version: ${version}`);
      seenVersions.add(version);
      const sql = fs.readFileSync(path.join(migrationsDir, filename), 'utf8');
      return { version, name, filename, sql, checksum: sha256(sql) };
    });
}

function assertLearningP0Postconditions(db) {
  const existing = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
  );
  const missing = LEARNING_P0_TABLES.filter((table) => !existing.has(table));
  if (missing.length) throw new Error(`Learning P0 migration missing tables: ${missing.join(', ')}`);
}

function runMigrations(db, options = {}) {
  const migrationsDir = options.migrationsDir || DEFAULT_MIGRATIONS_DIR;
  const preexistingTables = new Set(options.preexistingTables || []);
  const now = options.now || (() => new Date().toISOString());
  ensureMigrationTable(db);

  const applied = [];
  const skipped = [];
  let baselineRegistered = false;

  if (preexistingTables.has('generations')) {
    const baseline = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(BASELINE_VERSION);
    if (!baseline) {
      db.prepare(`
        INSERT INTO schema_migrations(version, name, checksum, is_baseline, applied_at_utc)
        VALUES (?, ?, ?, 1, ?)
      `).run(BASELINE_VERSION, BASELINE_NAME, BASELINE_CHECKSUM, now());
      baselineRegistered = true;
    }
  }

  for (const migration of listMigrationFiles(migrationsDir)) {
    const existing = db.prepare(
      'SELECT version, checksum FROM schema_migrations WHERE version = ?'
    ).get(migration.version);
    if (existing) {
      if (existing.checksum !== migration.checksum) {
        throw new Error(
          `Migration checksum mismatch for ${migration.filename}: expected ${existing.checksum}, got ${migration.checksum}`
        );
      }
      skipped.push(migration.version);
      continue;
    }

    const apply = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare(`
        INSERT INTO schema_migrations(version, name, checksum, is_baseline, applied_at_utc)
        VALUES (?, ?, ?, 0, ?)
      `).run(migration.version, migration.name, migration.checksum, now());
    });
    apply();
    applied.push(migration.version);
  }

  assertLearningP0Postconditions(db);
  return { applied, skipped, baselineRegistered };
}

module.exports = {
  BASELINE_VERSION,
  DEFAULT_MIGRATIONS_DIR,
  LEARNING_P0_TABLES,
  assertLearningP0Postconditions,
  ensureMigrationTable,
  listMigrationFiles,
  runMigrations,
  sha256,
};
