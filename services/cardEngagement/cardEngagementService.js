'use strict';

const crypto = require('node:crypto');
const dbService = require('../storage/databaseService');
const { normalizeTagValue } = require('../dataPreparation/rules');
const { DEFAULT_TIME_ZONE, learningDay } = require('../learning/time/learningTime');

const EVENT_KINDS = new Set([
  'generation_requested',
  'duplicate_card_hit',
  'existing_card_opened',
  'added_to_today',
  'new_version_requested',
  'library_search_submitted',
]);
const CARD_TYPES = new Set(['trilingual', 'grammar_ja', 'scenario_phrase', 'textbook_track']);
const SOURCE_SURFACES = new Set(['cards_factory', 'card_modal', 'learning_history', 'api']);
const EVENT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function requestHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function interactionError(code, message, status = 400, details) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = details;
  return error;
}

class CardEngagementService {
  constructor({ storage = dbService, now = () => new Date().toISOString() } = {}) {
    this.storage = storage;
    this.now = now;
  }

  timeZone() {
    const row = this.storage.db.prepare('SELECT time_zone FROM learning_profiles WHERE id = 1').get();
    return row?.time_zone || DEFAULT_TIME_ZONE;
  }

  record(input = {}) {
    const eventKey = String(input.eventKey || '').trim();
    if (!EVENT_KEY_PATTERN.test(eventKey)) {
      throw interactionError('CARD_ENGAGEMENT_INVALID_REQUEST', 'eventKey must be 8-128 safe characters');
    }
    const eventKind = String(input.eventKind || '').trim();
    if (!EVENT_KINDS.has(eventKind)) {
      throw interactionError('CARD_ENGAGEMENT_INVALID_REQUEST', 'eventKind is not supported');
    }
    const cardType = String(input.cardType || 'trilingual').trim();
    if (!CARD_TYPES.has(cardType)) {
      throw interactionError('CARD_ENGAGEMENT_INVALID_REQUEST', 'cardType is not supported');
    }
    const sourceSurface = String(input.sourceSurface || 'cards_factory').trim();
    if (!SOURCE_SURFACES.has(sourceSurface)) {
      throw interactionError('CARD_ENGAGEMENT_INVALID_REQUEST', 'sourceSurface is not supported');
    }
    const generationId = input.generationId ? Number(input.generationId) : null;
    const generation = generationId ? this.storage.getGenerationById(generationId) : null;
    if (generationId && !generation) {
      throw interactionError('CARD_ENGAGEMENT_GENERATION_NOT_FOUND', 'Generation not found', 404);
    }
    const phraseNormalized = normalizeTagValue(input.phrase || generation?.phrase || '');
    if (!phraseNormalized || [...phraseNormalized].length > 500) {
      throw interactionError('CARD_ENGAGEMENT_INVALID_REQUEST', 'phrase must contain 1-500 characters');
    }
    const timeZone = this.timeZone();
    const createdAtUtc = this.now();
    const payload = {
      generationId,
      phraseNormalized,
      cardType,
      eventKind,
      sourceSurface,
      metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
    };
    const hash = requestHash(payload);
    const existing = this.storage.getCardEngagementEventByKey(eventKey);
    if (existing) {
      if (existing.request_hash !== hash) {
        throw interactionError('CARD_ENGAGEMENT_IDEMPOTENCY_CONFLICT', 'eventKey was used for another interaction', 409);
      }
      return { idempotent: true, event: this.storage.mapCardEngagementEvent(existing) };
    }
    return {
      idempotent: false,
      event: this.storage.insertCardEngagementEvent({
        ...payload,
        eventKey,
        requestHash: hash,
        learningDay: learningDay(createdAtUtc, timeZone),
        timeZone,
        createdAtUtc,
      }),
    };
  }

  stats(generationId) {
    const generation = this.storage.getGenerationById(Number(generationId));
    if (!generation) throw interactionError('CARD_ENGAGEMENT_GENERATION_NOT_FOUND', 'Generation not found', 404);
    const phraseNormalized = normalizeTagValue(generation.phrase);
    const aggregate = this.storage.aggregateCardEngagement({
      id: Number(generation.id),
      phraseNormalized,
      cardType: generation.card_type || 'trilingual',
    });
    const versions = this.storage.findDuplicateGenerations(generation.phrase, generation.card_type || 'trilingual');
    const counts = aggregate.byKind;
    const attentionScore = Math.min(30,
      Math.min(12, Number(counts.duplicate_card_hit || 0) * 3)
      + Math.min(6, Number(counts.existing_card_opened || 0))
      + Math.min(8, Number(counts.added_to_today || 0) * 4)
      + Math.min(4, Number(counts.generation_requested || 0))
    );
    return {
      generationId: Number(generation.id),
      phrase: generation.phrase,
      cardType: generation.card_type || 'trilingual',
      generationRequests: Number(counts.generation_requested || 0),
      duplicateHits: Number(counts.duplicate_card_hit || 0),
      opens: Number(counts.existing_card_opened || 0),
      addedToToday: Number(counts.added_to_today || 0),
      newVersionRequests: Number(counts.new_version_requested || 0),
      successfulVersions: versions.length,
      reviewCount: aggregate.reviewCount,
      attentionScore,
      lastInteractionAtUtc: aggregate.lastInteractionAtUtc,
      lastInteractionDay: aggregate.lastInteractionDay,
    };
  }

  today() {
    const timeZone = this.timeZone();
    const day = learningDay(this.now(), timeZone);
    return { learningDay: day, timeZone, cards: this.storage.listTodayEngagementCards(day) };
  }

  range(startDay, endDay) {
    return this.storage.aggregateCardEngagementRange(startDay, endDay);
  }
}

module.exports = new CardEngagementService();
module.exports.CardEngagementService = CardEngagementService;
