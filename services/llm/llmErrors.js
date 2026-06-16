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
  EXECUTOR_BAD_REQUEST: 'EXECUTOR_BAD_REQUEST',
  EXECUTOR_TIMEOUT: 'EXECUTOR_TIMEOUT',
  EXECUTOR_CLI_ERROR: 'EXECUTOR_CLI_ERROR',
  EXECUTOR_SPAWN_ERROR: 'EXECUTOR_SPAWN_ERROR',
  EXECUTOR_BUSY: 'EXECUTOR_BUSY',
  EXECUTOR_ERROR: 'EXECUTOR_ERROR',
  GATEWAY_TIMEOUT: 'GATEWAY_TIMEOUT',
  GATEWAY_UPSTREAM_UNREACHABLE: 'GATEWAY_UPSTREAM_UNREACHABLE',
  GATEWAY_ERROR: 'GATEWAY_ERROR',
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
  [CODES.EXECUTOR_BAD_REQUEST]: 400,
  [CODES.EXECUTOR_TIMEOUT]: 504,
  [CODES.EXECUTOR_CLI_ERROR]: 502,
  [CODES.EXECUTOR_SPAWN_ERROR]: 500,
  [CODES.EXECUTOR_BUSY]: 429,
  [CODES.EXECUTOR_ERROR]: 500,
  [CODES.GATEWAY_TIMEOUT]: 504,
  [CODES.GATEWAY_UPSTREAM_UNREACHABLE]: 502,
  [CODES.GATEWAY_ERROR]: 500,
};

const RETRIABLE_CODES = new Set([
  CODES.TIMEOUT,
  CODES.RATE_LIMITED,
  CODES.UNAVAILABLE,
  CODES.EXECUTOR_TIMEOUT,
  CODES.EXECUTOR_CLI_ERROR,
  CODES.EXECUTOR_BUSY,
  CODES.GATEWAY_TIMEOUT,
  CODES.GATEWAY_UPSTREAM_UNREACHABLE,
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
