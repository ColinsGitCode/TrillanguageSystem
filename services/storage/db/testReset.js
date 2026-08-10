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
  // JLM-A0 metadata: proposals reference jobs, so children first.
  'language_metadata_proposals',
  'language_metadata_jobs',

  // DIC-R2 usage facts: independent of the entries below, cleared first.
  'local_glossary_lookup_events',

  // LLM proposals before confirmed local glossary entries.
  'local_glossary_proposals',
  'local_glossary_entries',

  // Pronunciation projections/events before their document parent.
  'pronunciation_correction_events',
  'pronunciation_tokens',
  'pronunciation_documents',

  // Append-only card interaction facts
  'card_engagement_events',

  // User-managed labels (assignments before the global catalog)
  'manual_tag_assignments',
  'manual_tag_definitions',

  // Card annotations (migration facts before current annotation rows)
  'card_annotation_migration_events',
  'card_annotations',

  // Knowledge Graph 2.0 (read models and append-only facts before parents)
  'kg_source_sync_jobs',
  'kg_planning_signals',
  'kg_point_stats',
  'kg_lookup_events',
  'kg_point_evidence_links',
  'kg_point_surface_links',
  'kg_point_transitions',
  'kg_resolution_events',
  'kg_resolution_cases',
  'kg_evidence',
  'kg_surface_forms',
  'kg_points',

  // Textbook Courses (immutable facts are reset only in test mode)
  'textbook_operation_events',
  'textbook_operations',
  'textbook_expression_review_states',
  'textbook_card_derivations',
  'textbook_expression_revisions',
  'textbook_expressions',
  'textbook_track_assets',
  'textbook_track_revisions',
  'textbook_tracks',
  'textbook_courses',

  // Learning Assistance 2.0 (projections/events before workflow parents)
  'learning_schedule_states',
  'learning_manual_queue_intents',
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
          'textbook_asset_delete_block',
          'textbook_operation_events_update_block',
          'textbook_operation_events_delete_block',
          'local_glossary_lookup_events_update_block',
          'local_glossary_lookup_events_delete_block',
          'card_annotation_migration_events_update_block',
          'card_annotation_migration_events_delete_block',
          'card_engagement_events_update_block',
          'card_engagement_events_delete_block',
          'pronunciation_correction_events_update_block',
          'pronunciation_correction_events_delete_block',
          'kg_resolution_events_update_block',
          'kg_resolution_events_delete_block',
          'kg_point_transitions_update_block',
          'kg_point_transitions_delete_block',
          'kg_lookup_events_update_block',
          'kg_lookup_events_delete_block'
        )
    `).all();
    for (const trigger of immutableTriggers) {
      db.exec(`DROP TRIGGER IF EXISTS ${trigger.name}`);
    }
    for (const table of TABLES_IN_DELETE_ORDER) {
      // Wrap in a check: a malformed table name in this list would otherwise
      // break the whole reset silently. SQLite throws `no such table` here.
      if (table === 'textbook_track_revisions') {
        let remaining = db.prepare('SELECT COUNT(*) AS count FROM textbook_track_revisions').get().count;
        while (remaining > 0) {
          const deleted = db.prepare(`
            DELETE FROM textbook_track_revisions
            WHERE id NOT IN (
              SELECT parent_revision_id
              FROM textbook_track_revisions
              WHERE parent_revision_id IS NOT NULL
            )
          `).run().changes;
          if (!deleted) throw new Error('Unable to delete textbook revision dependency chain');
          remaining -= deleted;
        }
      } else {
        db.prepare(`DELETE FROM ${table}`).run();
      }
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
