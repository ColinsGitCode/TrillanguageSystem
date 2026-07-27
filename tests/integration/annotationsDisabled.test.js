'use strict';

process.env.CARD_ANNOTATIONS_ENABLED = '0';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  api,
  closeServer,
} = require('./_harness');

test.after(async () => { await closeServer(); });

test('keeps the canonical annotation API hidden when the CA-P5 flag is disabled', async () => {
  const response = await api(
    'GET',
    '/api/annotations?targetKind=generation&targetId=1'
  );
  assert.equal(response.status, 404);
  assert.equal(response.body.code, 'ANNOTATION_FEATURE_DISABLED');
});
