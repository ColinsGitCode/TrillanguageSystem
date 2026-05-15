'use strict';

// Card highlights domain extracted from databaseService.js. Owns the
// card_highlights table (keyed on folder + base + sourceHash) plus the
// HTML-parsing helpers used to recompute markCount / highlightedChars
// on upsert. Functions take `db` first.

function stripHtmlTags(text) {
  return String(text || '').replace(/<[^>]+>/g, '');
}

function decodeBasicHtmlEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function computeHighlightMetricsFromHtml(html) {
  const input = String(html || '');
  if (!input.trim()) return { markCount: 0, highlightedChars: 0 };

  const blockMatches = input.match(/<mark\b[^>]*class=(?:"[^"]*\bstudy-highlight-red\b[^"]*"|'[^']*\bstudy-highlight-red\b[^']*')[^>]*>[\s\S]*?<\/mark>/gi) || [];
  let highlightedChars = 0;

  blockMatches.forEach((block) => {
    const inner = block
      .replace(/^<mark\b[^>]*>/i, '')
      .replace(/<\/mark>$/i, '');
    const plain = decodeBasicHtmlEntities(stripHtmlTags(inner)).replace(/\s+/g, ' ').trim();
    highlightedChars += plain.length;
  });

  return { markCount: blockMatches.length, highlightedChars };
}

function getByFile(db, folderName, baseFilename, sourceHash) {
  if (!folderName || !baseFilename || !sourceHash) return null;
  return db.prepare(`
    SELECT
      id,
      generation_id AS generationId,
      folder_name AS folderName,
      base_filename AS baseFilename,
      source_hash AS sourceHash,
      version,
      html_content AS htmlContent,
      mark_count AS markCount,
      highlighted_chars AS highlightedChars,
      updated_by AS updatedBy,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM card_highlights
    WHERE folder_name = ?
      AND base_filename = ?
      AND source_hash = ?
    LIMIT 1
  `).get(folderName, baseFilename, sourceHash) || null;
}

function upsert(db, payload = {}) {
  const folderName = String(payload.folderName || '').trim();
  const baseFilename = String(payload.baseFilename || '').trim();
  const sourceHash = String(payload.sourceHash || '').trim();
  const htmlContent = String(payload.htmlContent || '');
  if (!folderName || !baseFilename || !sourceHash) {
    throw new Error('folderName/baseFilename/sourceHash are required');
  }
  if (!htmlContent.trim()) {
    throw new Error('htmlContent is required');
  }

  const generationId = payload.generationId ? Number(payload.generationId) : null;
  const version = Number(payload.version || 1);
  const updatedBy = String(payload.updatedBy || 'ui').trim() || 'ui';
  const metrics = computeHighlightMetricsFromHtml(htmlContent);

  db.prepare(`
    INSERT INTO card_highlights (
      generation_id,
      folder_name,
      base_filename,
      source_hash,
      version,
      html_content,
      mark_count,
      highlighted_chars,
      updated_by,
      created_at,
      updated_at
    ) VALUES (
      @generationId,
      @folderName,
      @baseFilename,
      @sourceHash,
      @version,
      @htmlContent,
      @markCount,
      @highlightedChars,
      @updatedBy,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT(folder_name, base_filename, source_hash) DO UPDATE SET
      generation_id = COALESCE(excluded.generation_id, card_highlights.generation_id),
      version = excluded.version,
      html_content = excluded.html_content,
      mark_count = excluded.mark_count,
      highlighted_chars = excluded.highlighted_chars,
      updated_by = excluded.updated_by,
      updated_at = CURRENT_TIMESTAMP
  `).run({
    generationId,
    folderName,
    baseFilename,
    sourceHash,
    version,
    htmlContent,
    markCount: metrics.markCount,
    highlightedChars: metrics.highlightedChars,
    updatedBy
  });

  return getByFile(db, folderName, baseFilename, sourceHash);
}

function deleteByFile(db, folderName, baseFilename, sourceHash = '') {
  if (!folderName || !baseFilename) return 0;
  if (sourceHash) {
    const result = db.prepare(`
      DELETE FROM card_highlights
      WHERE folder_name = ?
        AND base_filename = ?
        AND source_hash = ?
    `).run(folderName, baseFilename, sourceHash);
    return result.changes || 0;
  }
  const result = db.prepare(`
    DELETE FROM card_highlights
    WHERE folder_name = ?
      AND base_filename = ?
  `).run(folderName, baseFilename);
  return result.changes || 0;
}

function getStats(db, { dateFrom, dateTo, provider, cardType } = {}) {
  const conditions = ['1=1'];
  const params = {};

  if (dateFrom) {
    conditions.push(`COALESCE(g.generation_date, date(ch.updated_at)) >= @dateFrom`);
    params.dateFrom = dateFrom;
  }
  if (dateTo) {
    conditions.push(`COALESCE(g.generation_date, date(ch.updated_at)) <= @dateTo`);
    params.dateTo = dateTo;
  }
  if (provider) {
    conditions.push(`g.llm_provider = @provider`);
    params.provider = provider;
  }
  if (cardType) {
    conditions.push(`g.card_type = @cardType`);
    params.cardType = cardType;
  }

  const whereSql = conditions.join(' AND ');

  const overview = db.prepare(`
    SELECT
      COUNT(*) AS highlightedCards,
      SUM(ch.mark_count) AS totalMarks,
      AVG(ch.mark_count) AS avgMarksPerCard,
      SUM(ch.highlighted_chars) AS totalHighlightedChars,
      AVG(ch.highlighted_chars) AS avgHighlightedChars,
      MAX(ch.updated_at) AS lastUpdatedAt
    FROM card_highlights ch
    LEFT JOIN generations g ON g.id = ch.generation_id
    WHERE ${whereSql}
  `).get(params);

  const byCardType = db.prepare(`
    SELECT
      COALESCE(g.card_type, 'unknown') AS cardType,
      COUNT(*) AS cards,
      SUM(ch.mark_count) AS marks,
      AVG(ch.mark_count) AS avgMarks
    FROM card_highlights ch
    LEFT JOIN generations g ON g.id = ch.generation_id
    WHERE ${whereSql}
    GROUP BY COALESCE(g.card_type, 'unknown')
    ORDER BY cards DESC
  `).all(params);

  const byProvider = db.prepare(`
    SELECT
      COALESCE(g.llm_provider, 'unknown') AS provider,
      COUNT(*) AS cards,
      SUM(ch.mark_count) AS marks
    FROM card_highlights ch
    LEFT JOIN generations g ON g.id = ch.generation_id
    WHERE ${whereSql}
    GROUP BY COALESCE(g.llm_provider, 'unknown')
    ORDER BY cards DESC
  `).all(params);

  const trend = db.prepare(`
    SELECT
      date(ch.updated_at) AS day,
      COUNT(*) AS cards,
      SUM(ch.mark_count) AS marks,
      SUM(ch.highlighted_chars) AS highlightedChars
    FROM card_highlights ch
    LEFT JOIN generations g ON g.id = ch.generation_id
    WHERE ${whereSql}
    GROUP BY date(ch.updated_at)
    ORDER BY day DESC
    LIMIT 90
  `).all(params);

  return {
    overview: {
      highlightedCards: Number(overview?.highlightedCards || 0),
      totalMarks: Number(overview?.totalMarks || 0),
      avgMarksPerCard: Number((overview?.avgMarksPerCard || 0).toFixed(2)),
      totalHighlightedChars: Number(overview?.totalHighlightedChars || 0),
      avgHighlightedChars: Number((overview?.avgHighlightedChars || 0).toFixed(2)),
      lastUpdatedAt: overview?.lastUpdatedAt || null
    },
    byCardType,
    byProvider,
    trend
  };
}

module.exports = {
  getByFile,
  upsert,
  deleteByFile,
  getStats,
  // Exposed for tests / future direct callers.
  computeHighlightMetricsFromHtml,
};
