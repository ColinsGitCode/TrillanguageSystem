'use strict';

const { profileLang } = require('../textUtils');

function run(cards = []) {
  const totals = {
    total: cards.length,
    byCardType: {},
    byProvider: {},
    byLangProfile: {}
  };
  let qualityCount = 0;
  let qualitySum = 0;
  let tokenCount = 0;
  let tokenSum = 0;

  cards.forEach((card) => {
    const cardType = String(card.card_type || 'trilingual');
    const provider = String(card.llm_provider || 'unknown');
    const langProfile = profileLang(card.phrase);
    totals.byCardType[cardType] = (totals.byCardType[cardType] || 0) + 1;
    totals.byProvider[provider] = (totals.byProvider[provider] || 0) + 1;
    totals.byLangProfile[langProfile] = (totals.byLangProfile[langProfile] || 0) + 1;

    if (card.quality_score != null) {
      qualityCount += 1;
      qualitySum += Number(card.quality_score || 0);
    }
    if (card.tokens_total != null) {
      tokenCount += 1;
      tokenSum += Number(card.tokens_total || 0);
    }
  });

  const avgQuality = qualityCount > 0 ? Number((qualitySum / qualityCount).toFixed(2)) : null;
  const avgTokens = tokenCount > 0 ? Number((tokenSum / tokenCount).toFixed(2)) : null;
  const actionItems = [];
  if ((totals.byCardType.grammar_ja || 0) < Math.max(5, Math.round(cards.length * 0.08))) {
    actionItems.push({ priority: 1, action: '提升语法卡占比，优先覆盖高频语法点。' });
  }
  if ((totals.byProvider.local || 0) < 10) {
    actionItems.push({ priority: 2, action: '增加本地模型样本，形成稳定对照集。' });
  }

  return {
    overview: `共分析 ${cards.length} 张卡片。`,
    topTopics: Object.entries(totals.byCardType)
      .sort((a, b) => b[1] - a[1])
      .map(([topic, count]) => ({ topic, count })),
    qualityObservations: [
      {
        finding: avgQuality == null ? '质量数据不足' : `平均质量分 ${avgQuality}`,
        severity: avgQuality != null && avgQuality < 80 ? 'high' : 'low',
        evidenceIds: []
      },
      {
        finding: avgTokens == null ? 'Token 数据不足' : `平均总 Token ${avgTokens}`,
        severity: 'low',
        evidenceIds: []
      }
    ],
    actionItems
  };
}

module.exports = { run };
