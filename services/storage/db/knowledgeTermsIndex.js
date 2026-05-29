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

function mapRow(row) {
  return {
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
  };
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
  return rows.map(mapRow);
}

// Learner-facing term library: filter by free-text query, language profile,
// card type and tag, with sort + pagination. Returns `{ items, total, limit,
// offset }` so the UI can render a pager. Distinct from `search` (which is the
// legacy capped lookup used elsewhere) — kept separate to avoid changing that
// contract.
function list(db, {
  query = '', langProfile = '', cardType = '', tag = '', clusterKey = '',
  sort = 'recent', limit = 20, offset = 0
} = {}) {
  const where = [];
  const params = {};

  const q = String(query || '').trim();
  if (q) {
    where.push('(phrase LIKE @q OR en_headword LIKE @q OR ja_headword LIKE @q OR zh_headword LIKE @q OR aliases_json LIKE @q)');
    params.q = `%${q}%`;
  }
  const lp = String(langProfile || '').trim().toLowerCase();
  if (lp && lp !== 'all') {
    where.push('lower(lang_profile) = @lp');
    params.lp = lp;
  }
  const ct = String(cardType || '').trim().toLowerCase();
  if (ct && ct !== 'all') {
    where.push('lower(card_type) = @ct');
    params.ct = ct;
  }
  const tg = String(tag || '').trim();
  if (tg) {
    // tags_json stores a JSON array string; match the quoted token so "ge"
    // does not match "general".
    where.push('tags_json LIKE @tag');
    params.tag = `%"${tg}"%`;
  }
  const ck = String(clusterKey || '').trim();
  if (ck && ck !== 'all') {
    // Restrict to terms whose card is mapped to this active cluster (the
    // semantic-classification category nav). Subquery keeps the FROM clause
    // unchanged.
    where.push(`generation_id IN (
      SELECT cc.generation_id
      FROM knowledge_cluster_cards cc
      JOIN knowledge_clusters c ON c.id = cc.cluster_id
      WHERE c.is_active = 1 AND c.cluster_key = @clusterKey
    )`);
    params.clusterKey = ck;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  let orderSql;
  if (sort === 'score') orderSql = 'ORDER BY score DESC, updated_at DESC';
  else if (sort === 'phrase') orderSql = 'ORDER BY phrase COLLATE NOCASE ASC';
  else orderSql = 'ORDER BY updated_at DESC';

  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 20));
  const safeOffset = Math.max(0, Number(offset) || 0);

  const total = db.prepare(`SELECT COUNT(*) AS n FROM knowledge_terms_index ${whereSql}`).get(params).n;
  const rows = db.prepare(
    `SELECT * FROM knowledge_terms_index ${whereSql} ${orderSql} LIMIT @limit OFFSET @offset`
  ).all({ ...params, limit: safeLimit, offset: safeOffset });

  return { items: rows.map(mapRow), total: Number(total || 0), limit: safeLimit, offset: safeOffset };
}

// Aggregate counts for the knowledge-base landing view: total term count plus
// breakdowns by language profile, card type, and the most common tags.
function overview(db, { topTagLimit = 20 } = {}) {
  const total = db.prepare('SELECT COUNT(*) AS n FROM knowledge_terms_index').get().n;

  const byLang = db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(lang_profile), ''), 'mixed') AS lang_profile, COUNT(*) AS count
    FROM knowledge_terms_index
    GROUP BY lang_profile
    ORDER BY count DESC, lang_profile ASC
  `).all().map((row) => ({ langProfile: row.lang_profile, count: Number(row.count || 0) }));

  const byCardType = db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(card_type), ''), 'trilingual') AS card_type, COUNT(*) AS count
    FROM knowledge_terms_index
    GROUP BY card_type
    ORDER BY count DESC, card_type ASC
  `).all().map((row) => ({ cardType: row.card_type, count: Number(row.count || 0) }));

  const tagCounts = new Map();
  for (const row of db.prepare('SELECT tags_json FROM knowledge_terms_index').all()) {
    const tags = safeJsonParse(row.tags_json, []);
    if (!Array.isArray(tags)) continue;
    for (const raw of tags) {
      const key = String(raw || '').trim();
      if (!key) continue;
      tagCounts.set(key, (tagCounts.get(key) || 0) + 1);
    }
  }
  const topTags = [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, Math.max(1, Number(topTagLimit) || 20));

  return { total: Number(total || 0), byLang, byCardType, topTags };
}

module.exports = {
  upsert,
  search,
  list,
  overview,
};
