'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { api, resetState, closeServer } = require('./_harness');

test.before(() => resetState());
test.after(async () => { await closeServer(); });

test.describe('/api/knowledge/* (E2E fixture branches)', () => {
  test.beforeEach(() => resetState());

  test.it('GET /api/knowledge/jobs empty → success:true, jobs:[]', async () => {
    const res = await api('GET', '/api/knowledge/jobs?limit=20');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.deepEqual(res.body.jobs, []);
  });

  test.it('POST /api/knowledge/jobs/start 400 when jobType missing', async () => {
    const res = await api('POST', '/api/knowledge/jobs/start', { body: {} });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'jobType is required');
  });

  test.it('POST → list → detail round-trip via E2E fixture', async () => {
    const started = await api('POST', '/api/knowledge/jobs/start', {
      body: { jobType: 'summary', scope: { limit: 10 }, batchSize: 5 }
    });
    assert.equal(started.status, 200);
    assert.equal(started.body.success, true);
    const jobId = started.body.job?.id;
    assert.ok(jobId, 'fixture job should have an id');

    const list = await api('GET', '/api/knowledge/jobs?limit=20');
    assert.equal(list.status, 200);
    assert.ok(list.body.jobs.some((j) => j.id === jobId));

    const detail = await api('GET', `/api/knowledge/jobs/${jobId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.job.id, jobId);
    assert.equal(detail.body.job.jobType, 'summary');
  });

  test.it('GET /api/knowledge/jobs/:id returns 404 for unknown id', async () => {
    const res = await api('GET', '/api/knowledge/jobs/9999');
    assert.equal(res.status, 404);
  });

  test.it('GET /api/knowledge/jobs/:id returns 400 for non-numeric id', async () => {
    const res = await api('GET', '/api/knowledge/jobs/not-a-number');
    assert.equal(res.status, 400);
  });

  test.it('POST cancel echoes a boolean cancelled flag', async () => {
    const started = await api('POST', '/api/knowledge/jobs/start', {
      body: { jobType: 'index' }
    });
    const jobId = started.body.job.id;
    const cancel = await api('POST', `/api/knowledge/jobs/${jobId}/cancel`);
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.success, true);
    assert.equal(typeof cancel.body.cancelled, 'boolean');
  });

  test.it('read-side endpoints work on empty DB (overview / index / grammar / clusters / issues / latest summary)', async () => {
    const probes = [
      '/api/knowledge/overview',
      '/api/knowledge/index?limit=5',
      '/api/knowledge/grammar',
      '/api/knowledge/clusters',
      '/api/knowledge/issues',
      '/api/knowledge/summary/latest',
    ];
    for (const path of probes) {
      const res = await api('GET', path);
      assert.equal(res.status, 200, `expected 200 from ${path}`);
    }
  });
});
