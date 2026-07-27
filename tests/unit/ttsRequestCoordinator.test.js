'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TtsRequestCoordinator } = require('../../services/generation/ttsRequestCoordinator');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('interactive TTS enters before queued batch work', async () => {
  const coordinator = new TtsRequestCoordinator({ maxConcurrency: 1 });
  const first = deferred();
  const order = [];
  const running = coordinator.run(async () => {
    order.push('batch-1');
    await first.promise;
  }, { requestClass: 'batch' });
  const secondBatch = coordinator.run(async () => {
    order.push('batch-2');
  }, { requestClass: 'batch' });
  const interactive = coordinator.run(async () => {
    order.push('interactive');
  }, { requestClass: 'interactive' });

  await new Promise((resolve) => setImmediate(resolve));
  first.resolve();
  await Promise.all([running, secondBatch, interactive]);
  assert.deepEqual(order, ['batch-1', 'interactive', 'batch-2']);
});

test('starved batch work is not displaced by later interactive requests', async () => {
  let now = 0;
  const coordinator = new TtsRequestCoordinator({
    maxConcurrency: 1,
    batchStarvationMs: 100,
    clock: () => now,
  });
  const first = deferred();
  const order = [];
  const running = coordinator.run(async () => {
    order.push('interactive-1');
    await first.promise;
  }, { requestClass: 'interactive' });
  const batch = coordinator.run(async () => {
    order.push('batch');
  }, { requestClass: 'batch' });
  now = 150;
  const laterInteractive = coordinator.run(async () => {
    order.push('interactive-2');
  }, { requestClass: 'interactive' });

  await new Promise((resolve) => setImmediate(resolve));
  first.resolve();
  await Promise.all([running, batch, laterInteractive]);
  assert.deepEqual(order, ['interactive-1', 'batch', 'interactive-2']);
});

test('aborted queued work never reaches the provider', async () => {
  const coordinator = new TtsRequestCoordinator({ maxConcurrency: 1 });
  const first = deferred();
  const running = coordinator.run(() => first.promise, { requestClass: 'batch' });
  const controller = new AbortController();
  let called = false;
  const queued = coordinator.run(async () => {
    called = true;
  }, { requestClass: 'interactive', signal: controller.signal });

  controller.abort();
  await assert.rejects(queued, { name: 'AbortError', code: 'TTS_REQUEST_ABORTED' });
  first.resolve();
  await running;
  assert.equal(called, false);
});
