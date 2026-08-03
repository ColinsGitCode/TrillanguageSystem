'use strict';

const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { OnboardingService } = require('../../services/onboarding/onboardingService');

function createDb() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '../../database/schema.sql'), 'utf8'));
  return db;
}

test('onboarding state is read-only and advances only from persisted facts', () => {
  const db = createDb();
  const service = new OnboardingService({ dbService: { db } });
  const empty = service.getState();
  assert.equal(empty.completedCount, 0);
  assert.equal(empty.nextStep.id, 'content');

  db.exec(`
    INSERT INTO generations(
      phrase, folder_name, base_filename, generation_date, card_type,
      md_file_path, html_file_path,
      llm_provider, llm_model, markdown_content, content_hash
    ) VALUES (
      'fixture', '2026.07.30', 'fixture', '2026-07-30', 'trilingual',
      '/tmp/onboarding-fixture.md', '/tmp/onboarding-fixture.html',
      'deepseek', 'fixture', '# fixture',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    );
    INSERT INTO study_items(
      source_generation_id, generation_id, unit_key, unit_kind, lifecycle,
      content_hash, unit_locator_json, created_at_utc, updated_at_utc
    ) VALUES (
      1, 1, 'en', 'trilingual_en', 'active',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '{}', '2026-07-30T00:00:00.000Z', '2026-07-30T00:00:00.000Z'
    );
  `);
  const withContent = service.getState();
  assert.equal(withContent.completedCount, 1);
  assert.equal(withContent.nextStep.id, 'plan');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM learning_plans').get().count, 0);
  db.close();
});
