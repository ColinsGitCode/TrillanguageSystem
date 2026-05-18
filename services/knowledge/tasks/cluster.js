'use strict';

const { normalizeText } = require('../textUtils');

function run(cards = []) {
  const clusterDefs = [
    { key: 'engineering', label: '工程系统', desc: '架构、接口、性能与运维相关表达', keywords: ['api', 'queue', 'retry', 'latency', 'db', 'database', 'cache', 'docker', 'proxy', '可观测', '高可用', '重试'] },
    { key: 'communication', label: '沟通表达', desc: '解释、总结、转述与论述相关表达', keywords: ['简而言之', '也就是说', '要するに', 'つまり', '说明', '解释', '焦点', '舆论'] },
    { key: 'grammar', label: '日语语法', desc: '语法结构和句型模式', keywords: ['わけでもなく', '〜', '文法', 'grammar', '使い分け'] },
    { key: 'general', label: '通用词汇', desc: '未归类的常规词汇', keywords: [] }
  ];

  const clusters = clusterDefs.map((def) => ({
    clusterKey: def.key,
    label: def.label,
    description: def.desc,
    keywords: def.keywords,
    confidence: 0.6,
    cards: []
  }));

  cards.forEach((card) => {
    const haystack = normalizeText([
      card.phrase,
      card.en_translation,
      card.ja_translation,
      card.zh_translation,
      card.markdown_content
    ].join(' ')).toLowerCase();

    let matched = false;
    for (const cluster of clusters) {
      if (!cluster.keywords.length) continue;
      const hitCount = cluster.keywords.filter((keyword) => haystack.includes(String(keyword).toLowerCase())).length;
      if (hitCount > 0) {
        matched = true;
        cluster.cards.push({
          generationId: Number(card.id),
          score: Number((hitCount / cluster.keywords.length).toFixed(4))
        });
      }
    }
    if (!matched) {
      const fallback = clusters.find((cluster) => cluster.clusterKey === 'general');
      fallback.cards.push({
        generationId: Number(card.id),
        score: 0.2
      });
    }
  });

  return {
    clusters: clusters.filter((cluster) => cluster.cards.length > 0)
  };
}

module.exports = { run };
