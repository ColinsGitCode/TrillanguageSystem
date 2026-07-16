-- migration:foreign-keys-off

CREATE TABLE IF NOT EXISTS kg_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  point_key TEXT NOT NULL UNIQUE CHECK (length(point_key) = 64),
  kp_kind TEXT NOT NULL CHECK (kp_kind IN ('lexeme', 'phrase', 'grammar_pattern')),
  language TEXT NOT NULL CHECK (language IN ('en', 'ja', 'zh')),
  canonical_form TEXT NOT NULL,
  canonical_reading TEXT,
  sense_discriminator TEXT NOT NULL DEFAULT '',
  identity_version TEXT NOT NULL,
  lifecycle TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'retired', 'archived')),
  created_by_event_id INTEGER,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  FOREIGN KEY (created_by_event_id) REFERENCES kg_resolution_events(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_kg_points_search
  ON kg_points(language, kp_kind, lifecycle, canonical_form);

CREATE TABLE IF NOT EXISTS kg_surface_forms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  surface_key TEXT NOT NULL UNIQUE CHECK (length(surface_key) = 64),
  language TEXT NOT NULL CHECK (language IN ('en', 'ja', 'zh')),
  surface_text TEXT NOT NULL,
  normalized_surface TEXT NOT NULL,
  normalized_reading TEXT,
  analysis_status TEXT NOT NULL CHECK (analysis_status IN ('analyzed', 'unresolved', 'unsupported')),
  analyzer_id TEXT,
  analyzer_version TEXT,
  analysis_rule_version TEXT,
  token_sequence_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(token_sequence_json) AND json_type(token_sequence_json) = 'array'),
  analysis_input_hash TEXT CHECK (analysis_input_hash IS NULL OR length(analysis_input_hash) = 64),
  analysis_output_hash TEXT CHECK (analysis_output_hash IS NULL OR length(analysis_output_hash) = 64),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kg_surface_search
  ON kg_surface_forms(language, normalized_surface, analysis_status);

CREATE TABLE IF NOT EXISTS kg_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evidence_key TEXT NOT NULL UNIQUE CHECK (length(evidence_key) = 64),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('generation', 'study_item', 'textbook_expression')),
  source_ref_id INTEGER NOT NULL CHECK (source_ref_id > 0),
  source_revision INTEGER NOT NULL DEFAULT 1 CHECK (source_revision > 0),
  locator_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(locator_json)),
  language TEXT NOT NULL CHECK (language IN ('en', 'ja', 'zh')),
  source_text TEXT NOT NULL,
  source_content_hash TEXT NOT NULL CHECK (length(source_content_hash) = 64),
  evidence_role TEXT NOT NULL CHECK (evidence_role IN ('primary', 'context')),
  lifecycle TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'superseded', 'orphaned')),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  UNIQUE (source_kind, source_ref_id, source_revision, evidence_key)
);

CREATE INDEX IF NOT EXISTS idx_kg_evidence_source
  ON kg_evidence(source_kind, source_ref_id, lifecycle);

CREATE TABLE IF NOT EXISTS kg_resolution_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_key TEXT NOT NULL UNIQUE CHECK (length(case_key) = 64),
  case_kind TEXT NOT NULL CHECK (case_kind IN ('ambiguous-surface', 'identity-split', 'evidence-conflict', 'unsupported-analysis', 'semantic-proposal')),
  language TEXT NOT NULL CHECK (language IN ('en', 'ja', 'zh')),
  kp_kind_hint TEXT CHECK (kp_kind_hint IS NULL OR kp_kind_hint IN ('lexeme', 'phrase', 'grammar_pattern')),
  surface_form_id INTEGER,
  evidence_id INTEGER,
  normalized_input TEXT NOT NULL,
  candidates_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(candidates_json) AND json_type(candidates_json) = 'array'),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed', 'superseded')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  resolved_point_id INTEGER,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  resolved_at_utc TEXT,
  CHECK ((status = 'resolved' AND resolved_point_id IS NOT NULL) OR status <> 'resolved'),
  FOREIGN KEY (surface_form_id) REFERENCES kg_surface_forms(id) ON DELETE SET NULL,
  FOREIGN KEY (evidence_id) REFERENCES kg_evidence(id) ON DELETE SET NULL,
  FOREIGN KEY (resolved_point_id) REFERENCES kg_points(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_kg_resolution_cases_status
  ON kg_resolution_cases(status, language, case_kind);

CREATE TABLE IF NOT EXISTS kg_resolution_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  case_id INTEGER,
  action TEXT NOT NULL CHECK (action IN ('case-opened', 'candidate-proposed', 'case-resolved', 'case-dismissed', 'case-reopened', 'point-created', 'point-split', 'point-merged', 'surface-attached', 'surface-detached', 'evidence-attached', 'evidence-detached', 'decision-reverted')),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('rule', 'user', 'maintenance', 'llm-proposal')),
  provider_id TEXT,
  model_id TEXT,
  analyzer_id TEXT,
  analyzer_version TEXT,
  rule_version TEXT,
  prompt_schema_version TEXT,
  prompt_version TEXT,
  input_hash TEXT CHECK (input_hash IS NULL OR length(input_hash) = 64),
  output_hash TEXT CHECK (output_hash IS NULL OR length(output_hash) = 64),
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  public_reason TEXT NOT NULL,
  occurred_at_utc TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES kg_resolution_cases(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_kg_resolution_events_case_time
  ON kg_resolution_events(case_id, occurred_at_utc DESC);

CREATE TABLE IF NOT EXISTS kg_point_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  predecessor_point_id INTEGER NOT NULL,
  successor_point_id INTEGER NOT NULL,
  transition_kind TEXT NOT NULL CHECK (transition_kind IN ('split-into', 'merge-into', 'replacement')),
  resolution_event_id INTEGER NOT NULL,
  created_at_utc TEXT NOT NULL,
  CHECK (predecessor_point_id <> successor_point_id),
  UNIQUE (resolution_event_id, predecessor_point_id, successor_point_id, transition_kind),
  FOREIGN KEY (predecessor_point_id) REFERENCES kg_points(id) ON DELETE RESTRICT,
  FOREIGN KEY (successor_point_id) REFERENCES kg_points(id) ON DELETE RESTRICT,
  FOREIGN KEY (resolution_event_id) REFERENCES kg_resolution_events(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_kg_transitions_predecessor
  ON kg_point_transitions(predecessor_point_id, created_at_utc DESC);
CREATE INDEX IF NOT EXISTS idx_kg_transitions_successor
  ON kg_point_transitions(successor_point_id, created_at_utc DESC);

CREATE TABLE IF NOT EXISTS kg_point_surface_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  point_id INTEGER NOT NULL,
  surface_form_id INTEGER NOT NULL,
  link_kind TEXT NOT NULL CHECK (link_kind IN ('canonical', 'inflection-of', 'polite-of')),
  lifecycle TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'superseded')),
  decision_event_id INTEGER NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('deterministic_rule', 'user', 'maintenance')),
  rule_version TEXT,
  confidence REAL NOT NULL DEFAULT 1 CHECK (confidence >= 0 AND confidence <= 1),
  public_reason TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  FOREIGN KEY (point_id) REFERENCES kg_points(id) ON DELETE RESTRICT,
  FOREIGN KEY (surface_form_id) REFERENCES kg_surface_forms(id) ON DELETE RESTRICT,
  FOREIGN KEY (decision_event_id) REFERENCES kg_resolution_events(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kg_point_surface_active
  ON kg_point_surface_links(point_id, surface_form_id, link_kind)
  WHERE lifecycle = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_kg_point_canonical_active
  ON kg_point_surface_links(point_id)
  WHERE lifecycle = 'active' AND link_kind = 'canonical';
CREATE INDEX IF NOT EXISTS idx_kg_surface_links_lookup
  ON kg_point_surface_links(surface_form_id, lifecycle, link_kind);

CREATE TABLE IF NOT EXISTS kg_point_evidence_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  point_id INTEGER NOT NULL,
  evidence_id INTEGER NOT NULL,
  attachment_role TEXT NOT NULL CHECK (attachment_role IN ('primary', 'context')),
  strength TEXT NOT NULL CHECK (strength IN ('strong', 'weak')),
  lifecycle TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'superseded')),
  decision_event_id INTEGER NOT NULL,
  extractor_version TEXT,
  public_reason TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  FOREIGN KEY (point_id) REFERENCES kg_points(id) ON DELETE RESTRICT,
  FOREIGN KEY (evidence_id) REFERENCES kg_evidence(id) ON DELETE RESTRICT,
  FOREIGN KEY (decision_event_id) REFERENCES kg_resolution_events(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kg_point_evidence_active
  ON kg_point_evidence_links(point_id, evidence_id, attachment_role)
  WHERE lifecycle = 'active';
CREATE INDEX IF NOT EXISTS idx_kg_evidence_links_lookup
  ON kg_point_evidence_links(evidence_id, lifecycle, strength);

CREATE TABLE IF NOT EXISTS kg_lookup_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  interaction_kind TEXT NOT NULL CHECK (interaction_kind IN ('explicit_lookup', 'duplicate_generation_attempt')),
  point_id INTEGER,
  resolution_case_id INTEGER,
  surface_form_id INTEGER,
  input_text TEXT NOT NULL,
  normalized_input TEXT NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('en', 'ja', 'zh')),
  kp_kind_hint TEXT CHECK (kp_kind_hint IS NULL OR kp_kind_hint IN ('lexeme', 'phrase', 'grammar_pattern')),
  source_context_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(source_context_json)),
  occurred_at_utc TEXT NOT NULL,
  learning_day TEXT NOT NULL CHECK (length(learning_day) = 10),
  time_zone TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  CHECK ((point_id IS NOT NULL AND resolution_case_id IS NULL) OR (point_id IS NULL AND resolution_case_id IS NOT NULL)),
  FOREIGN KEY (point_id) REFERENCES kg_points(id) ON DELETE RESTRICT,
  FOREIGN KEY (resolution_case_id) REFERENCES kg_resolution_cases(id) ON DELETE RESTRICT,
  FOREIGN KEY (surface_form_id) REFERENCES kg_surface_forms(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_kg_lookup_point_time
  ON kg_lookup_events(point_id, occurred_at_utc DESC);
CREATE INDEX IF NOT EXISTS idx_kg_lookup_case_time
  ON kg_lookup_events(resolution_case_id, occurred_at_utc DESC);
CREATE INDEX IF NOT EXISTS idx_kg_lookup_day
  ON kg_lookup_events(learning_day, interaction_kind);

CREATE TABLE IF NOT EXISTS kg_point_stats (
  point_id INTEGER PRIMARY KEY,
  study_item_count INTEGER NOT NULL DEFAULT 0 CHECK (study_item_count >= 0),
  active_study_item_count INTEGER NOT NULL DEFAULT 0 CHECK (active_study_item_count >= 0),
  due_count INTEGER NOT NULL DEFAULT 0 CHECK (due_count >= 0),
  review_event_count INTEGER NOT NULL DEFAULT 0 CHECK (review_event_count >= 0),
  last_reviewed_at_utc TEXT,
  explicit_lookup_count_7d INTEGER NOT NULL DEFAULT 0 CHECK (explicit_lookup_count_7d >= 0),
  explicit_lookup_count_30d INTEGER NOT NULL DEFAULT 0 CHECK (explicit_lookup_count_30d >= 0),
  duplicate_attempt_count_30d INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_attempt_count_30d >= 0),
  last_lookup_at_utc TEXT,
  evidence_count INTEGER NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  surface_form_count INTEGER NOT NULL DEFAULT 0 CHECK (surface_form_count >= 0),
  source_breakdown_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(source_breakdown_json)),
  projection_version TEXT NOT NULL,
  facts_watermark_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(facts_watermark_json)),
  computed_at_utc TEXT NOT NULL,
  FOREIGN KEY (point_id) REFERENCES kg_points(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS kg_planning_signals (
  study_item_id INTEGER PRIMARY KEY,
  score REAL NOT NULL CHECK (score >= 0 AND score <= 30),
  point_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(point_ids_json) AND json_type(point_ids_json) = 'array'),
  groups_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(groups_json) AND json_type(groups_json) = 'array'),
  reasons_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reasons_json) AND json_type(reasons_json) = 'array'),
  evidence_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidence_json) AND json_type(evidence_json) = 'array'),
  signal_version TEXT NOT NULL,
  source_watermark_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(source_watermark_json)),
  computed_at_utc TEXT NOT NULL,
  FOREIGN KEY (study_item_id) REFERENCES study_items(id) ON DELETE CASCADE
);

CREATE TRIGGER IF NOT EXISTS kg_resolution_events_update_block
BEFORE UPDATE ON kg_resolution_events
BEGIN
  SELECT RAISE(ABORT, 'kg resolution events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS kg_resolution_events_delete_block
BEFORE DELETE ON kg_resolution_events
BEGIN
  SELECT RAISE(ABORT, 'kg resolution events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS kg_point_transitions_update_block
BEFORE UPDATE ON kg_point_transitions
BEGIN
  SELECT RAISE(ABORT, 'kg point transitions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS kg_point_transitions_delete_block
BEFORE DELETE ON kg_point_transitions
BEGIN
  SELECT RAISE(ABORT, 'kg point transitions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS kg_lookup_events_update_block
BEFORE UPDATE ON kg_lookup_events
BEGIN
  SELECT RAISE(ABORT, 'kg lookup events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS kg_lookup_events_delete_block
BEFORE DELETE ON kg_lookup_events
BEGIN
  SELECT RAISE(ABORT, 'kg lookup events are immutable');
END;
