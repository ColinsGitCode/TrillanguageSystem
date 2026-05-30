'use strict';

// card_srs + card_reviews domain. Spaced-repetition state per generation plus
// a lightweight review log. Functions take `db` first. `due_date` is stored
// and compared with SQLite's `date('now')` (both UTC) so scheduling and the
// queue agree without a JS/SQLite timezone mismatch.

const { schedule } = require('../../srs/srsScheduler');

function mapState(row) {
  if (!row) return null;
  return {
    generationId: row.generation_id,
    easeFactor: row.ease_factor,
    intervalDays: row.interval_days,
    repetitions: row.repetitions,
    lapses: row.lapses,
    dueDate: row.due_date,
    lastGrade: row.last_grade,
    lastReviewedAt: row.last_reviewed_at
  };
}

function getState(db, generationId) {
  const row = db.prepare('SELECT * FROM card_srs WHERE generation_id = ?').get(Number(generationId));
  return mapState(row);
}

// Apply one review: run the scheduler, upsert card_srs, append a review-log row.
// Returns the new state, or null when the generation does not exist.
function review(db, generationId, grade) {
  const gid = Number(generationId);
  if (!gid) return null;
  const gen = db.prepare('SELECT id FROM generations WHERE id = ?').get(gid);
  if (!gen) return null;

  const prev = getState(db, gid);
  const next = schedule(prev ? {
    easeFactor: prev.easeFactor,
    intervalDays: prev.intervalDays,
    repetitions: prev.repetitions,
    lapses: prev.lapses
  } : undefined, grade);

  const plus = `+${next.intervalDays} days`;
  const txn = db.transaction(() => {
    db.prepare(`
      INSERT INTO card_srs (
        generation_id, ease_factor, interval_days, repetitions, lapses,
        due_date, last_grade, last_reviewed_at, updated_at
      ) VALUES (
        @gid, @ease, @interval, @reps, @lapses,
        date('now', @plus), @grade, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT(generation_id) DO UPDATE SET
        ease_factor = excluded.ease_factor,
        interval_days = excluded.interval_days,
        repetitions = excluded.repetitions,
        lapses = excluded.lapses,
        due_date = excluded.due_date,
        last_grade = excluded.last_grade,
        last_reviewed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    `).run({
      gid, ease: next.easeFactor, interval: next.intervalDays,
      reps: next.repetitions, lapses: next.lapses, plus, grade: next.grade
    });

    db.prepare(`
      INSERT INTO card_reviews (
        generation_id, grade, interval_before, interval_after, ease_after, reviewed_at
      ) VALUES (
        @gid, @grade, @before, @after, @ease, CURRENT_TIMESTAMP
      )
    `).run({
      gid, grade: next.grade, before: next.intervalBefore, after: next.intervalAfter, ease: next.easeFactor
    });
  });
  txn();

  return getState(db, gid);
}

// Cards to review now: tracked cards whose due_date has passed, plus untracked
// ("new") cards. Due cards come first, then new, capped by `limit`.
function getQueue(db, { limit = 20, cardType = '' } = {}) {
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 20));
  const ct = String(cardType || '').trim().toLowerCase();
  const where = ["(s.id IS NULL OR s.due_date <= date('now'))"];
  const params = { limit: safeLimit };
  if (ct && ct !== 'all') {
    where.push('lower(g.card_type) = @cardType');
    params.cardType = ct;
  }
  const rows = db.prepare(`
    SELECT
      g.id AS generation_id, g.phrase, g.card_type, g.folder_name, g.base_filename, g.created_at,
      s.due_date, s.repetitions, s.interval_days, s.ease_factor,
      CASE WHEN s.id IS NULL THEN 1 ELSE 0 END AS is_new
    FROM generations g
    LEFT JOIN card_srs s ON s.generation_id = g.id
    WHERE ${where.join(' AND ')}
    ORDER BY is_new ASC, s.due_date ASC, g.created_at ASC
    LIMIT @limit
  `).all(params);

  return rows.map((row) => ({
    generationId: row.generation_id,
    phrase: row.phrase || '',
    cardType: row.card_type || 'trilingual',
    folderName: row.folder_name || '',
    baseName: row.base_filename || '',
    dueDate: row.due_date || null,
    repetitions: Number(row.repetitions || 0),
    intervalDays: Number(row.interval_days || 0),
    isNew: Boolean(row.is_new)
  }));
}

function getStats(db) {
  const row = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM card_srs WHERE due_date <= date('now')) AS due_count,
      (SELECT COUNT(*) FROM generations g WHERE NOT EXISTS (SELECT 1 FROM card_srs s WHERE s.generation_id = g.id)) AS new_count,
      (SELECT COUNT(*) FROM card_reviews WHERE date(reviewed_at) = date('now')) AS reviewed_today,
      (SELECT COUNT(*) FROM card_srs) AS tracked_total
  `).get() || {};
  return {
    dueCount: Number(row.due_count || 0),
    newCount: Number(row.new_count || 0),
    reviewedToday: Number(row.reviewed_today || 0),
    trackedTotal: Number(row.tracked_total || 0)
  };
}

module.exports = {
  getState,
  review,
  getQueue,
  getStats,
};
