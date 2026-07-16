'use strict';

const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const test = require('node:test');
const Database = require('better-sqlite3');
const {
  GraphPlanningSignalReader,
  READ_SIGNAL_SQL,
} = require('../../services/kg/storage/graphPlanningSignalReader');

function createFixtureDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE kg_planning_signals (
      study_item_id INTEGER PRIMARY KEY,
      score REAL NOT NULL,
      point_ids_json TEXT NOT NULL,
      groups_json TEXT NOT NULL,
      reasons_json TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      signal_version TEXT NOT NULL
    );
    CREATE TABLE kg_lookup_events (
      id INTEGER PRIMARY KEY,
      event_key TEXT NOT NULL UNIQUE,
      point_id INTEGER,
      occurred_at_utc TEXT NOT NULL
    );
  `);
  return db;
}

function insertSignal(db, studyItemId, score = 19) {
  db.prepare(`
    INSERT INTO kg_planning_signals(
      study_item_id, score, point_ids_json, groups_json, reasons_json,
      evidence_json, signal_version
    ) VALUES (?, ?, '[17]', '["lookup-difficulty"]',
      '[{"code":"recent-lookup","label":"近期重复检索，建议在基础队列内提前复习"}]',
      '[{"source":"kg-lookup-signal-v1"}]', 'kg-lookup-signal-v1')
  `).run(studyItemId, score);
}

test.describe('GraphPlanningSignalReader', () => {
  test.it('returns no signal while disabled and never prepares the KG query', () => {
    const db = { prepare() { throw new Error('must not prepare'); } };
    const reader = new GraphPlanningSignalReader({ db, enabled: false });
    assert.equal(reader.readPlanningSignal({ studyItemId: 1 }), null);
  });

  test.it('reads one precomputed signal and exposes bounded public provenance', () => {
    const db = createFixtureDatabase();
    try {
      insertSignal(db, 42);
      const reader = new GraphPlanningSignalReader({ db, enabled: true });
      assert.deepEqual(reader.readPlanningSignal({ studyItemId: 42 }), {
        score: 19,
        groups: ['lookup-difficulty'],
        reasons: [{ code: 'recent-lookup', label: '近期重复检索，建议在基础队列内提前复习' }],
        evidence: [{
          source: 'kg-lookup-signal-v1',
          ruleVersion: 'kg-lookup-signal-v1',
          ruleKey: 'point:17',
        }],
      });
      assert.equal(reader.readPlanningSignal({ studyItemId: 999 }), null);
    } finally {
      db.close();
    }
  });

  test.it('degrades missing tables, read failures and malformed rows to null', () => {
    const missingTable = new Database(':memory:');
    try {
      const reader = new GraphPlanningSignalReader({ db: missingTable, enabled: true });
      assert.equal(reader.readPlanningSignal({ studyItemId: 1 }), null);
    } finally {
      missingTable.close();
    }

    const failing = new GraphPlanningSignalReader({
      db: { prepare: () => ({ get: () => { throw new Error('locked'); } }) },
      enabled: true,
    });
    assert.equal(failing.readPlanningSignal({ studyItemId: 1 }), null);

    const malformed = new GraphPlanningSignalReader({
      db: { prepare: () => ({ get: () => ({
        study_item_id: 1,
        score: 31,
        point_ids_json: '[]',
        groups_json: '[]',
        reasons_json: '[]',
        evidence_json: '[]',
        signal_version: 'bad',
      }) }) },
      enabled: true,
    });
    assert.equal(malformed.readPlanningSignal({ studyItemId: 1 }), null);
  });

  test.it('uses the INTEGER PRIMARY KEY and keeps p95 below 5ms at the P2 volume gate', () => {
    const db = createFixtureDatabase();
    try {
      const insertSignalRow = db.transaction(() => {
        for (let id = 1; id <= 1132; id += 1) insertSignal(db, id, (id % 30) + 1);
      });
      const insertLookupFacts = db.transaction(() => {
        const insert = db.prepare('INSERT INTO kg_lookup_events(event_key, point_id, occurred_at_utc) VALUES (?, ?, ?)');
        for (let id = 1; id <= 11320; id += 1) {
          insert.run(`lookup:${id}`, (id % 1132) + 1, '2026-07-16T03:00:00.000Z');
        }
      });
      insertSignalRow();
      insertLookupFacts();

      const plan = db.prepare(`EXPLAIN QUERY PLAN ${READ_SIGNAL_SQL}`).all(1);
      assert.ok(plan.some((row) => /INTEGER PRIMARY KEY/u.test(String(row.detail))));

      const reader = new GraphPlanningSignalReader({ db, enabled: true });
      const durations = [];
      for (let id = 1; id <= 1132; id += 1) {
        const startedAt = performance.now();
        const signal = reader.readPlanningSignal({ studyItemId: id });
        durations.push(performance.now() - startedAt);
        assert.ok(signal);
      }
      durations.sort((left, right) => left - right);
      const p95 = durations[Math.ceil(durations.length * 0.95) - 1];
      assert.ok(p95 < 5, `expected reader p95 < 5ms, received ${p95.toFixed(3)}ms`);
    } finally {
      db.close();
    }
  });
});
