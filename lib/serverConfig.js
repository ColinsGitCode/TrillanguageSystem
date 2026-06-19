'use strict';

// Process-wide configuration and small pure helpers shared across server.js,
// the route modules, and the generation service. Kept dependency-free (only
// node builtins) so anything can require it without pulling in services.

const PORT = process.env.PORT || 3010;
const RECORDS_PATH = process.env.RECORDS_PATH || '/data/trilingual_records';
const RECORDS_TIMEZONE = process.env.RECORDS_TIMEZONE || process.env.APP_TIMEZONE || process.env.TZ || 'Asia/Shanghai';
const DEFAULT_LLM_PROVIDER = 'deepseek';
const SUPPORTED_CARD_TYPES = new Set(['trilingual', 'grammar_ja', 'scenario_phrase']);
const SUPPORTED_DEEPSEEK_MODELS = new Set(['deepseek-v4-flash', 'deepseek-v4-pro']);
const DEFAULT_DEEPSEEK_BASE_URL = String(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
const DEFAULT_DEEPSEEK_MODEL = sanitizeDeepSeekModelName(process.env.DEEPSEEK_MODEL) || 'deepseek-v4-flash';
const DEFAULT_DEEPSEEK_TIMEOUT_MS = toNumberOr(process.env.DEEPSEEK_TIMEOUT_MS, 120000);
const DEFAULT_DEEPSEEK_THINKING = normalizeDeepSeekThinking(process.env.DEEPSEEK_THINKING || 'disabled');
const E2E_TEST_MODE = /^(1|true|yes|on)$/i.test(String(process.env.E2E_TEST_MODE || '').trim());

function toNumberOr(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeLlmProvider() {
  return 'deepseek';
}

function normalizeCardType(cardType) {
  const normalized = String(cardType || 'trilingual').trim().toLowerCase();
  return SUPPORTED_CARD_TYPES.has(normalized) ? normalized : 'trilingual';
}

function normalizeSourceMode(sourceMode) {
  const normalized = String(sourceMode || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'selection') return 'selection';
  if (normalized === 'input') return 'input';
  if (normalized === 'ocr') return 'ocr';
  return normalized;
}

function sanitizeDeepSeekModelName(modelName) {
  const model = String(modelName || '').trim();
  return SUPPORTED_DEEPSEEK_MODELS.has(model) ? model : '';
}

function resolveDeepSeekModel(modelOverride) {
  return sanitizeDeepSeekModelName(modelOverride)
    || sanitizeDeepSeekModelName(process.env.DEEPSEEK_MODEL)
    || 'deepseek-v4-flash';
}

function normalizeDeepSeekThinking(value) {
  return String(value || '').trim().toLowerCase() === 'enabled' ? 'enabled' : 'disabled';
}

function tzOffsetClause(tz = RECORDS_TIMEZONE, now = new Date()) {
  try {
    const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
    const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    const mins = Math.round((local - utc) / 60000);
    return `${mins >= 0 ? '+' : '-'}${Math.abs(mins)} minutes`;
  } catch (_err) {
    return '+0 minutes';
  }
}

module.exports = {
  PORT,
  RECORDS_PATH,
  RECORDS_TIMEZONE,
  DEFAULT_LLM_PROVIDER,
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_DEEPSEEK_TIMEOUT_MS,
  DEFAULT_DEEPSEEK_THINKING,
  E2E_TEST_MODE,
  SUPPORTED_CARD_TYPES,
  SUPPORTED_DEEPSEEK_MODELS,
  toNumberOr,
  normalizeLlmProvider,
  normalizeCardType,
  normalizeSourceMode,
  sanitizeDeepSeekModelName,
  resolveDeepSeekModel,
  normalizeDeepSeekThinking,
  tzOffsetClause,
};
