'use strict';

// Test-only helper: wipe every project-owned table in dependency-safe order.
// Used by /api/_test/reset (mounted only when E2E_TEST_MODE=1) so each
// Playwright spec file can start from a clean DB without restarting the
// server. Never call from production code.
//
// Tables are listed children-first so DELETE works even if a future schema
// change tightens a FK to RESTRICT. The order is hand-maintained; if you
// add a new project table to schema.sql or databaseService's inline CREATE
// statements, add it here (children before parents) and update the unit test.

const TABLES_IN_DELETE_ORDER = [
  // Textbook Courses (immutable facts are reset only in test mode)
  'textbook_card_derivations',
  'textbook_expression_revisions',
  'textbook_expressions',
  'textbook_track_assets',
  'textbook_track_revisions',
  'textbook_tracks',
  'textbook_courses',

  // Learning Assistance 2.0 (projections/events before workflow parents)
  'learning_schedule_states',
  'learning_review_events',
  'learning_sessions',
  'learning_queue_entries',
  'learning_daily_queues',
  'study_items',
  'learning_plans',
  'learning_profiles',
  'learning_source_admissions',

  // generations + observability children
  'audio_files',
  'observability_metrics',
  'generation_errors',

  // highlight sidecars
  'card_highlights',
  'card_tags',

  // generation_jobs
  'generation_job_events',
  'generation_jobs',

  // background tables (counters that accumulate across tests)
  'model_statistics',
  'system_health',

  // parent
  'generations',
];

function truncateAll(db) {
  const txn = db.transaction(() => {
    const immutableTriggers = db.prepare(`
      SELECT name, sql
      FROM sqlite_master
      WHERE type = 'trigger'
        AND name IN (
          'textbook_revision_delete_block',
          'textbook_expression_revision_delete_block',
          'textbook_asset_delete_block'
        )
    `).all();
    for (const trigger of immutableTriggers) {
      db.exec(`DROP TRIGGER IF EXISTS ${trigger.name}`);
    }
    for (const table of TABLES_IN_DELETE_ORDER) {
      // Wrap in a check: a malformed table name in this list would otherwise
      // break the whole reset silently. SQLite throws `no such table` here.
      db.prepare(`DELETE FROM ${table}`).run();
    }
    for (const trigger of immutableTriggers) {
      if (trigger.sql) db.exec(trigger.sql);
    }
    // Reset AUTOINCREMENT counters so generationId etc. start from 1 again,
    // which makes test assertions readable. sqlite_sequence is auto-created
    // only when at least one AUTOINCREMENT table has been populated.
    const hasSeq = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'`
    ).get();
    if (hasSeq) {
      db.prepare(`DELETE FROM sqlite_sequence`).run();
    }
  });
  txn();
}

module.exports = {
  truncateAll,
  TABLES_IN_DELETE_ORDER,
};
