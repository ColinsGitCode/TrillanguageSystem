'use strict';

const crypto = require('node:crypto');

const IDENTITY_VERSION = 'kg-identity-v1';
const SURFACE_IDENTITY_VERSION = 'surface-identity-v1';
const LANGUAGES = new Set(['en', 'ja', 'zh']);
const KP_KINDS = new Set(['lexeme', 'phrase', 'grammar_pattern']);

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function normalizeWhitespace(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

function normalizeLanguage(value) {
  const language = normalizeWhitespace(value).toLowerCase();
  if (!LANGUAGES.has(language)) throw new TypeError(`Unsupported knowledge language: ${value}`);
  return language;
}

function normalizeKnowledgeText(value, language) {
  const normalizedLanguage = normalizeLanguage(language);
  const normalized = normalizeWhitespace(value);
  if (!normalized) throw new TypeError('Knowledge text must not be empty');
  return normalizedLanguage === 'en' ? normalized.toLowerCase() : normalized;
}

function katakanaToHiragana(value) {
  return normalizeWhitespace(value).replace(/[ァ-ヶ]/gu, (character) => (
    String.fromCodePoint(character.codePointAt(0) - 0x60)
  ));
}

function buildKnowledgePointIdentity({
  kpKind,
  language,
  canonicalForm,
  canonicalReading = '',
  senseDiscriminator = '',
} = {}) {
  const normalizedKind = normalizeWhitespace(kpKind).toLowerCase();
  if (!KP_KINDS.has(normalizedKind)) throw new TypeError(`Unsupported knowledge point kind: ${kpKind}`);
  const normalizedLanguage = normalizeLanguage(language);
  const payload = {
    identityVersion: IDENTITY_VERSION,
    kpKind: normalizedKind,
    language: normalizedLanguage,
    canonicalForm: normalizeKnowledgeText(canonicalForm, normalizedLanguage),
    canonicalReading: normalizedLanguage === 'ja'
      ? katakanaToHiragana(canonicalReading)
      : normalizeWhitespace(canonicalReading),
    senseDiscriminator: normalizeWhitespace(senseDiscriminator),
  };
  return { ...payload, pointKey: sha256(stableJson(payload)) };
}

function buildSurfaceIdentity({ language, surfaceText, reading = '' } = {}) {
  const normalizedLanguage = normalizeLanguage(language);
  const payload = {
    identityVersion: SURFACE_IDENTITY_VERSION,
    language: normalizedLanguage,
    normalizedSurface: normalizeKnowledgeText(surfaceText, normalizedLanguage),
    normalizedReading: normalizedLanguage === 'ja'
      ? katakanaToHiragana(reading)
      : normalizeWhitespace(reading),
  };
  return { ...payload, surfaceKey: sha256(stableJson(payload)) };
}

module.exports = {
  IDENTITY_VERSION,
  KP_KINDS,
  LANGUAGES,
  SURFACE_IDENTITY_VERSION,
  buildKnowledgePointIdentity,
  buildSurfaceIdentity,
  katakanaToHiragana,
  normalizeKnowledgeText,
  sha256,
  stableJson,
};
