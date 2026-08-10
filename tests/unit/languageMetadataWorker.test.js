'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const workerSingleton = require('../../services/languageMetadata/languageMetadataJobService');

const { LanguageMetadataJobService } = workerSingleton;

test('language metadata worker recovers interrupted jobs and retries failures', async () => {
  const jobs = [
    { id: 1, attempts: 1 },
    { id: 1, attempts: 2 },
    { id: 1, attempts: 3 },
  ];
  let recovered = 0;
  let processed = 0;
  const service = new LanguageMetadataJobService({
    enabled: true,
    retryDelayMs: 1000,
    pollIntervalMs: 60_000,
    dbService: {
      recoverRunningLanguageMetadataJobs: () => { recovered += 1; return 2; },
      claimNextLanguageMetadataJob: () => jobs.shift() || null,
      finishLanguageMetadataJob: () => null,
    },
    processor: async () => {
      processed += 1;
      return { status: processed < 3 ? 'failed' : 'succeeded' };
    },
  });

  assert.deepEqual(service.bootstrap(), { enabled: true, recovered: 2 });
  service.clearTimer();
  await service.processQueue();
  service.clearTimer();
  await service.processQueue();
  service.clearTimer();
  await service.processQueue();
  service.clearTimer();

  assert.equal(recovered, 1);
  assert.equal(processed, 3, 'failed jobs remain claimable until the attempt budget is exhausted');
  await service.shutdown();
});

test('language metadata worker stays inert when disabled', async () => {
  let claimed = false;
  const service = new LanguageMetadataJobService({
    enabled: false,
    dbService: {
      claimNextLanguageMetadataJob: () => { claimed = true; },
    },
    processor: async () => ({ status: 'succeeded' }),
  });
  assert.deepEqual(service.bootstrap(), { enabled: false, recovered: 0 });
  await service.processQueue();
  assert.equal(claimed, false);
});
