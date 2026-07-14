'use strict';

const FTS_COLUMNS = 'phrase, en_translation, ja_translation, zh_translation, markdown_content';

const GENERATIONS_FTS_TRIGGER_SQL = `
  DROP TRIGGER IF EXISTS generations_fts_insert;
  DROP TRIGGER IF EXISTS generations_fts_delete;
  DROP TRIGGER IF EXISTS generations_fts_update;

  CREATE TRIGGER generations_fts_insert AFTER INSERT ON generations
  WHEN new.card_type <> 'textbook_track'
  BEGIN
    INSERT INTO generations_fts(rowid, ${FTS_COLUMNS})
    VALUES (new.id, new.phrase, new.en_translation, new.ja_translation, new.zh_translation, new.markdown_content);
  END;

  CREATE TRIGGER generations_fts_delete AFTER DELETE ON generations
  WHEN old.card_type <> 'textbook_track'
  BEGIN
    INSERT INTO generations_fts(generations_fts, rowid, ${FTS_COLUMNS})
    VALUES ('delete', old.id, old.phrase, old.en_translation, old.ja_translation, old.zh_translation, old.markdown_content);
  END;

  CREATE TRIGGER generations_fts_update AFTER UPDATE ON generations BEGIN
    INSERT INTO generations_fts(generations_fts, rowid, ${FTS_COLUMNS})
    SELECT 'delete', old.id, old.phrase, old.en_translation, old.ja_translation, old.zh_translation, old.markdown_content
    WHERE old.card_type <> 'textbook_track';
    INSERT INTO generations_fts(rowid, ${FTS_COLUMNS})
    SELECT new.id, new.phrase, new.en_translation, new.ja_translation, new.zh_translation, new.markdown_content
    WHERE new.card_type <> 'textbook_track';
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
  return triggers.some((trigger) => {
    const sql = String(trigger.sql || '');
    return /DELETE\s+FROM\s+generations_fts/i.test(sql)
      || !/textbook_track/u.test(sql)
      || (trigger.name !== 'generations_fts_update' && !/\bWHEN\b/u.test(sql));
  });
}

function ensureGenerationsFtsInfrastructure(db, { rebuild = false } = {}) {
  const repaired = hasLegacyFtsTriggers(db);
  if (repaired) db.exec(GENERATIONS_FTS_TRIGGER_SQL);
  if (repaired || rebuild) {
    db.prepare('DELETE FROM generations_fts').run();
    db.prepare(`
      INSERT INTO generations_fts(rowid, ${FTS_COLUMNS})
      SELECT id, ${FTS_COLUMNS}
      FROM generations
      WHERE card_type <> 'textbook_track'
    `).run();
  }
  db.prepare("INSERT INTO generations_fts(generations_fts) VALUES ('integrity-check')").run();
  return { repaired, rebuilt: repaired || rebuild };
}

module.exports = {
  GENERATIONS_FTS_TRIGGER_SQL,
  ensureGenerationsFtsInfrastructure,
  hasLegacyFtsTriggers,
};
