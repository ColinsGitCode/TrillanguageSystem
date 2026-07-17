'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { runPlanningCanary } = require('../../services/kg/application/runPlanningCanary');
const { seedStudyItem } = require('../helpers/learningFixtures');

function testDatabase() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '../../database/schema.sql'), 'utf8'));
  return db;
}

test('KG-R1 canary proves same-set ordering, failure fallback and zero mutation', () => {
  const db = testDatabase();
  try {
    const first = seedStudyItem(db, { phrase: 'first canary item', unitKey: 'kg-r1-first' });
    const second = seedStudyItem(db, { phrase: 'second canary item', unitKey: 'kg-r1-second' });
    seedStudyItem(db, { phrase: 'third canary item', unitKey: 'kg-r1-third' });
    db.prepare(`
      INSERT INTO kg_planning_signals(
        study_item_id, score, point_ids_json, groups_json, reasons_json,
        evidence_json, signal_version, source_watermark_json, computed_at_utc
      ) VALUES (?, 24, '[17]', '["lookup-difficulty"]',
        '[{"code":"recent-lookup","label":"近期重复检索"}]',
        '[{"source":"kg-lookup-signal-v1"}]', 'kg-lookup-signal-v1', '{}',
        '2026-07-17T01:00:00.000Z')
    `).run(second.studyItemId);

    const report = runPlanningCanary({
      db,
      nowUtc: '2026-07-17T01:00:00.000Z',
      dailyNewLimit: 3,
      iterations: 50,
    });

    assert.equal(report.overallPass, true);
    assert.equal(report.gates.selectedSetMatches, true);
    assert.equal(report.gates.baseKeysMatch, true);
    assert.equal(report.gates.failureFallbackMatches, true);
    assert.equal(report.gates.noNetworkCalls, true);
    assert.equal(report.gates.noObservedTableMutation, true);
    assert.equal(report.canary.graphEntries.length, 1);
    assert.equal(report.canary.graphEntries[0].studyItemId, second.studyItemId);
    assert.equal(report.canary.enabled.ids[0], second.studyItemId);
    assert.equal(report.canary.baseline.ids.includes(first.studyItemId), true);
    assert.equal(report.observationBefore.tables.learning_daily_queues, 0);
    assert.equal(report.observationAfter.tables.learning_daily_queues, 0);
  } finally {
    db.close();
  }
});

test('KG-R1 canary refuses to pass without a real planning projection', () => {
  const db = testDatabase();
  try {
    seedStudyItem(db, { phrase: 'no signal item', unitKey: 'kg-r1-no-signal' });
    const report = runPlanningCanary({
      db,
      nowUtc: '2026-07-17T01:00:00.000Z',
      dailyNewLimit: 1,
      iterations: 10,
    });
    assert.equal(report.overallPass, false);
    assert.equal(report.gates.signalProjectionAvailable, false);
    assert.equal(report.gates.graphSignalApplied, false);
  } finally {
    db.close();
  }
});
