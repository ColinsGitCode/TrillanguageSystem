'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createCardGenerationUseCase,
  GenerationCommandError,
  GenerationValidationError,
} = require('../../services/application/executeCardGeneration');

function createHarness(overrides = {}) {
  const calls = {
    marks: [],
    insertData: null,
    insertedErrors: [],
    generatedOptions: null,
  };
  const content = {
    markdown_content: '# Card',
    html_content: '',
    audio_tasks: [{ lang: 'en', text: 'hello', filename_suffix: '_en_1' }],
  };
  const observability = { metadata: { provider: 'deepseek', model: 'test-model' } };
  const ports = {
    activeProvider: 'deepseek',
    defaultModel: 'deepseek-v4-pro',
    e2eTestMode: false,
    log: { info() {}, error() {} },
    createPerformanceMonitor: () => ({
      mark: (name) => calls.marks.push(name),
      end: () => ({ totalTime: 12, phases: {} }),
    }),
    buildFixtureResult: () => ({
      output: content,
      prompt: 'fixture prompt',
      observability,
      baseName: 'fixture-card',
      targetDir: '/tmp/cards',
      folderName: '20260713',
      fallback: null,
    }),
    generateWithProvider: async (_phrase, _provider, _perf, options) => {
      calls.generatedOptions = options;
      return {
        output: content,
        prompt: 'provider prompt',
        observability,
        baseName: 'provider-card',
        targetDir: '/tmp/cards',
        folderName: '20260713',
        fallback: null,
      };
    },
    postProcessGeneratedContent: () => {},
    validateGeneratedContent: () => [],
    resolveCardAudioTasks: (value) => value.audio_tasks,
    prepareMarkdownForCard: async (markdown) => `${markdown}\nprepared`,
    renderHtmlFromMarkdown: async () => '<article>Card</article>',
    saveGeneratedFiles: (_phrase, _content, options) => ({
      folder: options.folderName,
      baseName: options.baseName,
      targetDir: options.targetDir,
      files: [`${options.baseName}.md`, `${options.baseName}.html`],
      absPaths: {
        md: `/tmp/cards/${options.baseName}.md`,
        html: `/tmp/cards/${options.baseName}.html`,
        meta: `/tmp/cards/${options.baseName}.meta.json`,
      },
    }),
    hasTtsEndpoint: () => true,
    normalizeAudioTasks: (tasks) => tasks,
    generateAudioBatch: async () => ({ files: [{ success: true, provider: 'kokoro' }] }),
    buildPersistedAudioTasks: (tasks) => tasks.map((task) => ({ ...task, status: 'generated' })),
    prepareInsertData: (data) => {
      calls.insertData = data;
      return { generation: data };
    },
    insertGeneration: () => 42,
    insertError: (data) => calls.insertedErrors.push(data),
    normalizeCardType: (value) => value || 'trilingual',
    normalizeSourceMode: (value) => value || null,
    ...overrides,
  };
  return { calls, execute: createCardGenerationUseCase(ports) };
}

test.describe('executeCardGeneration application use case', () => {
  test.it('owns generation, TTS, persistence, and the stable result envelope', async () => {
    const { calls, execute } = createHarness();
    const result = await execute({
      phrase: '  hello  ',
      cardType: 'trilingual',
      sourceMode: 'input',
      targetFolder: 'custom',
    });

    assert.deepEqual(Object.keys(result), [
      'success', 'card_type', 'source_mode', 'provider_requested', 'provider_used',
      'fallback', 'generationId', 'result', 'audio', 'prompt', 'llm_output', 'observability',
    ]);
    assert.equal(result.success, true);
    assert.equal(result.generationId, 42);
    assert.equal(result.provider_requested, 'deepseek');
    assert.equal(result.provider_used, 'deepseek');
    assert.equal(result.llm_output.html_content, '<article>Card</article>');
    assert.equal(result.audio.files[0].provider, 'kokoro');
    assert.equal(calls.generatedOptions.targetFolder, 'custom');
    assert.equal(calls.generatedOptions.modelOverride, 'deepseek-v4-pro');
    assert.equal(calls.insertData.audioTasks[0].status, 'generated');
    assert.deepEqual(calls.marks, ['fileSave', 'audioGenerate']);
  });

  test.it('uses deterministic fixtures and skips TTS in E2E context', async () => {
    let fixtureCalls = 0;
    let ttsCalls = 0;
    const { execute } = createHarness({
      buildFixtureResult: ({ cardType }) => {
        fixtureCalls += 1;
        return {
          output: { markdown_content: '# Fixture', html_content: '', audio_tasks: [] },
          prompt: 'fixture',
          observability: { metadata: { provider: 'deepseek', model: 'fixture' } },
          baseName: 'fixture',
          targetDir: '/tmp/cards',
          folderName: '20260713',
          fallback: null,
          cardType,
        };
      },
      generateAudioBatch: async () => { ttsCalls += 1; },
    });

    const result = await execute({ phrase: 'fixture', cardType: 'scenario_phrase' }, { e2eTestMode: true });
    assert.equal(result.card_type, 'scenario_phrase');
    assert.equal(fixtureCalls, 1);
    assert.equal(ttsCalls, 0);
    assert.equal(result.audio, null);
  });

  test.it('raises a typed validation error without writing files or error records', async () => {
    let saveCalls = 0;
    const { calls, execute } = createHarness({
      validateGeneratedContent: () => ['missing heading'],
      saveGeneratedFiles: () => { saveCalls += 1; },
    });

    await assert.rejects(
      execute({ phrase: 'invalid card' }),
      (error) => {
        assert.ok(error instanceof GenerationValidationError);
        assert.equal(error.status, 422);
        assert.deepEqual(error.details, ['missing heading']);
        assert.equal(error.prompt, 'provider prompt');
        return true;
      }
    );
    assert.equal(saveCalls, 0);
    assert.equal(calls.insertedErrors.length, 0);
  });

  test.it('rejects empty direct commands before invoking provider or persistence', async () => {
    const { calls, execute } = createHarness();
    await assert.rejects(
      execute({ phrase: '   ' }),
      (error) => error instanceof GenerationCommandError && error.status === 400
    );
    assert.equal(calls.generatedOptions, null);
    assert.equal(calls.insertedErrors.length, 0);
  });

  test.it('records unexpected execution failures once and rethrows them', async () => {
    const providerError = new Error('provider unavailable');
    const { calls, execute } = createHarness({
      generateWithProvider: async () => { throw providerError; },
    });

    await assert.rejects(execute({ phrase: 'failure' }), providerError);
    assert.equal(calls.insertedErrors.length, 1);
    assert.equal(calls.insertedErrors[0].phrase, 'failure');
    assert.equal(calls.insertedErrors[0].errorMessage, 'provider unavailable');
  });
});
