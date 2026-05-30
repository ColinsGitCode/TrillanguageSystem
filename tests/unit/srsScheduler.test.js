'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const srs = require('../../services/srs/srsScheduler');

test.describe('srsScheduler (SM-2 variant)', () => {
  test.it('new card + Good → 1 day, rep 1, ease unchanged (q=4 delta 0)', () => {
    const s = srs.schedule(srs.defaultState(), 'good');
    assert.equal(s.intervalDays, 1);
    assert.equal(s.repetitions, 1);
    assert.equal(s.easeFactor, 2.5);
    assert.equal(s.lapses, 0);
  });

  test.it('Good progression 1 → 6 → round(6*EF)=15', () => {
    const a = srs.schedule({ easeFactor: 2.5, intervalDays: 1, repetitions: 1 }, 'good');
    assert.equal(a.intervalDays, 6);
    assert.equal(a.repetitions, 2);
    const b = srs.schedule({ easeFactor: 2.5, intervalDays: 6, repetitions: 2 }, 'good');
    assert.equal(b.intervalDays, 15);
    assert.equal(b.repetitions, 3);
  });

  test.it('Easy raises ease (+0.1) and stretches the interval (×1.3)', () => {
    const s = srs.schedule({ easeFactor: 2.5, intervalDays: 6, repetitions: 1 }, 'easy');
    assert.equal(s.easeFactor, 2.6);
    // base for rep 1 = 6, ×1.3 = round(7.8) = 8
    assert.equal(s.intervalDays, 8);
  });

  test.it('Hard lowers ease (−0.14) and shortens the interval (×0.6)', () => {
    const s = srs.schedule({ easeFactor: 2.5, intervalDays: 1, repetitions: 1 }, 'hard');
    assert.equal(s.easeFactor, 2.36);
    // base for rep 1 = 6, ×0.6 = round(3.6) = 4
    assert.equal(s.intervalDays, 4);
    assert.ok(s.intervalDays < 6, 'hard < good');
  });

  test.it('Again is a lapse: reset reps, 1-day interval, lapses++, ease drops', () => {
    const s = srs.schedule({ easeFactor: 2.5, intervalDays: 15, repetitions: 3, lapses: 0 }, 'again');
    assert.equal(s.repetitions, 0);
    assert.equal(s.intervalDays, 1);
    assert.equal(s.lapses, 1);
    assert.equal(s.easeFactor, 2.18); // 2.5 - 0.32
  });

  test.it('ease is floored at 1.3', () => {
    const s = srs.schedule({ easeFactor: 1.3, intervalDays: 1, repetitions: 0 }, 'again');
    assert.equal(s.easeFactor, 1.3);
  });

  test.it('reports intervalBefore/After for the review log', () => {
    const s = srs.schedule({ easeFactor: 2.5, intervalDays: 6, repetitions: 2 }, 'good');
    assert.equal(s.intervalBefore, 6);
    assert.equal(s.intervalAfter, s.intervalDays);
  });

  test.it('ordering holds: again ≤ hard ≤ good ≤ easy from the same state', () => {
    const base = { easeFactor: 2.5, intervalDays: 10, repetitions: 3 };
    const again = srs.schedule(base, 'again').intervalDays;
    const hard = srs.schedule(base, 'hard').intervalDays;
    const good = srs.schedule(base, 'good').intervalDays;
    const easy = srs.schedule(base, 'easy').intervalDays;
    assert.ok(again <= hard && hard <= good && good <= easy, `${again} ${hard} ${good} ${easy}`);
  });

  test.it('rejects an invalid grade', () => {
    assert.throws(() => srs.schedule(srs.defaultState(), 'maybe'));
    assert.equal(srs.isValidGrade('Good'), true);
    assert.equal(srs.isValidGrade('nope'), false);
  });
});
