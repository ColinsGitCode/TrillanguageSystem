'use strict';

const crypto = require('node:crypto');

function seedStudyItem(db, options = {}) {
  const phrase = options.phrase || `fixture-${crypto.randomUUID()}`;
  const cardType = options.cardType || 'trilingual';
  const unitKind = options.unitKind || 'trilingual_en';
  const unitKey = options.unitKey || (unitKind === 'trilingual_ja' ? 'ja' : 'en');
  const markdown = options.markdown || `# ${phrase}\n\nFixture learning content.`;
  const contentHash = crypto.createHash('sha256').update(markdown).digest('hex');
  const folder = options.folder || '20260714';
  const base = options.base || phrase.replace(/[^a-z0-9]+/giu, '-').toLowerCase();
  const generation = db.prepare(`
    INSERT INTO generations(
      phrase, phrase_language, card_type, source_mode, llm_provider, llm_model,
      folder_name, base_filename, md_file_path, html_file_path, meta_file_path,
      markdown_content, content_hash, en_translation, ja_translation, zh_translation,
      generation_date, request_id
    ) VALUES (?, 'en', ?, 'input', 'test', 'fixture', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    phrase,
    cardType,
    folder,
    base,
    `/tmp/${base}.md`,
    `/tmp/${base}.html`,
    `/tmp/${base}.json`,
    markdown,
    contentHash,
    options.enTranslation || 'English answer',
    options.jaTranslation || '日本語の答え',
    options.zhTranslation || '中文提示',
    options.generationDate || '2026-07-14',
    crypto.randomUUID()
  );
  const generationId = Number(generation.lastInsertRowid);
  const nowUtc = options.nowUtc || '2026-07-14T01:00:00.000Z';
  db.prepare(`
    INSERT INTO learning_source_admissions(
      generation_id, status, content_hash, reasons_json, decision_version, state_version,
      dp_state_hash, materialization_disposition, identity_anchor_generation_id,
      admission_source, evaluated_at_utc, created_at_utc, updated_at_utc
    ) VALUES (?, 'eligible', ?, '[]', 'fixture-v1', 'fixture-v1', NULL,
      'create-items', ?, 'manual', ?, ?, ?)
  `).run(generationId, contentHash, generationId, nowUtc, nowUtc, nowUtc);
  const item = db.prepare(`
    INSERT INTO study_items(
      generation_id, source_generation_id, unit_key, unit_kind, unit_locator_json,
      content_hash, content_revision, lifecycle, created_at_utc, updated_at_utc
    ) VALUES (?, ?, ?, ?, '{}', ?, 1, 'active', ?, ?)
  `).run(generationId, generationId, unitKey, unitKind, contentHash, nowUtc, nowUtc);
  return { generationId, studyItemId: Number(item.lastInsertRowid), contentHash };
}

module.exports = { seedStudyItem };
