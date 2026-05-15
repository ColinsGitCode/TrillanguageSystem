'use strict';

const { E2E_TEST_MODE } = require('./serverConfig');

// Per-IP rate limit for the interactive generate endpoint. In-process state —
// see optimization note: this Map is not bounded and does not survive restarts
// or span multiple instances.
const GENERATE_MIN_INTERVAL_MS = 4000;
const generationThrottle = new Map();

function checkGenerateThrottle(req) {
  if (E2E_TEST_MODE) {
    return { allowed: true, retryAfterMs: 0 };
  }
  const key = req.ip || 'unknown';
  const now = Date.now();
  const last = generationThrottle.get(key) || 0;
  const elapsed = now - last;
  if (elapsed < GENERATE_MIN_INTERVAL_MS) {
    return {
      allowed: false,
      retryAfterMs: GENERATE_MIN_INTERVAL_MS - elapsed
    };
  }
  generationThrottle.set(key, now);
  return { allowed: true, retryAfterMs: 0 };
}

module.exports = { checkGenerateThrottle };
