'use strict';

const { learningError } = require('./learningErrors');

const ALLOWED_LANGUAGES = Object.freeze(['en', 'ja']);
const ALLOWED_CARD_TYPES = Object.freeze([
  'trilingual',
  'grammar_ja',
  'scenario_phrase',
  'whole_card',
  'textbook_track',
]);
const ALLOWED_TAG_NAMESPACES = Object.freeze(['topic', 'fn', 'lang', 'src', 'qa', 'tag']);
const DEFAULT_SCOPE = Object.freeze({
  version: 1,
  languages: Object.freeze(['en', 'ja']),
  cardTypes: Object.freeze(['trilingual', 'grammar_ja', 'scenario_phrase', 'whole_card']),
  dateRange: null,
  tags: Object.freeze([]),
  textbookTrackIds: Object.freeze([]),
});

function invalid(message, details) {
  throw learningError('LEARNING_INVALID_REQUEST', message, 400, details);
}

function uniqueStrings(value, field, allowed) {
  if (!Array.isArray(value) || value.length === 0) invalid(`${field} must be a non-empty array`);
  const normalized = [...new Set(value.map((item) => String(item || '').trim()))];
  if (normalized.some((item) => !allowed.includes(item))) {
    invalid(`${field} contains an unsupported value`, { field, allowed });
  }
  return normalized.sort();
}

function validDay(value, field) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    invalid(`${field} must use YYYY-MM-DD`);
  }
  return text;
}

function normalizeDateRange(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('scope.dateRange must be null or an object');
  const from = validDay(value.from, 'scope.dateRange.from');
  const to = validDay(value.to, 'scope.dateRange.to');
  if (from > to) invalid('scope.dateRange.from cannot be after scope.dateRange.to');
  return { from, to };
}

function normalizeTags(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) invalid('scope.tags must be an array');
  const tags = value.map((tag, index) => {
    if (!tag || typeof tag !== 'object' || Array.isArray(tag)) invalid(`scope.tags[${index}] must be an object`);
    const namespace = String(tag.namespace || '').trim();
    const normalizedValue = String(tag.value || '').trim().toLowerCase();
    if (!ALLOWED_TAG_NAMESPACES.includes(namespace)) {
      invalid(`scope.tags[${index}].namespace is unsupported`, { allowed: ALLOWED_TAG_NAMESPACES });
    }
    if (!normalizedValue) invalid(`scope.tags[${index}].value is required`);
    return { namespace, value: normalizedValue };
  });
  return [...new Map(tags.map((tag) => [`${tag.namespace}:${tag.value}`, tag])).values()]
    .sort((a, b) => `${a.namespace}:${a.value}`.localeCompare(`${b.namespace}:${b.value}`));
}

function normalizeTextbookTrackIds(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) invalid('scope.textbookTrackIds must be an array');
  return [...new Set(value.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0))]
    .sort((a, b) => a - b);
}

function normalizeScope(value = DEFAULT_SCOPE) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('scope must be an object');
  const version = Number(value.version || 1);
  if (![1, 2].includes(version)) invalid('scope.version must be 1 or 2');
  const cardTypes = uniqueStrings(value.cardTypes, 'scope.cardTypes', ALLOWED_CARD_TYPES);
  const textbookTrackIds = normalizeTextbookTrackIds(value.textbookTrackIds);
  if (cardTypes.includes('textbook_track') && textbookTrackIds.length === 0) {
    invalid('scope.textbookTrackIds is required when textbook_track is selected');
  }
  return {
    version: textbookTrackIds.length || cardTypes.includes('textbook_track') ? 2 : 1,
    languages: uniqueStrings(value.languages, 'scope.languages', ALLOWED_LANGUAGES),
    cardTypes,
    dateRange: normalizeDateRange(value.dateRange),
    tags: normalizeTags(value.tags),
    textbookTrackIds,
  };
}

function itemMatchesScope(row, scope, activeTagKeys = new Set()) {
  if (!['textbook_en', 'textbook_ja'].includes(row.unit_kind) && scope.dateRange) {
    if (!row.generation_date || row.generation_date < scope.dateRange.from || row.generation_date > scope.dateRange.to) {
      return false;
    }
  }
  if (!['textbook_en', 'textbook_ja'].includes(row.unit_kind)
    && scope.tags.some((tag) => !activeTagKeys.has(`${tag.namespace}:${tag.value}`))) return false;
  switch (row.unit_kind) {
    case 'trilingual_en':
      return scope.cardTypes.includes('trilingual') && scope.languages.includes('en');
    case 'trilingual_ja':
      return scope.cardTypes.includes('trilingual') && scope.languages.includes('ja');
    case 'grammar_ja':
      return scope.cardTypes.includes('grammar_ja') && scope.languages.includes('ja');
    case 'scenario_bilingual':
      return scope.cardTypes.includes('scenario_phrase')
        && scope.languages.includes('en')
        && scope.languages.includes('ja');
    case 'whole_card':
      return scope.cardTypes.includes('whole_card');
    case 'textbook_en': {
      const locator = safeParseLocator(row.unit_locator_json);
      return scope.cardTypes.includes('textbook_track')
        && scope.languages.includes('en')
        && scope.textbookTrackIds.includes(Number(locator.trackId));
    }
    case 'textbook_ja': {
      const locator = safeParseLocator(row.unit_locator_json);
      return scope.cardTypes.includes('textbook_track')
        && scope.languages.includes('ja')
        && scope.textbookTrackIds.includes(Number(locator.trackId));
    }
    default:
      return false;
  }
}

function safeParseLocator(value) {
  try {
    return JSON.parse(value || '{}');
  } catch (_error) {
    return {};
  }
}

module.exports = {
  ALLOWED_CARD_TYPES,
  ALLOWED_LANGUAGES,
  DEFAULT_SCOPE,
  itemMatchesScope,
  normalizeScope,
};
