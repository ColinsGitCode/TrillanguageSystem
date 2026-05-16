'use strict';

const {
  profileLang,
  extractEnHeadword,
  extractJaHeadword,
  extractZhHeadword,
  buildAliases,
  inferTags,
} = require('../textUtils');

function run(cards = []) {
  const entries = cards.map((card) => ({
    generationId: Number(card.id),
    phrase: String(card.phrase || ''),
    cardType: String(card.card_type || 'trilingual'),
    folderName: String(card.folder_name || ''),
    langProfile: profileLang(card.phrase),
    enHeadword: extractEnHeadword(card),
    jaHeadword: extractJaHeadword(card),
    zhHeadword: extractZhHeadword(card),
    aliases: buildAliases(card),
    tags: inferTags(card),
    score: Number(card.quality_score || 0)
  }));
  return { entries };
}

module.exports = { run };
