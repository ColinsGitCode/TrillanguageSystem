-- migration:foreign-keys-off

DROP TRIGGER IF EXISTS card_engagement_events_update_block;
DROP TRIGGER IF EXISTS card_engagement_events_delete_block;

CREATE TABLE card_engagement_events_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE CHECK (length(event_key) BETWEEN 8 AND 128),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  generation_id INTEGER,
  phrase_normalized TEXT NOT NULL CHECK (length(trim(phrase_normalized)) BETWEEN 1 AND 500),
  card_type TEXT NOT NULL
    CHECK (card_type IN ('trilingual', 'grammar_ja', 'scenario_phrase', 'textbook_track')),
  event_kind TEXT NOT NULL CHECK (event_kind IN (
    'generation_requested',
    'duplicate_card_hit',
    'existing_card_opened',
    'added_to_today',
    'new_version_requested',
    'library_search_submitted'
  )),
  source_surface TEXT NOT NULL DEFAULT 'cards_factory'
    CHECK (source_surface IN ('cards_factory', 'card_modal', 'learning_history', 'api')),
  learning_day TEXT NOT NULL CHECK (length(learning_day) = 10),
  time_zone TEXT NOT NULL CHECK (length(trim(time_zone)) BETWEEN 1 AND 64),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at_utc TEXT NOT NULL
);

INSERT INTO card_engagement_events_next (
  id,
  event_key,
  request_hash,
  generation_id,
  phrase_normalized,
  card_type,
  event_kind,
  source_surface,
  learning_day,
  time_zone,
  metadata_json,
  created_at_utc
)
SELECT
  id,
  event_key,
  request_hash,
  generation_id,
  phrase_normalized,
  card_type,
  event_kind,
  source_surface,
  learning_day,
  time_zone,
  metadata_json,
  created_at_utc
FROM card_engagement_events;

DROP TABLE card_engagement_events;
ALTER TABLE card_engagement_events_next RENAME TO card_engagement_events;

CREATE INDEX idx_card_engagement_generation_kind_day
  ON card_engagement_events(generation_id, event_kind, learning_day);
CREATE INDEX idx_card_engagement_phrase_type_kind
  ON card_engagement_events(phrase_normalized, card_type, event_kind, created_at_utc DESC);
CREATE INDEX idx_card_engagement_day_kind
  ON card_engagement_events(learning_day, event_kind, created_at_utc DESC);

CREATE TRIGGER card_engagement_events_update_block
BEFORE UPDATE ON card_engagement_events
BEGIN
  SELECT RAISE(ABORT, 'card engagement events are immutable');
END;

CREATE TRIGGER card_engagement_events_delete_block
BEFORE DELETE ON card_engagement_events
BEGIN
  SELECT RAISE(ABORT, 'card engagement events are immutable');
END;
