'use strict';

process.env.CARD_READER_V3_SHADOW_ENABLED = '0';

const assert = require('node:assert/strict');
const test = require('node:test');
const { api, closeServer } = require('./_harness');

test.after(closeServer);

test('disabled shadow reports its config and rejects comparison', async () => {
  const config = await api('GET', '/api/card-reader/shadow/config');
  assert.equal(config.status, 200);
  assert.equal(config.body.enabled, false);

  const response = await api('GET', '/api/card-reader/shadow?generationId=1');
  assert.equal(response.status, 404);
  assert.equal(response.body.code, 'CARD_READER_V3_SHADOW_DISABLED');
});
