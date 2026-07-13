'use strict';

process.env.DB_PATH = ':memory:';
process.env.LOG_SILENT = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseService } = require('../../services/storage/databaseService');
const { GenerationJobService } = require('../../services/generation/generationJobService');

function jobPayload(phrase, overrides = {}) {
  return {
    jobType: 'trilingual',
    phraseRaw: phrase,
    phraseNormalized: phrase,
    sourceMode: 'input',
    provider: 'deepseek',
    llmModel: 'deepseek-v4-pro',
    maxRetries: 2,
    sourceContext: {},
    requestPayload: { phrase },
    ...overrides,
  };
}

async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition timed out');
}

test.describe('GenerationJobService', () => {
  test.it('executes a queued row directly and persists success metadata', async () => {
    const db = new DatabaseService(':memory:');
    const calls = [];
    const service = new GenerationJobService({
      dbService: db,
      executor: async (job) => {
        calls.push(job.id);
        return {
          success: true,
          result: { folder: '2026.07.13', baseName: 'handoff' },
          provider_used: 'deepseek',
          observability: { metadata: { model: 'deepseek-v4-pro' } },
        };
      },
    });
    try {
      const job = service.enqueue(jobPayload('handoff'));
      const completed = await waitFor(() => {
        const current = db.getGenerationJobById(job.id);
        return current.status === 'success' ? current : null;
      });
      await waitFor(() => !service.running);

      assert.deepEqual(calls, [job.id]);
      assert.equal(completed.resultGenerationId, null);
      assert.equal(completed.resultFolder, '2026.07.13');
      assert.equal(completed.resultBaseFilename, 'handoff');
      assert.deepEqual(
        db.listGenerationJobEvents({ jobId: job.id, limit: 10 }).map((event) => event.eventType),
        ['created', 'picked', 'succeeded']
      );
    } finally {
      await service.shutdown({ timeoutMs: 100 });
      db.close();
    }
  });

  test.it('drains the active job during shutdown and leaves later jobs queued', async () => {
    const db = new DatabaseService(':memory:');
    let releaseFirst;
    let markStarted;
    const started = new Promise((resolve) => { markStarted = resolve; });
    const gate = new Promise((resolve) => { releaseFirst = resolve; });
    const executed = [];
    const service = new GenerationJobService({
      dbService: db,
      executor: async (job) => {
        executed.push(job.phraseNormalized);
        markStarted();
        await gate;
        return { success: true };
      },
    });
    try {
      const first = service.enqueue(jobPayload('first'));
      await started;
      const second = service.enqueue(jobPayload('second'));

      const shutdownPromise = service.shutdown({ timeoutMs: 500 });
      releaseFirst();
      const shutdownResult = await shutdownPromise;

      assert.deepEqual(shutdownResult, { drained: true, currentJobId: null });
      assert.deepEqual(executed, ['first']);
      assert.equal(db.getGenerationJobById(first.id).status, 'success');
      assert.equal(db.getGenerationJobById(second.id).status, 'queued');
      assert.throws(
        () => service.enqueue(jobPayload('third')),
        { code: 'GENERATION_WORKER_SHUTTING_DOWN' }
      );
    } finally {
      releaseFirst();
      db.close();
    }
  });

  test.it('reports the active job when drain exceeds its timeout', async () => {
    const db = new DatabaseService(':memory:');
    let release;
    let markStarted;
    const started = new Promise((resolve) => { markStarted = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    const service = new GenerationJobService({
      dbService: db,
      executor: async () => {
        markStarted();
        await gate;
        return { success: true };
      },
    });
    try {
      const job = service.enqueue(jobPayload('slow'));
      await started;
      assert.deepEqual(
        await service.shutdown({ timeoutMs: 5 }),
        { drained: false, currentJobId: job.id }
      );
      release();
      await waitFor(() => !service.running);
    } finally {
      release();
      db.close();
    }
  });

  test.it('recovers stale running jobs during bootstrap', () => {
    const db = new DatabaseService(':memory:');
    const queued = db.createGenerationJob(jobPayload('recover-on-start'));
    db.takeNextQueuedGenerationJob();
    const service = new GenerationJobService({ dbService: db });
    try {
      assert.equal(service.bootstrap(), 1);
      assert.equal(service.bootstrap(), 0);
      assert.equal(db.getGenerationJobById(queued.id).status, 'queued');
    } finally {
      service.resetForTests();
      db.close();
    }
  });

  test.it('classifies SQLite contention as a bounded retryable failure', () => {
    const service = new GenerationJobService({ dbService: {} });
    const error = Object.assign(new Error('database is locked'), { code: 'SQLITE_LOCKED' });
    assert.deepEqual(service.classifyTransientError(error), {
      retryable: true,
      code: 'SQLITE_BUSY',
      status: null,
    });
    assert.equal(service.getRetryDelayMs({ attempts: 1 }, 'SQLITE_BUSY'), 500);
  });

  test.it('uses structured provider codes for direct-call retry decisions', () => {
    const service = new GenerationJobService({ dbService: {} });
    const error = Object.assign(new Error('upstream timed out'), {
      code: 'LLM_TIMEOUT',
      status: 504,
    });
    assert.deepEqual(service.classifyTransientError(error), {
      retryable: true,
      code: 'LLM_TIMEOUT',
      status: 504,
    });
  });
});
