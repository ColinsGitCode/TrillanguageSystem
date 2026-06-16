'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function installStub(modulePath, exportsValue) {
  const resolved = require.resolve(modulePath);
  const previous = require.cache[resolved];
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: exportsValue,
  };
  return () => {
    if (previous) require.cache[resolved] = previous;
    else delete require.cache[resolved];
  };
}

async function captureDeepSeekCall(
  t,
  {
    provider = 'gemini',
    modelOverride = 'deepseek-v4-pro',
    usage = { input: 7, output: 11, total: 18 },
    estimate = () => 0,
  } = {}
) {
  const servicePath = require.resolve('../../services/generation/cardGenerationService');
  const restoreFns = [];
  const captured = {};

  delete require.cache[servicePath];
  restoreFns.push(installStub('../../services/generation/promptEngine', {
    buildPrompt: () => { throw new Error('unexpected json prompt'); },
    buildMarkdownPrompt: ({ phrase, filenameBase, cardType }) => {
      captured.promptArgs = { phrase, filenameBase, cardType };
      return 'markdown prompt';
    },
  }));
  restoreFns.push(installStub('../../services/llm/deepseekService', {
    generateMarkdown: async (prompt, options) => {
      captured.prompt = prompt;
      captured.options = options;
      return {
        markdown: [
          '## 1. 英文',
          '- **例句1**: Hello.',
          '- **例句2**: Goodbye.',
          '## 2. 日本語',
          '- **例句1**: こんにちは。',
          '- **例句2**: さようなら。',
          '## 3. 中文',
          '- **例句1**: 你好。',
        ].join('\n'),
        rawOutput: 'raw markdown',
        model: options.model,
        usage,
      };
    },
  }));
  restoreFns.push(installStub('../../services/storage/fileManager', {
    buildBaseName: () => 'base',
    ensureTodayDirectory: () => ({ targetDir: '/tmp', folderName: 'today' }),
    ensureFolderDirectory: () => ({ targetDir: '/tmp', folderName: 'folder' }),
  }));
  restoreFns.push(installStub('../../services/generation/htmlRenderer', {
    buildAudioTasksFromMarkdown: () => [
      { lang: 'en', text: 'Hello.', filename_suffix: '_en_1' },
      { lang: 'en', text: 'Goodbye.', filename_suffix: '_en_2' },
      { lang: 'ja', text: 'こんにちは。', filename_suffix: '_ja_1' },
      { lang: 'ja', text: 'さようなら。', filename_suffix: '_ja_2' },
    ],
    prepareMarkdownForCard: async (markdown) => `prepared:${markdown}`,
    renderHtmlFromMarkdown: async () => '<html><body>ok</body></html>',
  }));
  restoreFns.push(installStub('../../services/observability/observabilityService', {
    TokenCounter: {
      estimate,
      calculateCost: (usage, providerName) => ({ usage, providerName }),
    },
    QualityChecker: {
      check: () => ({ score: 1 }),
    },
    PromptParser: {
      parse: () => ({ parsed: true }),
    },
  }));

  t.after(() => {
    delete require.cache[servicePath];
    for (const restore of restoreFns.reverse()) restore();
  });

  const service = require('../../services/generation/cardGenerationService');
  const result = await service.generateWithProvider('hello', provider, { mark: () => {} }, {
    modelOverride,
    timeoutMs: 1234,
  });

  return { service, result, captured };
}

test.describe('cardGenerationService DeepSeek provider wiring', () => {
  test.it('routes generation through DeepSeek markdown regardless of legacy provider argument', async (t) => {
    const { result, captured } = await captureDeepSeekCall(t);

    assert.equal(captured.prompt, 'markdown prompt');
    assert.deepEqual(captured.promptArgs, {
      phrase: 'hello',
      filenameBase: 'base',
      cardType: 'trilingual',
    });
    assert.deepEqual(captured.options, {
      model: 'deepseek-v4-pro',
      timeoutMs: 1234,
    });
    assert.equal(result.observability.metadata.provider, 'deepseek');
    assert.equal(result.observability.metadata.model, 'deepseek-v4-pro');
    assert.equal(result.observability.metadata.outputMode, 'markdown');
    assert.equal(result.output.markdown_content.startsWith('prepared:'), true);
    assert.equal(result.output.html_content, '<html><body>ok</body></html>');
    assert.equal(result.output.audio_tasks.length, 4);
  });

  test.it('exports only generateWithProvider', async (t) => {
    const { service } = await captureDeepSeekCall(t, { provider: 'local', modelOverride: 'gemini-legacy' });

    assert.equal(typeof service.generateWithProvider, 'function');
    assert.equal(service.generateWithAutoFallback, undefined);
  });

  test.it('falls back to estimated tokens when DeepSeek reports zero usage', async (t) => {
    const { result } = await captureDeepSeekCall(t, {
      usage: { input: 0, output: 0, total: 0 },
      estimate: (text) => (text === 'markdown prompt' ? 4 : 21),
    });

    assert.deepEqual(result.observability.tokens, {
      input: 4,
      output: 21,
      total: 25,
    });
    assert.deepEqual(result.observability.cost.usage, {
      input: 4,
      output: 21,
      total: 25,
    });
  });
});
