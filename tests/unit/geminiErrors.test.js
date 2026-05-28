'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CODES,
  statusForCode,
  isRetriableCode,
  codedError,
  errorCodeOf,
} = require('../../services/llm/geminiErrors');

test.describe('geminiErrors', () => {
  test.it('reuses the rate-limit code string the job queue understands', () => {
    assert.equal(CODES.RATE_LIMITED, 'MODEL_CAPACITY_EXHAUSTED');
  });

  test.it('statusForCode maps known codes', () => {
    assert.equal(statusForCode(CODES.EXECUTOR_BAD_REQUEST), 400);
    assert.equal(statusForCode(CODES.EXECUTOR_TIMEOUT), 504);
    assert.equal(statusForCode(CODES.EXECUTOR_BUSY), 429);
    assert.equal(statusForCode(CODES.RATE_LIMITED), 429);
    assert.equal(statusForCode(CODES.GATEWAY_UPSTREAM_UNREACHABLE), 502);
  });

  test.it('statusForCode defaults unknown codes to 500', () => {
    assert.equal(statusForCode('SOMETHING_ELSE'), 500);
    assert.equal(statusForCode(undefined), 500);
  });

  test.it('isRetriableCode is true for transient codes only', () => {
    assert.equal(isRetriableCode(CODES.EXECUTOR_TIMEOUT), true);
    assert.equal(isRetriableCode(CODES.EXECUTOR_BUSY), true);
    assert.equal(isRetriableCode(CODES.RATE_LIMITED), true);
    assert.equal(isRetriableCode(CODES.GATEWAY_TIMEOUT), true);
    assert.equal(isRetriableCode(CODES.GATEWAY_UPSTREAM_UNREACHABLE), true);
    assert.equal(isRetriableCode(CODES.EXECUTOR_CLI_ERROR), true);
  });

  test.it('isRetriableCode is false for permanent / unknown codes', () => {
    assert.equal(isRetriableCode(CODES.EXECUTOR_BAD_REQUEST), false);
    assert.equal(isRetriableCode(CODES.EXECUTOR_SPAWN_ERROR), false);
    assert.equal(isRetriableCode(''), false);
    assert.equal(isRetriableCode(undefined), false);
  });

  test.it('codedError builds an Error carrying code + matching status', () => {
    const err = codedError(CODES.GATEWAY_TIMEOUT, 'gateway slow');
    assert.ok(err instanceof Error);
    assert.equal(err.code, CODES.GATEWAY_TIMEOUT);
    assert.equal(err.status, 504);
    assert.equal(err.message, 'gateway slow');
  });

  test.it('codedError defaults the message to the code', () => {
    const err = codedError(CODES.EXECUTOR_BUSY);
    assert.equal(err.message, CODES.EXECUTOR_BUSY);
    assert.equal(err.status, 429);
  });

  test.it('errorCodeOf reads a direct code', () => {
    assert.equal(errorCodeOf({ code: CODES.EXECUTOR_TIMEOUT }), CODES.EXECUTOR_TIMEOUT);
  });

  test.it('errorCodeOf falls back to a forwarded payload code', () => {
    assert.equal(errorCodeOf({ payload: { code: CODES.RATE_LIMITED } }), CODES.RATE_LIMITED);
  });

  test.it('errorCodeOf prefers the direct code over the payload code', () => {
    assert.equal(
      errorCodeOf({ code: CODES.GATEWAY_TIMEOUT, payload: { code: CODES.RATE_LIMITED } }),
      CODES.GATEWAY_TIMEOUT
    );
  });

  test.it('errorCodeOf returns empty string for null / codeless errors', () => {
    assert.equal(errorCodeOf(null), '');
    assert.equal(errorCodeOf(undefined), '');
    assert.equal(errorCodeOf(new Error('plain')), '');
    assert.equal(errorCodeOf({}), '');
  });
});
