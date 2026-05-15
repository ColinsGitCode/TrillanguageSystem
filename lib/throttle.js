'use strict';

const { E2E_TEST_MODE } = require('./serverConfig');

// Per-IP rate limit for the interactive generate endpoint.
//
// In-process state: doesn't survive restarts and doesn't coordinate across
// instances. Replacing this with a shared store (e.g. Redis) is a separate
// concern. What we DO own here is keeping the map bounded — without the
// periodic sweep, every unique IP that ever called the endpoint stuck around
// in memory forever, even though entries are dead after one interval.
const GENERATE_MIN_INTERVAL_MS = 4000;
const SWEEP_INTERVAL_MS = 60_000;
const generationThrottle = new Map();

// Drop entries older than the throttle interval — they no longer enforce
// anything (the next request from that IP would pass anyway). Returns the
// number of entries removed; used by tests to assert the sweep ran.
function sweepExpiredThrottleEntries(now = Date.now()) {
  const cutoff = now - GENERATE_MIN_INTERVAL_MS;
  let removed = 0;
  for (const [key, t] of generationThrottle) {
    if (t < cutoff) {
      generationThrottle.delete(key);
      removed += 1;
    }
  }
  return removed;
}

// Skip the background timer under E2E to keep the test runtime quiet — the
// throttle short-circuits anyway under E2E_TEST_MODE.
if (!E2E_TEST_MODE) {
  setInterval(() => sweepExpiredThrottleEntries(), SWEEP_INTERVAL_MS).unref();
}

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

module.exports = {
  checkGenerateThrottle,
  // Exported for tests — production code should not call these directly.
  _sweepExpiredThrottleEntries: sweepExpiredThrottleEntries,
  _throttleMapSize: () => generationThrottle.size,
};
