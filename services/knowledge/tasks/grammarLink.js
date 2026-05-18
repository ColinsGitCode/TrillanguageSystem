'use strict';

const { extractJapaneseSentences, detectGrammarPatterns } = require('../textUtils');

function run(cards = []) {
  const patternMap = new Map();
  cards.forEach((card) => {
    const sentences = extractJapaneseSentences(card.markdown_content || '');
    sentences.forEach((sentence) => {
      const patterns = detectGrammarPatterns(sentence);
      patterns.forEach((patternInfo) => {
        const key = patternInfo.pattern;
        if (!patternMap.has(key)) {
          patternMap.set(key, {
            pattern: key,
            explanationZh: patternInfo.explanationZh,
            confidence: 0.7,
            exampleRefs: []
          });
        }
        patternMap.get(key).exampleRefs.push({
          generationId: Number(card.id),
          sentence: sentence.slice(0, 140)
        });
      });
    });
  });

  return {
    patterns: Array.from(patternMap.values()).map((item) => ({
      ...item,
      exampleRefs: item.exampleRefs.slice(0, 50)
    }))
  };
}

module.exports = { run };
