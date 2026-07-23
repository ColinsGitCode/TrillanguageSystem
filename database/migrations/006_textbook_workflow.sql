CREATE TABLE IF NOT EXISTS textbook_expression_review_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id INTEGER NOT NULL,
  track_revision_id INTEGER NOT NULL,
  expression_id INTEGER NOT NULL,
  expression_revision_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'needs_attention', 'confirmed')),
  reason_code TEXT,
  reviewer TEXT,
  confirmed_at_utc TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  UNIQUE (track_revision_id, expression_id),
  CHECK ((status = 'confirmed' AND reviewer IS NOT NULL AND confirmed_at_utc IS NOT NULL)
    OR status <> 'confirmed'),
  FOREIGN KEY (track_id) REFERENCES textbook_tracks(id) ON DELETE RESTRICT,
  FOREIGN KEY (track_revision_id) REFERENCES textbook_track_revisions(id) ON DELETE RESTRICT,
  FOREIGN KEY (expression_id) REFERENCES textbook_expressions(id) ON DELETE RESTRICT,
  FOREIGN KEY (expression_revision_id) REFERENCES textbook_expression_revisions(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_textbook_review_track_status
  ON textbook_expression_review_states(track_id, track_revision_id, status, expression_id);

CREATE TABLE IF NOT EXISTS textbook_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id INTEGER NOT NULL,
  track_revision_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('release', 'tts', 'sync')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'partially_failed', 'failed', 'cancelled')),
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  preview_revision TEXT,
  current_step TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  result_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(result_json)),
  public_summary TEXT,
  error_code TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  started_at_utc TEXT,
  finished_at_utc TEXT,
  FOREIGN KEY (track_id) REFERENCES textbook_tracks(id) ON DELETE RESTRICT,
  FOREIGN KEY (track_revision_id) REFERENCES textbook_track_revisions(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_textbook_operations_track_status
  ON textbook_operations(track_id, status, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_textbook_operations_active_kind
  ON textbook_operations(track_id, kind)
  WHERE status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS textbook_operation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id INTEGER NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  event_type TEXT NOT NULL,
  step TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('queued', 'running', 'succeeded', 'partially_failed', 'failed', 'cancelled')),
  public_summary TEXT,
  error_code TEXT,
  retryable INTEGER NOT NULL DEFAULT 0 CHECK (retryable IN (0, 1)),
  occurred_at_utc TEXT NOT NULL,
  UNIQUE (operation_id, sequence),
  FOREIGN KEY (operation_id) REFERENCES textbook_operations(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_textbook_operation_events_operation
  ON textbook_operation_events(operation_id, sequence);

CREATE TRIGGER IF NOT EXISTS textbook_operation_events_update_block
BEFORE UPDATE ON textbook_operation_events
BEGIN
  SELECT RAISE(ABORT, 'textbook operation events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS textbook_operation_events_delete_block
BEFORE DELETE ON textbook_operation_events
BEGIN
  SELECT RAISE(ABORT, 'textbook operation events are immutable');
END;
