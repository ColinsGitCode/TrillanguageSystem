'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { api, resetState, closeServer, dbService } = require('./_harness');

test.before(() => resetState());
test.after(async () => { await closeServer(); });

test.describe('/api/generation-jobs/*', () => {
  test.beforeEach(() => resetState());

  test.it('POST /api/generation-jobs 400 when phrase missing', async () => {
    const res = await api('POST', '/api/generation-jobs', { body: {} });
    assert.equal(res.status, 400);
  });

  test.it('POST creates a queued job + GET list/summary/:id reflect it', async () => {
    const created = await api('POST', '/api/generation-jobs', {
      body: { phrase: 'job alpha', card_type: 'trilingual' }
    });
    assert.equal(created.status, 200);
    const jobId = created.body.job?.id;
    assert.ok(jobId, 'job id expected');

    const list = await api('GET', '/api/generation-jobs?limit=20');
    assert.equal(list.status, 200);
    assert.ok(list.body.jobs.some((j) => j.id === jobId));

    const summary = await api('GET', '/api/generation-jobs/summary');
    assert.equal(summary.status, 200);
    assert.ok(summary.body.summary && typeof summary.body.summary === 'object');

    const detail = await api('GET', `/api/generation-jobs/${jobId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.job.id, jobId);
  });

  test.it('POST creates jobs with DeepSeek provider/model metadata', async () => {
    const created = await api('POST', '/api/generation-jobs', {
      body: { phrase: 'job model metadata', card_type: 'trilingual' }
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.job.provider, 'deepseek');
    assert.equal(created.body.job.llmModel, 'deepseek-v4-flash');
    assert.equal(created.body.job.requestPayload?.llm_provider, 'deepseek');
    assert.equal(created.body.job.requestPayload?.llm_model, 'deepseek-v4-flash');
  });

  test.it('POST preserves scenario_phrase job type', async () => {
    const created = await api('POST', '/api/generation-jobs', {
      body: {
        phrase: '机场值机时询问行李额度',
        card_type: 'scenario_phrase'
      }
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.job.jobType, 'scenario_phrase');

    const detail = await api('GET', `/api/generation-jobs/${created.body.job.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.job.jobType, 'scenario_phrase');
  });

  test.it('preflights historical duplicates and persists an explicit version policy', async () => {
    dbService.insertGeneration({
      generation: {
        phrase: 'existing queue card',
        phraseLanguage: 'en',
        cardType: 'trilingual',
        sourceMode: 'input',
        llmProvider: 'deepseek',
        llmModel: 'deepseek-v4-pro',
        folderName: '20260713',
        baseFilename: 'existing queue card',
        mdFilePath: '/tmp/existing.md',
        htmlFilePath: '/tmp/existing.html',
        metaFilePath: '/tmp/existing.meta.json',
        markdownContent: '# existing queue card',
        enTranslation: null,
        jaTranslation: null,
        zhTranslation: null,
        generationDate: '2026-07-13',
        requestId: 'existing-queue-card',
      },
      observability: {
        tokensInput: 0, tokensOutput: 0, tokensTotal: 0, tokensCached: 0,
        costInput: 0, costOutput: 0, costTotal: 0, costCurrency: 'USD',
        quotaUsed: null, quotaLimit: null, quotaRemaining: null, quotaResetAt: null, quotaPercentage: null,
        performanceTotalMs: 0, performancePhases: '{}', qualityScore: 0, qualityChecks: '[]',
        qualityDimensions: '{}', qualityWarnings: '[]', promptFull: '', promptParsed: '{}',
        llmOutput: '{}', llmFinishReason: 'STOP', metadata: '{}',
      },
      audioFiles: [],
    });

    const rejected = await api('POST', '/api/generation-jobs', { body: { phrase: 'EXISTING QUEUE CARD' } });
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.code, 'CARD_DUPLICATE_EXISTS');

    const accepted = await api('POST', '/api/generation-jobs', {
      body: { phrase: 'existing queue card', duplicate_policy: 'create-version' },
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.job.duplicatePolicy, 'create-version');
    assert.equal(accepted.body.job.requestPayload.duplicate_policy, 'create-version');
  });

  test.it('GET /api/generation-jobs/:id 404 for unknown id', async () => {
    const res = await api('GET', '/api/generation-jobs/9999');
    assert.equal(res.status, 404);
  });

  test.it('POST /:id/cancel returns the cancelled job + fresh summary', async () => {
    const created = await api('POST', '/api/generation-jobs', { body: { phrase: 'cancel me' } });
    const jobId = created.body.job.id;
    const cancel = await api('POST', `/api/generation-jobs/${jobId}/cancel`);
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.success, true);
    assert.equal(cancel.body.job.id, jobId);
    assert.equal(cancel.body.job.status, 'cancelled');
    assert.ok(cancel.body.summary && typeof cancel.body.summary === 'object');
  });

  test.it('POST /:id/cancel returns 404 for unknown id', async () => {
    const res = await api('POST', '/api/generation-jobs/9999/cancel');
    assert.equal(res.status, 404);
  });

  test.it('POST /:id/retry returns 404 for unknown id', async () => {
    const res = await api('POST', '/api/generation-jobs/9999/retry');
    assert.equal(res.status, 404);
  });

  test.it('POST /clear-done returns cleared:N (covers cancelled + success states)', async () => {
    const created = await api('POST', '/api/generation-jobs', { body: { phrase: 'to clear' } });
    await api('POST', `/api/generation-jobs/${created.body.job.id}/cancel`);
    const clear = await api('POST', '/api/generation-jobs/clear-done');
    assert.equal(clear.status, 200);
    assert.equal(typeof clear.body.cleared, 'number');
    assert.ok(clear.body.cleared >= 1, `expected >=1, got ${clear.body.cleared}`);
  });

  test.it('GET /events returns an array for a real jobId', async () => {
    const created = await api('POST', '/api/generation-jobs', { body: { phrase: 'with events' } });
    const events = await api('GET', `/api/generation-jobs/events?jobId=${created.body.job.id}&limit=10`);
    assert.equal(events.status, 200);
    assert.ok(Array.isArray(events.body.events));
  });
});
