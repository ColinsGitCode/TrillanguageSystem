'use strict';

const { SIGNAL_VERSION, scoreLookupDifficulty } = require('../domain/planningSignalPolicy');

const PROJECTION_VERSION = 'kg-point-stats-v1';

function isoDaysBefore(now, days) {
  return new Date(new Date(now).getTime() - (days * 86_400_000)).toISOString();
}

function sourceBreakdown(rows) {
  return Object.fromEntries(rows.map((row) => [row.source_kind, Number(row.count)]));
}

function normalizedIds(values) {
  return [...new Set((values || [])
    .map(Number)
    .filter((value) => Number.isInteger(value) && value > 0))];
}

function placeholders(values) {
  return values.map(() => '?').join(',');
}

function rebuildKnowledgeProjections({ db, now = new Date().toISOString(), pointIds = null }) {
  const cutoff7d = isoDaysBefore(now, 7);
  const cutoff30d = isoDaysBefore(now, 30);
  const transaction = db.transaction(() => {
    const fullRebuild = pointIds == null;
    let points;
    if (fullRebuild) {
      db.prepare('DELETE FROM kg_planning_signals').run();
      db.prepare('DELETE FROM kg_point_stats').run();
      points = db.prepare("SELECT id FROM kg_points WHERE lifecycle = 'active' ORDER BY id").all();
    } else {
      const requestedIds = normalizedIds(pointIds);
      if (!requestedIds.length) {
        return { mode: 'incremental', pointCount: 0, signalCount: 0, computedAtUtc: now };
      }
      points = db.prepare(`
        SELECT id FROM kg_points
        WHERE lifecycle = 'active' AND id IN (${placeholders(requestedIds)})
        ORDER BY id
      `).all(...requestedIds);
      const activeIds = points.map((point) => Number(point.id));
      if (activeIds.length) {
        db.prepare(`DELETE FROM kg_point_stats WHERE point_id IN (${placeholders(activeIds)})`).run(...activeIds);
      }
    }
    const attachedItems = db.prepare(`
      SELECT DISTINCT e.source_ref_id AS study_item_id
      FROM kg_point_evidence_links link
      JOIN kg_evidence e ON e.id = link.evidence_id
      JOIN study_items item ON item.id = e.source_ref_id
      WHERE link.point_id = ? AND link.lifecycle = 'active' AND link.strength = 'strong'
        AND e.lifecycle = 'active' AND e.source_kind = 'study_item'
      ORDER BY e.source_ref_id
    `);
    const lookupCounts = db.prepare(`
      SELECT
        SUM(CASE WHEN interaction_kind = 'explicit_lookup' AND occurred_at_utc >= ? THEN 1 ELSE 0 END) AS explicit_7d,
        SUM(CASE WHEN interaction_kind = 'explicit_lookup' AND occurred_at_utc >= ? THEN 1 ELSE 0 END) AS explicit_30d,
        SUM(CASE WHEN interaction_kind = 'duplicate_generation_attempt' AND occurred_at_utc >= ? THEN 1 ELSE 0 END) AS duplicate_30d,
        MAX(occurred_at_utc) AS last_lookup,
        MAX(id) AS max_lookup_id
      FROM kg_lookup_events WHERE point_id = ?
    `);
    const evidenceCounts = db.prepare(`
      SELECT e.source_kind, COUNT(*) AS count
      FROM kg_point_evidence_links link
      JOIN kg_evidence e ON e.id = link.evidence_id
      WHERE link.point_id = ? AND link.lifecycle = 'active' AND e.lifecycle = 'active'
      GROUP BY e.source_kind ORDER BY e.source_kind
    `);
    const reviewStats = db.prepare(`
      SELECT COUNT(event.id) AS review_count, MAX(event.occurred_at_utc) AS last_reviewed
      FROM learning_review_events event
      WHERE event.study_item_id IN (
        SELECT e.source_ref_id
        FROM kg_point_evidence_links link
        JOIN kg_evidence e ON e.id = link.evidence_id
        WHERE link.point_id = ? AND link.lifecycle = 'active' AND link.strength = 'strong'
          AND e.lifecycle = 'active' AND e.source_kind = 'study_item'
      )
    `);
    const dueCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM learning_schedule_states state
      WHERE state.study_item_id IN (
        SELECT e.source_ref_id
        FROM kg_point_evidence_links link
        JOIN kg_evidence e ON e.id = link.evidence_id
        WHERE link.point_id = ? AND link.lifecycle = 'active' AND link.strength = 'strong'
          AND e.lifecycle = 'active' AND e.source_kind = 'study_item'
      ) AND state.due_at_utc <= ?
    `);
    const insertStats = db.prepare(`
      INSERT INTO kg_point_stats(
        point_id, study_item_count, active_study_item_count, due_count,
        review_event_count, last_reviewed_at_utc, explicit_lookup_count_7d,
        explicit_lookup_count_30d, duplicate_attempt_count_30d, last_lookup_at_utc,
        evidence_count, surface_form_count, source_breakdown_json, projection_version,
        facts_watermark_json, computed_at_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const globalWatermark = {
      maxResolutionEventId: Number(db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM kg_resolution_events').get().id),
      maxReviewEventId: Number(db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM learning_review_events').get().id),
    };
    const impactedItems = new Set();
    for (const point of points) {
      const items = attachedItems.all(point.id).map((row) => Number(row.study_item_id));
      items.forEach((studyItemId) => impactedItems.add(studyItemId));
      const activeCount = items.length
        ? Number(db.prepare(`SELECT COUNT(*) AS count FROM study_items WHERE lifecycle = 'active' AND id IN (${items.map(() => '?').join(',')})`).get(...items).count)
        : 0;
      const lookups = lookupCounts.get(cutoff7d, cutoff30d, cutoff30d, point.id);
      const breakdownRows = evidenceCounts.all(point.id);
      const reviews = reviewStats.get(point.id);
      const surfaces = Number(db.prepare(`
        SELECT COUNT(*) AS count FROM kg_point_surface_links
        WHERE point_id = ? AND lifecycle = 'active'
      `).get(point.id).count);
      const watermark = {
        maxLookupEventId: Number(lookups.max_lookup_id || 0),
        ...globalWatermark,
      };
      insertStats.run(
        point.id, items.length, activeCount, Number(dueCount.get(point.id, now).count),
        Number(reviews.review_count || 0), reviews.last_reviewed || null,
        Number(lookups.explicit_7d || 0), Number(lookups.explicit_30d || 0),
        Number(lookups.duplicate_30d || 0), lookups.last_lookup || null,
        breakdownRows.reduce((sum, row) => sum + Number(row.count), 0), surfaces,
        JSON.stringify(sourceBreakdown(breakdownRows)), PROJECTION_VERSION,
        JSON.stringify(watermark), now
      );
    }

    let signalItemIds;
    if (fullRebuild) {
      signalItemIds = db.prepare(`
        SELECT DISTINCT evidence.source_ref_id AS study_item_id
        FROM kg_point_evidence_links link
        JOIN kg_evidence evidence ON evidence.id = link.evidence_id
        JOIN study_items item ON item.id = evidence.source_ref_id
        WHERE link.lifecycle = 'active' AND link.strength = 'strong'
          AND evidence.lifecycle = 'active' AND evidence.source_kind = 'study_item'
          AND item.lifecycle = 'active'
        ORDER BY evidence.source_ref_id
      `).all().map((row) => Number(row.study_item_id));
    } else {
      signalItemIds = [...impactedItems].sort((left, right) => left - right);
      if (signalItemIds.length) {
        db.prepare(`DELETE FROM kg_planning_signals WHERE study_item_id IN (${placeholders(signalItemIds)})`)
          .run(...signalItemIds);
      }
    }

    const pointStatsForItem = db.prepare(`
      SELECT DISTINCT stats.point_id, stats.explicit_lookup_count_7d,
        stats.duplicate_attempt_count_30d, stats.facts_watermark_json
      FROM kg_point_evidence_links link
      JOIN kg_evidence evidence ON evidence.id = link.evidence_id
      JOIN kg_point_stats stats ON stats.point_id = link.point_id
      JOIN kg_points point ON point.id = link.point_id AND point.lifecycle = 'active'
      WHERE evidence.source_kind = 'study_item' AND evidence.source_ref_id = ?
        AND evidence.lifecycle = 'active' AND link.lifecycle = 'active' AND link.strength = 'strong'
      ORDER BY stats.point_id
    `);
    const insertSignal = db.prepare(`
      INSERT INTO kg_planning_signals(
        study_item_id, score, point_ids_json, groups_json, reasons_json,
        evidence_json, signal_version, source_watermark_json, computed_at_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let signalCount = 0;
    for (const studyItemId of signalItemIds) {
      const candidates = pointStatsForItem.all(studyItemId).map((row) => ({
        pointId: Number(row.point_id),
        score: scoreLookupDifficulty({
          explicitLookupCount7d: row.explicit_lookup_count_7d,
          duplicateAttemptCount30d: row.duplicate_attempt_count_30d,
        }),
        explicitLookupCount7d: Number(row.explicit_lookup_count_7d),
        duplicateAttemptCount30d: Number(row.duplicate_attempt_count_30d),
        watermark: JSON.parse(row.facts_watermark_json),
      }));
      const score = Math.max(0, ...candidates.map((candidate) => candidate.score));
      if (score <= 0) continue;
      const strongest = candidates.filter((candidate) => candidate.score === score);
      const signal = strongest[0];
      insertSignal.run(
        studyItemId, score, JSON.stringify(strongest.map((candidate) => candidate.pointId)),
        JSON.stringify(['lookup-difficulty']),
        JSON.stringify([{ code: 'recent-lookup', label: '近期重复检索，建议在基础队列内提前复习' }]),
        JSON.stringify([{
          source: SIGNAL_VERSION,
          explicitLookupCount7d: signal.explicitLookupCount7d,
          duplicateAttemptCount30d: signal.duplicateAttemptCount30d,
        }]),
        SIGNAL_VERSION, JSON.stringify(signal.watermark), now
      );
      signalCount += 1;
    }

    return {
      mode: fullRebuild ? 'full' : 'incremental',
      pointCount: points.length,
      signalCount,
      computedAtUtc: now,
    };
  });
  return transaction();
}

module.exports = {
  PROJECTION_VERSION,
  rebuildKnowledgeProjections,
};
