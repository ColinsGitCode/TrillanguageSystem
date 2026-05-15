'use strict';

const crypto = require('crypto');

// Process-wide configuration and small pure helpers shared across server.js,
// the route modules, and the generation service. Kept dependency-free (only
// node builtins) so anything can require it without pulling in services.

const PORT = process.env.PORT || 3010;
const RECORDS_PATH = process.env.RECORDS_PATH || '/data/trilingual_records';
const DEFAULT_LLM_PROVIDER = 'gemini';
const TRAINING_TEACHER_MODEL = process.env.TRAINING_TEACHER_MODEL || 'gemini-3-flash-preview';
const DEFAULT_GEMINI_MODEL = TRAINING_TEACHER_MODEL;
const E2E_TEST_MODE = /^(1|true|yes|on)$/i.test(String(process.env.E2E_TEST_MODE || '').trim());

function toNumberOr(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function createExperimentId() {
  return `exp_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

function normalizeLlmProvider() {
  return 'gemini';
}

function resolveTrackingModel() {
  return DEFAULT_GEMINI_MODEL;
}

function normalizeCardType(cardType) {
  const normalized = String(cardType || 'trilingual').trim().toLowerCase();
  return normalized === 'grammar_ja' ? 'grammar_ja' : 'trilingual';
}

function normalizeSourceMode(sourceMode) {
  const normalized = String(sourceMode || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'selection') return 'selection';
  if (normalized === 'input') return 'input';
  if (normalized === 'ocr') return 'ocr';
  return normalized;
}

function sanitizeGeminiModelName(modelName) {
  const model = String(modelName || '').trim();
  if (!model) return '';
  const lowered = model.toLowerCase();
  // These aliases are internal labels, not real Gemini model ids.
  if (lowered === 'gemini-cli' || lowered === 'cli' || lowered === 'default') return '';
  return model;
}

function resolveGeminiModel(mode, modelOverride) {
  const candidates = mode === 'host-proxy'
    ? [modelOverride, process.env.GEMINI_PROXY_MODEL, process.env.GEMINI_CLI_MODEL, process.env.GEMINI_MODEL]
    : [modelOverride, process.env.GEMINI_CLI_MODEL, process.env.GEMINI_MODEL];

  for (const candidate of candidates) {
    const sanitized = sanitizeGeminiModelName(candidate);
    if (sanitized) return sanitized;
  }
  return '';
}

module.exports = {
  PORT,
  RECORDS_PATH,
  DEFAULT_LLM_PROVIDER,
  TRAINING_TEACHER_MODEL,
  DEFAULT_GEMINI_MODEL,
  E2E_TEST_MODE,
  toNumberOr,
  createExperimentId,
  normalizeLlmProvider,
  resolveTrackingModel,
  normalizeCardType,
  normalizeSourceMode,
  sanitizeGeminiModelName,
  resolveGeminiModel,
};
