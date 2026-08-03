'use strict';

process.env.PRONUNCIATION_TELEMETRY_ENABLED = '1';

const assert = require('node:assert/strict');
const test = require('node:test');
const { api, closeServer } = require('./_harness');

test.after(closeServer);

test('telemetry accepts bounded content-free events and exposes aggregate counters', async () => {
  const accepted = await api('POST', '/api/pronunciation/telemetry', {
    body: {
      eventType: 'state',
      uiSurface: 'textbook',
      tokenStatus: 'unresolved',
      outcome: 'unresolved',
      length: 3,
    },
  });
  assert.equal(accepted.status, 202);
  const snapshot = await api('GET', '/api/pronunciation/telemetry');
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.body.telemetry.totalEvents, 1);
  assert.equal(JSON.stringify(snapshot.body).includes('unresolved'), true);
  assert.equal(JSON.stringify(snapshot.body).includes('reading'), false);
});

test('telemetry rejects complete learning content', async () => {
  const rejected = await api('POST', '/api/pronunciation/telemetry', {
    body: { eventType: 'token', surface: '勤務表' },
  });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.code, 'PRONUNCIATION_TELEMETRY_CONTENT_REJECTED');
});
