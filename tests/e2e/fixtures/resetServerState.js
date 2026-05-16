'use strict';

// Small helper for Playwright specs: posts to the E2E-only reset endpoint
// so each spec file (or test) can start from a clean DB + records dir
// without restarting the server. Mounting of /api/_test/reset is gated on
// E2E_TEST_MODE=1 in server.js, so it's a 404 in production.

async function resetServerState(request) {
  const res = await request.post('/api/_test/reset');
  if (!res.ok()) {
    const body = await res.text().catch(() => '');
    throw new Error(`/api/_test/reset failed: HTTP ${res.status()} ${body}`);
  }
}

module.exports = { resetServerState };
