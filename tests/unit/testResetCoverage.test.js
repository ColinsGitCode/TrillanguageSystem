'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { TABLES_IN_DELETE_ORDER } = require('../../services/storage/db/testReset');

const SCHEMA_PATH = path.join(__dirname, '../../database/schema.sql');

// Tables that must survive a reset: migration bookkeeping, seeded reference
// data that is reloaded at startup rather than per test, and virtual/FTS
// infrastructure that is rebuilt from its base table.
const INTENTIONALLY_KEPT = new Set([
  'schema_migrations',
  'local_dictionary_entries',
  'generations_fts',
  'generations_fts_data',
  'generations_fts_idx',
  'generations_fts_docsize',
  'generations_fts_config',
  'generations_fts_content',
  // FTS5 index kept in sync by triggers on textbook_expressions, so clearing
  // the base table clears this too.
  'textbook_expressions_fts',
]);

function schemaTables() {
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const names = new Set();
  const pattern = /CREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([A-Za-z_][A-Za-z0-9_]*)["'`]?/giu;
  let match = pattern.exec(sql);
  while (match) {
    names.add(match[1]);
    match = pattern.exec(sql);
  }
  return names;
}

test.describe('test reset covers every resettable project table', () => {
  // Regression guard: local_glossary_lookup_events was added to schema.sql
  // without being added here, which let usage facts leak between tests.
  test.it('every schema table is either reset or explicitly kept', () => {
    const reset = new Set(TABLES_IN_DELETE_ORDER);
    const missing = [...schemaTables()].filter((table) => (
      !reset.has(table) && !INTENTIONALLY_KEPT.has(table)
    ));
    assert.deepEqual(
      missing,
      [],
      `Add these tables to TABLES_IN_DELETE_ORDER (children first) or to INTENTIONALLY_KEPT: ${missing.join(', ')}`
    );
  });

  test.it('does not list a table that no longer exists in the schema', () => {
    const tables = schemaTables();
    const stale = TABLES_IN_DELETE_ORDER.filter((table) => !tables.has(table));
    assert.deepEqual(stale, [], `Stale entries in TABLES_IN_DELETE_ORDER: ${stale.join(', ')}`);
  });

  test.it('lists each table exactly once', () => {
    const duplicates = TABLES_IN_DELETE_ORDER.filter(
      (table, index) => TABLES_IN_DELETE_ORDER.indexOf(table) !== index
    );
    assert.deepEqual(duplicates, []);
  });
});
