'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { buildCandidates } = require('../../scripts/maintenance/buildPronunciationCompoundCandidates');

function createDatabase() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync('database/schema.sql', 'utf8'));
  db.prepare(`
    INSERT INTO generations(
      phrase, phrase_language, card_type, source_mode, llm_provider, llm_model,
      folder_name, base_filename, md_file_path, html_file_path, meta_file_path,
      markdown_content, content_hash, generation_date, request_id
    ) VALUES ('fixture', 'ja', 'trilingual', 'input', 'deepseek', 'deepseek-v4-pro',
      '20260803', 'fixture', '/tmp/fixture.md', '/tmp/fixture.html', '/tmp/fixture.json', ?, ?, '2026-08-03', ?)
  `).run(
    '# Fixture\n\n<ruby>勤務<rt>きんむ</rt></ruby><ruby>表<rt>ひょう</rt></ruby>',
    'a'.repeat(64),
    `candidate-test-${Date.now()}`
  );
  return db;
}

test('candidate audit keeps component segmentation and only groups direct Ruby neighbors', async () => {
  const db = createDatabase();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pronunciation-candidate-'));
  const file = path.join(directory, 'fixture.db');
  try {
    await db.backup(file);
    const result = buildCandidates(file);
    assert.equal(result.counts.distinctCandidates, 1);
    assert.equal(result.candidates[0].surface, '勤務表');
    assert.deepEqual(result.candidates[0].components.map((item) => item.surface), ['勤務', '表']);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
