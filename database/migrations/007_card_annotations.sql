CREATE TABLE IF NOT EXISTS card_annotations (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  target_kind TEXT NOT NULL
    CHECK (target_kind IN ('generation', 'textbook_track', 'textbook_expression')),
  target_id INTEGER NOT NULL CHECK (target_id > 0),
  target_revision TEXT NOT NULL CHECK (length(target_revision) BETWEEN 1 AND 128),
  projection_version TEXT NOT NULL CHECK (length(projection_version) BETWEEN 1 AND 64),
  quote_exact TEXT NOT NULL CHECK (length(quote_exact) BETWEEN 1 AND 1000),
  quote_prefix TEXT NOT NULL DEFAULT '' CHECK (length(quote_prefix) <= 256),
  quote_suffix TEXT NOT NULL DEFAULT '' CHECK (length(quote_suffix) <= 256),
  position_start INTEGER NOT NULL CHECK (position_start >= 0),
  position_end INTEGER NOT NULL CHECK (position_end > position_start),
  annotation_kind TEXT NOT NULL CHECK (annotation_kind IN ('highlight', 'note')),
  color TEXT CHECK (color IS NULL OR color IN ('red', 'yellow', 'green', 'blue')),
  note_text TEXT CHECK (note_text IS NULL OR length(note_text) <= 4000),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'orphaned', 'deleted')),
  source_content_hash TEXT
    CHECK (source_content_hash IS NULL OR length(source_content_hash) = 64),
  legacy_highlight_id INTEGER,
  legacy_payload_json TEXT
    CHECK (legacy_payload_json IS NULL OR json_valid(legacy_payload_json)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  CHECK (
    (annotation_kind = 'highlight' AND color IS NOT NULL)
    OR
    (annotation_kind = 'note' AND length(trim(COALESCE(note_text, ''))) > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_card_annotations_target_status
  ON card_annotations(target_kind, target_id, status, position_start, position_end);
CREATE INDEX IF NOT EXISTS idx_card_annotations_legacy
  ON card_annotations(legacy_highlight_id)
  WHERE legacy_highlight_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_card_annotations_active_anchor
  ON card_annotations(
    target_kind, target_id, projection_version,
    position_start, position_end, annotation_kind
  )
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS card_annotation_migration_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  migration_plan_hash TEXT NOT NULL CHECK (length(migration_plan_hash) = 64),
  legacy_highlight_id INTEGER NOT NULL CHECK (legacy_highlight_id > 0),
  legacy_run_ordinal INTEGER NOT NULL CHECK (legacy_run_ordinal > 0),
  annotation_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('migrated', 'orphaned', 'skipped', 'failed')),
  reason_code TEXT,
  source_fingerprint TEXT NOT NULL CHECK (length(source_fingerprint) = 64),
  created_at_utc TEXT NOT NULL,
  UNIQUE (migration_plan_hash, legacy_highlight_id, legacy_run_ordinal)
);

CREATE INDEX IF NOT EXISTS idx_card_annotation_migration_annotation
  ON card_annotation_migration_events(annotation_id)
  WHERE annotation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_card_annotation_migration_outcome
  ON card_annotation_migration_events(outcome, legacy_highlight_id);

CREATE TRIGGER IF NOT EXISTS card_annotation_migration_events_update_block
BEFORE UPDATE ON card_annotation_migration_events
BEGIN
  SELECT RAISE(ABORT, 'card annotation migration events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS card_annotation_migration_events_delete_block
BEFORE DELETE ON card_annotation_migration_events
BEGIN
  SELECT RAISE(ABORT, 'card annotation migration events are immutable');
END;
