'use strict';

// DIC-R2 real-usage feedback. Rows describe which short term was selected and
// which candidate required intervention; surrounding context is not stored.

function mapEvent(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    language: row.language,
    normalizedForm: row.normalized_form,
    senseKey: row.sense_key,
    outcome: row.outcome,
    sourceKind: row.source_kind,
    sourceDetail: row.source_detail,
    confidence: row.confidence,
    matchReason: row.match_reason,
    candidateCount: Number(row.candidate_count),
    chosenRank: Number(row.chosen_rank),
    createdAtUtc: row.created_at_utc,
  };
}

function recordEvent(db, payload) {
  const result = db.prepare(`
    INSERT INTO local_glossary_lookup_events(
      language, normalized_form, sense_key, outcome, source_kind, source_detail,
      confidence, match_reason, candidate_count, chosen_rank, created_at_utc
    ) VALUES (
      @language, @normalizedForm, @senseKey, @outcome, @sourceKind, @sourceDetail,
      @confidence, @matchReason, @candidateCount, @chosenRank, @createdAtUtc
    )
  `).run(payload);
  return mapEvent(db.prepare('SELECT * FROM local_glossary_lookup_events WHERE id = ?').get(result.lastInsertRowid));
}

// Terms whose shown gloss was actually rejected or replaced. This is the input
// for the manual override set: rank by how often a real reading went wrong,
// not by how often the term was merely displayed.
function listProblemTerms(db, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 500);
  const clauses = [];
  const params = { limit };
  if (options.language) {
    clauses.push('language = @language');
    params.language = options.language;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`
    SELECT
      language,
      normalized_form,
      COUNT(*) AS total,
      SUM(CASE WHEN outcome = 'shown' THEN 1 ELSE 0 END) AS shown,
      SUM(CASE WHEN outcome = 'rejected' THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN outcome = 'switched' THEN 1 ELSE 0 END) AS switched,
      SUM(CASE WHEN outcome = 'corrected' THEN 1 ELSE 0 END) AS corrected,
      MAX(created_at_utc) AS last_seen_utc
    FROM local_glossary_lookup_events
    ${where}
    GROUP BY language, normalized_form
    HAVING rejected + switched + corrected > 0
    ORDER BY (rejected + switched + corrected) DESC, total DESC, normalized_form ASC
    LIMIT @limit
  `).all(params).map((row) => ({
    language: row.language,
    normalizedForm: row.normalized_form,
    total: Number(row.total),
    shown: Number(row.shown),
    rejected: Number(row.rejected),
    switched: Number(row.switched),
    corrected: Number(row.corrected),
    interventions: Number(row.rejected) + Number(row.switched) + Number(row.corrected),
    lastSeenUtc: row.last_seen_utc,
  }));
}

function getOutcomeStats(db, options = {}) {
  const clauses = [];
  const params = {};
  if (options.language) {
    clauses.push('language = @language');
    params.language = options.language;
  }
  if (options.since) {
    clauses.push('created_at_utc >= @since');
    params.since = options.since;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT outcome, source_kind, confidence, COUNT(*) AS count
    FROM local_glossary_lookup_events
    ${where}
    GROUP BY outcome, source_kind, confidence
    ORDER BY count DESC
  `).all(params);

  const totals = { shown: 0, rejected: 0, switched: 0, corrected: 0 };
  const bySource = new Map();
  for (const row of rows) {
    const count = Number(row.count);
    if (row.outcome in totals) totals[row.outcome] += count;
    const bucket = bySource.get(row.source_kind) || { sourceKind: row.source_kind, shown: 0, interventions: 0 };
    if (row.outcome === 'shown') bucket.shown += count;
    else bucket.interventions += count;
    bySource.set(row.source_kind, bucket);
  }

  // One lookup can produce more than one action (reject, then correct), so the
  // action total is deliberately not presented as a query-level error rate.
  const interventions = totals.rejected + totals.switched + totals.corrected;
  return {
    totals,
    interventions,
    bySource: [...bySource.values()].sort((left, right) => right.shown - left.shown),
  };
}

module.exports = {
  getOutcomeStats,
  listProblemTerms,
  mapEvent,
  recordEvent,
};
