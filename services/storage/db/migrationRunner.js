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

const TEXTBOOK_P1_TABLES = Object.freeze([
  'textbook_courses',
  'textbook_tracks',
  'textbook_track_revisions',
  'textbook_track_assets',
  'textbook_expressions',
  'textbook_expression_revisions',
  'textbook_card_derivations',
]);

const KG_P1_TABLES = Object.freeze([
  'kg_points',
  'kg_surface_forms',
  'kg_evidence',
  'kg_resolution_cases',
  'kg_resolution_events',
  'kg_point_transitions',
  'kg_point_surface_links',
  'kg_point_evidence_links',
  'kg_lookup_events',
  'kg_point_stats',
  'kg_planning_signals',
]);

const LEARNING_P3_TABLES = Object.freeze([
  'learning_manual_queue_intents',
]);

const KG_R2_TABLES = Object.freeze([
  'kg_source_sync_jobs',
]);

const SUPPORTED_DIRECTIVES = new Set(['foreign-keys-off']);

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

function assertTextbookP1Postconditions(db) {
  const existing = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
  );
  const missing = TEXTBOOK_P1_TABLES.filter((table) => !existing.has(table));
  if (missing.length) throw new Error(`Textbook P1 migration missing tables: ${missing.join(', ')}`);
}

function assertKnowledgeGraphP1Postconditions(db) {
  const existing = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
  );
  const missing = KG_P1_TABLES.filter((table) => !existing.has(table));
  if (missing.length) throw new Error(`Knowledge Graph P1 migration missing tables: ${missing.join(', ')}`);
}

function assertLearningP3Postconditions(db) {
  const existing = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
  );
  const missing = LEARNING_P3_TABLES.filter((table) => !existing.has(table));
  if (missing.length) throw new Error(`Learning P3 migration missing tables: ${missing.join(', ')}`);
}

function assertKnowledgeGraphR2Postconditions(db) {
  const existing = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
  );
  const missing = KG_R2_TABLES.filter((table) => !existing.has(table));
  if (missing.length) throw new Error(`Knowledge Graph R2 migration missing tables: ${missing.join(', ')}`);
}

function parseMigrationDirectives(migration) {
  const lines = String(migration.sql || '').split(/\r?\n/u);
  const directives = new Set();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = /^--\s*migration:([a-z0-9-]+)\s*$/u.exec(trimmed);
    if (!match) break;
    const directive = match[1];
    if (!SUPPORTED_DIRECTIVES.has(directive)) {
      throw new Error(`Unsupported migration directive ${directive} in ${migration.filename}`);
    }
    directives.add(directive);
  }
  const stray = lines.find((line, index) => {
    if (!/^--\s*migration:/u.test(line.trim())) return false;
    return index >= directives.size;
  });
  if (stray) throw new Error(`Migration directive must appear before SQL in ${migration.filename}`);
  return directives;
}

function assertNoForeignKeyViolations(db, filename) {
  const violations = db.prepare('PRAGMA foreign_key_check').all();
  if (violations.length) {
    throw new Error(`Foreign key violations after ${filename}: ${JSON.stringify(violations)}`);
  }
}

function applyMigration(db, migration, now) {
  const directives = parseMigrationDirectives(migration);
  const foreignKeysOff = directives.has('foreign-keys-off');
  const transaction = db.transaction(() => {
    db.exec(migration.sql);
    assertNoForeignKeyViolations(db, migration.filename);
    db.prepare(`
      INSERT INTO schema_migrations(version, name, checksum, is_baseline, applied_at_utc)
      VALUES (?, ?, ?, 0, ?)
    `).run(migration.version, migration.name, migration.checksum, now());
  });

  if (!foreignKeysOff) {
    transaction();
    return;
  }

  try {
    db.pragma('foreign_keys = OFF');
    transaction();
  } finally {
    db.pragma('foreign_keys = ON');
  }
  assertNoForeignKeyViolations(db, migration.filename);
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

    applyMigration(db, migration, now);
    applied.push(migration.version);
  }

  assertLearningP0Postconditions(db);
  assertTextbookP1Postconditions(db);
  assertKnowledgeGraphP1Postconditions(db);
  assertLearningP3Postconditions(db);
  assertKnowledgeGraphR2Postconditions(db);
  return { applied, skipped, baselineRegistered };
}

module.exports = {
  BASELINE_VERSION,
  DEFAULT_MIGRATIONS_DIR,
  KG_P1_TABLES,
  KG_R2_TABLES,
  LEARNING_P3_TABLES,
  LEARNING_P0_TABLES,
  TEXTBOOK_P1_TABLES,
  assertLearningP0Postconditions,
  assertKnowledgeGraphP1Postconditions,
  assertKnowledgeGraphR2Postconditions,
  assertLearningP3Postconditions,
  assertTextbookP1Postconditions,
  ensureMigrationTable,
  listMigrationFiles,
  runMigrations,
  sha256,
};
