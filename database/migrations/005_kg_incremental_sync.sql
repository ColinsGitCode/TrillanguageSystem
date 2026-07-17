CREATE TABLE IF NOT EXISTS kg_source_sync_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation TEXT NOT NULL CHECK (operation IN ('active', 'absent')),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('study_item', 'textbook_expression')),
  source_ref_id INTEGER NOT NULL CHECK (source_ref_id > 0),
  source_revision INTEGER NOT NULL CHECK (source_revision > 0),
  language TEXT NOT NULL DEFAULT '' CHECK (language IN ('', 'en', 'ja')),
  source_content_hash TEXT NOT NULL CHECK (length(source_content_hash) = 64),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'superseded')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  retry_after_ts INTEGER,
  error_code TEXT,
  error_message TEXT,
  plan_hash TEXT CHECK (plan_hash IS NULL OR length(plan_hash) = 64),
  result_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(result_json)),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  started_at_utc TEXT,
  finished_at_utc TEXT,
  UNIQUE (
    operation, source_kind, source_ref_id, source_revision,
    language, source_content_hash
  )
);

CREATE INDEX IF NOT EXISTS idx_kg_source_sync_queue
  ON kg_source_sync_jobs(status, retry_after_ts, id);
CREATE INDEX IF NOT EXISTS idx_kg_source_sync_source
  ON kg_source_sync_jobs(source_kind, source_ref_id, language, id DESC);
