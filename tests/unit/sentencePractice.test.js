'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const Database = require('better-sqlite3');
const { createSentencePracticeService } = require('../../services/practice/sentencePracticeService');

const markdown = [
  '# Requests', '## 1. 英文:', '- **翻译**: Could you…?',
  '- **例句1**: Could you send the report?', '  - 你能发一下报告吗？',
  '- **例句2**: Could you open the window?', '  - 你能开一下窗吗？',
  '## 2. 日本語:', '- **翻訳**: いただけますか',
  '- **例句1**: 報告書を送っていただけますか。', '  - 能请你发一下报告吗？',
  '- **例句2**: 窓を開けていただけますか。', '  - 能请你开一下窗吗？',
  '## 3. 中文:', '- **翻译**: 礼貌请求',
].join('\n');

function fixture(t, ask) {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '../../database/schema.sql'), 'utf8'));
  db.exec('PRAGMA foreign_keys = ON');
  const id = Number(db.prepare(`
    INSERT INTO generations(phrase,llm_provider,folder_name,base_filename,md_file_path,html_file_path,markdown_content,content_hash)
    VALUES ('Requests','test','20261122','requests','requests.md','requests.html',?,?)
  `).run(markdown, 'a'.repeat(64)).lastInsertRowid);
  t.after(() => db.close());
  return { db, id, service: createSentencePracticeService({ db, ask }) };
}

test('both languages use card material without revealing a reference, and only completed attempts are in history', async t => {
  let calls = 0;
  const { service, id } = fixture(t, async () => {
    calls++;
    return { feedback: '礼貌而且意思准确。', suggestion: '' };
  });
  const [ja, en] = await Promise.all([
    service.issue({ language: 'ja', generationId: id }),
    service.issue({ language: 'en' }),
  ]);
  assert.deepEqual(Object.keys(ja), ['id', 'generationId', 'language', 'scene', 'cue']);
  assert.equal(ja.cue, '能请你发一下报告吗？');
  assert.equal(en.cue, '你能发一下报告吗？');
  assert.equal(calls, 0);
  assert.deepEqual(service.history(), []);
  await assert.rejects(service.assess(ja.id, { disputed: true }), { code: 'PRACTICE_UNANSWERED' });
  await assert.rejects(service.submit(ja.id, ' '), { code: 'PRACTICE_ANSWER' });
  await assert.rejects(service.issue({ language: ['ja'] }), { code: 'PRACTICE_LANGUAGE' });
});

test('save answer before AI, coalesce duplicate requests, and preserve self-assessment and disagreement on scenario change', async t => {
  let calls = 0;
  const { service, db, id } = fixture(t, async (_prompt, input) => {
    calls++;
    assert.equal(db.prepare('SELECT answer FROM sentence_practice_attempts WHERE answer IS NOT NULL').get().answer, input.answer);
    return { feedback: '请求表达清楚。', suggestion: '' };
  });
  const tables = ['learning_review_events', 'learning_schedule_states', 'learning_daily_queues', 'card_engagement_events', 'generations'];
  const snapshot = () => tables.map(table => db.prepare('SELECT * FROM ' + table).all());
  const before = snapshot();
  const prompt = await service.issue({ language: 'en', generationId: id });
  const answer = 'Could you send me the report?';
  const [a, b] = await Promise.all([service.submit(prompt.id, answer), service.submit(prompt.id, answer)]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  assert.equal(a.score, undefined);
  await assert.rejects(service.submit(prompt.id, 'overwritten'), { code: 'PRACTICE_ALREADY_ANSWERED' });
  await service.assess(prompt.id, { selfAssessment: 'independent' });
  await service.assess(prompt.id, { disputed: true });
  const next = await service.issue({ language: 'en', previousId: prompt.id });
  assert.equal(next.generationId, prompt.generationId);
  assert.equal(next.cue, '你能开一下窗吗？');
  assert.equal(calls, 1);
  assert.equal(service.history()[0].selfAssessment, 'independent');
  assert.equal(service.history()[0].disputed, true);
  assert.equal(service.history().length, 1);
  assert.deepEqual(snapshot(), before);
});

test('feedback failures and scored replies keep the answer without overwriting, and permit explicit retry', async t => {
  let calls = 0;
  const { service } = fixture(t, async () => {
    if (++calls === 1) throw Error('timeout');
    if (calls === 2) return { feedback: '这句 95 分。', suggestion: '' };
    return { feedback: '可以再明确一下礼貌程度。', suggestion: '送っていただけますか。' };
  });
  const p = await service.issue({ language: 'ja' });
  const answer = '送ってもらえますか。';
  assert.equal((await service.submit(p.id, answer)).feedback, null);
  assert.equal((await service.submit(p.id, answer)).feedback, null);
  assert.equal(service.history()[0].answer, answer);
  await service.assess(p.id, { selfAssessment: 'keep_practicing' });
  assert.equal((await service.submit(p.id, answer)).suggestion, '送っていただけますか。');
  assert.equal(service.history()[0].selfAssessment, 'keep_practicing');
});
