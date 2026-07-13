'use strict';

const FTS_COLUMNS = 'phrase, en_translation, ja_translation, zh_translation, markdown_content';

const GENERATIONS_FTS_TRIGGER_SQL = `
  DROP TRIGGER IF EXISTS generations_fts_insert;
  DROP TRIGGER IF EXISTS generations_fts_delete;
  DROP TRIGGER IF EXISTS generations_fts_update;

  CREATE TRIGGER generations_fts_insert AFTER INSERT ON generations BEGIN
    INSERT INTO generations_fts(rowid, ${FTS_COLUMNS})
    VALUES (new.id, new.phrase, new.en_translation, new.ja_translation, new.zh_translation, new.markdown_content);
  END;

  CREATE TRIGGER generations_fts_delete AFTER DELETE ON generations BEGIN
    INSERT INTO generations_fts(generations_fts, rowid, ${FTS_COLUMNS})
    VALUES ('delete', old.id, old.phrase, old.en_translation, old.ja_translation, old.zh_translation, old.markdown_content);
  END;

  CREATE TRIGGER generations_fts_update AFTER UPDATE ON generations BEGIN
    INSERT INTO generations_fts(generations_fts, rowid, ${FTS_COLUMNS})
    VALUES ('delete', old.id, old.phrase, old.en_translation, old.ja_translation, old.zh_translation, old.markdown_content);
    INSERT INTO generations_fts(rowid, ${FTS_COLUMNS})
    VALUES (new.id, new.phrase, new.en_translation, new.ja_translation, new.zh_translation, new.markdown_content);
  END;
`;

function hasLegacyFtsTriggers(db) {
  const triggers = db.prepare(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'trigger'
      AND name IN ('generations_fts_insert', 'generations_fts_delete', 'generations_fts_update')
  `).all();
  if (triggers.length !== 3) return true;
  return triggers.some((trigger) => /DELETE\s+FROM\s+generations_fts/i.test(trigger.sql || ''));
}

function ensureGenerationsFtsInfrastructure(db, { rebuild = false } = {}) {
  const repaired = hasLegacyFtsTriggers(db);
  if (repaired) db.exec(GENERATIONS_FTS_TRIGGER_SQL);
  if (repaired || rebuild) {
    db.prepare("INSERT INTO generations_fts(generations_fts) VALUES ('rebuild')").run();
  }
  db.prepare("INSERT INTO generations_fts(generations_fts) VALUES ('integrity-check')").run();
  return { repaired, rebuilt: repaired || rebuild };
}

module.exports = {
  GENERATIONS_FTS_TRIGGER_SQL,
  ensureGenerationsFtsInfrastructure,
  hasLegacyFtsTriggers,
};
