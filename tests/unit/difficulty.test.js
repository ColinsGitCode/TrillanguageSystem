'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const d = require('../../services/srs/difficulty');

test.describe('difficulty grading', () => {
  test.it('levelFromScore buckets at 34 / 67', () => {
    assert.equal(d.levelFromScore(0), 'easy');
    assert.equal(d.levelFromScore(33), 'easy');
    assert.equal(d.levelFromScore(34), 'medium');
    assert.equal(d.levelFromScore(66), 'medium');
    assert.equal(d.levelFromScore(67), 'hard');
    assert.equal(d.levelFromScore(100), 'hard');
  });

  test.it('heuristic: a short trilingual en term is easy', () => {
    const r = d.gradeDifficulty({ cardType: 'trilingual', langProfile: 'en', phrase: 'api' });
    assert.equal(r.source, 'heuristic');
    assert.equal(r.score, 28); // base only
    assert.equal(r.level, 'easy');
  });

  test.it('heuristic: a long grammar_ja ja term is hard', () => {
    const r = d.gradeDifficulty({ cardType: 'grammar_ja', langProfile: 'ja', phrase: '〜わけだ、〜という訳だよ' });
    assert.equal(String('〜わけだ、〜という訳だよ').length >= 12, true);
    assert.equal(r.score, 78); // 28 + 22 + 16 + 12
    assert.equal(r.level, 'hard');
  });

  test.it('heuristic: a mid-length mixed term is medium', () => {
    const r = d.gradeDifficulty({ cardType: 'trilingual', langProfile: 'mixed', phrase: 'handoff' });
    assert.equal(r.score, 42); // 28 + 8 + 6
    assert.equal(r.level, 'medium');
  });

  test.it('SRS: high ease + no lapses is easy', () => {
    const r = d.gradeDifficulty({ tracked: true, easeFactor: 2.6, lapses: 0 });
    assert.equal(r.source, 'srs');
    assert.equal(r.score, 0);
    assert.equal(r.level, 'easy');
  });

  test.it('SRS: low ease is hard', () => {
    const r = d.gradeDifficulty({ tracked: true, easeFactor: 1.3, lapses: 0 });
    assert.equal(r.score, 78);
    assert.equal(r.level, 'hard');
  });

  test.it('SRS: middling ease + a lapse is medium', () => {
    const r = d.gradeDifficulty({ tracked: true, easeFactor: 1.9, lapses: 1 });
    assert.equal(r.level, 'medium');
  });

  test.it('difficultyBand maps levels to score ranges', () => {
    assert.deepEqual(d.difficultyBand('easy'), { lo: 0, hi: 34 });
    assert.deepEqual(d.difficultyBand('medium'), { lo: 34, hi: 67 });
    assert.deepEqual(d.difficultyBand('hard'), { lo: 67, hi: 101 });
    assert.equal(d.difficultyBand('nope'), null);
  });

  test.it('buildDifficultyScoreSql emits a CASE expression referencing both aliases', () => {
    const sql = d.buildDifficultyScoreSql('t', 's');
    assert.match(sql, /CASE WHEN s\.id IS NOT NULL/);
    assert.match(sql, /t\.card_type/);
    assert.match(sql, /s\.ease_factor/);
  });
});
