CREATE TABLE IF NOT EXISTS local_glossary_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  language TEXT NOT NULL CHECK (language IN ('en', 'ja')),
  canonical_form TEXT NOT NULL CHECK (length(trim(canonical_form)) BETWEEN 1 AND 300),
  normalized_form TEXT NOT NULL CHECK (length(trim(normalized_form)) BETWEEN 1 AND 300),
  sense_key TEXT NOT NULL DEFAULT 'default' CHECK (length(trim(sense_key)) BETWEEN 1 AND 80),
  zh_gloss TEXT NOT NULL CHECK (length(trim(zh_gloss)) BETWEEN 1 AND 120),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('manual', 'llm-confirmed', 'imported')),
  source_ref_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(source_ref_json)),
  confidence TEXT NOT NULL DEFAULT 'high' CHECK (confidence IN ('high', 'medium', 'low')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_local_glossary_active_identity
  ON local_glossary_entries(language, normalized_form, sense_key)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_local_glossary_search
  ON local_glossary_entries(language, status, normalized_form);

CREATE TABLE IF NOT EXISTS local_glossary_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_key TEXT NOT NULL UNIQUE CHECK (length(proposal_key) = 64),
  language TEXT NOT NULL CHECK (language IN ('en', 'ja')),
  surface TEXT NOT NULL CHECK (length(trim(surface)) BETWEEN 1 AND 300),
  normalized_form TEXT NOT NULL CHECK (length(trim(normalized_form)) BETWEEN 1 AND 300),
  context_hash TEXT NOT NULL CHECK (length(context_hash) = 64),
  zh_gloss TEXT NOT NULL CHECK (length(trim(zh_gloss)) BETWEEN 1 AND 120),
  explanation TEXT,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  response_hash TEXT NOT NULL CHECK (length(response_hash) = 64),
  usage_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(usage_json)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  accepted_entry_id INTEGER,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  FOREIGN KEY (accepted_entry_id) REFERENCES local_glossary_entries(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_local_glossary_proposals_status
  ON local_glossary_proposals(status, language, normalized_form, updated_at_utc DESC);
