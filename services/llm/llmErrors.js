'use strict';

const CODES = {
  CONFIG_ERROR: 'LLM_CONFIG_ERROR',
  BAD_REQUEST: 'LLM_BAD_REQUEST',
  AUTH_ERROR: 'LLM_AUTH_ERROR',
  TIMEOUT: 'LLM_TIMEOUT',
  RATE_LIMITED: 'MODEL_CAPACITY_EXHAUSTED',
  UNAVAILABLE: 'LLM_PROVIDER_UNAVAILABLE',
  EMPTY_RESPONSE: 'LLM_EMPTY_RESPONSE',
  INVALID_RESPONSE: 'LLM_INVALID_RESPONSE',
};

const STATUS_BY_CODE = {
  [CODES.CONFIG_ERROR]: 500,
  [CODES.BAD_REQUEST]: 400,
  [CODES.AUTH_ERROR]: 401,
  [CODES.TIMEOUT]: 504,
  [CODES.RATE_LIMITED]: 429,
  [CODES.UNAVAILABLE]: 502,
  [CODES.EMPTY_RESPONSE]: 502,
  [CODES.INVALID_RESPONSE]: 502,
};

const RETRIABLE_CODES = new Set([
  CODES.TIMEOUT,
  CODES.RATE_LIMITED,
  CODES.UNAVAILABLE,
]);

function statusForCode(code) {
  return STATUS_BY_CODE[code] || 500;
}

function isRetriableCode(code) {
  return RETRIABLE_CODES.has(String(code || ''));
}

function codedError(code, message, payload = null) {
  const err = new Error(message || code);
  err.code = code;
  err.status = statusForCode(code);
  if (payload !== null && payload !== undefined) err.payload = payload;
  return err;
}

function errorCodeOf(err) {
  if (!err) return '';
  return String(err.code || (err.payload && err.payload.code) || '');
}

function codeForHttpStatus(status) {
  const n = Number(status || 0);
  if (n === 400) return CODES.BAD_REQUEST;
  if (n === 401 || n === 403) return CODES.AUTH_ERROR;
  if (n === 408 || n === 504) return CODES.TIMEOUT;
  if (n === 429) return CODES.RATE_LIMITED;
  if (n >= 500) return CODES.UNAVAILABLE;
  return CODES.INVALID_RESPONSE;
}

module.exports = {
  CODES,
  STATUS_BY_CODE,
  RETRIABLE_CODES,
  statusForCode,
  isRetriableCode,
  codedError,
  errorCodeOf,
  codeForHttpStatus,
};
