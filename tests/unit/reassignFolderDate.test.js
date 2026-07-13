'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  replaceFolderReferences,
  runMigration,
} = require('../../scripts/migrations/reassignFolderDate');

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folder-date-migration-'));
  const recordsPath = path.join(root, 'records');
  const sourceDir = path.join(recordsPath, 'kindergarden');
  const dbPath = path.join(recordsPath, 'records.db');
  fs.mkdirSync(sourceDir, { recursive: true });
  for (const extension of ['md', 'html', 'meta.json', 'wav']) {
    fs.writeFileSync(path.join(sourceDir, `card.${extension}`), extension, 'utf8');
  }

  const db = new Database(dbPath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE generations (
      id INTEGER PRIMARY KEY,
      folder_name TEXT NOT NULL,
      generation_date TEXT,
      md_file_path TEXT NOT NULL,
      html_file_path TEXT NOT NULL,
      meta_file_path TEXT,
      updated_at TEXT,
      created_at TEXT
    );
    CREATE TABLE audio_files (
      id INTEGER PRIMARY KEY,
      generation_id INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      FOREIGN KEY (generation_id) REFERENCES generations(id)
    );
    CREATE TABLE card_highlights (
      id INTEGER PRIMARY KEY,
      folder_name TEXT NOT NULL
    );
    CREATE TABLE generation_jobs (
      id INTEGER PRIMARY KEY,
      target_folder TEXT,
      result_folder TEXT,
      request_payload_json TEXT,
      result_summary_json TEXT,
      source_context_json TEXT
    );
  `);
  db.prepare(`
    INSERT INTO generations VALUES (1, ?, ?, ?, ?, ?, NULL, ?)
  `).run(
    'kindergarden',
    '2026-06-01',
    path.join(sourceDir, 'card.md'),
    path.join(sourceDir, 'card.html'),
    path.join(sourceDir, 'card.meta.json'),
    '2026-06-01 12:00:00'
  );
  db.prepare('INSERT INTO audio_files VALUES (1, 1, ?)').run(path.join(sourceDir, 'card.wav'));
  db.prepare('INSERT INTO card_highlights VALUES (1, ?)').run('kindergarden');
  db.prepare('INSERT INTO generation_jobs VALUES (1, ?, ?, ?, ?, ?)').run(
    'kindergarden',
    'kindergarden',
    JSON.stringify({ target_folder: 'kindergarden' }),
    JSON.stringify({ folder: 'kindergarden' }),
    JSON.stringify({ file: path.join(sourceDir, 'card.md') })
  );
  db.close();
  return { root, recordsPath, sourceDir, dbPath };
}

test.describe('reassignFolderDate migration', () => {
  test.it('recursively replaces exact folder values and absolute paths', () => {
    const replacement = {
      sourceFolder: 'kindergarden',
      targetFolder: '20260713',
      sourceDir: '/records/kindergarden',
      targetDir: '/records/20260713',
    };
    assert.deepEqual(replaceFolderReferences({
      folder: 'kindergarden',
      nested: ['/records/kindergarden/card.md', 'kindergarden-notes'],
    }, replacement), {
      folder: '20260713',
      nested: ['/records/20260713/card.md', 'kindergarden-notes'],
    });
  });

  test.it('moves files and updates every persisted folder reference atomically', async () => {
    const fixture = createFixture();
    try {
      const result = await runMigration({
        sourceFolder: 'kindergarden',
        targetFolder: '20260713',
        logicalDate: '2026-07-13',
        recordsPath: fixture.recordsPath,
        dbPath: fixture.dbPath,
        apply: true,
        createBackup: false,
      });
      assert.equal(result.movedFiles, 4);
      assert.deepEqual(result.updated, {
        generations: 1,
        audioFiles: 1,
        highlights: 1,
        jobs: 1,
      });
      assert.equal(fs.existsSync(fixture.sourceDir), false);
      assert.equal(fs.existsSync(path.join(fixture.recordsPath, '20260713', 'card.html')), true);

      const db = new Database(fixture.dbPath, { readonly: true });
      try {
        const generation = db.prepare('SELECT * FROM generations WHERE id = 1').get();
        assert.equal(generation.folder_name, '20260713');
        assert.equal(generation.generation_date, '2026-07-13');
        assert.match(generation.md_file_path, /20260713\/card\.md$/);
        assert.equal(generation.created_at, '2026-06-01 12:00:00');
        assert.match(db.prepare('SELECT file_path FROM audio_files WHERE id = 1').get().file_path, /20260713\/card\.wav$/);
        assert.equal(db.prepare('SELECT folder_name FROM card_highlights WHERE id = 1').get().folder_name, '20260713');
        const job = db.prepare('SELECT * FROM generation_jobs WHERE id = 1').get();
        assert.equal(job.target_folder, '20260713');
        assert.equal(job.result_folder, '20260713');
        assert.equal(JSON.parse(job.request_payload_json).target_folder, '20260713');
        assert.equal(JSON.parse(job.result_summary_json).folder, '20260713');
        assert.match(JSON.parse(job.source_context_json).file, /20260713\/card\.md$/);
      } finally {
        db.close();
      }
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test.it('refuses to overwrite a conflicting target file', async () => {
    const fixture = createFixture();
    fs.mkdirSync(path.join(fixture.recordsPath, '20260713'));
    fs.writeFileSync(path.join(fixture.recordsPath, '20260713', 'card.html'), 'existing', 'utf8');
    try {
      await assert.rejects(() => runMigration({
        sourceFolder: 'kindergarden',
        targetFolder: '20260713',
        logicalDate: '2026-07-13',
        recordsPath: fixture.recordsPath,
        dbPath: fixture.dbPath,
        apply: true,
      }), /conflicting file/);
      assert.equal(fs.existsSync(path.join(fixture.sourceDir, 'card.html')), true);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});
