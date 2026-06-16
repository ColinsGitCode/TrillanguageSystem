'use strict';

// Final knowledge_* slice: knowledge_outputs_raw write + the read-only
// aggregation/relations/summary layer. Methods here cross many knowledge_*
// tables (and generations / observability_metrics), so they land in one
// module rather than splitting by reader-side table.
//
// Functions take `db` first. `aggregateByGenerationIds` is exported so the
// term/pattern/cluster relation getters can share it.

const crypto = require('crypto');
const { safeJsonParse } = require('./helpers');

const KNOWLEDGE_SUPPORTED_CARD_TYPES = ['trilingual', 'grammar_ja'];

function normalizeKnowledgeCardTypes(cardTypes) {
  if (!Array.isArray(cardTypes) || cardTypes.length === 0) {
    return [...KNOWLEDGE_SUPPORTED_CARD_TYPES];
  }

  return Array.from(new Set(cardTypes
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => KNOWLEDGE_SUPPORTED_CARD_TYPES.includes(value))));
}

function insertRawOutput(db, jobId, batchNo, outputData = {}) {
  const inputDigest = crypto
    .createHash('sha1')
    .update(JSON.stringify(outputData.input || {}))
    .digest('hex');

  db.prepare(`
    INSERT INTO knowledge_outputs_raw (
      job_id, batch_no, input_digest, status, output_json, error_message
    ) VALUES (
      @jobId, @batchNo, @inputDigest, @status, @outputJson, @errorMessage
    )
  `).run({
    jobId,
    batchNo: Number(batchNo || 1),
    inputDigest,
    status: String(outputData.status || 'ok'),
    outputJson: JSON.stringify(outputData.output || {}),
    errorMessage: outputData.errorMessage ? String(outputData.errorMessage) : null
  });
}

function getSourceCards(db, scope = {}) {
  const conditions = ['1=1'];
  const params = {};
  const cardTypes = normalizeKnowledgeCardTypes(scope.cardTypes);
  if (cardTypes.length === 0) return [];

  if (scope.folderFrom) {
    conditions.push('g.folder_name >= @folderFrom');
    params.folderFrom = String(scope.folderFrom);
  }
  if (scope.folderTo) {
    conditions.push('g.folder_name <= @folderTo');
    params.folderTo = String(scope.folderTo);
  }
  {
    const placeholders = cardTypes.map((_, idx) => `@cardType${idx}`);
    cardTypes.forEach((value, idx) => {
      params[`cardType${idx}`] = String(value);
    });
    conditions.push(`lower(g.card_type) IN (${placeholders.join(', ')})`);
  }

  const limit = Number(scope.limit || 0);
  const limitSql = Number.isFinite(limit) && limit > 0 ? `LIMIT ${Math.floor(limit)}` : '';

  const sql = `
    SELECT
      g.id, g.phrase, g.card_type, g.source_mode, g.llm_provider, g.llm_model,
      g.folder_name, g.base_filename, g.md_file_path, g.html_file_path,
      g.markdown_content, g.en_translation, g.ja_translation, g.zh_translation,
      g.created_at,
      om.quality_score, om.tokens_total, om.performance_total_ms
    FROM generations g
    LEFT JOIN observability_metrics om ON om.generation_id = g.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY g.created_at DESC
    ${limitSql}
  `;

  return db.prepare(sql).all(params);
}

function getOverview(db, { limit = 8 } = {}) {
  const normalizedLimit = Math.max(1, Number(limit || 8));
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM knowledge_terms_index) AS term_count,
      (SELECT COUNT(*) FROM knowledge_grammar_patterns WHERE is_active = 1) AS grammar_pattern_count,
      (SELECT COUNT(*) FROM knowledge_clusters WHERE is_active = 1) AS cluster_count,
      (SELECT COUNT(*) FROM knowledge_issues WHERE resolved = 0) AS open_issue_count,
      (SELECT COUNT(*) FROM knowledge_jobs WHERE status = 'running') AS running_jobs,
      (SELECT COUNT(*) FROM knowledge_jobs WHERE status = 'queued') AS queued_jobs
  `).get() || {};

  const topTerms = db.prepare(`
    SELECT generation_id, phrase, card_type, score, folder_name
    FROM knowledge_terms_index
    ORDER BY score DESC, updated_at DESC
    LIMIT ?
  `).all(normalizedLimit).map((row) => ({
    generationId: row.generation_id,
    phrase: row.phrase || '',
    cardType: row.card_type || 'trilingual',
    score: Number(row.score || 0),
    folderName: row.folder_name || ''
  }));

  const topPatterns = db.prepare(`
    SELECT pattern, confidence
    FROM knowledge_grammar_patterns
    WHERE is_active = 1
    ORDER BY confidence DESC, updated_at DESC
    LIMIT ?
  `).all(normalizedLimit).map((row) => ({
    pattern: row.pattern || '',
    confidence: Number(row.confidence || 0)
  }));

  const topClusters = db.prepare(`
    SELECT c.cluster_key, c.label, c.confidence, COUNT(cc.generation_id) AS card_count
    FROM knowledge_clusters c
    LEFT JOIN knowledge_cluster_cards cc ON cc.cluster_id = c.id
    WHERE c.is_active = 1
    GROUP BY c.id
    ORDER BY c.confidence DESC, card_count DESC
    LIMIT ?
  `).all(normalizedLimit).map((row) => ({
    clusterKey: row.cluster_key || '',
    label: row.label || '',
    confidence: Number(row.confidence || 0),
    cardCount: Number(row.card_count || 0)
  }));

  const topIssues = db.prepare(`
    SELECT issue_type, severity, COUNT(*) AS issue_count
    FROM knowledge_issues
    WHERE resolved = 0
    GROUP BY issue_type, severity
    ORDER BY issue_count DESC, severity DESC
    LIMIT ?
  `).all(normalizedLimit).map((row) => ({
    issueType: row.issue_type || '',
    severity: row.severity || 'medium',
    count: Number(row.issue_count || 0)
  }));

  return {
    counts: {
      termCount: Number(counts.term_count || 0),
      grammarPatternCount: Number(counts.grammar_pattern_count || 0),
      clusterCount: Number(counts.cluster_count || 0),
      openIssueCount: Number(counts.open_issue_count || 0),
      runningJobs: Number(counts.running_jobs || 0),
      queuedJobs: Number(counts.queued_jobs || 0)
    },
    topTerms,
    topPatterns,
    topClusters,
    topIssues
  };
}

function aggregateByGenerationIds(db, generationIds = [], limit = 12) {
  const ids = Array.from(new Set((Array.isArray(generationIds) ? generationIds : [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0)));
  if (!ids.length) {
    return { patterns: [], clusters: [], issues: [] };
  }

  const placeholders = ids.map(() => '?').join(',');
  const normalizedLimit = Math.max(1, Number(limit || 12));

  const patterns = db.prepare(`
    SELECT p.pattern, MAX(p.confidence) AS confidence, COUNT(DISTINCT r.generation_id) AS card_count
    FROM knowledge_grammar_refs r
    JOIN knowledge_grammar_patterns p ON p.id = r.pattern_id
    WHERE p.is_active = 1
      AND r.generation_id IN (${placeholders})
    GROUP BY p.pattern
    ORDER BY card_count DESC, confidence DESC
    LIMIT ?
  `).all(...ids, normalizedLimit).map((row) => ({
    pattern: row.pattern || '',
    confidence: Number(row.confidence || 0),
    cardCount: Number(row.card_count || 0)
  }));

  const clusters = db.prepare(`
    SELECT c.cluster_key, c.label, MAX(c.confidence) AS confidence, COUNT(DISTINCT cc.generation_id) AS card_count
    FROM knowledge_cluster_cards cc
    JOIN knowledge_clusters c ON c.id = cc.cluster_id
    WHERE c.is_active = 1
      AND cc.generation_id IN (${placeholders})
    GROUP BY c.cluster_key, c.label
    ORDER BY card_count DESC, confidence DESC
    LIMIT ?
  `).all(...ids, normalizedLimit).map((row) => ({
    clusterKey: row.cluster_key || '',
    label: row.label || '',
    confidence: Number(row.confidence || 0),
    cardCount: Number(row.card_count || 0)
  }));

  const issues = db.prepare(`
    SELECT issue_type, severity, COUNT(*) AS issue_count
    FROM knowledge_issues
    WHERE generation_id IN (${placeholders})
    GROUP BY issue_type, severity
    ORDER BY issue_count DESC, severity DESC
    LIMIT ?
  `).all(...ids, normalizedLimit).map((row) => ({
    issueType: row.issue_type || '',
    severity: row.severity || 'medium',
    count: Number(row.issue_count || 0)
  }));

  return { patterns, clusters, issues };
}

function getCardRelations(db, generationId, { limit = 12 } = {}) {
  const id = Number(generationId);
  if (!id) return null;
  const normalizedLimit = Math.max(1, Number(limit || 12));

  const card = db.prepare(`
    SELECT id, phrase, card_type, folder_name, base_filename, llm_provider, llm_model, created_at
    FROM generations
    WHERE id = ?
    LIMIT 1
  `).get(id);
  if (!card) return null;

  const termRow = db.prepare(`
    SELECT *
    FROM knowledge_terms_index
    WHERE generation_id = ?
    LIMIT 1
  `).get(id);

  const grammarHits = db.prepare(`
    SELECT p.pattern, p.explanation_zh, p.confidence, r.sentence_excerpt
    FROM knowledge_grammar_refs r
    JOIN knowledge_grammar_patterns p ON p.id = r.pattern_id
    WHERE r.generation_id = ?
      AND p.is_active = 1
    ORDER BY p.confidence DESC, r.id ASC
    LIMIT ?
  `).all(id, normalizedLimit).map((row) => ({
    pattern: row.pattern || '',
    explanationZh: row.explanation_zh || '',
    confidence: Number(row.confidence || 0),
    sentence: row.sentence_excerpt || ''
  }));

  const clusters = db.prepare(`
    SELECT c.cluster_key, c.label, c.description, c.confidence, cc.score
    FROM knowledge_cluster_cards cc
    JOIN knowledge_clusters c ON c.id = cc.cluster_id
    WHERE cc.generation_id = ?
      AND c.is_active = 1
    ORDER BY cc.score DESC, c.confidence DESC
    LIMIT ?
  `).all(id, normalizedLimit).map((row) => ({
    clusterKey: row.cluster_key || '',
    label: row.label || '',
    description: row.description || '',
    confidence: Number(row.confidence || 0),
    score: Number(row.score || 0)
  }));

  const issues = db.prepare(`
    SELECT issue_type, severity, detail_json, resolved, updated_at
    FROM knowledge_issues
    WHERE generation_id = ?
    ORDER BY
      CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
      updated_at DESC
    LIMIT ?
  `).all(id, normalizedLimit).map((row) => ({
    issueType: row.issue_type || '',
    severity: row.severity || 'medium',
    detail: safeJsonParse(row.detail_json, {}),
    resolved: Boolean(row.resolved),
    updatedAt: row.updated_at
  }));

  const synonymRows = db.prepare(`
    SELECT
      g.id AS group_id,
      g.group_key,
      g.misuse_risk,
      g.recommendation,
      g.confidence,
      g.coverage_ratio,
      m.term,
      m.lang
    FROM knowledge_synonym_members m
    JOIN knowledge_synonym_groups g ON g.id = m.group_id
    WHERE m.generation_id = ?
      AND g.is_active = 1
    ORDER BY g.confidence DESC, m.id ASC
  `).all(id);
  const synonymMap = new Map();
  synonymRows.forEach((row) => {
    const key = Number(row.group_id);
    if (!synonymMap.has(key)) {
      synonymMap.set(key, {
        id: key,
        groupKey: row.group_key || '',
        misuseRisk: row.misuse_risk || 'medium',
        recommendation: row.recommendation || '',
        confidence: Number(row.confidence || 0),
        coverageRatio: Number(row.coverage_ratio || 0),
        members: []
      });
    }
    synonymMap.get(key).members.push({
      term: row.term || '',
      lang: row.lang || ''
    });
  });

  const relatedMap = new Map();
  const clusterRelated = db.prepare(`
    SELECT DISTINCT g.id AS generation_id, g.phrase, g.folder_name, g.base_filename, g.card_type, cc2.score
    FROM knowledge_cluster_cards cc1
    JOIN knowledge_cluster_cards cc2
      ON cc1.cluster_id = cc2.cluster_id
     AND cc2.generation_id != cc1.generation_id
    LEFT JOIN generations g ON g.id = cc2.generation_id
    WHERE cc1.generation_id = ?
    ORDER BY cc2.score DESC, cc2.id ASC
    LIMIT ?
  `).all(id, normalizedLimit);
  clusterRelated.forEach((row) => {
    if (!row.generation_id) return;
    const key = Number(row.generation_id);
    if (!relatedMap.has(key)) {
      relatedMap.set(key, {
        generationId: key,
        phrase: row.phrase || '',
        folderName: row.folder_name || '',
        baseName: row.base_filename || '',
        cardType: row.card_type || 'trilingual',
        reasons: [],
        relevance: 0
      });
    }
    const item = relatedMap.get(key);
    item.reasons.push('cluster');
    item.relevance = Math.max(item.relevance, Number(row.score || 0));
  });
  const grammarRelated = db.prepare(`
    SELECT DISTINCT g.id AS generation_id, g.phrase, g.folder_name, g.base_filename, g.card_type
    FROM knowledge_grammar_refs r1
    JOIN knowledge_grammar_refs r2
      ON r1.pattern_id = r2.pattern_id
     AND r2.generation_id != r1.generation_id
    LEFT JOIN generations g ON g.id = r2.generation_id
    WHERE r1.generation_id = ?
    ORDER BY r2.id ASC
    LIMIT ?
  `).all(id, normalizedLimit);
  grammarRelated.forEach((row) => {
    if (!row.generation_id) return;
    const key = Number(row.generation_id);
    if (!relatedMap.has(key)) {
      relatedMap.set(key, {
        generationId: key,
        phrase: row.phrase || '',
        folderName: row.folder_name || '',
        baseName: row.base_filename || '',
        cardType: row.card_type || 'trilingual',
        reasons: [],
        relevance: 0
      });
    }
    const item = relatedMap.get(key);
    item.reasons.push('pattern');
    item.relevance = Math.max(item.relevance, 1);
  });

  const relatedCards = Array.from(relatedMap.values())
    .map((item) => ({
      ...item,
      reasons: Array.from(new Set(item.reasons))
    }))
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, normalizedLimit);

  return {
    card: {
      generationId: Number(card.id),
      phrase: card.phrase || '',
      cardType: card.card_type || 'trilingual',
      folderName: card.folder_name || '',
      baseName: card.base_filename || '',
      provider: card.llm_provider || '',
      model: card.llm_model || '',
      createdAt: card.created_at
    },
    term: termRow ? {
      generationId: Number(termRow.generation_id),
      phrase: termRow.phrase || '',
      cardType: termRow.card_type || 'trilingual',
      langProfile: termRow.lang_profile || '',
      enHeadword: termRow.en_headword || null,
      jaHeadword: termRow.ja_headword || null,
      zhHeadword: termRow.zh_headword || null,
      aliases: safeJsonParse(termRow.aliases_json, []),
      tags: safeJsonParse(termRow.tags_json, []),
      score: Number(termRow.score || 0)
    } : null,
    grammarHits,
    clusters,
    issues,
    synonymGroups: Array.from(synonymMap.values()),
    relatedCards
  };
}

function getTermRelations(db, term, { limit = 20 } = {}) {
  const keyword = String(term || '').trim();
  if (!keyword) {
    return { term: '', matchedEntries: [], patterns: [], clusters: [], issues: [], relatedCards: [] };
  }
  const normalizedLimit = Math.max(1, Number(limit || 20));
  const rows = db.prepare(`
    SELECT
      t.generation_id, t.phrase, t.card_type, t.folder_name, t.lang_profile,
      t.en_headword, t.ja_headword, t.zh_headword, t.aliases_json, t.tags_json, t.score,
      g.base_filename
    FROM knowledge_terms_index t
    LEFT JOIN generations g ON g.id = t.generation_id
    WHERE t.phrase LIKE @q
       OR t.en_headword LIKE @q
       OR t.ja_headword LIKE @q
       OR t.zh_headword LIKE @q
    ORDER BY t.score DESC, t.updated_at DESC
    LIMIT @limit
  `).all({ q: `%${keyword}%`, limit: normalizedLimit });

  const matchedEntries = rows.map((row) => ({
    generationId: Number(row.generation_id),
    phrase: row.phrase || '',
    cardType: row.card_type || 'trilingual',
    folderName: row.folder_name || '',
    langProfile: row.lang_profile || '',
    enHeadword: row.en_headword || null,
    jaHeadword: row.ja_headword || null,
    zhHeadword: row.zh_headword || null,
    aliases: safeJsonParse(row.aliases_json, []),
    tags: safeJsonParse(row.tags_json, []),
    score: Number(row.score || 0),
    baseName: row.base_filename || ''
  }));

  const generationIds = matchedEntries.map((item) => item.generationId);
  const relatedCards = matchedEntries.slice(0, normalizedLimit).map((item) => ({
    generationId: item.generationId,
    phrase: item.phrase,
    folderName: item.folderName,
    baseName: item.baseName || '',
    cardType: item.cardType,
    reasons: ['term'],
    relevance: item.score
  }));

  const grouped = aggregateByGenerationIds(db, generationIds, normalizedLimit);
  return {
    term: keyword,
    matchedEntries,
    patterns: grouped.patterns,
    clusters: grouped.clusters,
    issues: grouped.issues,
    relatedCards
  };
}

function getPatternRelations(db, pattern, { limit = 20 } = {}) {
  const keyword = String(pattern || '').trim();
  if (!keyword) {
    return { pattern: null, refs: [], terms: [], clusters: [], issues: [], relatedCards: [] };
  }
  const normalizedLimit = Math.max(1, Number(limit || 20));
  const patternRow = db.prepare(`
    SELECT id, pattern, explanation_zh, confidence
    FROM knowledge_grammar_patterns
    WHERE is_active = 1
      AND pattern LIKE @pattern
    ORDER BY confidence DESC, updated_at DESC
    LIMIT 1
  `).get({ pattern: `%${keyword}%` });
  if (!patternRow) {
    return { pattern: null, refs: [], terms: [], clusters: [], issues: [], relatedCards: [] };
  }

  const refs = db.prepare(`
    SELECT r.generation_id, r.sentence_excerpt, g.phrase, g.folder_name, g.base_filename, g.card_type
    FROM knowledge_grammar_refs r
    LEFT JOIN generations g ON g.id = r.generation_id
    WHERE r.pattern_id = ?
    ORDER BY r.id ASC
    LIMIT ?
  `).all(patternRow.id, normalizedLimit).map((row) => ({
    generationId: Number(row.generation_id || 0),
    sentence: row.sentence_excerpt || '',
    phrase: row.phrase || '',
    folderName: row.folder_name || '',
    baseName: row.base_filename || '',
    cardType: row.card_type || 'trilingual'
  }));

  const generationIds = refs.map((row) => row.generationId).filter((id) => id > 0);
  const grouped = aggregateByGenerationIds(db, generationIds, normalizedLimit);
  const terms = db.prepare(`
    SELECT generation_id, phrase, card_type, folder_name, score
    FROM knowledge_terms_index
    WHERE generation_id IN (${generationIds.length ? generationIds.map(() => '?').join(',') : '0'})
    ORDER BY score DESC, updated_at DESC
    LIMIT ?
  `).all(...generationIds, normalizedLimit).map((row) => ({
    generationId: Number(row.generation_id),
    phrase: row.phrase || '',
    cardType: row.card_type || 'trilingual',
    folderName: row.folder_name || '',
    score: Number(row.score || 0)
  }));

  const relatedCards = refs.map((row) => ({
    generationId: row.generationId,
    phrase: row.phrase,
    folderName: row.folderName,
    baseName: row.baseName,
    cardType: row.cardType,
    reasons: ['pattern'],
    relevance: 1
  }));

  return {
    pattern: {
      id: Number(patternRow.id),
      pattern: patternRow.pattern || '',
      explanationZh: patternRow.explanation_zh || '',
      confidence: Number(patternRow.confidence || 0)
    },
    refs,
    terms,
    clusters: grouped.clusters,
    issues: grouped.issues,
    relatedCards
  };
}

function getClusterRelations(db, clusterKey, { limit = 20 } = {}) {
  const keyword = String(clusterKey || '').trim();
  if (!keyword) {
    return { cluster: null, cards: [], terms: [], patterns: [], issues: [] };
  }
  const normalizedLimit = Math.max(1, Number(limit || 20));
  const cluster = db.prepare(`
    SELECT id, cluster_key, label, description, confidence, keywords_json
    FROM knowledge_clusters
    WHERE is_active = 1
      AND cluster_key = @key
    LIMIT 1
  `).get({ key: keyword });
  if (!cluster) {
    return { cluster: null, cards: [], terms: [], patterns: [], issues: [] };
  }

  const cards = db.prepare(`
    SELECT cc.generation_id, cc.score, g.phrase, g.folder_name, g.base_filename, g.card_type
    FROM knowledge_cluster_cards cc
    LEFT JOIN generations g ON g.id = cc.generation_id
    WHERE cc.cluster_id = ?
    ORDER BY cc.score DESC, cc.id ASC
    LIMIT ?
  `).all(cluster.id, normalizedLimit).map((row) => ({
    generationId: Number(row.generation_id || 0),
    phrase: row.phrase || '',
    folderName: row.folder_name || '',
    baseName: row.base_filename || '',
    cardType: row.card_type || 'trilingual',
    score: Number(row.score || 0)
  }));

  const generationIds = cards.map((item) => item.generationId).filter((id) => id > 0);
  const grouped = aggregateByGenerationIds(db, generationIds, normalizedLimit);
  const terms = db.prepare(`
    SELECT generation_id, phrase, card_type, folder_name, score
    FROM knowledge_terms_index
    WHERE generation_id IN (${generationIds.length ? generationIds.map(() => '?').join(',') : '0'})
    ORDER BY score DESC, updated_at DESC
    LIMIT ?
  `).all(...generationIds, normalizedLimit).map((row) => ({
    generationId: Number(row.generation_id),
    phrase: row.phrase || '',
    cardType: row.card_type || 'trilingual',
    folderName: row.folder_name || '',
    score: Number(row.score || 0)
  }));

  return {
    cluster: {
      id: Number(cluster.id),
      clusterKey: cluster.cluster_key || '',
      label: cluster.label || '',
      description: cluster.description || '',
      confidence: Number(cluster.confidence || 0),
      keywords: safeJsonParse(cluster.keywords_json, [])
    },
    cards,
    terms,
    patterns: grouped.patterns,
    issues: grouped.issues
  };
}

function getLatestSummary(db) {
  const row = db.prepare(`
    SELECT r.output_json
    FROM knowledge_outputs_raw r
    INNER JOIN knowledge_jobs j ON j.id = r.job_id
    WHERE j.job_type = 'summary'
      AND j.status IN ('success', 'partial')
    ORDER BY j.finished_at DESC, j.id DESC, r.batch_no ASC
    LIMIT 1
  `).get();
  if (!row) return null;
  const parsed = safeJsonParse(row.output_json, null);
  return parsed && parsed.result ? parsed.result : parsed;
}

module.exports = {
  insertRawOutput,
  getSourceCards,
  getOverview,
  aggregateByGenerationIds,
  getCardRelations,
  getTermRelations,
  getPatternRelations,
  getClusterRelations,
  getLatestSummary,
};
