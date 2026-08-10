-- JLM-A0: shadow extraction storage for Japanese linguistic metadata.
--
-- Two tables by design (JLM-D2 ADR §3): a job records that an extraction was
-- attempted, a proposal records what it produced. Keeping them apart is what
-- lets "the provider timed out" stay distinguishable from "this card genuinely
-- has no loanwords" - the P0 run produced two 120s timeouts out of eight cards.
--
-- Nothing here participates in generations.content_hash. Card Markdown is never
-- read from or written to by this domain.

CREATE TABLE IF NOT EXISTS language_metadata_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_key TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('generation', 'textbook_expression')),
  target_id INTEGER NOT NULL CHECK (target_id > 0),
  source_content_hash TEXT NOT NULL CHECK (length(source_content_hash) = 64),
  metadata_kind TEXT NOT NULL CHECK (metadata_kind IN ('foreign-origin')),
  extraction_version TEXT NOT NULL CHECK (length(trim(extraction_version)) BETWEEN 1 AND 80),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'abandoned')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  last_error_code TEXT,
  model TEXT,
  prompt_version TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  UNIQUE (job_key)
);

CREATE INDEX IF NOT EXISTS idx_language_metadata_jobs_target
  ON language_metadata_jobs(target_kind, target_id, status);

CREATE TABLE IF NOT EXISTS language_metadata_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_key TEXT NOT NULL,
  job_id INTEGER,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('generation', 'textbook_expression')),
  target_id INTEGER NOT NULL CHECK (target_id > 0),
  source_content_hash TEXT NOT NULL CHECK (length(source_content_hash) = 64),
  metadata_kind TEXT NOT NULL CHECK (metadata_kind IN ('foreign-origin')),
  surface TEXT NOT NULL CHECK (length(trim(surface)) BETWEEN 1 AND 80),
  start_codepoint INTEGER NOT NULL CHECK (start_codepoint >= 0),
  end_codepoint INTEGER NOT NULL CHECK (end_codepoint > start_codepoint),
  value_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(value_json)),
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  origin TEXT NOT NULL CHECK (origin IN ('llm', 'human')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'stale')),
  model TEXT,
  prompt_version TEXT,
  response_hash TEXT,
  supersedes_proposal_id INTEGER,
  decided_by TEXT,
  decided_at_utc TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  UNIQUE (proposal_key),
  FOREIGN KEY (job_id) REFERENCES language_metadata_jobs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_language_metadata_proposals_target
  ON language_metadata_proposals(target_kind, target_id, source_content_hash, status);
