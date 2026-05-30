'use strict';

// Spaced-repetition scheduler — an SM-2 variant driving a 4-button grade UI
// (Again / Hard / Good / Easy). Pure functions, no DB / no Date side effects:
// `schedule(state, grade)` returns the next numeric SRS state and the db layer
// turns `intervalDays` into a concrete `due_date`. This keeps the algorithm
// deterministically unit-testable.

const GRADES = ['again', 'hard', 'good', 'easy'];
// SM-2 quality 0–5; q < 3 is a lapse. Again maps below the pass threshold.
const QUALITY = { again: 2, hard: 3, good: 4, easy: 5 };
// Grade multiplier applied to the base interval on a pass so the four buttons
// produce a clear ordering (hard < good < easy) the same review.
const INTERVAL_MULT = { hard: 0.6, good: 1, easy: 1.3 };
const DEFAULT_EASE = 2.5;
const MIN_EASE = 1.3;

function defaultState() {
  return { easeFactor: DEFAULT_EASE, intervalDays: 0, repetitions: 0, lapses: 0 };
}

function normalizeGrade(grade) {
  return String(grade || '').trim().toLowerCase();
}

function isValidGrade(grade) {
  return GRADES.includes(normalizeGrade(grade));
}

// Apply one review. `state` is `{ easeFactor, intervalDays, repetitions, lapses }`
// (any subset; missing fields default). Returns the next state plus the
// before/after intervals for the review log.
function schedule(state, grade) {
  const g = normalizeGrade(grade);
  if (!GRADES.includes(g)) throw new Error(`invalid srs grade: ${grade}`);

  const prev = { ...defaultState(), ...(state || {}) };
  const intervalBefore = Number(prev.intervalDays) || 0;
  const q = QUALITY[g];

  let easeFactor = Number(prev.easeFactor) || DEFAULT_EASE;
  let repetitions = Math.max(0, Number(prev.repetitions) || 0);
  let lapses = Math.max(0, Number(prev.lapses) || 0);
  let intervalDays;

  if (q < 3) {
    // Lapse: relearn from scratch tomorrow.
    repetitions = 0;
    lapses += 1;
    intervalDays = 1;
  } else {
    let base;
    if (repetitions === 0) base = 1;
    else if (repetitions === 1) base = 6;
    else base = Math.round(intervalBefore * easeFactor);
    intervalDays = Math.max(1, Math.round(base * INTERVAL_MULT[g]));
    repetitions += 1;
  }

  // SM-2 ease adjustment, floored at MIN_EASE.
  easeFactor = easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (easeFactor < MIN_EASE) easeFactor = MIN_EASE;
  easeFactor = Math.round(easeFactor * 1000) / 1000;

  return {
    easeFactor,
    intervalDays,
    repetitions,
    lapses,
    grade: g,
    quality: q,
    intervalBefore,
    intervalAfter: intervalDays
  };
}

module.exports = {
  GRADES,
  DEFAULT_EASE,
  MIN_EASE,
  defaultState,
  isValidGrade,
  normalizeGrade,
  schedule,
};
