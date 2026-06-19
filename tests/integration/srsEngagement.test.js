'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { api, resetState, closeServer } = require('./_harness');

test.before(() => resetState());
test.after(async () => { await closeServer(); });

test.describe('SRS engagement goal routes', () => {
  test.beforeEach(() => resetState());

  test.it('GET /api/srs/goal returns the default daily goal', async () => {
    const res = await api('GET', '/api/srs/goal');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { success: true, goal: 5 });
  });

  test.it('PUT /api/srs/goal persists a valid daily goal', async () => {
    const put = await api('PUT', '/api/srs/goal', { body: { goal: 12 } });
    assert.equal(put.status, 200);
    assert.deepEqual(put.body, { success: true, goal: 12 });

    const get = await api('GET', '/api/srs/goal');
    assert.equal(get.status, 200);
    assert.deepEqual(get.body, { success: true, goal: 12 });
  });

  test.it('PUT /api/srs/goal rejects invalid values', async () => {
    for (const goal of [0, -1, 1.5, 201, 'abc']) {
      const res = await api('PUT', '/api/srs/goal', { body: { goal } });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /goal must be an integer between 1 and 200/);
    }
  });
});

test.describe('GET /api/srs/engagement', () => {
  test.beforeEach(() => resetState());

  test.it('returns the engagement envelope for homepage rendering', async () => {
    const res = await api('GET', '/api/srs/engagement');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.engagement.today.goal, 5);
    assert.equal(typeof res.body.engagement.streak.days, 'number');
    assert.equal(typeof res.body.engagement.streak.activeToday, 'boolean');
    assert.ok('eligibleTotal' in res.body.engagement.mastery);
  });
});
