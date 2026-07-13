'use strict';

// Test-only reset endpoint. Mounted only when E2E_TEST_MODE=1.

const express = require('express');
const fs = require('fs');
const path = require('path');
const { dbService, generationJobService, RECORDS_PATH, resetE2EFixtures } = require('./_shared');
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
    fs.rmSync(path.join(RECORDS_PATH, entry.name), { recursive: true, force: true });
  }
}

router.post('/api/_test/reset', (_req, res) => {
  try {
    dbService.truncateAllForTests();
    generationJobService.resetForTests();
    resetE2EFixtures();
    wipeRecordsDir();
    res.json({ ok: true });
  } catch (err) {
    log.error({ err }, 'test reset failed');
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
