'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeAudioTasks,
  resolveCardAudioTasks,
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
  function scenarioCard(count = 12, options = {}) {
    const lines = [
      '# 空港で道を尋ねる',
      '## 1. 场景说明',
      '- **角色**: 旅行者と駅員',
      '- **语气**: 丁寧',
      '- **目标**: 乗り場を確認する',
      '## 2. 常用表达',
    ];
    for (let i = 1; i <= count; i += 1) {
      const padded = String(i).padStart(2, '0');
      lines.push(
        `### ${padded}. 表达标题${i}`,
        `- **中文**: 请问${i}号登机口在哪里？`,
        options.missingAudioLines
          ? `- **英语**: Where is gate ${i}?`
          : `- **英文**: Where is gate ${i}?`,
        options.missingAudioLines
          ? `- **日文**: 搭乗口${i}はどこですか。`
          : options.duplicateEnglishNoJapanese
            ? `- **英文**: Where can I find gate ${i}?`
            : `- **日本語**: 搭乗口${i}はどこですか。`,
        options.missingUsageHint ? '' : '- **使用提示**: 确认位置时使用。'
      );
    }
    const markdown = lines.filter(Boolean).join('\n');
    return options.missingChinese
      ? markdown.replace(/^- \*\*中文\*\*: .+$/gm, '')
      : markdown;
  }

  function scenarioCardWithExpressionsInSectionThree() {
    return scenarioCard().replace('## 2. 常用表达\n', '## 2. 常用表达\n## 3. 常用表达\n');
  }

  function scenarioCardWithDuplicateAndMissingEnglishIndex() {
    return scenarioCard()
      .replace(
        '- **英文**: Where is gate 1?',
        '- **英文**: Where is gate 1?\n- **英文**: Where can I find gate 1?'
      )
      .replace('- **英文**: Where is gate 12?', '- **英语**: Where is gate 12?');
  }

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

  test.it('accepts complete scenario card', () => {
    assert.deepEqual(
      validateGeneratedContent(
        { markdown_content: scenarioCard() },
        { cardType: 'scenario_phrase', allowMissingHtml: true }
      ),
      []
    );
  });

  test.it('rejects fewer than 12 scenario expressions', () => {
    assert.deepEqual(
      validateGeneratedContent(
        { markdown_content: scenarioCard(11) },
        { cardType: 'scenario_phrase', allowMissingHtml: true }
      ),
      ['scenario_phrase requires exactly 12 expression blocks']
    );
  });

  test.it('rejects scenario cards without 12 English and 12 Japanese audio lines', () => {
    assert.deepEqual(
      validateGeneratedContent(
        { markdown_content: scenarioCard(12, { duplicateEnglishNoJapanese: true }) },
        { cardType: 'scenario_phrase', allowMissingHtml: true }
      ),
      ['scenario_phrase requires 12 English and 12 Japanese audio lines']
    );
  });

  test.it('rejects scenario expression blocks outside section two', () => {
    assert.deepEqual(
      validateGeneratedContent(
        { markdown_content: scenarioCardWithExpressionsInSectionThree() },
        { cardType: 'scenario_phrase', allowMissingHtml: true }
      ),
      ['scenario_phrase requires exactly 12 expression blocks']
    );
  });

  test.it('rejects scenario cards without one English audio line per expression index', () => {
    assert.deepEqual(
      validateGeneratedContent(
        { markdown_content: scenarioCardWithDuplicateAndMissingEnglishIndex() },
        { cardType: 'scenario_phrase', allowMissingHtml: true }
      ),
      ['scenario_phrase requires one English and one Japanese audio line per expression block']
    );
  });

  test.it('rejects scenario expression blocks missing Chinese lines', () => {
    assert.deepEqual(
      validateGeneratedContent(
        { markdown_content: scenarioCard(12, { missingChinese: true }) },
        { cardType: 'scenario_phrase', allowMissingHtml: true }
      ),
      ['scenario_phrase requires every expression block to include Chinese and usage hint lines']
    );
  });

  test.it('rejects scenario expression blocks missing usage hints', () => {
    assert.deepEqual(
      validateGeneratedContent(
        { markdown_content: scenarioCard(12, { missingUsageHint: true }) },
        { cardType: 'scenario_phrase', allowMissingHtml: true }
      ),
      ['scenario_phrase requires every expression block to include Chinese and usage hint lines']
    );
  });
});

test.describe('resolveCardAudioTasks', () => {
  function scenarioCard() {
    const lines = [
      '# 空港で道を尋ねる',
      '## 1. 场景说明',
      '- 丁寧に場所を確認する。',
      '## 2. 常用表达',
    ];
    for (let i = 1; i <= 12; i += 1) {
      const padded = String(i).padStart(2, '0');
      lines.push(
        `### ${padded}.`,
        `- **中文**: 请问${i}号登机口在哪里？`,
        `- **英文**: Where is gate ${i}?`,
        `- **日本語**: 搭乗口(とうじょうぐち)はどこですか。`,
        '- **使用提示**: 确认位置时使用。'
      );
    }
    return lines.join('\n');
  }

  test.it('overrides non-empty model audio_tasks for scenario cards with deterministic markdown-derived tasks', () => {
    const content = {
      markdown_content: scenarioCard(),
      audio_tasks: [
        { lang: 'en', text: 'wrong text', filename_suffix: '_bad_1' }
      ],
    };

    const tasks = resolveCardAudioTasks(content, 'scenario_phrase');

    assert.equal(tasks.length, 24);
    assert.equal(tasks[0].filename_suffix, '_en_1');
    assert.equal(tasks[1].filename_suffix, '_ja_1');
    assert.equal(tasks[0].text, 'Where is gate 1?');
    assert.match(tasks[1].text, /搭乗口/);
    assert.doesNotMatch(tasks[1].text, /\(/);
  });

  test.it('keeps non-empty model audio_tasks for non-scenario cards', () => {
    const tasks = [{ lang: 'en', text: 'Keep me', filename_suffix: '_custom' }];

    assert.deepEqual(
      resolveCardAudioTasks({ markdown_content: '## 1. 英文', audio_tasks: tasks }, 'trilingual'),
      tasks
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
  function scenarioCard(count = 12, options = {}) {
    const lines = [
      '# 空港で道を尋ねる',
      '## 1. 场景说明',
      '- **角色**: 旅行者と駅員',
      '- **语气**: 丁寧',
      '- **目标**: 乗り場を確認する',
      '## 2. 常用表达',
    ];
    for (let i = 1; i <= count; i += 1) {
      const padded = String(i).padStart(2, '0');
      lines.push(
        `### ${padded}. 表达标题${i}`,
        `- **中文**: 请问${i}号登机口在哪里？`,
        options.missingAudioLines
          ? `- **英语**: Where is gate ${i}?`
          : `- **英文**: Where is gate ${i}?`,
        options.missingAudioLines
          ? `- **日文**: 搭乗口${i}はどこですか。`
          : options.duplicateEnglishNoJapanese
            ? `- **英文**: Where can I find gate ${i}?`
            : `- **日本語**: 搭乗口${i}はどこですか。`,
        options.missingUsageHint ? '' : '- **使用提示**: 确认位置时使用。'
      );
    }
    const markdown = lines.filter(Boolean).join('\n');
    return options.missingChinese
      ? markdown.replace(/^- \*\*中文\*\*: .+$/gm, '')
      : markdown;
  }

  function scenarioCardWithExpressionsInSectionThree() {
    return scenarioCard().replace('## 2. 常用表达\n', '## 2. 常用表达\n## 3. 常用表达\n');
  }

  function scenarioCardWithDuplicateAndMissingEnglishIndex() {
    return scenarioCard()
      .replace(
        '- **英文**: Where is gate 1?',
        '- **英文**: Where is gate 1?\n- **英文**: Where can I find gate 1?'
      )
      .replace('- **英文**: Where is gate 12?', '- **英语**: Where is gate 12?');
  }

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

  test.it('accepts well-formed scenario card', () => {
    assert.equal(
      validateSanitizedGeminiCardResponse({ markdown: scenarioCard() }, 'scenario_phrase'),
      true
    );
  });

  test.it('rejects scenario markdown with missing expression audio lines', () => {
    assert.equal(
      validateSanitizedGeminiCardResponse(
        { markdown: scenarioCard(12, { missingAudioLines: true }) },
        'scenario_phrase'
      ),
      false
    );
  });

  test.it('rejects scenario markdown without 12 English and 12 Japanese audio lines', () => {
    assert.equal(
      validateSanitizedGeminiCardResponse(
        { markdown: scenarioCard(12, { duplicateEnglishNoJapanese: true }) },
        'scenario_phrase'
      ),
      false
    );
  });

  test.it('rejects scenario markdown with expression blocks outside section two', () => {
    assert.equal(
      validateSanitizedGeminiCardResponse(
        { markdown: scenarioCardWithExpressionsInSectionThree() },
        'scenario_phrase'
      ),
      false
    );
  });

  test.it('rejects scenario markdown without one English audio line per expression index', () => {
    assert.equal(
      validateSanitizedGeminiCardResponse(
        { markdown: scenarioCardWithDuplicateAndMissingEnglishIndex() },
        'scenario_phrase'
      ),
      false
    );
  });

  test.it('rejects scenario markdown missing Chinese or usage hint lines', () => {
    assert.equal(
      validateSanitizedGeminiCardResponse(
        { markdown: scenarioCard(12, { missingChinese: true }) },
        'scenario_phrase'
      ),
      false
    );
    assert.equal(
      validateSanitizedGeminiCardResponse(
        { markdown: scenarioCard(12, { missingUsageHint: true }) },
        'scenario_phrase'
      ),
      false
    );
  });
});
