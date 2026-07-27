'use strict';

const { annotationError } = require('./annotationErrors');

const PROJECTION_VERSION = 'card-visible-text-v1';
const TARGET_KINDS = new Set(['generation', 'textbook_track', 'textbook_expression']);
const ANNOTATION_KINDS = new Set(['highlight', 'note']);
const COLORS = new Set(['red', 'yellow', 'green', 'blue']);
const ANNOTATION_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|ca_legacy_[a-f0-9]{32})$/iu;

function integer(value, code, { min = 0 } = {}) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < min) throw annotationError(code, 400);
  return normalized;
}

function boundedText(value, code, max, { required = false } = {}) {
  const text = value == null ? '' : String(value);
  if ((required && !text) || text.length > max) throw annotationError(code, 400);
  return text;
}

function publicAnnotation(annotation, { includeLegacyPayload = false } = {}) {
  if (!annotation) return null;
  const output = { ...annotation };
  if (!includeLegacyPayload) delete output.legacyPayload;
  return output;
}

function validateSelector(selector) {
  if (selector?.projectionVersion !== PROJECTION_VERSION) {
    throw annotationError('ANNOTATION_PROJECTION_UNSUPPORTED', 400, {
      supported: PROJECTION_VERSION,
    });
  }
  const exact = boundedText(selector.textQuote?.exact, 'ANNOTATION_SELECTOR_INVALID', 1000, {
    required: true,
  });
  const prefix = boundedText(selector.textQuote?.prefix, 'ANNOTATION_SELECTOR_INVALID', 256);
  const suffix = boundedText(selector.textQuote?.suffix, 'ANNOTATION_SELECTOR_INVALID', 256);
  const start = integer(selector.textPosition?.start, 'ANNOTATION_SELECTOR_INVALID');
  const end = integer(selector.textPosition?.end, 'ANNOTATION_SELECTOR_INVALID', { min: 1 });
  if (end <= start || end - start !== exact.length) {
    throw annotationError('ANNOTATION_SELECTOR_INVALID', 400, {
      reason: 'position-must-use-utf16-and-match-exact',
    });
  }
  return {
    projectionVersion: PROJECTION_VERSION,
    quoteExact: exact,
    quotePrefix: prefix,
    quoteSuffix: suffix,
    positionStart: start,
    positionEnd: end,
  };
}

function validateBody(annotationKind, color, noteText) {
  if (!ANNOTATION_KINDS.has(annotationKind)) {
    throw annotationError('ANNOTATION_KIND_INVALID', 400);
  }
  const normalizedColor = color == null || color === '' ? null : String(color);
  const normalizedNote = noteText == null || noteText === '' ? null : String(noteText);
  if (normalizedColor && !COLORS.has(normalizedColor)) {
    throw annotationError('ANNOTATION_COLOR_INVALID', 400);
  }
  if (normalizedNote && normalizedNote.length > 4000) {
    throw annotationError('ANNOTATION_NOTE_INVALID', 400);
  }
  if (annotationKind === 'highlight' && !normalizedColor) {
    throw annotationError('ANNOTATION_COLOR_REQUIRED', 400);
  }
  if (annotationKind === 'note' && !normalizedNote?.trim()) {
    throw annotationError('ANNOTATION_NOTE_REQUIRED', 400);
  }
  return { color: normalizedColor, noteText: normalizedNote };
}

class AnnotationService {
  constructor({ dbService, now = () => new Date().toISOString() } = {}) {
    if (!dbService) throw new TypeError('AnnotationService requires dbService');
    this.dbService = dbService;
    this.now = now;
  }

  resolveTarget(targetKind, targetId) {
    if (!TARGET_KINDS.has(targetKind)) throw annotationError('ANNOTATION_TARGET_KIND_INVALID', 400);
    const id = integer(targetId, 'ANNOTATION_TARGET_ID_INVALID', { min: 1 });
    const target = this.dbService.resolveCardAnnotationTarget(targetKind, id);
    if (!target) throw annotationError('ANNOTATION_TARGET_NOT_FOUND', 404);
    if (!target.targetRevision) {
      throw annotationError('ANNOTATION_TARGET_REVISION_UNAVAILABLE', 409);
    }
    return target;
  }

  list(targetKind, targetId, options = {}) {
    const target = this.resolveTarget(targetKind, targetId);
    const annotations = this.dbService.listCardAnnotations(targetKind, target.targetId, options)
      .map((annotation) => publicAnnotation(annotation, options));
    return { target, annotations };
  }

  get(id, options = {}) {
    const annotation = this.dbService.getCardAnnotation(id);
    if (!annotation || annotation.status === 'deleted') {
      throw annotationError('ANNOTATION_NOT_FOUND', 404);
    }
    return publicAnnotation(annotation, options);
  }

  create(payload = {}) {
    const id = String(payload.id || '').trim().toLowerCase();
    if (!ANNOTATION_ID.test(id)) throw annotationError('ANNOTATION_ID_INVALID', 400);
    const target = this.resolveTarget(payload.targetKind, payload.targetId);
    if (String(payload.expectedTargetRevision || '') !== target.targetRevision) {
      throw annotationError('ANNOTATION_TARGET_REVISION_CONFLICT', 409, {
        expected: target.targetRevision,
      });
    }
    const selector = validateSelector(payload.selector);
    const annotationKind = String(payload.annotationKind || '');
    const body = validateBody(annotationKind, payload.color, payload.noteText);
    const timestamp = this.now();
    try {
      return publicAnnotation(this.dbService.createCardAnnotation({
        id,
        targetKind: target.targetKind,
        targetId: target.targetId,
        targetRevision: target.targetRevision,
        ...selector,
        annotationKind,
        ...body,
        status: 'active',
        sourceContentHash: target.sourceContentHash,
        createdAtUtc: timestamp,
        updatedAtUtc: timestamp,
      }));
    } catch (error) {
      if (error?.code?.startsWith('SQLITE_CONSTRAINT')) {
        throw annotationError('ANNOTATION_CONFLICT', 409);
      }
      throw error;
    }
  }

  update(id, payload = {}) {
    const current = this.get(id, { includeLegacyPayload: true });
    const expectedVersion = integer(payload.expectedVersion, 'ANNOTATION_VERSION_INVALID', { min: 1 });
    const body = validateBody(
      current.annotationKind,
      Object.hasOwn(payload, 'color') ? payload.color : current.color,
      Object.hasOwn(payload, 'noteText') ? payload.noteText : current.noteText
    );
    const updated = this.dbService.updateCardAnnotation(
      current.id,
      expectedVersion,
      body,
      this.now()
    );
    if (!updated) throw annotationError('ANNOTATION_VERSION_CONFLICT', 409);
    return publicAnnotation(updated);
  }

  remove(id, payload = {}) {
    const current = this.get(id, { includeLegacyPayload: true });
    const expectedVersion = integer(payload.expectedVersion, 'ANNOTATION_VERSION_INVALID', { min: 1 });
    const deleted = this.dbService.deleteCardAnnotation(
      current.id,
      expectedVersion,
      this.now()
    );
    if (!deleted) throw annotationError('ANNOTATION_VERSION_CONFLICT', 409);
    return { id: deleted.id, status: deleted.status, version: deleted.version };
  }
}

module.exports = {
  ANNOTATION_KINDS,
  COLORS,
  PROJECTION_VERSION,
  AnnotationService,
  publicAnnotation,
  validateSelector,
};
