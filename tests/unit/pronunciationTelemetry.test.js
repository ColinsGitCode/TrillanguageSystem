'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const telemetry = require('../../services/pronunciation/pronunciationTelemetry');

test.beforeEach(() => telemetry.reset());

test('accepts content-free events and aggregates duration without storing text', () => {
  const result = telemetry.record({
    eventType: 'action',
    uiSurface: 'card-modal',
    action: 'tts',
    outcome: 'success',
    durationMs: 182,
    length: 4,
    queueWaitMs: 12,
    statusCode: 200,
  });
  assert.deepEqual(result, { accepted: true });
  const snapshot = telemetry.snapshot();
  assert.equal(snapshot.totalEvents, 1);
  assert.equal(snapshot.counters.length, 1);
  assert.equal(snapshot.counters[0].durationTotalMs, 182);
  assert.equal(snapshot.counters[0].lengthTotal, 4);
  assert.equal(JSON.stringify(snapshot).includes('reading'), false);
  assert.equal(JSON.stringify(snapshot).includes('surface'), false);
});

test('rejects content-bearing fields before aggregation', () => {
  assert.throws(
    () => telemetry.record({ eventType: 'token', surface: '勤務表' }),
    (error) => error.code === 'PRONUNCIATION_TELEMETRY_CONTENT_REJECTED' && error.status === 400
  );
  assert.equal(telemetry.snapshot().totalEvents, 0);
});

test('tracks lifecycle gauges without allowing negative counts', () => {
  telemetry.record({ eventType: 'lifecycle', resource: 'listener', outcome: 'start' });
  telemetry.record({ eventType: 'lifecycle', resource: 'listener', outcome: 'end' });
  telemetry.record({ eventType: 'lifecycle', resource: 'listener', outcome: 'end' });
  const { gauges } = telemetry.snapshot();
  assert.equal(gauges.activeListeners, 0);
  assert.equal(gauges.maxActiveListeners, 1);
});
