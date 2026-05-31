'use strict';

// Learning plan: assemble a staged study path from existing data — one stage
// per active semantic cluster (a category on the function/topic axis), each
// with SRS progress (learned / due / new) and a difficulty breakdown. Stages
// are ordered easy → hard (by average card difficulty). Deterministic; no LLM.

const { buildDifficultyScoreSql, levelFromScore } = require('../../srs/difficulty');

function getLearningPlan(db, { axis = 'all' } = {}) {
  const ax = String(axis || '').trim().toLowerCase();
  const where = ['c.is_active = 1'];
  const params = {};
  if (ax && ax !== 'all') {
    where.push('lower(c.taxonomy) = @axis');
    params.axis = ax;
  }
  const score = buildDifficultyScoreSql('t', 's');

  const rows = db.prepare(`
    SELECT
      c.cluster_key, c.label, c.taxonomy,
      COUNT(cc.generation_id) AS total,
      SUM(CASE WHEN s.repetitions >= 2 THEN 1 ELSE 0 END) AS learned,
      SUM(CASE WHEN s.id IS NOT NULL AND s.due_date <= date('now') THEN 1 ELSE 0 END) AS due_now,
      SUM(CASE WHEN s.id IS NULL THEN 1 ELSE 0 END) AS new_count,
      AVG(${score}) AS avg_difficulty,
      SUM(CASE WHEN (${score}) < 34 THEN 1 ELSE 0 END) AS easy,
      SUM(CASE WHEN (${score}) >= 34 AND (${score}) < 67 THEN 1 ELSE 0 END) AS medium,
      SUM(CASE WHEN (${score}) >= 67 THEN 1 ELSE 0 END) AS hard
    FROM knowledge_clusters c
    JOIN knowledge_cluster_cards cc ON cc.cluster_id = c.id
    LEFT JOIN card_srs s ON s.generation_id = cc.generation_id
    LEFT JOIN knowledge_terms_index t ON t.generation_id = cc.generation_id
    WHERE ${where.join(' AND ')}
    GROUP BY c.id
    HAVING total > 0
    ORDER BY avg_difficulty ASC, total DESC
  `).all(params);

  const stages = rows.map((r, i) => {
    const avg = Math.round(Number(r.avg_difficulty || 0));
    return {
      order: i + 1,
      clusterKey: r.cluster_key,
      label: r.label,
      taxonomy: r.taxonomy || null,
      total: Number(r.total || 0),
      learned: Number(r.learned || 0),
      due: Number(r.due_now || 0),
      newCount: Number(r.new_count || 0),
      avgDifficulty: avg,
      difficultyLevel: levelFromScore(avg),
      breakdown: {
        easy: Number(r.easy || 0),
        medium: Number(r.medium || 0),
        hard: Number(r.hard || 0)
      }
    };
  });

  const summary = stages.reduce((acc, st) => {
    acc.total += st.total;
    acc.learned += st.learned;
    acc.due += st.due;
    acc.newCount += st.newCount;
    return acc;
  }, { stageCount: stages.length, total: 0, learned: 0, due: 0, newCount: 0 });
  // The recommended next stage is the easiest one that is not yet fully learned.
  const next = stages.find((st) => st.learned < st.total) || null;
  summary.recommendedStage = next ? next.clusterKey : null;

  return { stages, summary };
}

module.exports = {
  getLearningPlan,
};
