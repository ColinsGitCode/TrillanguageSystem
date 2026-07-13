'use strict';

const CARD_TAG_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS card_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    generation_id INTEGER NOT NULL,
    namespace TEXT NOT NULL,
    value TEXT NOT NULL,
    normalized_value TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'user',
    status TEXT NOT NULL DEFAULT 'active',
    rule_version TEXT,
    rule_key TEXT,
    evidence_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CHECK (namespace IN ('topic', 'fn', 'lang', 'src', 'qa', 'tag')),
    CHECK (source IN ('rule', 'user', 'import')),
    CHECK (status IN ('active', 'suppressed')),
    UNIQUE (generation_id, namespace, normalized_value),
    FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_card_tags_active_ns_value
    ON card_tags(namespace, normalized_value) WHERE status = 'active';
  CREATE INDEX IF NOT EXISTS idx_card_tags_generation ON card_tags(generation_id);
`;

function ensureSchema(db) {
  db.exec(CARD_TAG_SCHEMA_SQL);
}

function listByGeneration(db, generationId, { includeSuppressed = false } = {}) {
  return db.prepare(`
    SELECT * FROM card_tags
    WHERE generation_id = ? ${includeSuppressed ? '' : "AND status = 'active'"}
    ORDER BY namespace, normalized_value
  `).all(generationId);
}

function listActiveForGenerations(db, generationIds = []) {
  const ids = [...new Set(generationIds.map(Number).filter(Number.isInteger))];
  if (!ids.length) return [];
  return db.prepare(`
    SELECT * FROM card_tags
    WHERE status = 'active' AND generation_id IN (${ids.map(() => '?').join(',')})
    ORDER BY generation_id, namespace, normalized_value
  `).all(...ids);
}

function insertRuleIfMissing(db, tag) {
  return db.prepare(`
    INSERT OR IGNORE INTO card_tags (
      generation_id, namespace, value, normalized_value, source, status,
      rule_version, rule_key, evidence_json
    ) VALUES (
      @generationId, @namespace, @value, @normalizedValue, 'rule', 'active',
      @ruleVersion, @ruleKey, @evidenceJson
    )
  `).run(tag);
}

function insertRule(db, tag) {
  return db.prepare(`
    INSERT INTO card_tags (
      generation_id, namespace, value, normalized_value, source, status,
      rule_version, rule_key, evidence_json
    ) VALUES (
      @generationId, @namespace, @value, @normalizedValue, 'rule', 'active',
      @ruleVersion, @ruleKey, @evidenceJson
    )
  `).run({ ruleVersion: null, ruleKey: null, evidenceJson: null, ...tag });
}

function setTag(db, tag) {
  return db.prepare(`
    INSERT INTO card_tags (
      generation_id, namespace, value, normalized_value, source, status,
      rule_version, rule_key, evidence_json
    ) VALUES (
      @generationId, @namespace, @value, @normalizedValue, @source, @status,
      @ruleVersion, @ruleKey, @evidenceJson
    )
    ON CONFLICT(generation_id, namespace, normalized_value) DO UPDATE SET
      value = excluded.value,
      source = excluded.source,
      status = excluded.status,
      rule_version = excluded.rule_version,
      rule_key = excluded.rule_key,
      evidence_json = excluded.evidence_json,
      updated_at = CURRENT_TIMESTAMP
  `).run({ ruleVersion: null, ruleKey: null, evidenceJson: null, ...tag });
}

function counts(db) {
  return db.prepare(`
    SELECT namespace, value, COUNT(*) AS count
    FROM card_tags
    WHERE status = 'active'
    GROUP BY namespace, value
    ORDER BY namespace, value
  `).all();
}

module.exports = {
  CARD_TAG_SCHEMA_SQL,
  counts,
  ensureSchema,
  insertRule,
  insertRuleIfMissing,
  listActiveForGenerations,
  listByGeneration,
  setTag,
};
