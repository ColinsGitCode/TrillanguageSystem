'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const cfg = require('../../lib/serverConfig');

test.describe('serverConfig.toNumberOr', () => {
  test.it('parses numeric strings and numbers', () => {
    assert.equal(cfg.toNumberOr('5', 0), 5);
    assert.equal(cfg.toNumberOr(42, 0), 42);
  });

  test.it('keeps a finite zero rather than the fallback', () => {
    assert.equal(cfg.toNumberOr(0, 9), 0);
  });

  test.it('falls back for non-numeric input', () => {
    assert.equal(cfg.toNumberOr('abc', 7), 7);
    assert.equal(cfg.toNumberOr(undefined, 3), 3);
    assert.equal(cfg.toNumberOr(NaN, 1), 1);
  });
});

test.describe('serverConfig.normalizeCardType', () => {
  test.it('keeps grammar_ja', () => {
    assert.equal(cfg.normalizeCardType('grammar_ja'), 'grammar_ja');
    assert.equal(cfg.normalizeCardType('  GRAMMAR_JA '), 'grammar_ja');
  });

  test.it('keeps scenario_phrase', () => {
    assert.equal(cfg.normalizeCardType('scenario_phrase'), 'scenario_phrase');
    assert.equal(cfg.normalizeCardType('  SCENARIO_PHRASE '), 'scenario_phrase');
  });

  test.it('defaults everything else to trilingual', () => {
    assert.equal(cfg.normalizeCardType('trilingual'), 'trilingual');
    assert.equal(cfg.normalizeCardType('weird'), 'trilingual');
    assert.equal(cfg.normalizeCardType(''), 'trilingual');
    assert.equal(cfg.normalizeCardType(undefined), 'trilingual');
  });
});

test.describe('serverConfig.normalizeSourceMode', () => {
  test.it('recognises the known modes case-insensitively', () => {
    assert.equal(cfg.normalizeSourceMode('selection'), 'selection');
    assert.equal(cfg.normalizeSourceMode('INPUT'), 'input');
    assert.equal(cfg.normalizeSourceMode('Ocr'), 'ocr');
  });

  test.it('returns null for empty input', () => {
    assert.equal(cfg.normalizeSourceMode(''), null);
    assert.equal(cfg.normalizeSourceMode(undefined), null);
  });

  test.it('passes through other non-empty values lowercased', () => {
    assert.equal(cfg.normalizeSourceMode('Custom'), 'custom');
  });
});

test.describe('serverConfig.deepseek defaults', () => {
  test.it('uses DeepSeek as the only normalized provider', () => {
    assert.equal(cfg.DEFAULT_LLM_PROVIDER, 'deepseek');
    assert.equal(cfg.normalizeLlmProvider(), 'deepseek');
    assert.equal(cfg.normalizeLlmProvider('gemini'), 'deepseek');
    assert.equal(cfg.normalizeLlmProvider('local'), 'deepseek');
  });

  test.it('defaults to DeepSeek V4 Pro', () => {
    assert.equal(cfg.DEFAULT_DEEPSEEK_MODEL, 'deepseek-v4-pro');
    assert.equal(cfg.DEFAULT_DEEPSEEK_BASE_URL, 'https://api.deepseek.com');
  });

  test.it('sanitizes DeepSeek model names and rejects legacy Gemini aliases', () => {
    assert.equal(cfg.sanitizeDeepSeekModelName('deepseek-v4-flash'), 'deepseek-v4-flash');
    assert.equal(cfg.sanitizeDeepSeekModelName('  deepseek-v4-pro  '), 'deepseek-v4-pro');
    assert.equal(cfg.sanitizeDeepSeekModelName('gemini-cli'), '');
    assert.equal(cfg.sanitizeDeepSeekModelName('gemini-3-flash-preview'), '');
    assert.equal(cfg.sanitizeDeepSeekModelName(''), '');
  });

  test.it('resolves DeepSeek model override before env default', () => {
    const saved = process.env.DEEPSEEK_MODEL;
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-pro';
    try {
      assert.equal(cfg.resolveDeepSeekModel('deepseek-v4-flash'), 'deepseek-v4-flash');
      assert.equal(cfg.resolveDeepSeekModel('gemini-3-pro'), 'deepseek-v4-pro');
      assert.equal(cfg.resolveDeepSeekModel(''), 'deepseek-v4-pro');
    } finally {
      if (saved === undefined) delete process.env.DEEPSEEK_MODEL;
      else process.env.DEEPSEEK_MODEL = saved;
    }
  });
});

test.describe('serverConfig timezone helpers', () => {
  test.it('exports the configured records timezone', () => {
    assert.equal(typeof cfg.RECORDS_TIMEZONE, 'string');
    assert.ok(cfg.RECORDS_TIMEZONE.length > 0);
  });

  test.it('builds a SQLite minute modifier for Asia/Shanghai', () => {
    assert.equal(cfg.tzOffsetClause('Asia/Shanghai', new Date('2026-06-19T00:00:00Z')), '+480 minutes');
  });

  test.it('falls back to UTC for invalid timezone names', () => {
    assert.equal(cfg.tzOffsetClause('Not/AZone', new Date('2026-06-19T00:00:00Z')), '+0 minutes');
  });
});
