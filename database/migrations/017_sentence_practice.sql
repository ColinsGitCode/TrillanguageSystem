CREATE TABLE IF NOT EXISTS sentence_practice_attempts (
  id TEXT PRIMARY KEY,
  generation_id INTEGER REFERENCES generations(id) ON DELETE SET NULL,
  language TEXT NOT NULL CHECK (language IN ('ja', 'en')),
  material_json TEXT NOT NULL,
  scene TEXT NOT NULL,
  cue TEXT NOT NULL,
  reference_answer TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  answer TEXT,
  answered_at_utc TEXT,
  feedback TEXT,
  suggestion TEXT,
  self_assessment TEXT CHECK (self_assessment IN ('independent', 'keep_practicing')),
  disputed INTEGER NOT NULL DEFAULT 0 CHECK (disputed IN (0, 1))
);
CREATE INDEX IF NOT EXISTS idx_sentence_practice_history
  ON sentence_practice_attempts(answered_at_utc DESC) WHERE answered_at_utc IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sentence_practice_pending
  ON sentence_practice_attempts(created_at_utc) WHERE answered_at_utc IS NULL;
