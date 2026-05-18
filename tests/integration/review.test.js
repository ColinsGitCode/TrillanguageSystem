'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { api, resetState, closeServer } = require('./_harness');

test.before(() => resetState());
test.after(async () => { await closeServer(); });

test.describe('/api/review/*', () => {
  test.beforeEach(() => resetState());

  test.it('GET /api/review/campaigns empty', async () => {
    const res = await api('GET', '/api/review/campaigns');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.campaigns));
    assert.equal(res.body.campaigns.length, 0);
  });

  test.it('GET /api/review/campaigns/active returns campaign:null when no active', async () => {
    const res = await api('GET', '/api/review/campaigns/active');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.campaign, null);
  });

  test.it('POST then GET round-trip for a campaign', async () => {
    const create = await api('POST', '/api/review/campaigns', {
      body: { name: 'integration campaign', createdBy: 'test', notes: 'note' }
    });
    assert.equal(create.status, 200);
    assert.equal(create.body.success, true);
    const campaignId = create.body.campaign?.id;
    assert.ok(campaignId, 'campaign id expected');

    const list = await api('GET', '/api/review/campaigns');
    assert.ok(list.body.campaigns.some((c) => c.id === campaignId));

    const progress = await api('GET', `/api/review/campaigns/${campaignId}/progress`);
    assert.equal(progress.status, 200);
    assert.equal(progress.body.success, true);
  });

  test.it('GET /api/review/campaigns/:id/progress 404 for unknown id', async () => {
    const res = await api('GET', '/api/review/campaigns/9999/progress');
    assert.equal(res.status, 404);
  });

  test.it('GET /api/review/generations/:id/examples 400 for invalid id', async () => {
    const res = await api('GET', '/api/review/generations/0/examples');
    assert.equal(res.status, 400);
  });
});
