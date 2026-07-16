'use strict';

const READ_SIGNAL_SQL = `
  SELECT study_item_id, score, point_ids_json, groups_json, reasons_json,
    evidence_json, signal_version
  FROM kg_planning_signals
  WHERE study_item_id = ?
`;

function jsonArray(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function publicEvidence(row, pointIds, storedEvidence) {
  const source = String(storedEvidence[0]?.source || row.signal_version || 'kg-planning-signal')
    .trim().slice(0, 120);
  const ruleVersion = String(row.signal_version).trim().slice(0, 80);
  const ids = [...new Set(pointIds.map(Number).filter((pointId) => Number.isSafeInteger(pointId) && pointId > 0))]
    .slice(0, 12);
  if (!ids.length) {
    return [{
      source,
      ruleVersion,
      ruleKey: `study-item:${Number(row.study_item_id)}`,
    }];
  }
  return ids.map((pointId) => ({
    source,
    ruleVersion,
    ruleKey: `point:${pointId}`,
  }));
}

class GraphPlanningSignalReader {
  constructor({ db, enabled = false } = {}) {
    if (!db) throw new TypeError('GraphPlanningSignalReader requires a SQLite database');
    this.enabled = Boolean(enabled);
    this.readSignal = null;
    if (!this.enabled) return;
    try {
      this.readSignal = db.prepare(READ_SIGNAL_SQL);
    } catch (_error) {
      this.readSignal = null;
    }
  }

  readPlanningSignal(studyItem) {
    const studyItemId = Number(studyItem?.studyItemId);
    if (!this.enabled || !this.readSignal || !Number.isSafeInteger(studyItemId) || studyItemId <= 0) return null;
    try {
      const row = this.readSignal.get(studyItemId);
      if (!row) return null;
      const score = Number(row.score);
      const pointIds = jsonArray(row.point_ids_json);
      const groups = jsonArray(row.groups_json);
      const reasons = jsonArray(row.reasons_json);
      const storedEvidence = jsonArray(row.evidence_json);
      if (!Number.isFinite(score) || score < 0 || score > 30
        || !pointIds || !groups || !reasons || !storedEvidence || !String(row.signal_version || '').trim()) {
        return null;
      }
      return {
        score,
        groups,
        reasons,
        evidence: publicEvidence(row, pointIds, storedEvidence),
      };
    } catch (_error) {
      return null;
    }
  }
}

module.exports = {
  GraphPlanningSignalReader,
  READ_SIGNAL_SQL,
};
