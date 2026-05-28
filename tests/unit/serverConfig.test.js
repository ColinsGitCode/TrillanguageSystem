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

test.describe('serverConfig.sanitizeGeminiModelName', () => {
  test.it('drops internal alias labels', () => {
    assert.equal(cfg.sanitizeGeminiModelName('gemini-cli'), '');
    assert.equal(cfg.sanitizeGeminiModelName('cli'), '');
    assert.equal(cfg.sanitizeGeminiModelName('default'), '');
    assert.equal(cfg.sanitizeGeminiModelName('DEFAULT'), '');
  });

  test.it('keeps real model ids and trims them', () => {
    assert.equal(cfg.sanitizeGeminiModelName('gemini-3-flash'), 'gemini-3-flash');
    assert.equal(cfg.sanitizeGeminiModelName('  gemini-3-pro  '), 'gemini-3-pro');
  });

  test.it('returns empty string for blank input', () => {
    assert.equal(cfg.sanitizeGeminiModelName(''), '');
    assert.equal(cfg.sanitizeGeminiModelName(undefined), '');
  });
});

test.describe('serverConfig.resolveGeminiModel', () => {
  test.it('prefers a valid model override', () => {
    assert.equal(cfg.resolveGeminiModel('host-proxy', 'gemini-3-pro'), 'gemini-3-pro');
    assert.equal(cfg.resolveGeminiModel('cli', 'gemini-x'), 'gemini-x');
  });

  test.it('skips an alias override and falls through to env', () => {
    const saved = process.env.GEMINI_PROXY_MODEL;
    process.env.GEMINI_PROXY_MODEL = 'env-proxy-model';
    try {
      assert.equal(cfg.resolveGeminiModel('host-proxy', 'cli'), 'env-proxy-model');
    } finally {
      if (saved === undefined) delete process.env.GEMINI_PROXY_MODEL;
      else process.env.GEMINI_PROXY_MODEL = saved;
    }
  });

  test.it('returns empty string when nothing resolves', () => {
    const keys = ['GEMINI_PROXY_MODEL', 'GEMINI_CLI_MODEL', 'GEMINI_MODEL'];
    const saved = {};
    for (const k of keys) { saved[k] = process.env[k]; delete process.env[k]; }
    try {
      assert.equal(cfg.resolveGeminiModel('host-proxy', 'default'), '');
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });
});

test.describe('serverConfig misc helpers', () => {
  test.it('normalizeLlmProvider always returns gemini', () => {
    assert.equal(cfg.normalizeLlmProvider(), 'gemini');
  });
});
