'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { api, resetState, closeServer } = require('./_harness');

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
    assert.equal(created.body.job.llmModel, 'deepseek-v4-pro');
    assert.equal(created.body.job.requestPayload?.llm_provider, 'deepseek');
    assert.equal(created.body.job.requestPayload?.llm_model, 'deepseek-v4-pro');
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
