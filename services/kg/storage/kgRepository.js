'use strict';

function parseJson(value, fallback) {
  try {
    return value == null ? fallback : JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function pointDto(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    pointKey: row.point_key,
    kind: row.kp_kind,
    language: row.language,
    canonicalForm: row.canonical_form,
    canonicalReading: row.canonical_reading || '',
    senseDiscriminator: row.sense_discriminator || '',
    identityVersion: row.identity_version,
    lifecycle: row.lifecycle,
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
  };
}

function caseDto(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    caseKey: row.case_key,
    caseKind: row.case_kind,
    language: row.language,
    kindHint: row.kp_kind_hint,
    surfaceFormId: row.surface_form_id == null ? null : Number(row.surface_form_id),
    evidenceId: row.evidence_id == null ? null : Number(row.evidence_id),
    normalizedInput: row.normalized_input,
    candidates: parseJson(row.candidates_json, []),
    status: row.status,
    revision: Number(row.revision),
    resolvedPointId: row.resolved_point_id == null ? null : Number(row.resolved_point_id),
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
    resolvedAtUtc: row.resolved_at_utc,
  };
}

class KgRepository {
  constructor(db) {
    this.db = db;
  }

  transaction(operation) {
    return this.db.transaction(operation)();
  }

  getPointById(id) {
    return pointDto(this.db.prepare('SELECT * FROM kg_points WHERE id = ?').get(Number(id)));
  }

  getPointByKey(pointKey) {
    return pointDto(this.db.prepare('SELECT * FROM kg_points WHERE point_key = ?').get(pointKey));
  }

  searchPoints({ query, language, kind, limit = 20 }) {
    const normalizedLimit = Math.min(Math.max(Number(limit) || 20, 1), 20);
    const terms = [`p.lifecycle = 'active'`, `(p.canonical_form LIKE @query ESCAPE '\\' OR s.normalized_surface LIKE @query ESCAPE '\\')`];
    const params = { query: `%${String(query).replace(/[\\%_]/gu, '\\$&')}%`, limit: normalizedLimit };
    if (language) {
      terms.push('p.language = @language');
      params.language = language;
    }
    if (kind) {
      terms.push('p.kp_kind = @kind');
      params.kind = kind;
    }
    return this.db.prepare(`
      SELECT DISTINCT p.*, COALESCE(stats.explicit_lookup_count_7d, 0) AS lookup_count_7d
      FROM kg_points p
      LEFT JOIN kg_point_surface_links l ON l.point_id = p.id AND l.lifecycle = 'active'
      LEFT JOIN kg_surface_forms s ON s.id = l.surface_form_id
      LEFT JOIN kg_point_stats stats ON stats.point_id = p.id
      WHERE ${terms.join(' AND ')}
      ORDER BY CASE WHEN p.canonical_form = @exact THEN 0 ELSE 1 END,
               lookup_count_7d DESC, p.canonical_form, p.id
      LIMIT @limit
    `).all({ ...params, exact: String(query) }).map((row) => ({
      ...pointDto(row),
      lookupCount7d: Number(row.lookup_count_7d),
    }));
  }

  insertPoint(identity, now, createdByEventId = null) {
    this.db.prepare(`
      INSERT OR IGNORE INTO kg_points(
        point_key, kp_kind, language, canonical_form, canonical_reading,
        sense_discriminator, identity_version, lifecycle, created_by_event_id,
        created_at_utc, updated_at_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(
      identity.pointKey, identity.kpKind, identity.language, identity.canonicalForm,
      identity.canonicalReading || null, identity.senseDiscriminator || '', identity.identityVersion,
      createdByEventId, now, now
    );
    return this.getPointByKey(identity.pointKey);
  }

  getSurfaceByKey(surfaceKey) {
    return this.db.prepare('SELECT * FROM kg_surface_forms WHERE surface_key = ?').get(surfaceKey) || null;
  }

  insertSurface(surface, analysis, now) {
    this.db.prepare(`
      INSERT OR IGNORE INTO kg_surface_forms(
        surface_key, language, surface_text, normalized_surface, normalized_reading,
        analysis_status, analyzer_id, analyzer_version, analysis_rule_version,
        token_sequence_json, analysis_input_hash, analysis_output_hash, created_at_utc, updated_at_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      surface.surfaceKey, surface.language, analysis.input || surface.normalizedSurface,
      surface.normalizedSurface, surface.normalizedReading || null, analysis.status,
      analysis.analyzer?.id || null, analysis.analyzer?.version || null,
      analysis.analyzer?.ruleVersion || null, JSON.stringify(analysis.tokens || []),
      analysis.inputHash || null, analysis.outputHash || null, now, now
    );
    return this.getSurfaceByKey(surface.surfaceKey);
  }

  getResolutionEventByKey(eventKey) {
    return this.db.prepare('SELECT * FROM kg_resolution_events WHERE event_key = ?').get(eventKey) || null;
  }

  insertResolutionEvent(event) {
    const result = this.db.prepare(`
      INSERT INTO kg_resolution_events(
        event_key, request_hash, case_id, action, actor_kind, provider_id, model_id,
        analyzer_id, analyzer_version, rule_version, prompt_schema_version, prompt_version,
        input_hash, output_hash, payload_json, public_reason, occurred_at_utc, created_at_utc
      ) VALUES (@eventKey, @requestHash, @caseId, @action, @actorKind, @providerId, @modelId,
        @analyzerId, @analyzerVersion, @ruleVersion, @promptSchemaVersion, @promptVersion,
        @inputHash, @outputHash, @payloadJson, @publicReason, @occurredAtUtc, @createdAtUtc)
    `).run({
      caseId: null, providerId: null, modelId: null, analyzerId: null, analyzerVersion: null,
      ruleVersion: null, promptSchemaVersion: null, promptVersion: null, inputHash: null,
      outputHash: null, payloadJson: '{}', ...event,
    });
    return Number(result.lastInsertRowid);
  }

  ensureResolutionEvent(event) {
    const existing = this.getResolutionEventByKey(event.eventKey);
    if (existing) {
      if (existing.request_hash !== event.requestHash) {
        const error = new Error('The event key is already used by a different request');
        error.code = 'KG_EVENT_KEY_CONFLICT';
        error.status = 409;
        throw error;
      }
      return Number(existing.id);
    }
    return this.insertResolutionEvent(event);
  }

  ensureSurfaceLink({ pointId, surfaceFormId, linkKind, decisionEventId, sourceKind, ruleVersion, publicReason, now }) {
    this.db.prepare(`
      INSERT OR IGNORE INTO kg_point_surface_links(
        point_id, surface_form_id, link_kind, lifecycle, decision_event_id, source_kind,
        rule_version, confidence, public_reason, created_at_utc, updated_at_utc
      ) VALUES (?, ?, ?, 'active', ?, ?, ?, 1, ?, ?, ?)
    `).run(pointId, surfaceFormId, linkKind, decisionEventId, sourceKind, ruleVersion || null, publicReason, now, now);
  }

  sourceExists(sourceKind, sourceRefId) {
    const tables = {
      generation: 'generations',
      study_item: 'study_items',
      textbook_expression: 'textbook_expressions',
    };
    const table = tables[sourceKind];
    if (!table) return false;
    return Boolean(this.db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(Number(sourceRefId)));
  }

  getEvidenceByKey(evidenceKey) {
    return this.db.prepare('SELECT * FROM kg_evidence WHERE evidence_key = ?').get(evidenceKey) || null;
  }

  insertEvidence(evidence, now) {
    this.db.prepare(`
      INSERT OR IGNORE INTO kg_evidence(
        evidence_key, source_kind, source_ref_id, source_revision, locator_json,
        language, source_text, source_content_hash, evidence_role, lifecycle,
        created_at_utc, updated_at_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      evidence.evidenceKey, evidence.sourceKind, evidence.sourceRefId, evidence.sourceRevision,
      JSON.stringify(evidence.locator || {}), evidence.language, evidence.sourceText,
      evidence.sourceContentHash, evidence.evidenceRole, now, now
    );
    return this.getEvidenceByKey(evidence.evidenceKey);
  }

  ensureEvidenceLink({ pointId, evidenceId, attachmentRole, strength, decisionEventId, extractorVersion, publicReason, now }) {
    this.db.prepare(`
      INSERT OR IGNORE INTO kg_point_evidence_links(
        point_id, evidence_id, attachment_role, strength, lifecycle, decision_event_id,
        extractor_version, public_reason, created_at_utc, updated_at_utc
      ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
    `).run(
      pointId, evidenceId, attachmentRole, strength, decisionEventId,
      extractorVersion || null, publicReason, now, now
    );
  }

  getCaseById(id) {
    return caseDto(this.db.prepare('SELECT * FROM kg_resolution_cases WHERE id = ?').get(Number(id)));
  }

  getCaseByKey(caseKey) {
    return caseDto(this.db.prepare('SELECT * FROM kg_resolution_cases WHERE case_key = ?').get(caseKey));
  }

  insertCase(data) {
    this.db.prepare(`
      INSERT OR IGNORE INTO kg_resolution_cases(
        case_key, case_kind, language, kp_kind_hint, surface_form_id, evidence_id,
        normalized_input, candidates_json, status, revision, created_at_utc, updated_at_utc
      ) VALUES (@caseKey, @caseKind, @language, @kindHint, @surfaceFormId, @evidenceId,
        @normalizedInput, @candidatesJson, 'open', 1, @now, @now)
    `).run({ evidenceId: null, candidatesJson: '[]', ...data });
    return this.getCaseByKey(data.caseKey);
  }

  updateCaseDecision({ id, expectedRevision, status, resolvedPointId = null, now }) {
    const result = this.db.prepare(`
      UPDATE kg_resolution_cases
      SET status = ?, resolved_point_id = ?, revision = revision + 1,
          updated_at_utc = ?, resolved_at_utc = CASE WHEN ? = 'resolved' THEN ? ELSE NULL END
      WHERE id = ? AND revision = ?
    `).run(status, resolvedPointId, now, status, now, Number(id), Number(expectedRevision));
    return result.changes === 1;
  }

  getLookupByKey(eventKey) {
    return this.db.prepare('SELECT * FROM kg_lookup_events WHERE event_key = ?').get(eventKey) || null;
  }

  insertLookup(event) {
    const result = this.db.prepare(`
      INSERT INTO kg_lookup_events(
        event_key, request_hash, interaction_kind, point_id, resolution_case_id, surface_form_id,
        input_text, normalized_input, language, kp_kind_hint, source_context_json,
        occurred_at_utc, learning_day, time_zone, created_at_utc
      ) VALUES (@eventKey, @requestHash, @interactionKind, @pointId, @resolutionCaseId,
        @surfaceFormId, @inputText, @normalizedInput, @language, @kindHint,
        @sourceContextJson, @occurredAtUtc, @learningDay, @timeZone, @createdAtUtc)
    `).run(event);
    return this.db.prepare('SELECT * FROM kg_lookup_events WHERE id = ?').get(Number(result.lastInsertRowid));
  }

  getPointForms(pointId) {
    return this.db.prepare(`
      SELECT s.id, s.surface_text, s.normalized_surface, s.normalized_reading,
             s.analysis_status, l.link_kind, l.source_kind, l.rule_version,
             l.confidence, l.public_reason
      FROM kg_point_surface_links l
      JOIN kg_surface_forms s ON s.id = l.surface_form_id
      WHERE l.point_id = ? AND l.lifecycle = 'active'
      ORDER BY CASE l.link_kind WHEN 'canonical' THEN 0 WHEN 'inflection-of' THEN 1 ELSE 2 END,
               s.normalized_surface, s.id
    `).all(Number(pointId)).map((row) => ({
      id: Number(row.id), text: row.surface_text, normalized: row.normalized_surface,
      reading: row.normalized_reading || '', analysisStatus: row.analysis_status,
      linkKind: row.link_kind, sourceKind: row.source_kind, ruleVersion: row.rule_version,
      confidence: Number(row.confidence), reason: row.public_reason,
    }));
  }

  getPointEvidence(pointId) {
    return this.db.prepare(`
      SELECT e.*, l.attachment_role, l.strength, l.extractor_version, l.public_reason
      FROM kg_point_evidence_links l
      JOIN kg_evidence e ON e.id = l.evidence_id
      WHERE l.point_id = ? AND l.lifecycle = 'active' AND e.lifecycle = 'active'
      ORDER BY e.source_kind, e.source_ref_id, e.id
    `).all(Number(pointId)).map((row) => ({
      id: Number(row.id), evidenceKey: row.evidence_key, sourceKind: row.source_kind,
      sourceRefId: Number(row.source_ref_id), sourceRevision: Number(row.source_revision),
      locator: parseJson(row.locator_json, {}), language: row.language, sourceText: row.source_text,
      sourceContentHash: row.source_content_hash, evidenceRole: row.evidence_role,
      attachmentRole: row.attachment_role, strength: row.strength,
      extractorVersion: row.extractor_version, reason: row.public_reason,
    }));
  }

  getPointStats(pointId) {
    const row = this.db.prepare('SELECT * FROM kg_point_stats WHERE point_id = ?').get(Number(pointId));
    if (!row) return null;
    return {
      studyItemCount: Number(row.study_item_count), activeStudyItemCount: Number(row.active_study_item_count),
      dueCount: Number(row.due_count), reviewEventCount: Number(row.review_event_count),
      lastReviewedAtUtc: row.last_reviewed_at_utc, explicitLookupCount7d: Number(row.explicit_lookup_count_7d),
      explicitLookupCount30d: Number(row.explicit_lookup_count_30d),
      duplicateAttemptCount30d: Number(row.duplicate_attempt_count_30d), lastLookupAtUtc: row.last_lookup_at_utc,
      evidenceCount: Number(row.evidence_count), surfaceFormCount: Number(row.surface_form_count),
      sourceBreakdown: parseJson(row.source_breakdown_json, {}), projectionVersion: row.projection_version,
      computedAtUtc: row.computed_at_utc,
    };
  }
}

module.exports = {
  KgRepository,
  caseDto,
  pointDto,
};
