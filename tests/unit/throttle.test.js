'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  checkGenerateThrottle,
  _sweepExpiredThrottleEntries,
  _throttleMapSize,
} = require('../../lib/throttle');

// Helper: a minimal req-like object for the throttle to key off of. Tests use
// unique IPs so they don't observe state left by earlier tests in the file.
function reqFromIp(ip) {
  return { ip };
}

test.describe('checkGenerateThrottle', () => {
  test.it('allows the first call from an IP', () => {
    const result = checkGenerateThrottle(reqFromIp('unit-first-call'));
    assert.equal(result.allowed, true);
    assert.equal(result.retryAfterMs, 0);
  });

  test.it('denies an immediate second call from the same IP', (t) => {
    // node:test's mock.timers defaults Date.now to 0, which collides with
// the throttle's `last || 0` fallback for an unseen key. Use a realistic
// epoch so unseen keys look "infinitely old" the way real time does.
t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
    const ip = 'unit-second-call';
    assert.equal(checkGenerateThrottle(reqFromIp(ip)).allowed, true);
    const second = checkGenerateThrottle(reqFromIp(ip));
    assert.equal(second.allowed, false);
    assert.ok(second.retryAfterMs > 0);
    assert.ok(second.retryAfterMs <= 4000);
  });

  test.it('treats different IPs as independent', () => {
    assert.equal(checkGenerateThrottle(reqFromIp('unit-iso-A')).allowed, true);
    assert.equal(checkGenerateThrottle(reqFromIp('unit-iso-B')).allowed, true);
  });

  test.it('allows again once the interval has passed', (t) => {
    // node:test's mock.timers defaults Date.now to 0, which collides with
// the throttle's `last || 0` fallback for an unseen key. Use a realistic
// epoch so unseen keys look "infinitely old" the way real time does.
t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
    const ip = 'unit-after-interval';
    assert.equal(checkGenerateThrottle(reqFromIp(ip)).allowed, true);
    assert.equal(checkGenerateThrottle(reqFromIp(ip)).allowed, false);
    t.mock.timers.tick(4001);
    assert.equal(checkGenerateThrottle(reqFromIp(ip)).allowed, true);
  });

  test.it('falls back to a stable key when req.ip is missing', () => {
    // First call from an unknown-ip "client" is allowed; the throttle should
    // still apply on the next call (it picks 'unknown' as the key).
    const first = checkGenerateThrottle({});
    assert.equal(first.allowed, true);
    const second = checkGenerateThrottle({});
    assert.equal(second.allowed, false);
  });
});

test.describe('throttle sweep', () => {
  test.it('drops entries older than the throttle interval', (t) => {
    // node:test's mock.timers defaults Date.now to 0, which collides with
// the throttle's `last || 0` fallback for an unseen key. Use a realistic
// epoch so unseen keys look "infinitely old" the way real time does.
t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
    const before = _throttleMapSize();
    for (const ip of ['sweep-A', 'sweep-B', 'sweep-C', 'sweep-D']) {
      checkGenerateThrottle(reqFromIp(ip));
    }
    const populated = _throttleMapSize();
    assert.ok(populated >= before + 4, `expected map to grow, before=${before} populated=${populated}`);

    // Advance past the interval — every entry written above is now stale.
    t.mock.timers.tick(4001);
    const removed = _sweepExpiredThrottleEntries();
    assert.ok(removed >= 4, `expected sweep to remove >= 4 entries, got ${removed}`);
    assert.ok(_throttleMapSize() <= populated - 4);
  });

  test.it('keeps fresh entries on a sweep', (t) => {
    // node:test's mock.timers defaults Date.now to 0, which collides with
// the throttle's `last || 0` fallback for an unseen key. Use a realistic
// epoch so unseen keys look "infinitely old" the way real time does.
t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
    const ip = 'sweep-fresh';
    checkGenerateThrottle(reqFromIp(ip));
    const sizeBefore = _throttleMapSize();
    t.mock.timers.tick(1000); // still within the interval
    _sweepExpiredThrottleEntries();
    assert.equal(_throttleMapSize(), sizeBefore, 'fresh entry should survive the sweep');
  });
});
