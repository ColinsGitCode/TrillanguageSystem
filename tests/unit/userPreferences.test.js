'use strict';

process.env.DB_PATH = ':memory:';
process.env.LOG_SILENT = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseService } = require('../../services/storage/databaseService');
const prefs = require('../../services/storage/db/userPreferences');

function freshDb() {
  return new DatabaseService(':memory:');
}

test.describe('userPreferences storage', () => {
  test.it('returns fallback for missing preference', () => {
    const db = freshDb();
    try {
      assert.equal(prefs.getPreference(db.db, 'daily_goal', '5'), '5');
    } finally {
      db.close();
    }
  });

  test.it('sets and updates preference values', () => {
    const db = freshDb();
    try {
      prefs.setPreference(db.db, 'daily_goal', '5');
      assert.equal(prefs.getPreference(db.db, 'daily_goal', '0'), '5');
      prefs.setPreference(db.db, 'daily_goal', '12');
      assert.equal(prefs.getPreference(db.db, 'daily_goal', '0'), '12');
    } finally {
      db.close();
    }
  });
});
