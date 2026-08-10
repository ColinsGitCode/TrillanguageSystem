-- DIC-R2: real-usage feedback for local Chinese-gloss disambiguation.
--
-- Privacy contract: this table records the selected short term/phrase and the
-- interaction outcome, never its surrounding context. There is deliberately no
-- context/snippet/card-content column, and descriptive fields are allowlisted.

CREATE TABLE IF NOT EXISTS local_glossary_lookup_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  language TEXT NOT NULL CHECK (language IN ('en', 'ja')),
  normalized_form TEXT NOT NULL CHECK (length(trim(normalized_form)) BETWEEN 1 AND 80),
  sense_key TEXT NOT NULL DEFAULT 'default' CHECK (length(trim(sense_key)) BETWEEN 1 AND 80),
  outcome TEXT NOT NULL CHECK (outcome IN ('shown', 'rejected', 'switched', 'corrected')),
  source_kind TEXT NOT NULL CHECK (source_kind IN (
    'current-card', 'textbook', 'manual', 'llm-confirmed', 'imported', 'history-card', 'dictionary'
  )),
  source_detail TEXT CHECK (source_detail IS NULL OR source_detail IN (
    '本卡片', '教材确认', '本地词库', '人工确认', '本地导入', '历史卡片', '本地词典',
    '精选本地词典', '中文维基词典 · 直接日中', 'JMdict · 英中桥接', 'ECDICT'
  )),
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  match_reason TEXT CHECK (match_reason IS NULL OR match_reason IN (
    'reading', 'context', 'exact-form', 'normalized-form'
  )),
  candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
  chosen_rank INTEGER NOT NULL DEFAULT 0 CHECK (chosen_rank >= 0),
  created_at_utc TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_local_glossary_events_term
  ON local_glossary_lookup_events(language, normalized_form, outcome, created_at_utc DESC);

CREATE INDEX IF NOT EXISTS idx_local_glossary_events_outcome
  ON local_glossary_lookup_events(outcome, created_at_utc DESC);

CREATE TRIGGER IF NOT EXISTS local_glossary_lookup_events_update_block
BEFORE UPDATE ON local_glossary_lookup_events
BEGIN
  SELECT RAISE(ABORT, 'local glossary lookup events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS local_glossary_lookup_events_delete_block
BEFORE DELETE ON local_glossary_lookup_events
BEGIN
  SELECT RAISE(ABORT, 'local glossary lookup events are immutable');
END;
