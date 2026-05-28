'use strict';

// knowledge_grammar_patterns + knowledge_grammar_refs domain extracted from
// databaseService.js. The `replace` path is transactional: deactivates the
// previous active version, deletes that job's rows (including refs), then
// re-inserts. Functions take `db` first.

function replaceData(db, patterns = [], jobId) {
  const transaction = db.transaction((payload, versionJobId) => {
    db.prepare(`UPDATE knowledge_grammar_patterns SET is_active = 0 WHERE is_active = 1`).run();
    db.prepare(`DELETE FROM knowledge_grammar_refs WHERE pattern_id IN (SELECT id FROM knowledge_grammar_patterns WHERE version_job_id = ?)`).run(versionJobId);
    db.prepare(`DELETE FROM knowledge_grammar_patterns WHERE version_job_id = ?`).run(versionJobId);

    const insertPattern = db.prepare(`
      INSERT INTO knowledge_grammar_patterns (
        pattern, explanation_zh, confidence, version_job_id, is_active
      ) VALUES (
        @pattern, @explanationZh, @confidence, @versionJobId, 1
      )
    `);
    const insertRef = db.prepare(`
      INSERT OR IGNORE INTO knowledge_grammar_refs (
        pattern_id, generation_id, sentence_excerpt
      ) VALUES (
        @patternId, @generationId, @sentenceExcerpt
      )
    `);

    let count = 0;
    for (const pattern of payload) {
      const result = insertPattern.run({
        pattern: String(pattern.pattern || ''),
        explanationZh: String(pattern.explanationZh || ''),
        confidence: Number(pattern.confidence || 0),
        versionJobId: Number(versionJobId)
      });
      const patternId = Number(result.lastInsertRowid);
      const refs = Array.isArray(pattern.exampleRefs) ? pattern.exampleRefs : [];
      refs.forEach((ref) => {
        if (!ref.generationId) return;
        insertRef.run({
          patternId,
          generationId: Number(ref.generationId),
          sentenceExcerpt: String(ref.sentence || '')
        });
      });
      count += 1;
    }
    return count;
  });

  return transaction(Array.isArray(patterns) ? patterns : [], Number(jobId));
}

function listPatterns(db, { pattern = '', limit = 30 } = {}) {
  const hasPattern = String(pattern || '').trim().length > 0;
  const rows = db.prepare(hasPattern
    ? `
      SELECT *
      FROM knowledge_grammar_patterns
      WHERE is_active = 1
        AND pattern LIKE @pattern
      ORDER BY updated_at DESC
      LIMIT @limit
    `
    : `
      SELECT *
      FROM knowledge_grammar_patterns
      WHERE is_active = 1
      ORDER BY updated_at DESC
      LIMIT @limit
    `
  ).all({
    pattern: `%${String(pattern || '').trim()}%`,
    limit: Math.max(1, Number(limit || 30))
  });

  const refs = db.prepare(`
    SELECT r.pattern_id, r.generation_id, r.sentence_excerpt, g.phrase
    FROM knowledge_grammar_refs r
    LEFT JOIN generations g ON g.id = r.generation_id
    WHERE r.pattern_id IN (
      SELECT id FROM knowledge_grammar_patterns WHERE is_active = 1
    )
    ORDER BY r.id ASC
  `).all();

  const refsMap = new Map();
  refs.forEach((row) => {
    if (!refsMap.has(row.pattern_id)) refsMap.set(row.pattern_id, []);
    refsMap.get(row.pattern_id).push({
      generationId: row.generation_id,
      phrase: row.phrase || '',
      sentence: row.sentence_excerpt || ''
    });
  });

  return rows.map((row) => ({
    id: row.id,
    pattern: row.pattern,
    explanationZh: row.explanation_zh,
    confidence: row.confidence,
    refs: refsMap.get(row.id) || [],
    updatedAt: row.updated_at
  }));
}

module.exports = {
  replaceData,
  listPatterns,
};
