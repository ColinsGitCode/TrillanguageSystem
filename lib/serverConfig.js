'use strict';

// Process-wide configuration and small pure helpers shared across server.js,
// the route modules, and the generation service. Kept dependency-free (only
// node builtins) so anything can require it without pulling in services.

const PORT = process.env.PORT || 3010;
const RECORDS_PATH = process.env.RECORDS_PATH || '/data/trilingual_records';
const TEXTBOOK_FEATURE_ENABLED = !/^(0|false|no|off)$/i.test(String(process.env.TEXTBOOK_FEATURE_ENABLED ?? 'true').trim());
const KG_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.KG_ENABLED || '').trim());
const KG_PLANNING_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.KG_PLANNING_ENABLED || '').trim());
const KG_LLM_ENRICHMENT_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.KG_LLM_ENRICHMENT_ENABLED || '').trim());
const KG_INCREMENTAL_SYNC_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.KG_INCREMENTAL_SYNC_ENABLED || '').trim());
const CARD_ANNOTATIONS_ENABLED = !/^(0|false|no|off)$/i.test(
  String(process.env.CARD_ANNOTATIONS_ENABLED ?? 'true').trim()
);
const TEXTBOOK_SOURCE_ROOT = process.env.TEXTBOOK_SOURCE_ROOT || '/media/textbooks';
const TEXTBOOK_WORK_PATH = process.env.TEXTBOOK_WORK_PATH || '/data/textbooks';
const RECORDS_TIMEZONE = process.env.RECORDS_TIMEZONE || process.env.APP_TIMEZONE || process.env.TZ || 'Asia/Shanghai';
const DEFAULT_LLM_PROVIDER = 'deepseek';
const SUPPORTED_CARD_TYPES = new Set(['trilingual', 'grammar_ja', 'scenario_phrase']);
const SUPPORTED_DEEPSEEK_MODELS = new Set(['deepseek-v4-flash', 'deepseek-v4-pro']);
const DEFAULT_DEEPSEEK_BASE_URL = String(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
const DEFAULT_DEEPSEEK_MODEL = sanitizeDeepSeekModelName(process.env.DEEPSEEK_MODEL) || 'deepseek-v4-flash';
const DEFAULT_DEEPSEEK_TIMEOUT_MS = toNumberOr(process.env.DEEPSEEK_TIMEOUT_MS, 120000);
const DEFAULT_DEEPSEEK_THINKING = normalizeDeepSeekThinking(process.env.DEEPSEEK_THINKING || 'disabled');
const E2E_TEST_MODE = /^(1|true|yes|on)$/i.test(String(process.env.E2E_TEST_MODE || '').trim());
const SQLITE_BUSY_TIMEOUT_MS = Math.max(0, toNumberOr(process.env.SQLITE_BUSY_TIMEOUT_MS, 5000));
const SQLITE_BUSY_RETRY_MAX = Math.max(0, toNumberOr(process.env.SQLITE_BUSY_RETRY_MAX, 3));
const SQLITE_BUSY_RETRY_BASE_MS = Math.max(0, toNumberOr(process.env.SQLITE_BUSY_RETRY_BASE_MS, 25));
const GENERATION_WORKER_SHUTDOWN_TIMEOUT_MS = Math.max(
  1000,
  toNumberOr(process.env.GENERATION_WORKER_SHUTDOWN_TIMEOUT_MS, 30000)
);
const SELECTION_TTS_ENABLED = /^(1|true|yes|on)$/i.test(
  String(process.env.SELECTION_TTS_ENABLED || '').trim()
);
const SELECTION_TTS_CACHE_PATH = process.env.SELECTION_TTS_CACHE_PATH || '/data/selection_tts_cache';
const SELECTION_TTS_MAX_CHARS = Math.max(1, toNumberOr(process.env.SELECTION_TTS_MAX_CHARS, 300));
const SELECTION_TTS_TIMEOUT_MS = Math.max(1000, toNumberOr(process.env.SELECTION_TTS_TIMEOUT_MS, 15000));
const SELECTION_TTS_MAX_CONCURRENCY = Math.max(
  1,
  toNumberOr(process.env.SELECTION_TTS_MAX_CONCURRENCY, 2)
);
const SELECTION_TTS_CACHE_TTL_HOURS = Math.max(
  1,
  toNumberOr(process.env.SELECTION_TTS_CACHE_TTL_HOURS, 168)
);
const SELECTION_TTS_CACHE_MAX_BYTES = Math.max(
  1024,
  toNumberOr(process.env.SELECTION_TTS_CACHE_MAX_BYTES, 268435456)
);
const SELECTION_TTS_MAX_RESPONSE_BYTES = Math.max(
  1024,
  toNumberOr(process.env.SELECTION_TTS_MAX_RESPONSE_BYTES, 10485760)
);
const PRONUNCIATION_OVERLAY_ENABLED = /^(1|true|yes|on)$/i.test(
  String(process.env.PRONUNCIATION_OVERLAY_ENABLED || '').trim()
);
const PRONUNCIATION_ACTIONS_ENABLED = /^(1|true|yes|on)$/i.test(
  String(process.env.PRONUNCIATION_ACTIONS_ENABLED || '').trim()
);
const PRONUNCIATION_LEGACY_RUBY_READER_ENABLED = !/^(0|false|no|off)$/i.test(
  String(process.env.PRONUNCIATION_LEGACY_RUBY_READER_ENABLED ?? 'true').trim()
);
const PRONUNCIATION_TELEMETRY_ENABLED = /^(1|true|yes|on)$/i.test(
  String(process.env.PRONUNCIATION_TELEMETRY_ENABLED || '').trim()
);
const CARD_READER_V3_SHADOW_ENABLED = /^(1|true|yes|on)$/i.test(
  String(process.env.CARD_READER_V3_SHADOW_ENABLED || '').trim()
);
const CARD_READER_V3_SHADOW_MAX_MARKDOWN_CHARS = Math.max(
  1000,
  toNumberOr(process.env.CARD_READER_V3_SHADOW_MAX_MARKDOWN_CHARS, 200000)
);
const CARD_READER_V3_CANARY_ENABLED = /^(1|true|yes|on)$/i.test(
  String(process.env.CARD_READER_V3_CANARY_ENABLED || '').trim()
);
const CARD_READER_V3_CANARY_GENERATION_IDS = parsePositiveIntegerList(
  process.env.CARD_READER_V3_CANARY_GENERATION_IDS
);
// JLM-A0. Both default off: LANGUAGE_METADATA_ENABLED gates reading the domain
// at all, EXTRACTION gates whether a second LLM call is actually issued, so
// stored shadow output can be inspected without generating more of it.
const LANGUAGE_METADATA_ENABLED = /^(1|true|yes|on)$/i.test(
  String(process.env.LANGUAGE_METADATA_ENABLED || '').trim()
);
const LANGUAGE_METADATA_EXTRACTION_ENABLED = /^(1|true|yes|on)$/i.test(
  String(process.env.LANGUAGE_METADATA_EXTRACTION_ENABLED || '').trim()
);
const LANGUAGE_METADATA_TIMEOUT_MS = Math.max(
  1000,
  toNumberOr(process.env.LANGUAGE_METADATA_TIMEOUT_MS, 20000)
);

function toNumberOr(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function parsePositiveIntegerList(value) {
  return Object.freeze(Array.from(new Set(String(value || '')
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isSafeInteger(item) && item > 0))));
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
  TEXTBOOK_FEATURE_ENABLED,
  KG_ENABLED,
  KG_PLANNING_ENABLED,
  KG_LLM_ENRICHMENT_ENABLED,
  KG_INCREMENTAL_SYNC_ENABLED,
  CARD_ANNOTATIONS_ENABLED,
  TEXTBOOK_SOURCE_ROOT,
  TEXTBOOK_WORK_PATH,
  RECORDS_TIMEZONE,
  DEFAULT_LLM_PROVIDER,
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_DEEPSEEK_TIMEOUT_MS,
  DEFAULT_DEEPSEEK_THINKING,
  E2E_TEST_MODE,
  SQLITE_BUSY_TIMEOUT_MS,
  SQLITE_BUSY_RETRY_MAX,
  SQLITE_BUSY_RETRY_BASE_MS,
  GENERATION_WORKER_SHUTDOWN_TIMEOUT_MS,
  SELECTION_TTS_ENABLED,
  SELECTION_TTS_CACHE_PATH,
  SELECTION_TTS_MAX_CHARS,
  SELECTION_TTS_TIMEOUT_MS,
  SELECTION_TTS_MAX_CONCURRENCY,
  SELECTION_TTS_CACHE_TTL_HOURS,
  SELECTION_TTS_CACHE_MAX_BYTES,
  SELECTION_TTS_MAX_RESPONSE_BYTES,
  PRONUNCIATION_OVERLAY_ENABLED,
  PRONUNCIATION_ACTIONS_ENABLED,
  PRONUNCIATION_LEGACY_RUBY_READER_ENABLED,
  PRONUNCIATION_TELEMETRY_ENABLED,
  CARD_READER_V3_SHADOW_ENABLED,
  CARD_READER_V3_SHADOW_MAX_MARKDOWN_CHARS,
  CARD_READER_V3_CANARY_ENABLED,
  CARD_READER_V3_CANARY_GENERATION_IDS,
  LANGUAGE_METADATA_ENABLED,
  LANGUAGE_METADATA_EXTRACTION_ENABLED,
  LANGUAGE_METADATA_TIMEOUT_MS,
  SUPPORTED_CARD_TYPES,
  SUPPORTED_DEEPSEEK_MODELS,
  toNumberOr,
  parsePositiveIntegerList,
  normalizeLlmProvider,
  normalizeCardType,
  normalizeSourceMode,
  sanitizeDeepSeekModelName,
  resolveDeepSeekModel,
  normalizeDeepSeekThinking,
  tzOffsetClause,
};
