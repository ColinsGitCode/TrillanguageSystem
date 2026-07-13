'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createCardGenerationUseCase,
  CardAdmissionError,
  GenerationCommandError,
  GenerationValidationError,
} = require('../../services/application/executeCardGeneration');

function createHarness(overrides = {}) {
  const calls = {
    marks: [],
    insertData: null,
    insertedErrors: [],
    generatedOptions: null,
    cleanupCalls: [],
    deletedGenerations: [],
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
    findDuplicateGenerations: () => [],
    assertDuplicatePolicy: ({ duplicatePolicy, duplicates }) => ({ policy: duplicatePolicy, duplicates }),
    createGenerationStagingArea: ({ targetDir, folderName, baseName }) => ({
      targetDir,
      folderName,
      baseName,
      stagingDir: '/tmp/cards/.staging/run',
      stagingRoot: '/tmp/cards/.staging',
    }),
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
    publishStagedGeneration: ({ targetDir, baseName }) => ({
      publishedPaths: [
        `${targetDir}/${baseName}.md`,
        `${targetDir}/${baseName}.html`,
        `${targetDir}/${baseName}.meta.json`,
        `${targetDir}/${baseName}_en_1.mp3`,
      ],
      absPaths: {
        md: `${targetDir}/${baseName}.md`,
        html: `${targetDir}/${baseName}.html`,
        meta: `${targetDir}/${baseName}.meta.json`,
      },
    }),
    cleanupGenerationArtifacts: (payload) => calls.cleanupCalls.push(payload),
    hasTtsEndpoint: () => true,
    normalizeAudioTasks: (tasks) => tasks,
    generateAudioBatch: async () => ({
      files: [{ success: true, provider: 'kokoro' }],
      results: [{ index: 0, filePath: '/tmp/cards/.staging/run/provider-card_en_1.mp3' }],
      errors: [],
    }),
    validateCardAdmission: () => ({
      status: 'eligible',
      contentHash: 'a'.repeat(64),
      structure: { reviewRequired: false },
      audio: { expected: 1, generated: 1 },
    }),
    buildPersistedAudioTasks: (tasks) => tasks.map((task) => ({ ...task, status: 'generated' })),
    prepareInsertData: (data) => {
      calls.insertData = data;
      return { generation: data };
    },
    buildAdmissionTags: () => [
      { namespace: 'lang', value: 'en', normalizedValue: 'en' },
      { namespace: 'src', value: 'input', normalizedValue: 'input' },
    ],
    insertGeneration: () => 42,
    getGenerationById: () => ({ content_hash: 'a'.repeat(64), audioFiles: [{}] }),
    listCardTags: () => [
      { namespace: 'lang', status: 'active' },
      { namespace: 'src', status: 'active' },
    ],
    validatePersistedAdmission: () => true,
    deleteGeneration: (generationId) => calls.deletedGenerations.push(generationId),
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
      'fallback', 'duplicate_policy', 'generationId', 'result', 'audio', 'prompt', 'llm_output',
      'observability', 'admission',
    ]);
    assert.equal(result.success, true);
    assert.equal(result.generationId, 42);
    assert.equal(result.provider_requested, 'deepseek');
    assert.equal(result.provider_used, 'deepseek');
    assert.equal(result.duplicate_policy, 'reject');
    assert.equal(result.admission.status, 'eligible');
    assert.equal(result.llm_output.html_content, '<article>Card</article>');
    assert.equal(result.audio.files[0].provider, 'kokoro');
    assert.equal(calls.generatedOptions.targetFolder, 'custom');
    assert.equal(calls.generatedOptions.modelOverride, 'deepseek-v4-pro');
    assert.equal(calls.insertData.audioTasks[0].status, 'generated');
    assert.deepEqual(calls.marks, ['fileSave', 'audioGenerate']);
    assert.equal(calls.cleanupCalls.length, 0);
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
    assert.equal(calls.cleanupCalls.length, 1);
  });

  test.it('rejects empty direct commands before invoking provider or persistence', async () => {
    const { calls, execute } = createHarness();
    await assert.rejects(
      execute({ phrase: '   ' }),
      (error) => error instanceof GenerationCommandError && error.status === 400
    );
    assert.equal(calls.generatedOptions, null);
    assert.equal(calls.insertedErrors.length, 0);
    assert.equal(calls.cleanupCalls.length, 1);
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
    assert.equal(calls.cleanupCalls.length, 1);
  });

  test.it('rejects historical duplicates before provider or file work', async () => {
    const { calls, execute } = createHarness({
      findDuplicateGenerations: () => [{ id: 9, phrase: 'same', card_type: 'trilingual' }],
      assertDuplicatePolicy: () => {
        throw new CardAdmissionError('duplicate', { code: 'CARD_DUPLICATE_EXISTS', status: 409 });
      },
    });
    await assert.rejects(
      execute({ phrase: 'same' }),
      (error) => error.code === 'CARD_DUPLICATE_EXISTS' && error.status === 409
    );
    assert.equal(calls.generatedOptions, null);
    assert.equal(calls.insertedErrors.length, 0);
    assert.equal(calls.cleanupCalls.length, 1);
  });

  test.it('compensates the DB row and published files when readback admission fails', async () => {
    const readbackError = new CardAdmissionError('readback failed', {
      code: 'CARD_ADMISSION_READBACK_FAILED',
      status: 500,
    });
    const { calls, execute } = createHarness({
      validatePersistedAdmission: () => { throw readbackError; },
    });
    await assert.rejects(execute({ phrase: 'readback failure' }), readbackError);
    assert.deepEqual(calls.deletedGenerations, [42]);
    assert.equal(calls.cleanupCalls.length, 1);
    assert.equal(calls.cleanupCalls[0].publishedPaths.length, 4);
    assert.equal(calls.insertedErrors.length, 0);
  });
});
