'use strict';

process.env.KG_ENABLED = '0';

const assert = require('node:assert/strict');
const test = require('node:test');
const { api, closeServer } = require('./_harness');

test.after(async () => closeServer());

test('KG API is unavailable when its default-off feature flag is disabled', async () => {
  const response = await api('GET', '/api/kg/search?q=handoff');
  assert.equal(response.status, 404);
  assert.equal(response.body.code, 'KG_FEATURE_DISABLED');
});
