'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeAudioTasks,
  validateGeneratedContent,
  extractGeminiMarkdownResponse,
  validateSanitizedGeminiCardResponse,
} = require('../../lib/generationHelpers');

test.describe('normalizeAudioTasks', () => {
  test.it('returns [] for non-array input', () => {
    assert.deepEqual(normalizeAudioTasks(null), []);
    assert.deepEqual(normalizeAudioTasks('nope', 'base'), []);
  });

  test.it('strips baseName + known extension from filename_suffix', () => {
    const tasks = [{ filename_suffix: 'mycard_en_1.mp3', lang: 'en' }];
    const out = normalizeAudioTasks(tasks, 'mycard');
    assert.equal(out[0].filename_suffix, '_en_1');
  });

  test.it('synthesizes a suffix when filename_suffix is empty', () => {
    const tasks = [
      { filename_suffix: '', lang: 'ja' },
      { filename_suffix: '', lang: 'en' },
    ];
    const out = normalizeAudioTasks(tasks, 'mycard');
    assert.equal(out[0].filename_suffix, '_ja_1');
    assert.equal(out[1].filename_suffix, '_en_2');
  });

  test.it('English tasks default response_format to the normalized extension', () => {
    const tasks = [{ filename_suffix: '_en_1', lang: 'en' }];
    const out = normalizeAudioTasks(tasks, '');
    assert.equal(out[0].extension, 'mp3');
    assert.equal(out[0].response_format, 'mp3');
  });

  test.it('Japanese tasks pick wav extension and do not set response_format', () => {
    const tasks = [{ filename_suffix: '_ja_1', lang: 'ja' }];
    const out = normalizeAudioTasks(tasks, '');
    assert.equal(out[0].extension, 'wav');
    assert.equal(out[0].response_format, undefined);
  });

  test.it('does not mutate the input task objects', () => {
    const tasks = [{ filename_suffix: 'mycard_en_1.mp3', lang: 'en' }];
    const before = { ...tasks[0] };
    normalizeAudioTasks(tasks, 'mycard');
    assert.deepEqual(tasks[0], before);
  });
});

test.describe('validateGeneratedContent', () => {
  test.it('reports non-object input as invalid JSON', () => {
    assert.deepEqual(validateGeneratedContent(null), ['Response is not a valid JSON object']);
    assert.deepEqual(validateGeneratedContent('text'), ['Response is not a valid JSON object']);
  });

  test.it('reports missing or empty markdown_content', () => {
    assert.deepEqual(validateGeneratedContent({}), ['markdown_content is missing or empty']);
    assert.deepEqual(
      validateGeneratedContent({ markdown_content: '   ' }),
      ['markdown_content is missing or empty']
    );
  });

  test.it('returns [] for a well-formed object (HTML check is currently relaxed)', () => {
    assert.deepEqual(
      validateGeneratedContent({ markdown_content: '## hello' }),
      []
    );
  });
});

test.describe('extractGeminiMarkdownResponse', () => {
  test.it('returns "" for non-object input', () => {
    assert.equal(extractGeminiMarkdownResponse(null), '');
    assert.equal(extractGeminiMarkdownResponse('str'), '');
    assert.equal(extractGeminiMarkdownResponse(undefined), '');
  });

  test.it('prefers the markdown field over rawOutput', () => {
    assert.equal(
      extractGeminiMarkdownResponse({ markdown: 'A', rawOutput: 'B' }),
      'A'
    );
  });

  test.it('falls back to rawOutput when markdown is missing', () => {
    assert.equal(extractGeminiMarkdownResponse({ rawOutput: '  B  ' }), 'B');
  });
});

test.describe('validateSanitizedGeminiCardResponse', () => {
  function trilingualCard() {
    return [
      '## 1. 英文',
      '- **例句1**: Hello.',
      '- **例句2**: Goodbye.',
      '## 2. 日本語',
      '- **例句1**: こんにちは。',
      '- **例句2**: さようなら。',
      '## 3. 中文',
      '- **例句1**: 你好。',
    ].join('\n');
  }

  function grammarCard() {
    return [
      '## 1. 语法概述',
      '概述内容。',
      '## 2. 日本語',
      '- **例句1**: 日本語の例。',
      '- **例句2**: もう一つ。',
      '- **例句3**: 三つ目。',
      '## 3. 常见误用',
      '常见误用。',
    ].join('\n');
  }

  test.it('returns false when response yields no markdown', () => {
    assert.equal(validateSanitizedGeminiCardResponse(null), false);
    assert.equal(validateSanitizedGeminiCardResponse({}), false);
  });

  test.it('rejects markdown containing MCP diagnostic noise', () => {
    const md = `${trilingualCard()}\n\nMCP issues detected — Run /mcp list for status`;
    assert.equal(validateSanitizedGeminiCardResponse({ markdown: md }), false);
  });

  test.it('requires the trilingual section trio by default', () => {
    const missing = trilingualCard().replace('## 3. 中文', '## 3. CHINESE');
    assert.equal(validateSanitizedGeminiCardResponse({ markdown: missing }), false);
  });

  test.it('accepts a well-formed trilingual card with enough audio tasks', () => {
    assert.equal(validateSanitizedGeminiCardResponse({ markdown: trilingualCard() }), true);
  });

  test.it('requires the grammar_ja section trio when cardType is grammar_ja', () => {
    assert.equal(validateSanitizedGeminiCardResponse({ markdown: grammarCard() }, 'grammar_ja'), true);
    // A trilingual card lacks the grammar headings.
    assert.equal(validateSanitizedGeminiCardResponse({ markdown: trilingualCard() }, 'grammar_ja'), false);
  });
});
