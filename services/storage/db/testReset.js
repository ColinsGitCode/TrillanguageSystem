'use strict';

// Test-only helper: wipe every project-owned table in dependency-safe order.
// Used by /api/_test/reset (mounted only when E2E_TEST_MODE=1) so each
// Playwright spec file can start from a clean DB without restarting the
// server. Never call from production code.
//
// Tables are listed children-first so DELETE works even if a future schema
// change tightens a FK to RESTRICT. The order is hand-maintained; if you
// add a new knowledge_* table to schema.sql or to databaseService's inline
// CREATE TABLE statements, add it here (children before parents) and bump
// the unit test.

const TABLES_IN_DELETE_ORDER = [
  // generations + observability children
  'audio_files',
  'observability_metrics',
  'generation_errors',

  // highlight sidecars
  'card_highlights',

  // spaced-repetition (children of generations)
  'card_reviews',
  'card_srs',

  // knowledge_* (children before parents)
  'knowledge_grammar_refs',
  'knowledge_grammar_patterns',
  'knowledge_cluster_cards',
  'knowledge_clusters',
  'knowledge_synonym_members',
  'knowledge_synonym_candidates',
  'knowledge_synonym_jobs_meta',
  'knowledge_synonym_groups',
  'knowledge_terms_index',
  'knowledge_issues',
  'knowledge_outputs_raw',
  'knowledge_jobs',

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
    for (const table of TABLES_IN_DELETE_ORDER) {
      // Wrap in a check: a malformed table name in this list would otherwise
      // break the whole reset silently. SQLite throws `no such table` here.
      db.prepare(`DELETE FROM ${table}`).run();
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
