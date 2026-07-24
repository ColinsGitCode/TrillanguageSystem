'use strict';

const CURRENT_SCENARIO_EXPRESSION_COUNT = 20;
const LEGACY_SCENARIO_EXPRESSION_COUNT = 12;
const SUPPORTED_SCENARIO_EXPRESSION_COUNTS = Object.freeze([
  LEGACY_SCENARIO_EXPRESSION_COUNT,
  CURRENT_SCENARIO_EXPRESSION_COUNT,
]);

const SCENARIO_EXPRESSIONS_HEADER_RE =
  /常用表达|常用表現|常用表達|common\s+(?:expressions?|phrases?)|useful\s+(?:expressions?|phrases?)|よく使う(?:表現|フレーズ)/iu;

function getScenarioExpressionIndices(markdown) {
  const lines = String(markdown || '').split(/\r?\n/u);
  let inExpressions = false;
  const indices = [];

  for (const line of lines) {
    const sectionMatch = line.match(/^##\s*(\d+)\.\s*(.+)\s*$/u);
    if (sectionMatch) {
      inExpressions =
        Number(sectionMatch[1]) === 2 && SCENARIO_EXPRESSIONS_HEADER_RE.test(sectionMatch[2]);
      continue;
    }
    if (!inExpressions) continue;
    const expressionMatch = line.match(/^###\s*(\d{1,2})\.\s*.*$/u);
    if (expressionMatch) indices.push(Number(expressionMatch[1]));
  }

  return indices;
}

function getScenarioExpressionCount(markdown) {
  return getScenarioExpressionIndices(markdown).length;
}

function isSupportedScenarioExpressionCount(count) {
  return SUPPORTED_SCENARIO_EXPRESSION_COUNTS.includes(Number(count));
}

module.exports = {
  CURRENT_SCENARIO_EXPRESSION_COUNT,
  LEGACY_SCENARIO_EXPRESSION_COUNT,
  SCENARIO_EXPRESSIONS_HEADER_RE,
  SUPPORTED_SCENARIO_EXPRESSION_COUNTS,
  getScenarioExpressionCount,
  getScenarioExpressionIndices,
  isSupportedScenarioExpressionCount,
};
