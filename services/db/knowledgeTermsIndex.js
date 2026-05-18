'use strict';

// knowledge_terms_index domain extracted from databaseService.js. Owns the
// upsert-by-generation_id write path plus the cross-headword search read.
// Functions take `db` first.

const { safeJsonParse } = require('./helpers');

function upsert(db, entries = [], jobId = null) {
  if (!Array.isArray(entries) || entries.length === 0) return 0;
  const stmt = db.prepare(`
    INSERT INTO knowledge_terms_index (
      generation_id, phrase, card_type, folder_name, lang_profile,
      en_headword, ja_headword, zh_headword, aliases_json, tags_json,
      score, last_job_id, updated_at
    ) VALUES (
      @generationId, @phrase, @cardType, @folderName, @langProfile,
      @enHeadword, @jaHeadword, @zhHeadword, @aliasesJson, @tagsJson,
      @score, @lastJobId, CURRENT_TIMESTAMP
    )
    ON CONFLICT(generation_id) DO UPDATE SET
      phrase = excluded.phrase,
      card_type = excluded.card_type,
      folder_name = excluded.folder_name,
      lang_profile = excluded.lang_profile,
      en_headword = excluded.en_headword,
      ja_headword = excluded.ja_headword,
      zh_headword = excluded.zh_headword,
      aliases_json = excluded.aliases_json,
      tags_json = excluded.tags_json,
      score = excluded.score,
      last_job_id = excluded.last_job_id,
      updated_at = CURRENT_TIMESTAMP
  `);
  const transaction = db.transaction((rows) => {
    let count = 0;
    for (const item of rows) {
      stmt.run({
        generationId: Number(item.generationId),
        phrase: String(item.phrase || ''),
        cardType: String(item.cardType || 'trilingual'),
        folderName: String(item.folderName || ''),
        langProfile: String(item.langProfile || 'mixed'),
        enHeadword: item.enHeadword || null,
        jaHeadword: item.jaHeadword || null,
        zhHeadword: item.zhHeadword || null,
        aliasesJson: JSON.stringify(item.aliases || []),
        tagsJson: JSON.stringify(item.tags || []),
        score: Number(item.score || 0),
        lastJobId: jobId ? Number(jobId) : null
      });
      count += 1;
    }
    return count;
  });
  return transaction(entries);
}

function search(db, { query = '', limit = 50 } = {}) {
  const hasQuery = String(query || '').trim().length > 0;
  const sql = hasQuery
    ? `
      SELECT *
      FROM knowledge_terms_index
      WHERE phrase LIKE @q OR en_headword LIKE @q OR ja_headword LIKE @q OR zh_headword LIKE @q
      ORDER BY updated_at DESC
      LIMIT @limit
    `
    : `
      SELECT *
      FROM knowledge_terms_index
      ORDER BY updated_at DESC
      LIMIT @limit
    `;
  const rows = db.prepare(sql).all({
    q: `%${String(query || '').trim()}%`,
    limit: Math.max(1, Number(limit || 50))
  });
  return rows.map((row) => ({
    generationId: row.generation_id,
    phrase: row.phrase,
    cardType: row.card_type,
    folderName: row.folder_name,
    langProfile: row.lang_profile,
    enHeadword: row.en_headword,
    jaHeadword: row.ja_headword,
    zhHeadword: row.zh_headword,
    aliases: safeJsonParse(row.aliases_json, []),
    tags: safeJsonParse(row.tags_json, []),
    score: row.score,
    updatedAt: row.updated_at
  }));
}

module.exports = {
  upsert,
  search,
};
