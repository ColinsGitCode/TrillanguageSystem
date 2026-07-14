CREATE TABLE IF NOT EXISTS learning_profiles (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  time_zone TEXT NOT NULL,
  scheduler_id TEXT NOT NULL,
  scheduler_version TEXT NOT NULL,
  scheduler_adapter TEXT NOT NULL,
  parameters_json TEXT NOT NULL CHECK (json_valid(parameters_json)),
  parameters_hash TEXT NOT NULL CHECK (length(parameters_hash) = 64),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS learning_source_admissions (
  generation_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('eligible', 'whole-card-only', 'quarantined', 'unresolved')),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  reasons_json TEXT NOT NULL CHECK (json_valid(reasons_json) AND json_type(reasons_json) = 'array'),
  decision_version TEXT NOT NULL,
  state_version TEXT NOT NULL,
  dp_state_hash TEXT,
  materialization_disposition TEXT NOT NULL CHECK (materialization_disposition IN ('create-items', 'adopt-existing', 'exclude')),
  identity_anchor_generation_id INTEGER NOT NULL CHECK (identity_anchor_generation_id > 0),
  admission_source TEXT NOT NULL CHECK (admission_source IN ('dp7', 'online', 'manual', 'rule-reassessment')),
  evaluated_at_utc TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  CHECK (
    (materialization_disposition = 'create-items' AND identity_anchor_generation_id = generation_id)
    OR (materialization_disposition = 'adopt-existing' AND identity_anchor_generation_id <> generation_id)
    OR materialization_disposition = 'exclude'
  ),
  FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lsa_status_disposition ON learning_source_admissions(status, materialization_disposition);
CREATE INDEX IF NOT EXISTS idx_lsa_identity_anchor ON learning_source_admissions(identity_anchor_generation_id);

CREATE TABLE IF NOT EXISTS learning_plans (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT NOT NULL CHECK (status IN ('active', 'paused')),
  scope_json TEXT NOT NULL CHECK (json_valid(scope_json)),
  daily_action_goal INTEGER NOT NULL DEFAULT 20 CHECK (daily_action_goal BETWEEN 5 AND 100),
  daily_new_limit INTEGER NOT NULL DEFAULT 5 CHECK (daily_new_limit BETWEEN 0 AND 50),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS study_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generation_id INTEGER,
  source_generation_id INTEGER NOT NULL CHECK (source_generation_id > 0),
  unit_key TEXT NOT NULL,
  unit_kind TEXT NOT NULL CHECK (unit_kind IN ('trilingual_en', 'trilingual_ja', 'grammar_ja', 'scenario_bilingual', 'whole_card')),
  unit_locator_json TEXT NOT NULL CHECK (json_valid(unit_locator_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  content_revision INTEGER NOT NULL DEFAULT 1 CHECK (content_revision >= 1),
  lifecycle TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'suspended', 'archived')),
  lifecycle_reason TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  UNIQUE (source_generation_id, unit_key),
  FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_study_items_generation ON study_items(generation_id);
CREATE INDEX IF NOT EXISTS idx_study_items_lifecycle ON study_items(lifecycle, unit_kind);

CREATE TABLE IF NOT EXISTS learning_daily_queues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  learning_day TEXT NOT NULL CHECK (length(learning_day) = 10),
  time_zone TEXT NOT NULL,
  plan_revision INTEGER NOT NULL CHECK (plan_revision >= 1),
  profile_revision INTEGER NOT NULL CHECK (profile_revision >= 1),
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'active', 'completed', 'superseded')),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  UNIQUE (plan_id, learning_day, plan_revision, profile_revision),
  FOREIGN KEY (plan_id) REFERENCES learning_plans(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_learning_queues_day_status ON learning_daily_queues(learning_day, status);

CREATE TABLE IF NOT EXISTS learning_queue_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  queue_id INTEGER NOT NULL,
  study_item_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  bucket INTEGER NOT NULL CHECK (bucket BETWEEN 1 AND 6),
  provider_score REAL,
  explanation_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(explanation_json)),
  available_at_utc TEXT,
  due_at_utc TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'deferred', 'completed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_event_id INTEGER,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  UNIQUE (queue_id, study_item_id),
  FOREIGN KEY (queue_id) REFERENCES learning_daily_queues(id) ON DELETE CASCADE,
  FOREIGN KEY (study_item_id) REFERENCES study_items(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_learning_entries_queue_status ON learning_queue_entries(queue_id, status, bucket, available_at_utc);

CREATE TABLE IF NOT EXISTS learning_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  queue_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'ended')),
  current_entry_id INTEGER,
  revealed_entry_id INTEGER,
  revealed_at_utc TEXT,
  started_at_utc TEXT NOT NULL,
  last_activity_at_utc TEXT NOT NULL,
  ended_at_utc TEXT,
  FOREIGN KEY (queue_id) REFERENCES learning_daily_queues(id) ON DELETE RESTRICT,
  FOREIGN KEY (current_entry_id) REFERENCES learning_queue_entries(id) ON DELETE SET NULL,
  FOREIGN KEY (revealed_entry_id) REFERENCES learning_queue_entries(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_sessions_one_active ON learning_sessions((1)) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_learning_sessions_queue ON learning_sessions(queue_id, status);

CREATE TABLE IF NOT EXISTS learning_review_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  study_item_id INTEGER NOT NULL,
  session_id INTEGER NOT NULL,
  queue_entry_id INTEGER NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
  response_ms INTEGER NOT NULL CHECK (response_ms >= 0),
  occurred_at_utc TEXT NOT NULL,
  learning_day TEXT NOT NULL CHECK (length(learning_day) = 10),
  time_zone TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  before_state_json TEXT NOT NULL CHECK (json_valid(before_state_json)),
  after_state_json TEXT NOT NULL CHECK (json_valid(after_state_json)),
  algorithm_id TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  parameters_hash TEXT NOT NULL CHECK (length(parameters_hash) = 64),
  public_explanation_json TEXT NOT NULL CHECK (json_valid(public_explanation_json)),
  created_at_utc TEXT NOT NULL,
  FOREIGN KEY (study_item_id) REFERENCES study_items(id) ON DELETE RESTRICT,
  FOREIGN KEY (session_id) REFERENCES learning_sessions(id) ON DELETE RESTRICT,
  FOREIGN KEY (queue_entry_id) REFERENCES learning_queue_entries(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_learning_events_item_time ON learning_review_events(study_item_id, occurred_at_utc DESC);
CREATE INDEX IF NOT EXISTS idx_learning_events_day ON learning_review_events(learning_day);

CREATE TABLE IF NOT EXISTS learning_schedule_states (
  study_item_id INTEGER PRIMARY KEY,
  fsrs_state TEXT NOT NULL CHECK (fsrs_state IN ('new', 'learning', 'review', 'relearning')),
  due_at_utc TEXT NOT NULL,
  last_reviewed_at_utc TEXT,
  stability REAL CHECK (stability IS NULL OR stability >= 0),
  difficulty REAL CHECK (difficulty IS NULL OR difficulty BETWEEN 1 AND 10),
  elapsed_days INTEGER NOT NULL DEFAULT 0 CHECK (elapsed_days >= 0),
  scheduled_days INTEGER NOT NULL DEFAULT 0 CHECK (scheduled_days >= 0),
  reps INTEGER NOT NULL DEFAULT 0 CHECK (reps >= 0),
  lapses INTEGER NOT NULL DEFAULT 0 CHECK (lapses >= 0),
  step INTEGER NOT NULL DEFAULT 0 CHECK (step >= 0),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  last_event_id INTEGER,
  algorithm_id TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  parameters_hash TEXT NOT NULL CHECK (length(parameters_hash) = 64),
  updated_at_utc TEXT NOT NULL,
  FOREIGN KEY (study_item_id) REFERENCES study_items(id) ON DELETE CASCADE,
  FOREIGN KEY (last_event_id) REFERENCES learning_review_events(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_learning_schedule_due ON learning_schedule_states(due_at_utc, fsrs_state);
