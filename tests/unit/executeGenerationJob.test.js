'use strict';

process.env.DB_PATH = ':memory:';
process.env.LOG_SILENT = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  commandFromGenerationJob,
  createGenerationJobExecutor,
} = require('../../services/application/executeGenerationJob');

test.describe('executeGenerationJob', () => {
  test.it('maps a persisted queue row to the generation use-case command', () => {
    assert.deepEqual(commandFromGenerationJob({
      phraseRaw: ' raw phrase ',
      phraseNormalized: ' normalized phrase ',
      jobType: 'scenario_phrase',
      sourceMode: 'OCR',
      targetFolder: ' 2026.07.13 ',
      duplicatePolicy: 'create-version',
      provider: 'deepseek',
      llmModel: 'deepseek-v4-flash',
    }), {
      phrase: 'normalized phrase',
      cardType: 'scenario_phrase',
      sourceMode: 'ocr',
      targetFolder: '2026.07.13',
      duplicatePolicy: 'create-version',
      requestedProvider: 'deepseek',
      modelOverride: 'deepseek-v4-flash',
    });
  });

  test.it('calls the injected use case directly and returns its result', async () => {
    const calls = [];
    const expected = { success: true, generationId: 42 };
    const executor = createGenerationJobExecutor(async (command) => {
      calls.push(command);
      return expected;
    });

    const actual = await executor({
      phraseNormalized: 'handoff',
      jobType: 'trilingual',
      sourceMode: 'input',
      provider: 'deepseek',
      llmModel: 'deepseek-v4-pro',
    });

    assert.equal(actual, expected);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].phrase, 'handoff');
    assert.equal(calls[0].cardType, 'trilingual');
  });

  test.it('rejects a non-function use-case adapter', () => {
    assert.throws(() => createGenerationJobExecutor(null), /must be a function/);
  });
});
