'use strict';

// DIC-R2 measurement helpers.
//
// The metric is deliberately objective: does the top-ranked candidate carry the
// part of speech the surrounding context implies, and is a pivoted bridge gloss
// labelled low confidence? Both are decidable from the stored rows, so the
// before/after numbers do not depend on anyone's judgement of a translation.

const { partOfSpeechMatches } = require('./localGlossaryService');

function scoreCase(testCase, rankedGlosses) {
  const top = rankedGlosses[0] || null;
  if (!top) {
    return {
      id: testCase.id,
      language: testCase.language,
      text: testCase.text,
      expectedPartOfSpeech: testCase.expectedPartOfSpeech,
      topGloss: null,
      topPartOfSpeech: null,
      topSource: null,
      topConfidence: null,
      candidateCount: 0,
      partOfSpeechCorrect: false,
      confidenceCalibrated: false,
      resolved: false,
    };
  }
  const partOfSpeechCorrect = partOfSpeechMatches(top.partOfSpeech, testCase.expectedPartOfSpeech);
  // A gloss pivoted JA -> EN -> ZH must never be presented as trustworthy.
  const isBridge = top.sourceDetail === 'JMdict · 英中桥接';
  const confidenceCalibrated = isBridge ? top.confidence === 'low' : top.confidence !== 'low';
  return {
    id: testCase.id,
    language: testCase.language,
    text: testCase.text,
    expectedPartOfSpeech: testCase.expectedPartOfSpeech,
    topGloss: top.zhGloss,
    topPartOfSpeech: top.partOfSpeech,
    topSource: top.sourceDetail,
    topConfidence: top.confidence,
    candidateCount: rankedGlosses.length,
    partOfSpeechCorrect,
    confidenceCalibrated,
    resolved: true,
  };
}

function summarize(results) {
  const resolved = results.filter((result) => result.resolved);
  const correct = resolved.filter((result) => result.partOfSpeechCorrect).length;
  const calibrated = resolved.filter((result) => result.confidenceCalibrated).length;
  const rate = (value) => (resolved.length ? Number((value / resolved.length).toFixed(4)) : null);
  return {
    total: results.length,
    resolved: resolved.length,
    unresolved: results.length - resolved.length,
    partOfSpeechCorrect: correct,
    partOfSpeechAccuracy: rate(correct),
    confidenceCalibrated: calibrated,
    confidenceCalibrationRate: rate(calibrated),
  };
}

function compare(baseline, current) {
  const byId = new Map(baseline.map((result) => [result.id, result]));
  const improved = [];
  const regressed = [];
  for (const result of current) {
    const before = byId.get(result.id);
    if (!before) continue;
    if (!before.partOfSpeechCorrect && result.partOfSpeechCorrect) improved.push(result.id);
    if (before.partOfSpeechCorrect && !result.partOfSpeechCorrect) regressed.push(result.id);
  }
  return { improved, regressed };
}

module.exports = { compare, scoreCase, summarize };
