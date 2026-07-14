-- migration:foreign-keys-off

CREATE TABLE IF NOT EXISTS textbook_courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  source_notice TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS textbook_tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL,
  track_number INTEGER NOT NULL CHECK (track_number > 0),
  display_order INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'verified', 'published', 'archived')),
  current_revision_id INTEGER,
  pending_revision_id INTEGER,
  generation_id INTEGER UNIQUE,
  published_at_utc TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  UNIQUE (course_id, track_number),
  FOREIGN KEY (course_id) REFERENCES textbook_courses(id) ON DELETE RESTRICT,
  FOREIGN KEY (current_revision_id) REFERENCES textbook_track_revisions(id) ON DELETE SET NULL,
  FOREIGN KEY (pending_revision_id) REFERENCES textbook_track_revisions(id) ON DELETE SET NULL,
  FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS textbook_track_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id INTEGER NOT NULL,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  parent_revision_id INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'verified', 'published', 'superseded', 'rejected')),
  origin TEXT NOT NULL CHECK (origin IN ('import', 'user-edit', 'structure-edit', 'ai-regeneration')),
  manifest_schema_version TEXT,
  manifest_relative_path TEXT,
  manifest_hash TEXT CHECK (manifest_hash IS NULL OR length(manifest_hash) = 64),
  source_fingerprint TEXT CHECK (source_fingerprint IS NULL OR length(source_fingerprint) = 64),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  projection_hash TEXT NOT NULL CHECK (length(projection_hash) = 64),
  expression_count INTEGER NOT NULL CHECK (expression_count >= 0),
  skill_name TEXT,
  skill_version TEXT,
  skill_input_summary_json TEXT CHECK (skill_input_summary_json IS NULL OR json_valid(skill_input_summary_json)),
  change_summary_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(change_summary_json)),
  created_at_utc TEXT NOT NULL,
  verified_at_utc TEXT,
  UNIQUE (track_id, revision_number),
  CHECK (
    (
      origin = 'import'
      AND parent_revision_id IS NULL
      AND manifest_schema_version IS NOT NULL
      AND manifest_relative_path IS NOT NULL
      AND manifest_hash IS NOT NULL
      AND source_fingerprint IS NOT NULL
      AND skill_name IS NOT NULL
      AND skill_version IS NOT NULL
      AND skill_input_summary_json IS NOT NULL
    )
    OR (
      origin <> 'import'
      AND parent_revision_id IS NOT NULL
      AND manifest_schema_version IS NULL
      AND manifest_relative_path IS NULL
      AND manifest_hash IS NULL
      AND source_fingerprint IS NULL
    )
  ),
  FOREIGN KEY (track_id) REFERENCES textbook_tracks(id) ON DELETE RESTRICT,
  FOREIGN KEY (parent_revision_id) REFERENCES textbook_track_revisions(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_textbook_revision_source_fingerprint
  ON textbook_track_revisions(source_fingerprint)
  WHERE source_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_textbook_revisions_track_status
  ON textbook_track_revisions(track_id, status, revision_number DESC);

CREATE TABLE IF NOT EXISTS textbook_track_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL,
  asset_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('source_image', 'official_audio')),
  ordinal INTEGER NOT NULL DEFAULT 0 CHECK (ordinal >= 0),
  relative_path TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  mime_type TEXT NOT NULL,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  availability TEXT NOT NULL DEFAULT 'available' CHECK (availability IN ('available', 'missing', 'hash-mismatch')),
  observed_mtime_ms INTEGER CHECK (observed_mtime_ms IS NULL OR observed_mtime_ms >= 0),
  verified_at_utc TEXT,
  UNIQUE (revision_id, asset_key),
  UNIQUE (revision_id, kind, ordinal),
  FOREIGN KEY (revision_id) REFERENCES textbook_track_revisions(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_textbook_assets_revision_kind
  ON textbook_track_assets(revision_id, kind, availability);

CREATE TABLE IF NOT EXISTS textbook_expressions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id INTEGER NOT NULL,
  expression_key TEXT NOT NULL,
  lifecycle TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'retired')),
  created_revision_id INTEGER NOT NULL,
  retired_revision_id INTEGER,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  UNIQUE (track_id, expression_key),
  FOREIGN KEY (track_id) REFERENCES textbook_tracks(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_revision_id) REFERENCES textbook_track_revisions(id) ON DELETE RESTRICT,
  FOREIGN KEY (retired_revision_id) REFERENCES textbook_track_revisions(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_textbook_expressions_track_lifecycle
  ON textbook_expressions(track_id, lifecycle, expression_key);

CREATE TABLE IF NOT EXISTS textbook_expression_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL,
  expression_id INTEGER NOT NULL,
  display_ordinal INTEGER NOT NULL CHECK (display_ordinal > 0),
  official_en_text TEXT NOT NULL,
  official_ja_text TEXT NOT NULL,
  zh_cue_text TEXT NOT NULL,
  ja_ruby_html TEXT NOT NULL,
  phrase_analysis_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(phrase_analysis_json)),
  grammar_points_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(grammar_points_json)),
  confidence_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(confidence_json)),
  source_spans_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(source_spans_json)),
  provenance_json TEXT NOT NULL CHECK (json_valid(provenance_json)),
  editor_note TEXT,
  en_unit_hash TEXT NOT NULL CHECK (length(en_unit_hash) = 64),
  ja_unit_hash TEXT NOT NULL CHECK (length(ja_unit_hash) = 64),
  created_at_utc TEXT NOT NULL,
  UNIQUE (revision_id, expression_id),
  UNIQUE (revision_id, display_ordinal),
  FOREIGN KEY (revision_id) REFERENCES textbook_track_revisions(id) ON DELETE RESTRICT,
  FOREIGN KEY (expression_id) REFERENCES textbook_expressions(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_textbook_expr_revisions_revision_order
  ON textbook_expression_revisions(revision_id, display_ordinal);
CREATE INDEX IF NOT EXISTS idx_textbook_expr_revisions_expression
  ON textbook_expression_revisions(expression_id, revision_id DESC);

CREATE TABLE IF NOT EXISTS textbook_card_derivations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expression_id INTEGER NOT NULL,
  source_expression_revision_id INTEGER NOT NULL,
  selection_language TEXT NOT NULL CHECK (selection_language IN ('en', 'ja')),
  selection_text TEXT NOT NULL,
  selection_hash TEXT NOT NULL CHECK (length(selection_hash) = 64),
  target_card_type TEXT NOT NULL CHECK (target_card_type IN ('trilingual', 'grammar_ja')),
  target_generation_id INTEGER,
  target_job_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'superseded')),
  derivation_revision INTEGER NOT NULL DEFAULT 1 CHECK (derivation_revision >= 1),
  request_context_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(request_context_json)),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  UNIQUE (expression_id, selection_hash, target_card_type),
  FOREIGN KEY (expression_id) REFERENCES textbook_expressions(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_expression_revision_id) REFERENCES textbook_expression_revisions(id) ON DELETE RESTRICT,
  FOREIGN KEY (target_generation_id) REFERENCES generations(id) ON DELETE SET NULL,
  FOREIGN KEY (target_job_id) REFERENCES generation_jobs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_textbook_derivations_expression_status
  ON textbook_card_derivations(expression_id, status);
CREATE INDEX IF NOT EXISTS idx_textbook_derivations_target_generation
  ON textbook_card_derivations(target_generation_id)
  WHERE target_generation_id IS NOT NULL;

CREATE VIRTUAL TABLE IF NOT EXISTS textbook_expressions_fts USING fts5(
  official_en_text,
  official_ja_text,
  zh_cue_text,
  content=textbook_expression_revisions,
  content_rowid=id
);

CREATE TRIGGER IF NOT EXISTS textbook_expr_fts_insert AFTER INSERT ON textbook_expression_revisions BEGIN
  INSERT INTO textbook_expressions_fts(rowid, official_en_text, official_ja_text, zh_cue_text)
  VALUES (new.id, new.official_en_text, new.official_ja_text, new.zh_cue_text);
END;

CREATE TRIGGER IF NOT EXISTS textbook_expr_fts_delete AFTER DELETE ON textbook_expression_revisions BEGIN
  INSERT INTO textbook_expressions_fts(textbook_expressions_fts, rowid, official_en_text, official_ja_text, zh_cue_text)
  VALUES ('delete', old.id, old.official_en_text, old.official_ja_text, old.zh_cue_text);
END;

CREATE TRIGGER IF NOT EXISTS textbook_expr_fts_update AFTER UPDATE ON textbook_expression_revisions BEGIN
  INSERT INTO textbook_expressions_fts(textbook_expressions_fts, rowid, official_en_text, official_ja_text, zh_cue_text)
  VALUES ('delete', old.id, old.official_en_text, old.official_ja_text, old.zh_cue_text);
  INSERT INTO textbook_expressions_fts(rowid, official_en_text, official_ja_text, zh_cue_text)
  VALUES (new.id, new.official_en_text, new.official_ja_text, new.zh_cue_text);
END;

CREATE TRIGGER IF NOT EXISTS textbook_revision_delete_block
BEFORE DELETE ON textbook_track_revisions
BEGIN
  SELECT RAISE(ABORT, 'textbook track revisions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS textbook_expression_revision_delete_block
BEFORE DELETE ON textbook_expression_revisions
BEGIN
  SELECT RAISE(ABORT, 'textbook expression revisions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS textbook_asset_delete_block
BEFORE DELETE ON textbook_track_assets
BEGIN
  SELECT RAISE(ABORT, 'textbook track assets are immutable');
END;

CREATE TRIGGER IF NOT EXISTS textbook_track_course_owner_insert
BEFORE INSERT ON textbook_track_revisions
WHEN (SELECT COUNT(*) FROM textbook_tracks WHERE id = NEW.track_id) = 0
BEGIN
  SELECT RAISE(ABORT, 'textbook revision track does not exist');
END;

CREATE TRIGGER IF NOT EXISTS textbook_asset_revision_owner_insert
BEFORE INSERT ON textbook_track_assets
WHEN (SELECT COUNT(*) FROM textbook_track_revisions WHERE id = NEW.revision_id) = 0
BEGIN
  SELECT RAISE(ABORT, 'textbook asset revision does not exist');
END;

CREATE TRIGGER IF NOT EXISTS textbook_expression_revision_owner_insert
BEFORE INSERT ON textbook_expression_revisions
WHEN (
  SELECT track_id FROM textbook_expressions WHERE id = NEW.expression_id
) <> (
  SELECT track_id FROM textbook_track_revisions WHERE id = NEW.revision_id
)
BEGIN
  SELECT RAISE(ABORT, 'textbook expression revision crosses track boundary');
END;

DROP TRIGGER IF EXISTS generations_fts_insert;
DROP TRIGGER IF EXISTS generations_fts_delete;
DROP TRIGGER IF EXISTS generations_fts_update;
DELETE FROM generations_fts;
INSERT INTO generations_fts(rowid, phrase, en_translation, ja_translation, zh_translation, markdown_content)
SELECT id, phrase, en_translation, ja_translation, zh_translation, markdown_content
FROM generations
WHERE card_type <> 'textbook_track';

CREATE TRIGGER generations_fts_insert AFTER INSERT ON generations
WHEN new.card_type <> 'textbook_track'
BEGIN
  INSERT INTO generations_fts(rowid, phrase, en_translation, ja_translation, zh_translation, markdown_content)
  VALUES (new.id, new.phrase, new.en_translation, new.ja_translation, new.zh_translation, new.markdown_content);
END;

CREATE TRIGGER generations_fts_delete AFTER DELETE ON generations
WHEN old.card_type <> 'textbook_track'
BEGIN
  INSERT INTO generations_fts(generations_fts, rowid, phrase, en_translation, ja_translation, zh_translation, markdown_content)
  VALUES ('delete', old.id, old.phrase, old.en_translation, old.ja_translation, old.zh_translation, old.markdown_content);
END;

CREATE TRIGGER generations_fts_update AFTER UPDATE ON generations
BEGIN
  INSERT INTO generations_fts(generations_fts, rowid, phrase, en_translation, ja_translation, zh_translation, markdown_content)
  SELECT 'delete', old.id, old.phrase, old.en_translation, old.ja_translation, old.zh_translation, old.markdown_content
  WHERE old.card_type <> 'textbook_track';
  INSERT INTO generations_fts(rowid, phrase, en_translation, ja_translation, zh_translation, markdown_content)
  SELECT new.id, new.phrase, new.en_translation, new.ja_translation, new.zh_translation, new.markdown_content
  WHERE new.card_type <> 'textbook_track';
END;

CREATE TABLE study_items_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generation_id INTEGER,
  source_generation_id INTEGER NOT NULL CHECK (source_generation_id > 0),
  unit_key TEXT NOT NULL,
  unit_kind TEXT NOT NULL CHECK (unit_kind IN ('trilingual_en', 'trilingual_ja', 'grammar_ja', 'scenario_bilingual', 'whole_card', 'textbook_en', 'textbook_ja')),
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

INSERT INTO study_items_new(
  id, generation_id, source_generation_id, unit_key, unit_kind, unit_locator_json,
  content_hash, content_revision, lifecycle, lifecycle_reason, created_at_utc, updated_at_utc
)
SELECT
  id, generation_id, source_generation_id, unit_key, unit_kind, unit_locator_json,
  content_hash, content_revision, lifecycle, lifecycle_reason, created_at_utc, updated_at_utc
FROM study_items;

DROP TABLE study_items;
ALTER TABLE study_items_new RENAME TO study_items;
CREATE INDEX IF NOT EXISTS idx_study_items_generation ON study_items(generation_id);
CREATE INDEX IF NOT EXISTS idx_study_items_lifecycle ON study_items(lifecycle, unit_kind);
