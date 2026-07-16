CREATE TABLE IF NOT EXISTS learning_manual_queue_intents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  intent_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  plan_id INTEGER NOT NULL,
  learning_day TEXT NOT NULL CHECK (length(learning_day) = 10),
  time_zone TEXT NOT NULL,
  queue_id INTEGER NOT NULL,
  queue_entry_id INTEGER NOT NULL,
  study_item_id INTEGER NOT NULL,
  policy_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired', 'cancelled')),
  completion_review_event_id INTEGER,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  completed_at_utc TEXT,
  expired_at_utc TEXT,
  cancelled_at_utc TEXT,
  UNIQUE (plan_id, learning_day, study_item_id),
  CHECK ((status = 'completed' AND completion_review_event_id IS NOT NULL AND completed_at_utc IS NOT NULL)
    OR status <> 'completed'),
  CHECK ((status = 'expired' AND expired_at_utc IS NOT NULL) OR status <> 'expired'),
  CHECK ((status = 'cancelled' AND cancelled_at_utc IS NOT NULL) OR status <> 'cancelled'),
  FOREIGN KEY (plan_id) REFERENCES learning_plans(id) ON DELETE RESTRICT,
  FOREIGN KEY (queue_id) REFERENCES learning_daily_queues(id) ON DELETE RESTRICT,
  FOREIGN KEY (queue_entry_id) REFERENCES learning_queue_entries(id) ON DELETE RESTRICT,
  FOREIGN KEY (study_item_id) REFERENCES study_items(id) ON DELETE RESTRICT,
  FOREIGN KEY (completion_review_event_id) REFERENCES learning_review_events(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_learning_manual_intents_day_status
  ON learning_manual_queue_intents(learning_day, status, created_at_utc);
CREATE INDEX IF NOT EXISTS idx_learning_manual_intents_item_status
  ON learning_manual_queue_intents(study_item_id, status, learning_day);
