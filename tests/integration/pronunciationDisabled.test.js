'use strict';

process.env.PRONUNCIATION_OVERLAY_ENABLED = '0';
process.env.PRONUNCIATION_ACTIONS_ENABLED = '0';

const assert = require('node:assert/strict');
const test = require('node:test');
const { api, closeServer } = require('./_harness');

test.after(closeServer);

test('pronunciation read API is fail-closed when the overlay flag is disabled', async () => {
  const response = await api('GET', '/api/pronunciation?targetKind=generation&targetId=1');
  assert.equal(response.status, 404);
  assert.equal(response.body.code, 'PRONUNCIATION_FEATURE_DISABLED');
});

test('pronunciation correction API remains disabled independently', async () => {
  const response = await api('POST', '/api/pronunciation/corrections', {
    body: {
      targetId: 1,
      tokenKey: 'token:1',
      eventKey: 'pronunciation-disabled-event',
      eventType: 'reading',
      expectedRevision: 1,
    },
  });
  assert.equal(response.status, 404);
  assert.equal(response.body.code, 'PRONUNCIATION_FEATURE_DISABLED');
});
