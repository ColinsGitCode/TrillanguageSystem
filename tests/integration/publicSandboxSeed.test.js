'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

test('public sandbox seed creates only synthetic cards and learning units', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'three-lans-public-seed-'));
  const dbPath = path.join(root, 'database', 'records.db');
  const recordsPath = path.join(root, 'records');
  try {
    const output = execFileSync(
      process.execPath,
      [path.join(__dirname, '../../scripts/sandbox/createPublicSandboxSeed.js')],
      {
        cwd: path.join(__dirname, '../..'),
        env: {
          ...process.env,
          DB_PATH: dbPath,
          RECORDS_PATH: recordsPath,
          LOG_SILENT: '1',
          KG_ENABLED: '0',
        },
        encoding: 'utf8',
      }
    );
    assert.deepEqual(JSON.parse(output), { seeded: true, cards: 3 });

    const db = new Database(dbPath, { readonly: true });
    try {
      const generations = db.prepare(
        'SELECT id, phrase, card_type, markdown_content FROM generations ORDER BY id'
      ).all();
      assert.equal(generations.length, 3);
      assert.deepEqual(generations.map((row) => row.card_type), [
        'trilingual',
        'grammar_ja',
        'scenario_phrase',
      ]);
      assert.equal(generations.every((row) => row.markdown_content.length > 50), true);
      assert.equal(db.prepare('SELECT COUNT(*) AS total FROM study_items').get().total, 23);
      assert.equal(
        db.prepare("SELECT COUNT(*) AS total FROM card_tags WHERE namespace = 'src' AND value = 'public-sandbox'").get().total,
        3
      );
    } finally {
      db.close();
    }

    const files = fs.readdirSync(path.join(recordsPath, 'demo')).sort();
    assert.equal(files.filter((name) => name.endsWith('.html')).length, 3);
    assert.equal(files.filter((name) => name.endsWith('.md')).length, 3);
    assert.equal(files.filter((name) => name.endsWith('.meta.json')).length, 3);

    const second = execFileSync(
      process.execPath,
      [path.join(__dirname, '../../scripts/sandbox/createPublicSandboxSeed.js')],
      {
        cwd: path.join(__dirname, '../..'),
        env: {
          ...process.env,
          DB_PATH: dbPath,
          RECORDS_PATH: recordsPath,
          LOG_SILENT: '1',
          KG_ENABLED: '0',
        },
        encoding: 'utf8',
      }
    );
    assert.deepEqual(JSON.parse(second), { seeded: false, cards: 3 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
