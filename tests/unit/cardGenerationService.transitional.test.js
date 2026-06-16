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

test.describe('cardGenerationService transitional provider wiring', () => {
  test.it('does not pass DeepSeek defaults into the legacy Gemini proxy path', async (t) => {
    const servicePath = require.resolve('../../services/generation/cardGenerationService');
    const restoreFns = [];
    const captured = {};

    delete require.cache[servicePath];
    restoreFns.push(installStub('../../services/generation/promptEngine', {
      buildPrompt: () => 'json prompt',
      buildMarkdownPrompt: () => 'markdown prompt',
    }));
    restoreFns.push(installStub('../../services/llm/geminiService', {
      generateContent: async () => ({ content: {}, usage: { input: 0, output: 0, total: 0 } }),
    }));
    restoreFns.push(installStub('../../services/llm/geminiCliService', {
      runGeminiCli: async () => { throw new Error('unexpected cli call'); },
    }));
    restoreFns.push(installStub('../../services/llm/geminiProxyService', {
      runGeminiProxy: async (_prompt, options) => {
        captured.model = options.model;
        return { markdown: '# ok', rawOutput: '# ok', model: options.model || null };
      },
    }));
    restoreFns.push(installStub('../../services/llm/localLlmService', {
      generateContent: async () => ({ content: {}, usage: { input: 0, output: 0, total: 0 } }),
    }));
    restoreFns.push(installStub('../../services/storage/fileManager', {
      buildBaseName: () => 'base',
      ensureTodayDirectory: () => ({ targetDir: '/tmp', folderName: 'today' }),
      ensureFolderDirectory: () => ({ targetDir: '/tmp', folderName: 'folder' }),
    }));
    restoreFns.push(installStub('../../services/generation/htmlRenderer', {
      buildAudioTasksFromMarkdown: () => [],
      prepareMarkdownForCard: async (markdown) => markdown,
      renderHtmlFromMarkdown: async () => '<p>ok</p>',
    }));
    restoreFns.push(installStub('../../services/observability/observabilityService', {
      TokenCounter: {
        estimate: () => 0,
        calculateCost: () => 0,
      },
      QualityChecker: {
        check: () => ({ score: 1 }),
      },
      PromptParser: {
        parse: () => ({}),
      },
    }));

    t.after(() => {
      delete require.cache[servicePath];
      for (const restore of restoreFns.reverse()) restore();
    });

    const savedMode = process.env.GEMINI_MODE;
    process.env.GEMINI_MODE = 'host-proxy';
    t.after(() => {
      if (savedMode === undefined) delete process.env.GEMINI_MODE;
      else process.env.GEMINI_MODE = savedMode;
    });

    const { generateWithProvider } = require('../../services/generation/cardGenerationService');
    await generateWithProvider('hello', 'gemini', { mark: () => {} }, {
      modelOverride: 'deepseek-v4-flash',
    });

    assert.notEqual(captured.model, 'deepseek-v4-flash');
    assert.equal(captured.model, '');
  });
});
