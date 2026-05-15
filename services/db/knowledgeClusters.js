'use strict';

// knowledge_clusters + knowledge_cluster_cards domain extracted from
// databaseService.js. Same shape as the grammar domain: replace is
// transactional (deactivate prior active version, clear this job's rows
// + child cards, re-insert). Functions take `db` first.

const { safeJsonParse } = require('./helpers');

function replaceData(db, clusters = [], jobId) {
  const transaction = db.transaction((payload, versionJobId) => {
    db.prepare(`UPDATE knowledge_clusters SET is_active = 0 WHERE is_active = 1`).run();
    db.prepare(`DELETE FROM knowledge_cluster_cards WHERE cluster_id IN (SELECT id FROM knowledge_clusters WHERE version_job_id = ?)`).run(versionJobId);
    db.prepare(`DELETE FROM knowledge_clusters WHERE version_job_id = ?`).run(versionJobId);

    const insertCluster = db.prepare(`
      INSERT INTO knowledge_clusters (
        cluster_key, label, description, keywords_json, confidence, version_job_id, is_active
      ) VALUES (
        @clusterKey, @label, @description, @keywordsJson, @confidence, @versionJobId, 1
      )
    `);
    const insertCard = db.prepare(`
      INSERT OR IGNORE INTO knowledge_cluster_cards (
        cluster_id, generation_id, score
      ) VALUES (
        @clusterId, @generationId, @score
      )
    `);

    let count = 0;
    for (const cluster of payload) {
      const result = insertCluster.run({
        clusterKey: String(cluster.clusterKey || ''),
        label: String(cluster.label || 'Unknown'),
        description: String(cluster.description || ''),
        keywordsJson: JSON.stringify(cluster.keywords || []),
        confidence: Number(cluster.confidence || 0),
        versionJobId: Number(versionJobId)
      });
      const clusterId = Number(result.lastInsertRowid);
      const cards = Array.isArray(cluster.cards) ? cluster.cards : [];
      cards.forEach((card) => {
        if (!card.generationId) return;
        insertCard.run({
          clusterId,
          generationId: Number(card.generationId),
          score: Number(card.score || 0)
        });
      });
      count += 1;
    }
    return count;
  });

  return transaction(Array.isArray(clusters) ? clusters : [], Number(jobId));
}

function listClusters(db, limit = 20) {
  const clusters = db.prepare(`
    SELECT *
    FROM knowledge_clusters
    WHERE is_active = 1
    ORDER BY confidence DESC, updated_at DESC
    LIMIT ?
  `).all(Math.max(1, Number(limit || 20)));

  const cards = db.prepare(`
    SELECT cc.cluster_id, cc.generation_id, cc.score, g.phrase, g.folder_name
    FROM knowledge_cluster_cards cc
    LEFT JOIN generations g ON g.id = cc.generation_id
    WHERE cc.cluster_id IN (
      SELECT id FROM knowledge_clusters WHERE is_active = 1
    )
    ORDER BY cc.score DESC, cc.id ASC
  `).all();

  const cardMap = new Map();
  cards.forEach((row) => {
    if (!cardMap.has(row.cluster_id)) cardMap.set(row.cluster_id, []);
    cardMap.get(row.cluster_id).push({
      generationId: row.generation_id,
      phrase: row.phrase || '',
      folderName: row.folder_name || '',
      score: row.score || 0
    });
  });

  return clusters.map((row) => ({
    id: row.id,
    clusterKey: row.cluster_key,
    label: row.label,
    description: row.description,
    keywords: safeJsonParse(row.keywords_json, []),
    confidence: row.confidence,
    cards: cardMap.get(row.id) || [],
    updatedAt: row.updated_at
  }));
}

module.exports = {
  replaceData,
  listClusters,
};
