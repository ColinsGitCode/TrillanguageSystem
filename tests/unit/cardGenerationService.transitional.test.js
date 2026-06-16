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

async function captureGeminiProxyModel(t, { modelOverride = undefined } = {}) {
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
      modelOverride,
    });

    return captured.model;
}

test.describe('cardGenerationService transitional provider wiring', () => {
  test.it('does not pass DeepSeek defaults into the legacy Gemini proxy path', async (t) => {
    const model = await captureGeminiProxyModel(t, { modelOverride: 'deepseek-v4-flash' });

    assert.notEqual(model, 'deepseek-v4-flash');
    assert.equal(model, '');
  });

  test.it('preserves GEMINI_PROXY_MODEL fallback for the legacy Gemini proxy path', async (t) => {
    const savedProxyModel = process.env.GEMINI_PROXY_MODEL;
    process.env.GEMINI_PROXY_MODEL = 'gemini-legacy-proxy';
    t.after(() => {
      if (savedProxyModel === undefined) delete process.env.GEMINI_PROXY_MODEL;
      else process.env.GEMINI_PROXY_MODEL = savedProxyModel;
    });

    const model = await captureGeminiProxyModel(t, { modelOverride: 'deepseek-v4-pro' });

    assert.equal(model, 'gemini-legacy-proxy');
  });

  test.it('preserves TRAINING_TEACHER_MODEL fallback for the legacy Gemini proxy path', async (t) => {
    const savedProxyModel = process.env.GEMINI_PROXY_MODEL;
    const savedTeacherModel = process.env.TRAINING_TEACHER_MODEL;
    delete process.env.GEMINI_PROXY_MODEL;
    process.env.TRAINING_TEACHER_MODEL = 'gemini-teacher-legacy';
    t.after(() => {
      if (savedProxyModel === undefined) delete process.env.GEMINI_PROXY_MODEL;
      else process.env.GEMINI_PROXY_MODEL = savedProxyModel;
      if (savedTeacherModel === undefined) delete process.env.TRAINING_TEACHER_MODEL;
      else process.env.TRAINING_TEACHER_MODEL = savedTeacherModel;
    });

    const model = await captureGeminiProxyModel(t, { modelOverride: 'deepseek-custom' });

    assert.equal(model, 'gemini-teacher-legacy');
  });
});
