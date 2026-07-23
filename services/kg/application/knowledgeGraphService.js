'use strict';

const {
  buildKnowledgePointIdentity,
  buildSurfaceIdentity,
  normalizeKnowledgeText,
  sha256,
  stableJson,
} = require('../domain/knowledgeIdentity');
const { analyzeJapaneseForm } = require('../domain/japaneseFormAnalysis');
const { buildEvidenceLinkCandidate } = require('../domain/knowledgeEvidence');
const { prepareSourceText } = require('../domain/sourceTextQuality');
const { KnowledgeGraphError, invalidInput } = require('../domain/kgErrors');
const { KgRepository } = require('../storage/kgRepository');
const { rebuildKnowledgeProjections } = require('./rebuildKnowledgeProjections');
const { DEFAULT_TIME_ZONE, learningDay, validateTimeZone } = require('../../learning/time/learningTime');

const INTERACTION_KINDS = new Set(['explicit_lookup', 'duplicate_generation_attempt']);
const KP_KINDS = new Set(['lexeme', 'phrase', 'grammar_pattern']);
const EVENT_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{7,127}$/u;

function json(value) {
  return JSON.stringify(value == null ? {} : value);
}

function requireEventKey(value) {
  const eventKey = String(value || '').trim();
  if (!EVENT_KEY_PATTERN.test(eventKey)) {
    throw invalidInput('eventKey must contain 8-128 safe characters');
  }
  return eventKey;
}

function normalizeKind(value) {
  const kind = String(value || 'lexeme').trim().toLowerCase();
  if (!KP_KINDS.has(kind)) throw invalidInput(`Unsupported knowledge point kind: ${value}`);
  return kind;
}

function eventConflict() {
  return new KnowledgeGraphError('KG_EVENT_KEY_CONFLICT', 'The event key is already used by a different request', 409);
}

function notFound(code, message) {
  return new KnowledgeGraphError(code, message, 404);
}

function stale(details) {
  return new KnowledgeGraphError('KG_RESOLUTION_STALE', 'The resolution case has changed', 409, details);
}

class KnowledgeGraphService {
  constructor({ db, busyRetry = (operation) => operation(), clock = () => new Date().toISOString(), analyzeJapanese = analyzeJapaneseForm } = {}) {
    if (!db) throw new TypeError('KnowledgeGraphService requires db');
    this.db = db;
    this.repo = new KgRepository(db);
    this.busyRetry = busyRetry;
    this.clock = clock;
    this.analyzeJapanese = analyzeJapanese;
  }

  search(options = {}) {
    const query = String(options.query || '').trim();
    if (!query) return [];
    const language = options.language ? String(options.language).trim().toLowerCase() : null;
    const kind = options.kind ? normalizeKind(options.kind) : null;
    if (language && !['en', 'ja', 'zh'].includes(language)) throw invalidInput(`Unsupported language: ${language}`);
    return this.repo.searchPoints({ query, language, kind, limit: options.limit });
  }

  getPoint(id) {
    const point = this.repo.getPointById(id);
    if (!point) throw notFound('KG_POINT_NOT_FOUND', 'Knowledge point not found');
    return {
      ...point,
      stats: this.repo.getPointStats(point.id),
      forms: this.repo.getPointForms(point.id),
      evidence: this.repo.getPointEvidence(point.id),
    };
  }

  getForms(id) {
    this.getPoint(id);
    return this.repo.getPointForms(id);
  }

  getEvidence(id) {
    this.getPoint(id);
    return this.repo.getPointEvidence(id);
  }

  getResolutionCase(id) {
    const resolutionCase = this.repo.getCaseById(id);
    if (!resolutionCase) throw notFound('KG_RESOLUTION_CASE_NOT_FOUND', 'Resolution case not found');
    return resolutionCase;
  }

  listResolutionCases({ status = 'open', limit = 50 } = {}) {
    if (!['open', 'resolved', 'dismissed', 'superseded'].includes(status)) {
      throw invalidInput(`Unsupported resolution status: ${status}`);
    }
    return this.repo.listResolutionCases({ status, limit });
  }

  async lookup(command = {}) {
    const eventKey = requireEventKey(command.eventKey);
    const language = String(command.language || '').trim().toLowerCase();
    const kind = normalizeKind(command.kindHint || command.kind);
    const inputText = String(command.input || command.inputText || '').trim();
    const interactionKind = String(command.interactionKind || 'explicit_lookup').trim();
    if (!['en', 'ja', 'zh'].includes(language)) throw invalidInput(`Unsupported language: ${language}`);
    if (!inputText) throw invalidInput('inputText must not be empty');
    if (!INTERACTION_KINDS.has(interactionKind)) throw invalidInput(`Unsupported interaction kind: ${interactionKind}`);
    const timeZone = validateTimeZone(command.timeZone || DEFAULT_TIME_ZONE);
    const sourceContext = command.sourceContext && typeof command.sourceContext === 'object'
      ? command.sourceContext
      : {};
    const requestHash = sha256(stableJson({ inputText, interactionKind, kind, language, sourceContext, timeZone }));
    const existing = this.repo.getLookupByKey(eventKey);
    if (existing) {
      if (existing.request_hash !== requestHash) throw eventConflict();
      return this.hydrateLookup(existing, true);
    }

    const analysis = await this.analyzeInput({ inputText, language, kind });
    return this.busyRetry(() => this.repo.transaction(() => {
      const raced = this.repo.getLookupByKey(eventKey);
      if (raced) {
        if (raced.request_hash !== requestHash) throw eventConflict();
        return this.hydrateLookup(raced, true);
      }
      const now = this.clock();
      const target = analysis.status === 'resolved'
        ? this.persistResolvedAnalysis(analysis, now)
        : this.persistUnresolvedAnalysis(analysis, kind, now);
      const currentCase = target.resolutionCaseId ? this.repo.getCaseById(target.resolutionCaseId) : null;
      const resolvedPointId = currentCase?.status === 'resolved' ? currentCase.resolvedPointId : target.pointId;
      const lookup = this.repo.insertLookup({
        eventKey,
        requestHash,
        interactionKind,
        pointId: resolvedPointId || null,
        resolutionCaseId: resolvedPointId ? null : target.resolutionCaseId,
        surfaceFormId: target.surfaceFormId,
        inputText,
        normalizedInput: analysis.normalizedInput,
        language,
        kindHint: kind,
        sourceContextJson: json(sourceContext),
        occurredAtUtc: now,
        learningDay: learningDay(now, timeZone),
        timeZone,
        createdAtUtc: now,
      });
      if (resolvedPointId) {
        rebuildKnowledgeProjections({ db: this.db, now, pointIds: [resolvedPointId] });
      }
      return this.hydrateLookup(lookup, false);
    }));
  }

  async analyzeInput({ inputText, language, kind }) {
    const prepared = prepareSourceText(inputText, language);
    if (prepared.status !== 'ready') {
      throw invalidInput(`Input does not match the selected language or markup contract: ${prepared.reason}`);
    }
    const preparedText = prepared.text;
    if (language === 'ja' && kind === 'lexeme') {
      const result = await this.analyzeJapanese(preparedText);
      return {
        ...result,
        language,
        kind,
        inputHash: sha256(result.normalizedInput),
        outputHash: sha256(stableJson({
          status: result.status,
          canonicalForm: result.canonicalForm,
          lemmaReading: result.lemmaReading,
          relation: result.relation,
          reason: result.reason,
          tokens: result.tokens,
        })),
      };
    }
    const normalizedInput = normalizeKnowledgeText(preparedText, language);
    const pointIdentity = buildKnowledgePointIdentity({
      kpKind: kind,
      language,
      canonicalForm: normalizedInput,
    });
    return {
      status: 'resolved',
      input: preparedText,
      normalizedInput,
      canonicalForm: normalizedInput,
      lemmaReading: '',
      surfaceReading: '',
      relation: { linkKind: 'canonical', formKind: 'dictionary' },
      pointIdentity,
      surfaceIdentity: buildSurfaceIdentity({ language, surfaceText: normalizedInput }),
      language,
      kind,
      analyzer: null,
      tokens: [],
      inputHash: sha256(normalizedInput),
      outputHash: sha256(stableJson({ status: 'resolved', pointIdentity })),
    };
  }

  persistResolvedAnalysis(analysis, now) {
    const pointEventPayload = { identity: analysis.pointIdentity };
    const pointEventId = this.repo.ensureResolutionEvent({
      eventKey: `rule:point:${analysis.pointIdentity.pointKey}`,
      requestHash: sha256(stableJson(pointEventPayload)),
      action: 'point-created',
      actorKind: 'rule',
      analyzerId: analysis.analyzer?.id || null,
      analyzerVersion: analysis.analyzer?.version || null,
      ruleVersion: analysis.analyzer?.ruleVersion || analysis.pointIdentity.identityVersion,
      inputHash: analysis.inputHash,
      outputHash: analysis.outputHash,
      payloadJson: json(pointEventPayload),
      publicReason: 'Deterministic identity rules resolved this knowledge point.',
      occurredAtUtc: now,
      createdAtUtc: now,
    });
    const point = this.repo.insertPoint(analysis.pointIdentity, now, pointEventId);

    const canonicalSurface = buildSurfaceIdentity({
      language: analysis.language,
      surfaceText: analysis.canonicalForm,
      reading: analysis.lemmaReading || '',
    });
    const canonicalAnalysis = {
      ...analysis,
      input: analysis.canonicalForm,
      status: 'analyzed',
      tokens: analysis.lemmaTokens || analysis.tokens || [],
    };
    const persistedCanonical = this.repo.insertSurface(canonicalSurface, canonicalAnalysis, now);
    this.ensureSurfaceAttachment({
      point,
      surface: persistedCanonical,
      linkKind: 'canonical',
      analysis,
      now,
    });

    const inputSurface = this.repo.insertSurface(
      analysis.surfaceIdentity,
      { ...analysis, status: 'analyzed' },
      now
    );
    this.ensureSurfaceAttachment({
      point,
      surface: inputSurface,
      linkKind: analysis.relation.linkKind,
      analysis,
      now,
    });
    return { pointId: point.id, resolutionCaseId: null, surfaceFormId: Number(inputSurface.id) };
  }

  ensureSurfaceAttachment({ point, surface, linkKind, analysis, now }) {
    const payload = { pointId: point.id, surfaceFormId: Number(surface.id), linkKind };
    const eventId = this.repo.ensureResolutionEvent({
      eventKey: `rule:surface:${point.pointKey}:${surface.surface_key}:${linkKind}`,
      requestHash: sha256(stableJson(payload)),
      action: 'surface-attached',
      actorKind: 'rule',
      analyzerId: analysis.analyzer?.id || null,
      analyzerVersion: analysis.analyzer?.version || null,
      ruleVersion: analysis.analyzer?.ruleVersion || analysis.pointIdentity.identityVersion,
      inputHash: analysis.inputHash,
      outputHash: analysis.outputHash,
      payloadJson: json(payload),
      publicReason: `Deterministic analysis accepted the ${linkKind} relation.`,
      occurredAtUtc: now,
      createdAtUtc: now,
    });
    this.repo.ensureSurfaceLink({
      pointId: point.id,
      surfaceFormId: Number(surface.id),
      linkKind,
      decisionEventId: eventId,
      sourceKind: 'deterministic_rule',
      ruleVersion: analysis.analyzer?.ruleVersion || analysis.pointIdentity.identityVersion,
      publicReason: `Deterministic ${linkKind} relation.`,
      now,
    });
  }

  persistUnresolvedAnalysis(analysis, kind, now) {
    const language = analysis.language || 'ja';
    const surfaceIdentity = analysis.surfaceIdentity || buildSurfaceIdentity({
      language,
      surfaceText: analysis.normalizedInput,
    });
    const surface = this.repo.insertSurface(surfaceIdentity, {
      ...analysis,
      status: analysis.reason === 'unsupported-token' ? 'unsupported' : 'unresolved',
    }, now);
    const caseKey = sha256(stableJson({
      version: 'kg-resolution-case-v1',
      language,
      kind,
      surfaceKey: surfaceIdentity.surfaceKey,
      reason: analysis.reason,
    }));
    const resolutionCase = this.repo.insertCase({
      caseKey,
      caseKind: analysis.reason === 'ambiguous-kana-input' ? 'ambiguous-surface' : 'unsupported-analysis',
      language,
      kindHint: kind,
      surfaceFormId: Number(surface.id),
      normalizedInput: analysis.normalizedInput,
      candidatesJson: json([]),
      now,
    });
    const payload = { caseId: resolutionCase.id, reason: analysis.reason, details: analysis.details || {} };
    this.repo.ensureResolutionEvent({
      eventKey: `rule:case-opened:${caseKey}`,
      requestHash: sha256(stableJson(payload)),
      caseId: resolutionCase.id,
      action: 'case-opened',
      actorKind: 'rule',
      analyzerId: analysis.analyzer?.id || null,
      analyzerVersion: analysis.analyzer?.version || null,
      ruleVersion: analysis.analyzer?.ruleVersion || null,
      inputHash: analysis.inputHash,
      outputHash: analysis.outputHash,
      payloadJson: json(payload),
      publicReason: `Input remains unresolved: ${analysis.reason}.`,
      occurredAtUtc: now,
      createdAtUtc: now,
    });
    return { pointId: null, resolutionCaseId: resolutionCase.id, surfaceFormId: Number(surface.id) };
  }

  resolveCase(id, command = {}) {
    const eventKey = requireEventKey(command.eventKey);
    const action = String(command.action || '').trim();
    if (!['resolve', 'dismiss', 'reopen'].includes(action)) throw invalidInput(`Unsupported resolution action: ${action}`);
    const expectedRevision = Number(command.revision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw invalidInput('revision must be a positive integer');
    const requestHash = sha256(stableJson({ id: Number(id), action, revision: expectedRevision, pointId: command.pointId || null, point: command.point || null }));
    const existingEvent = this.repo.getResolutionEventByKey(eventKey);
    if (existingEvent) {
      if (existingEvent.request_hash !== requestHash) throw eventConflict();
      const resolutionCase = this.getResolutionCase(id);
      return {
        resolutionCase,
        point: resolutionCase.resolvedPointId ? this.repo.getPointById(resolutionCase.resolvedPointId) : null,
        reused: true,
      };
    }

    return this.busyRetry(() => this.repo.transaction(() => {
      const resolutionCase = this.repo.getCaseById(id);
      if (!resolutionCase) throw notFound('KG_RESOLUTION_CASE_NOT_FOUND', 'Resolution case not found');
      if (resolutionCase.revision !== expectedRevision) {
        throw stale({ expectedRevision, actualRevision: resolutionCase.revision });
      }
      const now = this.clock();
      let point = null;
      if (action === 'resolve') {
        if (command.pointId) {
          point = this.repo.getPointById(command.pointId);
          if (!point) throw notFound('KG_POINT_NOT_FOUND', 'Knowledge point not found');
        } else {
          const proposed = command.point || {};
          const identity = buildKnowledgePointIdentity({
            kpKind: proposed.kind || resolutionCase.kindHint || 'lexeme',
            language: proposed.language || resolutionCase.language,
            canonicalForm: proposed.canonicalForm,
            canonicalReading: proposed.canonicalReading || '',
            senseDiscriminator: proposed.senseDiscriminator || '',
          });
          point = this.repo.getPointByKey(identity.pointKey);
          if (!point) {
            const eventId = this.repo.insertResolutionEvent({
              eventKey,
              requestHash,
              caseId: resolutionCase.id,
              action: 'case-resolved',
              actorKind: 'user',
              payloadJson: json({ point: identity }),
              publicReason: String(command.publicReason || 'User resolved the ambiguous knowledge point.'),
              occurredAtUtc: now,
              createdAtUtc: now,
            });
            point = this.repo.insertPoint(identity, now, eventId);
            this.attachManualCanonicalSurface(point, identity, eventId, now);
          }
        }
      }
      if (!this.repo.getResolutionEventByKey(eventKey)) {
        this.repo.insertResolutionEvent({
          eventKey,
          requestHash,
          caseId: resolutionCase.id,
          action: action === 'resolve' ? 'case-resolved' : action === 'dismiss' ? 'case-dismissed' : 'case-reopened',
          actorKind: 'user',
          payloadJson: json({ pointId: point?.id || null }),
          publicReason: String(command.publicReason || `User chose to ${action} this case.`),
          occurredAtUtc: now,
          createdAtUtc: now,
        });
      }
      const status = action === 'resolve' ? 'resolved' : action === 'dismiss' ? 'dismissed' : 'open';
      if (!this.repo.updateCaseDecision({
        id: resolutionCase.id,
        expectedRevision,
        status,
        resolvedPointId: point?.id || null,
        now,
      })) throw stale({ expectedRevision });
      if (point) rebuildKnowledgeProjections({ db: this.db, now, pointIds: [point.id] });
      return { resolutionCase: this.getResolutionCase(id), point, reused: false };
    }));
  }

  attachManualCanonicalSurface(point, identity, eventId, now) {
    const surfaceIdentity = buildSurfaceIdentity({
      language: identity.language,
      surfaceText: identity.canonicalForm,
      reading: identity.canonicalReading,
    });
    const surface = this.repo.insertSurface(surfaceIdentity, {
      input: identity.canonicalForm,
      status: 'analyzed',
      tokens: [],
    }, now);
    this.repo.ensureSurfaceLink({
      pointId: point.id,
      surfaceFormId: Number(surface.id),
      linkKind: 'canonical',
      decisionEventId: eventId,
      sourceKind: 'user',
      ruleVersion: null,
      publicReason: 'User accepted this canonical form.',
      now,
    });
  }

  attachEvidence(candidateInput) {
    const candidate = buildEvidenceLinkCandidate(candidateInput);
    const point = this.repo.getPointByKey(candidate.pointKey);
    if (!point) throw notFound('KG_POINT_NOT_FOUND', 'Knowledge point not found');
    if (!this.repo.sourceExists(candidate.evidence.sourceKind, candidate.evidence.sourceRefId)) {
      throw invalidInput('Evidence source does not exist');
    }
    return this.busyRetry(() => this.repo.transaction(() => {
      const now = this.clock();
      const evidence = this.persistEvidenceCandidate(candidate, point, now);
      const projection = rebuildKnowledgeProjections({ db: this.db, now, pointIds: [point.id] });
      return { point: this.getPoint(point.id), evidence, projection };
    }));
  }

  persistEvidenceCandidate(candidate, point, now) {
    const eventPayload = { pointId: point.id, evidenceKey: candidate.evidence.evidenceKey };
    const eventId = this.repo.ensureResolutionEvent({
      eventKey: `rule:evidence:${point.pointKey}:${candidate.evidence.evidenceKey}`,
      requestHash: sha256(stableJson(eventPayload)),
      action: 'evidence-attached',
      actorKind: 'rule',
      ruleVersion: candidate.ruleVersion,
      payloadJson: json(eventPayload),
      publicReason: candidate.publicReason,
      occurredAtUtc: now,
      createdAtUtc: now,
    });
    const evidence = this.repo.insertEvidence(candidate.evidence, now);
    this.repo.ensureEvidenceLink({
      pointId: point.id,
      evidenceId: Number(evidence.id),
      attachmentRole: candidate.evidence.evidenceRole,
      strength: candidate.strength,
      decisionEventId: eventId,
      extractorVersion: candidate.ruleVersion,
      publicReason: candidate.publicReason,
      now,
    });
    return evidence;
  }

  rebuild(now = this.clock()) {
    return this.busyRetry(() => rebuildKnowledgeProjections({ db: this.db, now }));
  }

  hydrateLookup(row, reused) {
    const point = row.point_id == null ? null : this.repo.getPointById(row.point_id);
    const resolutionCase = row.resolution_case_id == null ? null : this.repo.getCaseById(row.resolution_case_id);
    return {
      id: Number(row.id),
      eventKey: row.event_key,
      interactionKind: row.interaction_kind,
      inputText: row.input_text,
      normalizedInput: row.normalized_input,
      language: row.language,
      kindHint: row.kp_kind_hint,
      occurredAtUtc: row.occurred_at_utc,
      learningDay: row.learning_day,
      timeZone: row.time_zone,
      resolution: point ? 'resolved' : 'unresolved',
      point,
      resolutionCase,
      reused,
    };
  }
}

module.exports = {
  KnowledgeGraphService,
  normalizeKind,
  requireEventKey,
};
