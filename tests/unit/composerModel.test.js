'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const MODULE = '../../app/features/factory/composer-model.mjs';

test('batch card types split on lines, trim, and drop blanks and repeats', async () => {
  const { composerLines } = await import(MODULE);
  assert.deepEqual(
    composerLines(' assertion \n\n段落に分けて\r\nassertion\n单一 ', 'trilingual'),
    ['assertion', '段落に分けて', '单一'],
  );
  assert.deepEqual(composerLines('〜において\nだが', 'grammar_ja'), ['〜において', 'だが']);
  assert.deepEqual(composerLines('   \n  ', 'trilingual'), []);
});

test('a scenario is one card even when it spans lines', async () => {
  const { composerLines } = await import(MODULE);
  assert.deepEqual(
    composerLines('在东京租房\n向中介确认初期费用', 'scenario_phrase'),
    ['在东京租房\n向中介确认初期费用'],
  );
});

test('language is named only when the script decides it', async () => {
  const { detectLineLanguage } = await import(MODULE);
  assert.equal(detectLineLanguage('take a rain check'), 'en');
  assert.equal(detectLineLanguage('それぞれ'), 'ja');
  assert.equal(detectLineLanguage('段落に分けて'), 'ja', 'kana settles mixed kanji');
  assert.equal(detectLineLanguage('キューに追加する'), 'ja');
  // Kanji-only text is Chinese or Japanese; guessing would mislabel one of them.
  assert.equal(detectLineLanguage('单一'), null);
  assert.equal(detectLineLanguage('再申請'), null);
  assert.equal(detectLineLanguage('SNS 运营'), null, 'Latin mixed with Han is not English');
});

test('server times without a zone are read as UTC, not local time', async () => {
  const { parseServerTime } = await import(MODULE);
  assert.equal(parseServerTime('2026-09-25 08:03:57'), Date.UTC(2026, 8, 25, 8, 3, 57));
  assert.equal(parseServerTime('2026-09-25T08:04:09.116Z'), Date.UTC(2026, 8, 25, 8, 4, 9, 116));
  assert.equal(parseServerTime('2026-09-25T17:04:09+09:00'), Date.UTC(2026, 8, 25, 8, 4, 9));
  assert.equal(parseServerTime(null), null);
  assert.equal(parseServerTime('not a date'), null);
});

test('the tray says how far along each job is', async () => {
  const { describeJob } = await import(MODULE);
  const now = Date.UTC(2026, 8, 25, 8, 4, 20);
  const running = { id: 10, status: 'running', startedAt: '2026-09-25 08:04:08' };
  const firstQueued = { id: 11, status: 'queued' };
  const secondQueued = { id: 12, status: 'queued' };
  const jobs = [running, firstQueued, secondQueued];

  assert.deepEqual(describeJob(running, jobs, now), { tone: 'running', text: '生成中 12 秒' });
  assert.deepEqual(describeJob(firstQueued, jobs, now), { tone: 'queued', text: '排队中，前面还有 1 张' });
  assert.deepEqual(describeJob(secondQueued, jobs, now), { tone: 'queued', text: '排队中，前面还有 2 张' });
  assert.deepEqual(
    describeJob({ id: 12, status: 'queued' }, [{ id: 12, status: 'queued' }], now),
    { tone: 'queued', text: '排队中，下一个就是它' },
  );
  assert.deepEqual(
    describeJob({ id: 9, status: 'success', startedAt: '2026-09-25 08:03:57', finishedAt: '2026-09-25T08:04:19.000Z' }, jobs, now),
    { tone: 'done', text: '22 秒完成' },
    'mixed timestamp formats still give the real duration',
  );
  assert.equal(describeJob({ id: 8, status: 'failed', errorMessage: 'DeepSeek timeout' }, jobs, now).text, '生成失败：DeepSeek timeout');
});

test('estimates use the measured median per card type', async () => {
  const { estimateDuration } = await import(MODULE);
  assert.equal(estimateDuration(0, 'trilingual'), '');
  assert.equal(estimateDuration(1, 'trilingual'), '约 20 秒');
  assert.equal(estimateDuration(3, 'trilingual'), '约 1 分钟');
  assert.equal(estimateDuration(1, 'scenario_phrase'), '约 1 分钟');
});
