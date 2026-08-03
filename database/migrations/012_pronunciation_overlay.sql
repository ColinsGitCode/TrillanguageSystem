CREATE TABLE IF NOT EXISTS pronunciation_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('generation', 'textbook_track', 'textbook_expression')),
  target_id INTEGER NOT NULL CHECK (target_id > 0),
  source_content_hash TEXT NOT NULL CHECK (length(source_content_hash) = 64),
  projection_version TEXT NOT NULL DEFAULT 'pronunciation-plain-text-v1',
  status TEXT NOT NULL DEFAULT 'ready'
    CHECK (status IN ('partial', 'ready', 'stale', 'archived')),
  analyzer_version TEXT NOT NULL,
  dictionary_version TEXT NOT NULL,
  document_hash TEXT NOT NULL CHECK (length(document_hash) = 64),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  UNIQUE (target_kind, target_id, source_content_hash)
);
CREATE INDEX IF NOT EXISTS idx_pronunciation_documents_target
  ON pronunciation_documents(target_kind, target_id, updated_at_utc DESC);
CREATE INDEX IF NOT EXISTS idx_pronunciation_documents_status
  ON pronunciation_documents(status, updated_at_utc DESC);

CREATE TABLE IF NOT EXISTS pronunciation_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  token_key TEXT NOT NULL,
  surface TEXT NOT NULL CHECK (length(trim(surface)) > 0),
  start_codepoint INTEGER NOT NULL CHECK (start_codepoint >= 0),
  end_codepoint INTEGER NOT NULL CHECK (end_codepoint > start_codepoint),
  reading_raw TEXT,
  reading_hiragana TEXT,
  unit_kind TEXT NOT NULL CHECK (unit_kind IN ('word', 'component', 'kanji', 'punctuation', 'unresolved')),
  status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'unresolved', 'rejected', 'superseded')),
  source TEXT NOT NULL CHECK (source IN ('textbook', 'manual', 'dictionary', 'analyzer', 'rule', 'llm-proposal', 'legacy-ruby')),
  rule_version TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(evidence_json)),
  components_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(components_json)),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  UNIQUE (document_id, token_key),
  FOREIGN KEY (document_id) REFERENCES pronunciation_documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pronunciation_tokens_document_range
  ON pronunciation_tokens(document_id, start_codepoint, end_codepoint);
CREATE INDEX IF NOT EXISTS idx_pronunciation_tokens_status
  ON pronunciation_tokens(status, source);

CREATE TABLE IF NOT EXISTS pronunciation_correction_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE CHECK (length(event_key) BETWEEN 8 AND 160),
  document_id INTEGER NOT NULL,
  token_key TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('reading', 'boundary', 'resolve', 'reject', 'split', 'merge')),
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  expected_revision INTEGER NOT NULL CHECK (expected_revision > 0),
  resulting_revision INTEGER NOT NULL CHECK (resulting_revision > expected_revision),
  created_at_utc TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES pronunciation_documents(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_pronunciation_correction_document
  ON pronunciation_correction_events(document_id, created_at_utc DESC);
CREATE TRIGGER IF NOT EXISTS pronunciation_correction_events_update_block
BEFORE UPDATE ON pronunciation_correction_events
BEGIN
  SELECT RAISE(ABORT, 'pronunciation correction events are immutable');
END;
CREATE TRIGGER IF NOT EXISTS pronunciation_correction_events_delete_block
BEFORE DELETE ON pronunciation_correction_events
BEGIN
  SELECT RAISE(ABORT, 'pronunciation correction events are immutable');
END;
