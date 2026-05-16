'use strict';

// Test-only route. POST /api/_test/reset wipes every project DB table and
// clears RECORDS_PATH contents so each Playwright spec file can start from
// a clean slate without restarting the server. The route is only mounted
// when E2E_TEST_MODE=1 — see server.js where the conditional `app.use(...)`
// lives. Treat this as a hard contract: never call from production code
// and never expose without the env gate.

const express = require('express');
const fs = require('fs');
const path = require('path');
const {
  dbService,
  generationJobService,
  RECORDS_PATH,
} = require('./_shared');
const log = require('../lib/logger').child({ module: 'route/test-reset' });

const router = express.Router();

function wipeRecordsDir() {
  if (!RECORDS_PATH) return;
  let entries;
  try {
    entries = fs.readdirSync(RECORDS_PATH, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  for (const entry of entries) {
    const target = path.join(RECORDS_PATH, entry.name);
    fs.rmSync(target, { recursive: true, force: true });
  }
}

router.post('/api/_test/reset', (req, res) => {
  try {
    dbService.truncateAllForTests();
    generationJobService.resetForTests();
    wipeRecordsDir();
    res.json({ ok: true });
  } catch (err) {
    log.error({ err }, 'test reset failed');
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
