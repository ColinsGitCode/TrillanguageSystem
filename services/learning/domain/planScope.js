'use strict';

const { learningError } = require('./learningErrors');

const ALLOWED_LANGUAGES = Object.freeze(['en', 'ja']);
const ALLOWED_CARD_TYPES = Object.freeze([
  'trilingual',
  'grammar_ja',
  'scenario_phrase',
  'whole_card',
]);
const ALLOWED_TAG_NAMESPACES = Object.freeze(['topic', 'fn', 'lang', 'src', 'qa', 'tag']);
const DEFAULT_SCOPE = Object.freeze({
  version: 1,
  languages: Object.freeze(['en', 'ja']),
  cardTypes: Object.freeze(['trilingual', 'grammar_ja', 'scenario_phrase', 'whole_card']),
  dateRange: null,
  tags: Object.freeze([]),
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

function normalizeScope(value = DEFAULT_SCOPE) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('scope must be an object');
  if (value.version !== undefined && Number(value.version) !== 1) invalid('scope.version must be 1');
  return {
    version: 1,
    languages: uniqueStrings(value.languages, 'scope.languages', ALLOWED_LANGUAGES),
    cardTypes: uniqueStrings(value.cardTypes, 'scope.cardTypes', ALLOWED_CARD_TYPES),
    dateRange: normalizeDateRange(value.dateRange),
    tags: normalizeTags(value.tags),
  };
}

function itemMatchesScope(row, scope, activeTagKeys = new Set()) {
  if (scope.dateRange) {
    if (!row.generation_date || row.generation_date < scope.dateRange.from || row.generation_date > scope.dateRange.to) {
      return false;
    }
  }
  if (scope.tags.some((tag) => !activeTagKeys.has(`${tag.namespace}:${tag.value}`))) return false;
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
    default:
      return false;
  }
}

module.exports = {
  ALLOWED_CARD_TYPES,
  ALLOWED_LANGUAGES,
  DEFAULT_SCOPE,
  itemMatchesScope,
  normalizeScope,
};
