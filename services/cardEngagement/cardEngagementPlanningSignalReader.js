'use strict';

const { normalizeTagValue } = require('../dataPreparation/rules');

class CardEngagementPlanningSignalReader {
  constructor({ db, enabled = true } = {}) {
    if (!db) throw new TypeError('CardEngagementPlanningSignalReader requires a SQLite database');
    this.db = db;
    this.enabled = Boolean(enabled);
  }

  readPlanningSignal(studyItem, context = {}) {
    if (!this.enabled || !studyItem?.generationId) return null;
    const nowMs = Date.parse(context.nowUtc || new Date().toISOString());
    const cutoff = new Date(nowMs - (30 * 24 * 60 * 60 * 1000)).toISOString();
    const generation = this.db.prepare(
      'SELECT phrase, card_type FROM generations WHERE id = ?'
    ).get(Number(studyItem.generationId));
    if (!generation) return null;
    const phraseNormalized = normalizeTagValue(generation.phrase);
    const rows = this.db.prepare(`
      SELECT event_kind, COUNT(*) AS count
      FROM card_engagement_events
      WHERE created_at_utc >= ?
        AND (
          generation_id = ?
          OR (phrase_normalized = ? AND card_type = ?)
        )
      GROUP BY event_kind
    `).all(cutoff, Number(studyItem.generationId), phraseNormalized, generation.card_type);
    const counts = Object.fromEntries(rows.map((row) => [row.event_kind, Number(row.count)]));
    const duplicateHits = Number(counts.duplicate_card_hit || 0);
    const opens = Number(counts.existing_card_opened || 0);
    const addedToToday = Number(counts.added_to_today || 0);
    const score = Math.min(24,
      Math.min(12, duplicateHits * 3)
      + Math.min(4, opens)
      + Math.min(8, addedToToday * 4)
    );
    if (!score) return null;
    const reasons = [];
    if (duplicateHits) reasons.push({ code: 'repeated-generation-query', label: `近 30 天重复查询 ${duplicateHits} 次` });
    if (opens) reasons.push({ code: 'existing-card-opened', label: `近 30 天主动打开 ${opens} 次` });
    if (addedToToday) reasons.push({ code: 'added-to-today', label: `近 30 天主动加入今日 ${addedToToday} 次` });
    return {
      score,
      groups: ['behavior:active-attention'],
      reasons,
      evidence: [{
        source: 'card-engagement-events',
        ruleVersion: 'card-engagement-v1',
        ruleKey: `generation:${studyItem.generationId}`,
      }],
    };
  }
}

module.exports = { CardEngagementPlanningSignalReader };
