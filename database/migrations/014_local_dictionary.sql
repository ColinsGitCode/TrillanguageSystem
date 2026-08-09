CREATE TABLE IF NOT EXISTS local_dictionary_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  language TEXT NOT NULL CHECK (language IN ('en', 'ja')),
  surface_form TEXT NOT NULL CHECK (length(trim(surface_form)) BETWEEN 1 AND 300),
  normalized_form TEXT NOT NULL CHECK (length(trim(normalized_form)) BETWEEN 1 AND 300),
  lemma TEXT NOT NULL CHECK (length(trim(lemma)) BETWEEN 1 AND 300),
  reading TEXT,
  part_of_speech TEXT,
  zh_gloss TEXT NOT NULL CHECK (length(trim(zh_gloss)) BETWEEN 1 AND 120),
  sense_key TEXT NOT NULL DEFAULT 'default' CHECK (length(trim(sense_key)) BETWEEN 1 AND 80),
  source_id TEXT NOT NULL CHECK (length(trim(source_id)) BETWEEN 1 AND 120),
  dictionary_version TEXT NOT NULL CHECK (length(trim(dictionary_version)) BETWEEN 1 AND 120),
  source_ref_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(source_ref_json)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  UNIQUE(language, normalized_form, sense_key, dictionary_version)
);

CREATE INDEX IF NOT EXISTS idx_local_dictionary_lookup
  ON local_dictionary_entries(language, status, normalized_form, dictionary_version);

CREATE INDEX IF NOT EXISTS idx_local_dictionary_surface
  ON local_dictionary_entries(language, status, surface_form);
