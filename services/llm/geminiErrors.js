'use strict';

// Structured error codes for the Gemini request chain. Callers branch on a
// stable code instead of regex-matching free-text error messages.
// Dependency-free: the gateway and executor run as standalone processes and
// require it directly.

const CODES = {
  EXECUTOR_BAD_REQUEST: 'EXECUTOR_BAD_REQUEST',
  EXECUTOR_TIMEOUT: 'EXECUTOR_TIMEOUT',
  EXECUTOR_CLI_ERROR: 'EXECUTOR_CLI_ERROR',
  EXECUTOR_SPAWN_ERROR: 'EXECUTOR_SPAWN_ERROR',
  EXECUTOR_BUSY: 'EXECUTOR_BUSY',
  EXECUTOR_ERROR: 'EXECUTOR_ERROR',
  // Reuses the code string already understood by generationJobService.
  RATE_LIMITED: 'MODEL_CAPACITY_EXHAUSTED',
  GATEWAY_TIMEOUT: 'GATEWAY_TIMEOUT',
  GATEWAY_UPSTREAM_UNREACHABLE: 'GATEWAY_UPSTREAM_UNREACHABLE',
  GATEWAY_ERROR: 'GATEWAY_ERROR',
};

// HTTP status each code surfaces as over the wire.
const STATUS_BY_CODE = {
  [CODES.EXECUTOR_BAD_REQUEST]: 400,
  [CODES.EXECUTOR_TIMEOUT]: 504,
  [CODES.EXECUTOR_CLI_ERROR]: 502,
  [CODES.EXECUTOR_SPAWN_ERROR]: 500,
  [CODES.EXECUTOR_BUSY]: 429,
  [CODES.EXECUTOR_ERROR]: 500,
  [CODES.RATE_LIMITED]: 429,
  [CODES.GATEWAY_TIMEOUT]: 504,
  [CODES.GATEWAY_UPSTREAM_UNREACHABLE]: 502,
  [CODES.GATEWAY_ERROR]: 500,
};

// Codes worth retrying — transient by nature.
const RETRIABLE_CODES = new Set([
  CODES.EXECUTOR_TIMEOUT,
  CODES.EXECUTOR_CLI_ERROR,
  CODES.EXECUTOR_BUSY,
  CODES.RATE_LIMITED,
  CODES.GATEWAY_TIMEOUT,
  CODES.GATEWAY_UPSTREAM_UNREACHABLE,
]);

function statusForCode(code) {
  return STATUS_BY_CODE[code] || 500;
}

function isRetriableCode(code) {
  return RETRIABLE_CODES.has(String(code || ''));
}

// Build an Error carrying a structured code and matching HTTP status.
function codedError(code, message) {
  const err = new Error(message || code);
  err.code = code;
  err.status = statusForCode(code);
  return err;
}

// Pull the structured code off an error regardless of where it was attached
// (directly, or inside an HTTP error payload forwarded through the chain).
function errorCodeOf(err) {
  if (!err) return '';
  return String(err.code || (err.payload && err.payload.code) || '');
}

module.exports = {
  CODES,
  STATUS_BY_CODE,
  RETRIABLE_CODES,
  statusForCode,
  isRetriableCode,
  codedError,
  errorCodeOf,
};
