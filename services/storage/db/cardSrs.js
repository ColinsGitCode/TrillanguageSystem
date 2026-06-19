'use strict';

// card_srs + card_reviews domain. Spaced-repetition state per generation plus
// a lightweight review log. Functions take `db` first. `due_date` scheduling
// stays UTC-date based, while natural-day learning stats shift review logs into
// the configured records timezone.

const { RECORDS_TIMEZONE, tzOffsetClause } = require('../../../lib/serverConfig');
const { schedule } = require('../../srs/srsScheduler');

const SRS_SUPPORTED_CARD_TYPES = ['trilingual', 'grammar_ja'];
const DEFAULT_DAILY_GOAL = 5;

function normalizeSrsCardType(cardType) {
  const ct = String(cardType || '').trim().toLowerCase();
  if (!ct || ct === 'all') return '';
  return SRS_SUPPORTED_CARD_TYPES.includes(ct) ? ct : '__unsupported__';
}

function supportedCardTypeParams(prefix = 'cardType') {
  const params = {};
  const placeholders = SRS_SUPPORTED_CARD_TYPES.map((value, idx) => {
    const key = `${prefix}${idx}`;
    params[key] = value;
    return `@${key}`;
  });
  return { params, sql: placeholders.join(', ') };
}

function sqliteDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
  }
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

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
  const gen = db.prepare('SELECT id, card_type FROM generations WHERE id = ?').get(gid);
  if (!gen || !SRS_SUPPORTED_CARD_TYPES.includes(String(gen.card_type || '').toLowerCase())) return null;

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
  const ct = normalizeSrsCardType(cardType);
  if (ct === '__unsupported__') return [];

  const where = ["(s.id IS NULL OR s.due_date <= date('now'))"];
  const params = { limit: safeLimit };

  if (ct) {
    where.push('lower(g.card_type) = @cardType');
    params.cardType = ct;
  } else {
    const placeholders = SRS_SUPPORTED_CARD_TYPES.map((_, idx) => `@cardType${idx}`);
    SRS_SUPPORTED_CARD_TYPES.forEach((value, idx) => {
      params[`cardType${idx}`] = value;
    });
    where.push(`lower(g.card_type) IN (${placeholders.join(', ')})`);
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

function getStats(db, { timezone = RECORDS_TIMEZONE, now = new Date() } = {}) {
  const { params, sql: supportedCardTypesSql } = supportedCardTypeParams();
  const queryParams = {
    ...params,
    now: sqliteDateTime(now),
    tzShift: tzOffsetClause(timezone, now)
  };

  const row = db.prepare(`
    SELECT
      (
        SELECT COUNT(*)
        FROM card_srs s
        JOIN generations g ON g.id = s.generation_id
        WHERE s.due_date <= date(@now)
          AND lower(g.card_type) IN (${supportedCardTypesSql})
      ) AS due_count,
      (
        SELECT COUNT(*)
        FROM generations g
        WHERE lower(g.card_type) IN (${supportedCardTypesSql})
          AND NOT EXISTS (SELECT 1 FROM card_srs s WHERE s.generation_id = g.id)
      ) AS new_count,
      (
        SELECT COUNT(*)
        FROM card_reviews r
        JOIN generations g ON g.id = r.generation_id
        WHERE date(r.reviewed_at, @tzShift) = date(@now, @tzShift)
          AND lower(g.card_type) IN (${supportedCardTypesSql})
      ) AS reviewed_today,
      (
        SELECT COUNT(*)
        FROM card_srs s
        JOIN generations g ON g.id = s.generation_id
        WHERE lower(g.card_type) IN (${supportedCardTypesSql})
      ) AS tracked_total
  `).get(queryParams) || {};
  return {
    dueCount: Number(row.due_count || 0),
    newCount: Number(row.new_count || 0),
    reviewedToday: Number(row.reviewed_today || 0),
    trackedTotal: Number(row.tracked_total || 0)
  };
}

function getEngagement(db, { goal = DEFAULT_DAILY_GOAL, timezone = RECORDS_TIMEZONE, now = new Date() } = {}) {
  const { params, sql: supportedCardTypesSql } = supportedCardTypeParams();
  const baseParams = {
    ...params,
    now: sqliteDateTime(now),
    tzShift: tzOffsetClause(timezone, now)
  };

  const today = db.prepare(`
    SELECT
      COUNT(*) AS reviewed,
      COUNT(DISTINCT CASE WHEN r.interval_before = 0 THEN r.generation_id END) AS new_learned
    FROM card_reviews r
    JOIN generations g ON g.id = r.generation_id
    WHERE date(r.reviewed_at, @tzShift) = date(@now, @tzShift)
      AND lower(g.card_type) IN (${supportedCardTypesSql})
  `).get(baseParams) || {};

  const mastery = db.prepare(`
    SELECT
      (
        SELECT COUNT(*)
        FROM card_srs s
        JOIN generations g ON g.id = s.generation_id
        WHERE s.repetitions >= 2
          AND lower(g.card_type) IN (${supportedCardTypesSql})
      ) AS mastered,
      (
        SELECT COUNT(*)
        FROM card_srs s
        JOIN generations g ON g.id = s.generation_id
        WHERE lower(g.card_type) IN (${supportedCardTypesSql})
      ) AS tracked,
      (
        SELECT COUNT(*)
        FROM generations g
        WHERE lower(g.card_type) IN (${supportedCardTypesSql})
      ) AS eligible_total
  `).get(params) || {};

  const dayRows = db.prepare(`
    SELECT date(r.reviewed_at, @tzShift) AS day, COUNT(*) AS count
    FROM card_reviews r
    JOIN generations g ON g.id = r.generation_id
    WHERE date(r.reviewed_at, @tzShift) >= date(@now, @tzShift, '-180 days')
      AND lower(g.card_type) IN (${supportedCardTypesSql})
    GROUP BY day
    ORDER BY day DESC
  `).all(baseParams);

  const activeDays = new Set(
    dayRows
      .filter((row) => Number(row.count || 0) > 0)
      .map((row) => row.day)
  );
  const todayKey = db.prepare(`SELECT date(@now, @tzShift) AS day`).get(baseParams).day;
  let cursor = todayKey;
  const activeToday = activeDays.has(todayKey);
  let days = 0;

  if (!activeToday) {
    cursor = db.prepare(`SELECT date(@day, '-1 day') AS day`).get({ day: todayKey }).day;
  }
  while (activeDays.has(cursor)) {
    days += 1;
    cursor = db.prepare(`SELECT date(@day, '-1 day') AS day`).get({ day: cursor }).day;
  }

  return {
    streak: {
      days,
      activeToday,
      lastActiveDay: dayRows[0]?.day || null
    },
    today: {
      goal: Number(goal || DEFAULT_DAILY_GOAL),
      reviewed: Number(today.reviewed || 0),
      newLearned: Number(today.new_learned || 0)
    },
    mastery: {
      mastered: Number(mastery.mastered || 0),
      tracked: Number(mastery.tracked || 0),
      eligibleTotal: Number(mastery.eligible_total || 0)
    }
  };
}

module.exports = {
  getState,
  review,
  getQueue,
  getStats,
  getEngagement,
};
