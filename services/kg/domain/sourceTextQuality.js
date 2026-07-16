'use strict';

const CJK_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const JAPANESE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HTML_TAG = /<\/?[a-z][^>]*>/iu;

function stripJapaneseRuby(value) {
  return String(value || '')
    .replace(/<(?:rt|rp)\b[^>]*>[\s\S]*?<\/(?:rt|rp)>/giu, '')
    .replace(/<\/?(?:ruby|rb)\b[^>]*>/giu, '')
    .trim();
}

function prepareSourceText(value, language) {
  const rawText = String(value || '').trim();
  if (!rawText) return { status: 'unresolved', text: '', reason: 'source-text-empty' };
  const text = language === 'ja' ? stripJapaneseRuby(rawText) : rawText;
  if (!text) return { status: 'unresolved', text: '', reason: 'source-text-empty' };
  if (HTML_TAG.test(text)) {
    return { status: 'unresolved', text, reason: 'source-markup-unsupported' };
  }
  if (language === 'en' && CJK_SCRIPT.test(text)) {
    return { status: 'unresolved', text, reason: 'source-language-mismatch' };
  }
  if (language === 'ja' && !JAPANESE_SCRIPT.test(text)) {
    return { status: 'unresolved', text, reason: 'source-language-mismatch' };
  }
  return { status: 'ready', text };
}

module.exports = {
  prepareSourceText,
  stripJapaneseRuby,
};
