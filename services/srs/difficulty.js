'use strict';

// Card difficulty grading. Two signal sources, in priority order:
//   1. SRS-empirical — a tracked card's ease_factor / lapses (low ease + many
//      lapses ⇒ the learner finds it hard). Most accurate once reviewed.
//   2. Heuristic prior — for untracked cards: card type (grammar_ja harder),
//      language profile (ja > mixed > en/zh), phrase length.
// Output is a 0–100 score bucketed into easy / medium / hard.
//
// The scoring constants live here ONCE and are consumed by both the pure JS
// `gradeDifficulty` (used row-by-row) and `buildDifficultyScoreSql` (used by
// the term-list query for paginated filter/sort), so the two never drift.

const LEVELS = ['easy', 'medium', 'hard'];

// Empirical (SRS) weights.
const SRS = { easeHigh: 2.6, easeRange: 1.3, easeWeight: 78, lapseWeight: 11, lapseMax: 22 };
// Heuristic weights.
const HEUR = { base: 28, grammar: 22, ja: 16, mixed: 8, lenLong: 12, lenMid: 6, lenLongAt: 12, lenMidAt: 6 };
// Score → level band thresholds: <easy → easy, <medium → medium, else hard.
const BANDS = { easy: 34, medium: 67 };

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function levelFromScore(score) {
  const s = Number(score) || 0;
  if (s < BANDS.easy) return 'easy';
  if (s < BANDS.medium) return 'medium';
  return 'hard';
}

// card: { tracked?, easeFactor?, lapses?, cardType?, langProfile?, phrase? }
function gradeDifficulty(card = {}) {
  const tracked = card.tracked != null ? Boolean(card.tracked) : card.easeFactor != null;
  let score;
  let source;

  if (tracked) {
    source = 'srs';
    const ease = Number.isFinite(Number(card.easeFactor)) ? Number(card.easeFactor) : 2.5;
    const lapses = Math.max(0, Number(card.lapses) || 0);
    const easePart = clamp((SRS.easeHigh - ease) / SRS.easeRange, 0, 1) * SRS.easeWeight;
    const lapsePart = Math.min(SRS.lapseMax, lapses * SRS.lapseWeight);
    score = Math.min(100, Math.round(easePart + lapsePart));
  } else {
    source = 'heuristic';
    let s = HEUR.base;
    if (String(card.cardType) === 'grammar_ja') s += HEUR.grammar;
    const lp = String(card.langProfile || '').toLowerCase();
    if (lp === 'ja') s += HEUR.ja;
    else if (lp === 'mixed') s += HEUR.mixed;
    const len = String(card.phrase || '').length;
    if (len >= HEUR.lenLongAt) s += HEUR.lenLong;
    else if (len >= HEUR.lenMidAt) s += HEUR.lenMid;
    score = Math.min(100, s);
  }

  return { level: levelFromScore(score), score, source };
}

// SQLite expression that computes the same 0–100 score for a joined row, where
// `t` aliases knowledge_terms_index and `s` aliases card_srs (LEFT JOINed;
// s.id IS NULL ⇒ untracked ⇒ heuristic branch).
function buildDifficultyScoreSql(t = 't', s = 's') {
  return `CASE WHEN ${s}.id IS NOT NULL THEN
    MIN(100, CAST(ROUND(
      MAX(0.0, MIN(1.0, (${SRS.easeHigh} - ${s}.ease_factor) / ${SRS.easeRange})) * ${SRS.easeWeight}
      + MIN(${SRS.lapseMax}, ${s}.lapses * ${SRS.lapseWeight})
    ) AS INTEGER))
  ELSE
    MIN(100,
      ${HEUR.base}
      + (CASE WHEN lower(${t}.card_type) = 'grammar_ja' THEN ${HEUR.grammar} ELSE 0 END)
      + (CASE WHEN lower(${t}.lang_profile) = 'ja' THEN ${HEUR.ja} WHEN lower(${t}.lang_profile) = 'mixed' THEN ${HEUR.mixed} ELSE 0 END)
      + (CASE WHEN length(${t}.phrase) >= ${HEUR.lenLongAt} THEN ${HEUR.lenLong} WHEN length(${t}.phrase) >= ${HEUR.lenMidAt} THEN ${HEUR.lenMid} ELSE 0 END)
    )
  END`;
}

// SQL band predicate for a difficulty level (used in WHERE). Returns null for
// an unknown level so callers can skip filtering.
function difficultyBand(level) {
  const dl = String(level || '').trim().toLowerCase();
  if (dl === 'easy') return { lo: 0, hi: BANDS.easy };
  if (dl === 'medium') return { lo: BANDS.easy, hi: BANDS.medium };
  if (dl === 'hard') return { lo: BANDS.medium, hi: 101 };
  return null;
}

module.exports = {
  LEVELS,
  BANDS,
  gradeDifficulty,
  levelFromScore,
  buildDifficultyScoreSql,
  difficultyBand,
};
