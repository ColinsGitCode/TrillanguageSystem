'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { TextbookOperationExecutor } = require('../../services/textbooks/textbookOperationExecutor');

function fakeDb() {
  const state = {
    operation: {
      id: 1,
      track_id: 7,
      kind: 'release',
      status: 'queued',
      result: {
        command: {
          expectedTrackRevision: 1,
          confirmUnitCount: 4,
          expectedPlanRevision: 0,
          includeTts: true,
        },
        steps: {},
      },
    },
    publishCalls: 0,
  };
  return {
    state,
    getTextbookOperation: () => structuredClone(state.operation),
    claimTextbookOperation: () => {
      if (state.operation.status !== 'queued') return null;
      state.operation.status = 'running';
      return structuredClone(state.operation);
    },
    updateTextbookOperationStep: (_id, step, status, options = {}) => {
      state.operation.result.steps[step] = {
        status,
        errorCode: options.errorCode || null,
        retryable: Boolean(options.retryable),
        ...(Object.hasOwn(options, 'result') ? { result: options.result } : {}),
      };
      return structuredClone(state.operation);
    },
    finishTextbookOperation: (_id, status, options = {}) => {
      state.operation.status = status;
      state.operation.public_summary = options.publicSummary;
      state.operation.error_code = options.errorCode || null;
      state.operation.result = { ...state.operation.result, ...(options.result || {}) };
      return structuredClone(state.operation);
    },
    publishTextbookTrack: () => {
      state.publishCalls += 1;
      return { unitCount: 4, itemActions: { inserted: 4 } };
    },
  };
}

test('release operation preserves publish when TTS partly fails and retries only unfinished steps', async () => {
  const dbService = fakeDb();
  let ttsCalls = 0;
  const executor = new TextbookOperationExecutor({
    dbService,
    ttsService: {
      generateTrack: async () => {
        ttsCalls += 1;
        return { summary: { failed: ttsCalls === 1 ? 1 : 0 } };
      },
    },
    logger: { error() {} },
  });

  const first = await executor.execute(1);
  assert.equal(first.status, 'partially_failed');
  assert.equal(first.error_code, 'TEXTBOOK_TTS_PARTIAL_FAILURE');
  assert.equal(dbService.state.publishCalls, 1);
  assert.equal(dbService.state.operation.result.steps.publish.status, 'succeeded');
  assert.equal(dbService.state.operation.result.steps.materialize.status, 'succeeded');
  assert.equal(dbService.state.operation.result.steps.tts.status, 'failed');

  dbService.state.operation.status = 'queued';
  const retried = await executor.execute(1);
  assert.equal(retried.status, 'succeeded');
  assert.equal(dbService.state.publishCalls, 1);
  assert.equal(ttsCalls, 2);
  assert.equal(dbService.state.operation.result.steps.sync.status, 'succeeded');
});
