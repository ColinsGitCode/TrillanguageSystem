'use strict';

const analyzerPackage = require('kuroshiro-analyzer-kuromoji/package.json');
const kuroshiroPackage = require('kuroshiro/package.json');
const { analyzeJapaneseTokens } = require('../../generation/japaneseFurigana');
const {
  buildKnowledgePointIdentity,
  buildSurfaceIdentity,
  katakanaToHiragana,
  normalizeKnowledgeText,
} = require('./knowledgeIdentity');

const ANALYZER_ID = 'kuroshiro-analyzer-kuromoji';
const RULE_VERSION = 'kg-ja-form-v1';
const CONTENT_POS = new Set(['動詞', '形容詞', '名詞']);
const PURE_KANA = /^[\p{Script=Hiragana}\p{Script=Katakana}ー・\s]+$/u;

function analyzerDescriptor() {
  return {
    id: ANALYZER_ID,
    version: analyzerPackage.version,
    kuroshiroVersion: kuroshiroPackage.version,
    ruleVersion: RULE_VERSION,
  };
}

function isUnknownToken(token) {
  return token?.verbose?.word_type === 'UNKNOWN' || !token?.basic_form || token.basic_form === '*';
}

function isPrimaryContentToken(token) {
  return CONTENT_POS.has(token?.pos) && token?.pos_detail_1 !== '接尾';
}

function readingForTokens(tokens) {
  const reading = tokens.map((token) => token.reading || token.surface_form || '').join('');
  return reading ? katakanaToHiragana(reading) : '';
}

function unresolved(input, normalizedInput, tokens, reason, details = {}) {
  return {
    status: 'unresolved',
    input,
    normalizedInput,
    reason,
    details,
    analyzer: analyzerDescriptor(),
    tokens,
  };
}

function classifyRelation(normalizedInput, canonicalForm, primaryIndex, tokens) {
  const suffix = tokens.slice(primaryIndex + 1);
  if (normalizedInput === canonicalForm && suffix.length === 0) {
    return { linkKind: 'canonical', formKind: 'dictionary' };
  }
  if (suffix.length !== 1) return null;

  const helper = suffix[0];
  if (helper.pos === '助動詞' && helper.basic_form === 'た') {
    return { linkKind: 'inflection-of', formKind: 'past' };
  }
  if (helper.pos === '助詞' && helper.pos_detail_1 === '接続助詞' && helper.basic_form === 'て') {
    return { linkKind: 'inflection-of', formKind: 'te-form' };
  }
  if (helper.pos === '助動詞' && helper.basic_form === 'ます') {
    return { linkKind: 'polite-of', formKind: 'polite' };
  }
  return null;
}

async function analyzeJapaneseForm(input, options = {}) {
  const tokenize = options.tokenize || analyzeJapaneseTokens;
  const rawInput = String(input || '');
  const normalizedInput = normalizeKnowledgeText(rawInput, 'ja');
  const tokens = await tokenize(normalizedInput);

  if (PURE_KANA.test(normalizedInput)) {
    return unresolved(rawInput, normalizedInput, tokens, 'ambiguous-kana-input');
  }
  if (!tokens.length) return unresolved(rawInput, normalizedInput, tokens, 'no-tokens');
  if (tokens.some(isUnknownToken)) return unresolved(rawInput, normalizedInput, tokens, 'unsupported-token');

  const primaryIndexes = tokens
    .map((token, index) => (isPrimaryContentToken(token) ? index : -1))
    .filter((index) => index >= 0);
  if (primaryIndexes.length !== 1) {
    return unresolved(rawInput, normalizedInput, tokens, 'multiple-content-tokens', {
      primaryTokenCount: primaryIndexes.length,
    });
  }

  const primaryIndex = primaryIndexes[0];
  const primary = tokens[primaryIndex];
  const canonicalForm = normalizeKnowledgeText(primary.basic_form, 'ja');
  const lemmaTokens = await tokenize(canonicalForm);
  const lemmaPrimary = lemmaTokens.find((token) => (
    isPrimaryContentToken(token) && !isUnknownToken(token) && token.basic_form === canonicalForm
  ));
  if (!lemmaPrimary?.reading) {
    return unresolved(rawInput, normalizedInput, tokens, 'lemma-reading-unavailable', {
      canonicalForm,
      lemmaTokens,
    });
  }

  const relation = classifyRelation(normalizedInput, canonicalForm, primaryIndex, tokens);
  if (!relation) {
    return unresolved(rawInput, normalizedInput, tokens, 'unsupported-token-sequence', {
      canonicalForm,
      primaryIndex,
    });
  }

  const lemmaReading = katakanaToHiragana(lemmaPrimary.reading);
  const surfaceReading = readingForTokens(tokens);
  return {
    status: 'resolved',
    input: rawInput,
    normalizedInput,
    canonicalForm,
    lemmaReading,
    surfaceReading,
    primaryTokenIndex: primaryIndex,
    relation,
    pointIdentity: buildKnowledgePointIdentity({
      kpKind: 'lexeme',
      language: 'ja',
      canonicalForm,
      canonicalReading: lemmaReading,
    }),
    surfaceIdentity: buildSurfaceIdentity({
      language: 'ja',
      surfaceText: normalizedInput,
      reading: surfaceReading,
    }),
    analyzer: analyzerDescriptor(),
    tokens,
    lemmaTokens,
  };
}

module.exports = {
  ANALYZER_ID,
  RULE_VERSION,
  analyzeJapaneseForm,
  analyzerDescriptor,
  classifyRelation,
};
