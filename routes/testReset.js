'use strict';

// Test-only reset endpoint. Mounted only when E2E_TEST_MODE=1.

const express = require('express');
const fs = require('fs');
const path = require('path');
const { dbService, generationJobService, RECORDS_PATH, resetE2EFixtures } = require('./_shared');
const { expandStudyUnits, stableJson } = require('../services/learning/application/materializeStudyItems');
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

router.post('/api/_test/learning-seed', (_req, res) => {
  try {
    const generations = dbService.db.prepare(`
      SELECT id, card_type, content_hash FROM generations ORDER BY id
    `).all();
    const timestamp = new Date().toISOString();
    const insertItem = dbService.db.prepare(`
      INSERT OR IGNORE INTO study_items(
        generation_id, source_generation_id, unit_key, unit_kind, unit_locator_json,
        content_hash, content_revision, lifecycle, created_at_utc, updated_at_utc
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 'active', ?, ?)
    `);
    const transaction = dbService.db.transaction(() => {
      for (const generation of generations) {
        dbService.db.prepare(`
          UPDATE learning_source_admissions
          SET status='eligible', reasons_json='["e2e-learning-fixture"]',
              materialization_disposition='create-items', updated_at_utc=?
          WHERE generation_id=?
        `).run(timestamp, generation.id);
        dbService.db.prepare(`
          UPDATE card_tags SET status='suppressed', updated_at=CURRENT_TIMESTAMP
          WHERE generation_id=? AND namespace='qa' AND normalized_value='test-artifact-candidate'
        `).run(generation.id);
        for (const unit of expandStudyUnits({
          cardType: generation.card_type,
          recommendation: { status: 'eligible' },
        })) {
          insertItem.run(
            generation.id,
            generation.id,
            unit.unitKey,
            unit.unitKind,
            stableJson(unit.locator),
            generation.content_hash,
            timestamp,
            timestamp
          );
        }
      }
    });
    transaction();
    const itemCount = Number(dbService.db.prepare('SELECT COUNT(*) AS count FROM study_items').get().count);
    res.json({ ok: true, generationCount: generations.length, studyItemCount: itemCount });
  } catch (err) {
    log.error({ err }, 'test learning seed failed');
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
