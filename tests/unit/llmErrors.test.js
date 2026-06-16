'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CODES,
  statusForCode,
  isRetriableCode,
  codedError,
  errorCodeOf,
  codeForHttpStatus,
} = require('../../services/llm/llmErrors');

test.describe('llmErrors', () => {
  test.it('keeps the queue-compatible capacity code', () => {
    assert.equal(CODES.RATE_LIMITED, 'MODEL_CAPACITY_EXHAUSTED');
  });

  test.it('maps provider codes to HTTP status', () => {
    assert.equal(statusForCode(CODES.CONFIG_ERROR), 500);
    assert.equal(statusForCode(CODES.BAD_REQUEST), 400);
    assert.equal(statusForCode(CODES.AUTH_ERROR), 401);
    assert.equal(statusForCode(CODES.TIMEOUT), 504);
    assert.equal(statusForCode(CODES.RATE_LIMITED), 429);
    assert.equal(statusForCode(CODES.UNAVAILABLE), 502);
    assert.equal(statusForCode(CODES.EMPTY_RESPONSE), 502);
    assert.equal(statusForCode('unknown'), 500);
  });

  test.it('marks transient provider errors as retriable', () => {
    assert.equal(isRetriableCode(CODES.TIMEOUT), true);
    assert.equal(isRetriableCode(CODES.RATE_LIMITED), true);
    assert.equal(isRetriableCode(CODES.UNAVAILABLE), true);
    assert.equal(isRetriableCode(CODES.BAD_REQUEST), false);
    assert.equal(isRetriableCode(CODES.AUTH_ERROR), false);
    assert.equal(isRetriableCode(CODES.CONFIG_ERROR), false);
  });

  test.it('creates coded Error objects', () => {
    const err = codedError(CODES.RATE_LIMITED, 'busy');
    assert.equal(err.message, 'busy');
    assert.equal(err.code, CODES.RATE_LIMITED);
    assert.equal(err.status, 429);
  });

  test.it('extracts direct and payload codes', () => {
    assert.equal(errorCodeOf({ code: CODES.TIMEOUT }), CODES.TIMEOUT);
    assert.equal(errorCodeOf({ payload: { code: CODES.RATE_LIMITED } }), CODES.RATE_LIMITED);
    assert.equal(errorCodeOf(new Error('plain')), '');
  });

  test.it('maps HTTP status to provider codes', () => {
    assert.equal(codeForHttpStatus(400), CODES.BAD_REQUEST);
    assert.equal(codeForHttpStatus(401), CODES.AUTH_ERROR);
    assert.equal(codeForHttpStatus(403), CODES.AUTH_ERROR);
    assert.equal(codeForHttpStatus(408), CODES.TIMEOUT);
    assert.equal(codeForHttpStatus(429), CODES.RATE_LIMITED);
    assert.equal(codeForHttpStatus(500), CODES.UNAVAILABLE);
    assert.equal(codeForHttpStatus(503), CODES.UNAVAILABLE);
  });
});
