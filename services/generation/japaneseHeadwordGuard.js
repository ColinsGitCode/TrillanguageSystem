'use strict';

const OpenCC = require('opencc-js');
const { analyzeJapaneseTokens } = require('./japaneseFurigana');

const KANA_RE = /[\u3040-\u309F\u30A0-\u30FF]/u;
const KANJI_RE = /[\u3400-\u9FFF々〆ヵヶ]/u;
const ASCII_LETTER_RE = /[A-Za-z]/;
const MAX_HEADWORD_LENGTH = 40;
const MAX_SHARED_KANJI_HEADWORD_LENGTH = 12;

let jpToCnConverter = null;
let tradToCnConverter = null;

function getConverters() {
  if (!jpToCnConverter) {
    jpToCnConverter = OpenCC.Converter({ from: 'jp', to: 'cn' });
  }
  if (!tradToCnConverter) {
    tradToCnConverter = OpenCC.Converter({ from: 't', to: 'cn' });
  }
  return { jpToCn: jpToCnConverter, tradToCn: tradToCnConverter };
}

function hasJapaneseSpecificKanji(text) {
  const value = String(text || '');
  if (!KANJI_RE.test(value)) return false;
  const { jpToCn, tradToCn } = getConverters();
  return jpToCn(value) !== value || tradToCn(value) !== value;
}

function isPureKanjiWord(text) {
  return /^[\u3400-\u9FFF々〆ヵヶ]+$/u.test(String(text || ''));
}

function isCandidatePhraseShape(phrase) {
  const trimmed = String(phrase || '').trim();
  if (!trimmed || trimmed.length > MAX_HEADWORD_LENGTH || /[\r\n]/.test(trimmed)) {
    return false;
  }
  const hasKana = KANA_RE.test(trimmed);
  const hasKanji = KANJI_RE.test(trimmed);
  if (!hasKana && !hasKanji) return false;
  // Reject English phrases mixed with stray punctuation unless Japanese kana or
  // Japanese-specific kanji is present (e.g. "API連携" or "発注システム").
  if (ASCII_LETTER_RE.test(trimmed) && !hasKana && !hasJapaneseSpecificKanji(trimmed)) {
    return false;
  }
  return true;
}

function hasJapanesePromptHint(phrase) {
  const trimmed = String(phrase || '').trim();
  if (!isCandidatePhraseShape(trimmed)) return false;
  return KANA_RE.test(trimmed) || hasJapaneseSpecificKanji(trimmed);
}

function extractJapaneseContextLines(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  let inJapanese = false;
  const contextLines = [];

  for (const line of lines) {
    const headerMatch = line.match(/^\s*##\s*\d+\.\s*(.+)$/);
    if (headerMatch) {
      inJapanese = /日本語|日语/.test(headerMatch[1]);
      continue;
    }
    if (!inJapanese) continue;
    // Only inspect Japanese body lines (解説 and 例句1/例句2), never nested Chinese translations.
    if (/^\s*-\s*\*\*(?:解説|解释|例句\d+)\*\*\s*[:：]/u.test(line)) {
      const cleaned = line
        .replace(/^\s*-\s*\*\*[^*]+\*\*\s*[:：]\s*/u, '')
        .replace(/<rt>.*?<\/rt>/giu, '')
        .replace(/<rp>.*?<\/rp>/giu, '')
        .replace(/<[^>]+>/gu, '');
      contextLines.push(cleaned);
    }
  }
  return contextLines;
}

function hasValidKuromojiKanjiReadings(tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) return false;
  for (const token of tokens) {
    const surface = String(token?.surface_form || '');
    if (!KANJI_RE.test(surface)) continue;
    const reading = token?.reading && token.reading !== '*' ? String(token.reading).trim() : '';
    const basicForm = token?.basic_form && token.basic_form !== '*' ? String(token.basic_form).trim() : '';
    if (!reading || !basicForm) {
      return false;
    }
  }
  return true;
}

async function classifyJapaneseHeadword(phrase, markdown = '', { analyzeTokens = analyzeJapaneseTokens } = {}) {
  const trimmed = String(phrase || '').trim();
  if (!isCandidatePhraseShape(trimmed)) {
    return { preserve: false, reason: 'not_japanese_candidate', phrase: trimmed };
  }

  const hasKana = KANA_RE.test(trimmed);
  const hasKanji = KANJI_RE.test(trimmed);
  const japaneseSpecificKanji = hasJapaneseSpecificKanji(trimmed);

  // Every kanji token must be recognized by Kuromoji with a valid Japanese reading.
  // Simplified-Chinese-only characters (e.g. 测, 确, 认, 实, 电, 脑, 单, 异) fail here.
  if (hasKanji) {
    const tokens = await analyzeTokens(trimmed);
    if (!hasValidKuromojiKanjiReadings(tokens)) {
      return { preserve: false, reason: 'unresolved_kanji_in_kuromoji', phrase: trimmed };
    }
  }

  // Tier 1: Contains Hiragana or Katakana (and all kanji, if any, have valid JA readings).
  if (hasKana) {
    return { preserve: true, reason: 'kana_japanese_input', phrase: trimmed };
  }

  // Tier 2: Pure/mixed kanji containing Japanese Shinjitai / non-Simplified-Chinese kanji
  // with valid Japanese readings (e.g. 計測, 受領, 充実, 補足指標, 確認, 実装, 仕様).
  if (japaneseSpecificKanji) {
    return { preserve: true, reason: 'japanese_specific_kanji_input', phrase: trimmed };
  }

  // Tier 3: Shared-kanji word (e.g. 翌月, 手配, 把握, 手順) whose characters are identical
  // in Simplified Chinese and Japanese: preserve when the card's own Japanese examples or
  // explanation actually use the input word verbatim (avoids misclassifying Chinese "配置"
  // whose Japanese examples use "設定").
  if (isPureKanjiWord(trimmed) && [...trimmed].length <= MAX_SHARED_KANJI_HEADWORD_LENGTH) {
    const contextLines = extractJapaneseContextLines(markdown);
    if (contextLines.some((line) => line.includes(trimmed))) {
      return { preserve: true, reason: 'shared_kanji_confirmed_in_japanese_section', phrase: trimmed };
    }
  }

  return { preserve: false, reason: 'ambiguous_shared_kanji_not_used_in_ja', phrase: trimmed };
}

function replaceJapaneseTranslationLine(markdown, targetHeadword) {
  const lines = String(markdown || '').split(/\r?\n/);
  let inJapanese = false;
  let replaced = false;

  const updated = lines.map((line) => {
    const headerMatch = line.match(/^\s*##\s*\d+\.\s*(.+)$/);
    if (headerMatch) {
      inJapanese = /日本語|日语/.test(headerMatch[1]);
      return line;
    }
    if (!inJapanese || replaced) return line;
    const match = line.match(/^(\s*-\s*)\*\*(?:翻訳|翻译)\*\*\s*[:：]\s*(.*)$/u);
    if (match) {
      replaced = true;
      return `${match[1]}**翻訳**: ${targetHeadword}`;
    }
    return line;
  });

  return { markdown: updated.join('\n'), replaced };
}

async function enforceJapaneseHeadwordInMarkdown(markdown, options = {}) {
  if (!markdown || typeof markdown !== 'string') return markdown;
  const cardType = String(options.cardType || 'trilingual').trim().toLowerCase();
  if (cardType !== 'trilingual') return markdown;

  const phrase = String(options.phrase || '').trim();
  if (!phrase) return markdown;

  const classification = await classifyJapaneseHeadword(phrase, markdown, {
    analyzeTokens: options.analyzeTokens || analyzeJapaneseTokens,
  });
  if (!classification.preserve) return markdown;

  const { markdown: enforced } = replaceJapaneseTranslationLine(markdown, classification.phrase);
  return enforced;
}

module.exports = {
  hasJapaneseSpecificKanji,
  hasJapanesePromptHint,
  classifyJapaneseHeadword,
  enforceJapaneseHeadwordInMarkdown,
};
