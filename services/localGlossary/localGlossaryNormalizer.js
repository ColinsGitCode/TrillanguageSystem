'use strict';

const { analyzeJapaneseTokens } = require('../generation/japaneseFurigana');

const EDGE_PUNCTUATION = /^[\s.,!?;:'"“”‘’()[\]{}<>《》【】、。！？：；]+|[\s.,!?;:'"“”‘’()[\]{}<>《》【】、。！？：；]+$/gu;

function normalizeSurface(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .replace(EDGE_PUNCTUATION, '')
    .trim();
}

function englishAliases(value) {
  const normalized = normalizeSurface(value).toLocaleLowerCase('en-US');
  const aliases = new Set([normalized]);
  if (!/^[a-z][a-z '-]{2,}$/u.test(normalized) || normalized.includes(' ')) return [...aliases];
  if (normalized.endsWith('ies') && normalized.length > 4) aliases.add(`${normalized.slice(0, -3)}y`);
  if (normalized.endsWith('es') && normalized.length > 4) aliases.add(normalized.slice(0, -2));
  if (normalized.endsWith('s') && !normalized.endsWith('ss') && normalized.length > 3) aliases.add(normalized.slice(0, -1));
  if (normalized.endsWith('ied') && normalized.length > 4) aliases.add(`${normalized.slice(0, -3)}y`);
  if (normalized.endsWith('ed') && normalized.length > 4) {
    aliases.add(normalized.slice(0, -2));
    aliases.add(`${normalized.slice(0, -1)}`);
  }
  if (normalized.endsWith('ing') && normalized.length > 5) {
    const stem = normalized.slice(0, -3);
    aliases.add(stem);
    aliases.add(`${stem}e`);
  }
  return [...aliases].filter(Boolean);
}

async function normalizeJapanese(value) {
  const surface = normalizeSurface(value);
  const result = { canonicalForm: surface, normalizedForm: surface, aliases: [surface] };
  if (!surface) return result;
  try {
    const tokens = (await analyzeJapaneseTokens(surface)).filter((token) => (
      String(token.surface_form || '').trim()
    ));
    if (tokens.length === 1 && normalizeSurface(tokens[0].surface_form) === surface) {
      const basic = normalizeSurface(tokens[0].basic_form);
      if (basic && basic !== '*') {
        result.canonicalForm = basic;
        result.normalizedForm = basic;
        result.aliases = [...new Set([surface, basic])];
      }
    } else if (
      tokens.length > 1
      && tokens[0].pos === '動詞'
      && tokens.slice(1).every((token) => token.pos === '助動詞')
    ) {
      const basic = normalizeSurface(tokens[0].basic_form);
      if (basic && basic !== '*') {
        result.canonicalForm = basic;
        result.normalizedForm = basic;
        result.aliases = [...new Set([surface, basic])];
      }
    }
  } catch (_error) {
    // Lookup remains available with exact surface matching when the analyzer is unavailable.
  }
  return result;
}

async function normalizeTerm(value, language) {
  const surface = normalizeSurface(value);
  if (language === 'en') {
    const aliases = englishAliases(surface);
    return {
      canonicalForm: aliases[0] || surface,
      normalizedForm: aliases[0] || surface,
      aliases,
    };
  }
  return normalizeJapanese(surface);
}

module.exports = {
  englishAliases,
  normalizeSurface,
  normalizeTerm,
};
