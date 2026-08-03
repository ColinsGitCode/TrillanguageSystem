'use strict';

const { safeJsonParse } = require('./helpers');

function mapEvent(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    eventKey: row.event_key,
    generationId: row.generation_id ? Number(row.generation_id) : null,
    phraseNormalized: row.phrase_normalized,
    cardType: row.card_type,
    eventKind: row.event_kind,
    sourceSurface: row.source_surface,
    learningDay: row.learning_day,
    timeZone: row.time_zone,
    metadata: safeJsonParse(row.metadata_json, {}),
    createdAtUtc: row.created_at_utc,
  };
}

function getByKey(db, eventKey) {
  return db.prepare('SELECT * FROM card_engagement_events WHERE event_key = ?').get(eventKey) || null;
}

function insert(db, event) {
  const result = db.prepare(`
    INSERT INTO card_engagement_events(
      event_key, request_hash, generation_id, phrase_normalized, card_type,
      event_kind, source_surface, learning_day, time_zone, metadata_json, created_at_utc
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.eventKey,
    event.requestHash,
    event.generationId,
    event.phraseNormalized,
    event.cardType,
    event.eventKind,
    event.sourceSurface,
    event.learningDay,
    event.timeZone,
    JSON.stringify(event.metadata || {}),
    event.createdAtUtc
  );
  return mapEvent(db.prepare('SELECT * FROM card_engagement_events WHERE id = ?').get(result.lastInsertRowid));
}

function aggregateForCard(db, generation) {
  const counts = db.prepare(`
    SELECT event_kind, COUNT(*) AS count
    FROM card_engagement_events
    WHERE generation_id = ? OR (phrase_normalized = ? AND card_type = ?)
    GROUP BY event_kind
  `).all(generation.id, generation.phraseNormalized, generation.cardType);
  const byKind = Object.fromEntries(counts.map((row) => [row.event_kind, Number(row.count)]));
  const last = db.prepare(`
    SELECT created_at_utc, learning_day
    FROM card_engagement_events
    WHERE generation_id = ? OR (phrase_normalized = ? AND card_type = ?)
    ORDER BY id DESC LIMIT 1
  `).get(generation.id, generation.phraseNormalized, generation.cardType);
  const reviews = db.prepare(`
    SELECT COUNT(*) AS count
    FROM learning_review_events review
    JOIN study_items item ON item.id = review.study_item_id
    WHERE item.generation_id = ?
  `).get(generation.id);
  return {
    byKind,
    reviewCount: Number(reviews?.count || 0),
    lastInteractionAtUtc: last?.created_at_utc || null,
    lastInteractionDay: last?.learning_day || null,
  };
}

function listTodayCards(db, learningDay) {
  return db.prepare(`
    WITH latest AS (
      SELECT generation_id, MAX(id) AS event_id
      FROM card_engagement_events
      WHERE learning_day = ? AND event_kind = 'added_to_today' AND generation_id IS NOT NULL
      GROUP BY generation_id
    )
    SELECT generation.id, generation.phrase, generation.card_type,
           generation.folder_name, generation.base_filename, generation.generation_date,
           event.created_at_utc AS added_at_utc
    FROM latest
    JOIN card_engagement_events event ON event.id = latest.event_id
    JOIN generations generation ON generation.id = latest.generation_id
    ORDER BY event.id DESC
  `).all(learningDay).map((row) => ({
    id: Number(row.id),
    phrase: row.phrase,
    cardType: row.card_type,
    folder: row.folder_name,
    baseFilename: row.base_filename,
    generationDate: row.generation_date,
    addedAtUtc: row.added_at_utc,
  }));
}

function aggregateRange(db, startDay, endDay) {
  const counts = db.prepare(`
    SELECT event_kind, COUNT(*) AS count
    FROM card_engagement_events
    WHERE learning_day BETWEEN ? AND ?
    GROUP BY event_kind
  `).all(startDay, endDay);
  const activeDays = db.prepare(`
    SELECT COUNT(DISTINCT learning_day) AS count
    FROM card_engagement_events
    WHERE learning_day BETWEEN ? AND ?
  `).get(startDay, endDay);
  const recent = db.prepare(`
    SELECT event.id, event.event_kind, event.learning_day, event.created_at_utc,
           event.generation_id, event.phrase_normalized, event.card_type,
           generation.folder_name, generation.base_filename
    FROM card_engagement_events event
    LEFT JOIN generations generation ON generation.id = event.generation_id
    WHERE event.learning_day BETWEEN ? AND ?
    ORDER BY event.id DESC LIMIT 30
  `).all(startDay, endDay).map((row) => ({
    id: Number(row.id),
    eventKind: row.event_kind,
    learningDay: row.learning_day,
    createdAtUtc: row.created_at_utc,
    generationId: row.generation_id ? Number(row.generation_id) : null,
    phrase: row.phrase_normalized,
    cardType: row.card_type,
    folder: row.folder_name || null,
    baseFilename: row.base_filename || null,
  }));
  return {
    counts: Object.fromEntries(counts.map((row) => [row.event_kind, Number(row.count)])),
    activeDays: Number(activeDays?.count || 0),
    recent,
  };
}

module.exports = {
  aggregateForCard,
  aggregateRange,
  getByKey,
  insert,
  listTodayCards,
  mapEvent,
};
