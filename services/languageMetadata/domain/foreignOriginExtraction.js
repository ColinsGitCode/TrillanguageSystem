'use strict';

// JLM-P0: extraction contract for `jlm-foreign-origin-v1`.
//
// Pure domain logic. No database, no LLM call, no runtime wiring — this module
// exists so the JLM-D0 §2.3 rejection rules can be exercised deterministically
// before any of the proposal storage in JLM-D2 is built.
//
// The LLM never supplies trustworthy offsets. It reports which segment a
// katakana surface sits in and which occurrence it means; the server re-locates
// that occurrence in the real Japanese text and owns the resulting codepoint
// range. Anything that cannot be re-located is rejected rather than guessed.

const crypto = require('node:crypto');

// NUL cannot occur inside any field, so it is the only separator that cannot
// produce an ambiguous key. Written as an escape because a raw NUL byte in
// source is invisible, makes the file look binary to grep, and is easy to
// mis-transcribe as a space.
const FIELD_SEPARATOR = '\u0000';
const SCHEMA_VERSION = 'jlm-foreign-origin-v1';
const METADATA_KIND = 'foreign-origin';

// Segment indexes are 1-based in the LLM contract: the model is asked to number
// the segments it was shown, and 1-based numbering is what it reproduces most
// reliably. The conversion to a 0-based array index happens here, once.
const SEGMENT_INDEX_BASE = 1;

const MAX_ITEMS = 64;
const MAX_ORIGIN_TERM_CODEPOINTS = 80;
const MIN_KATAKANA_CODEPOINTS = 2;

const ORIGIN_LANGUAGES = new Set(['en', 'fr', 'de', 'it', 'es', 'pt', 'nl', 'ru', 'la']);
const CONFIDENCES = new Set(['high', 'medium', 'low']);

// A standalone 'ー' or '・' is punctuation, not a loanword. Requiring at least
// two katakana codepoints and disallowing a leading long-vowel mark keeps the
// separator dot out of the candidate set entirely.
const KATAKANA_SURFACE = /^[\p{Script=Katakana}][\p{Script=Katakana}ー]*$/u;
const ORIGIN_TERM_ALLOWED = /^[A-Za-z][A-Za-z0-9'’\-. ]*$/u;

const REJECTION = Object.freeze({
  ENVELOPE_INVALID: 'envelope-invalid',
  SCHEMA_VERSION_UNKNOWN: 'schema-version-unknown',
  ITEMS_OVERFLOW: 'items-overflow',
  SEGMENT_INDEX_INVALID: 'segment-index-invalid',
  SURFACE_NOT_KATAKANA: 'surface-not-katakana',
  SURFACE_NOT_FOUND: 'surface-not-found',
  OCCURRENCE_INVALID: 'occurrence-invalid',
  OCCURRENCE_OUT_OF_RANGE: 'occurrence-out-of-range',
  ORIGIN_TERM_INVALID: 'origin-term-invalid',
  ORIGIN_LANGUAGE_UNKNOWN: 'origin-language-unknown',
  CONFIDENCE_UNKNOWN: 'confidence-unknown',
  CONFLICTING_CANDIDATE: 'conflicting-candidate',
});

function codePointLength(value) {
  return Array.from(String(value || '')).length;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

// Finds the nth occurrence of `needle` in `haystack`, returning its UTF-16
// index, or -1 when there are fewer than n occurrences.
function nthIndexOf(haystack, needle, occurrence) {
  let cursor = 0;
  for (let seen = 0; seen < occurrence; seen += 1) {
    const index = haystack.indexOf(needle, cursor);
    if (index < 0) return -1;
    if (seen === occurrence - 1) return index;
    cursor = index + needle.length;
  }
  return -1;
}

function normalizeOriginTerm(value) {
  return String(value == null ? '' : value).normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function validateHumanCorrectionValue({ surface, originTerm, originLanguage }) {
  const normalizedSurface = String(surface || '').normalize('NFKC').trim();
  const normalizedTerm = normalizeOriginTerm(originTerm);
  const normalizedLanguage = String(originLanguage || '').trim().toLowerCase();
  if (!normalizedSurface
    || !KATAKANA_SURFACE.test(normalizedSurface)
    || codePointLength(normalizedSurface) < MIN_KATAKANA_CODEPOINTS) {
    return { ok: false, reason: REJECTION.SURFACE_NOT_KATAKANA };
  }
  if (!normalizedTerm
    || codePointLength(normalizedTerm) > MAX_ORIGIN_TERM_CODEPOINTS
    || !ORIGIN_TERM_ALLOWED.test(normalizedTerm)) {
    return { ok: false, reason: REJECTION.ORIGIN_TERM_INVALID };
  }
  if (!ORIGIN_LANGUAGES.has(normalizedLanguage)) {
    return { ok: false, reason: REJECTION.ORIGIN_LANGUAGE_UNKNOWN };
  }
  return {
    ok: true,
    surface: normalizedSurface,
    originTerm: normalizedTerm,
    originLanguage: normalizedLanguage,
  };
}

// Deterministic idempotency key (JLM-D0 §3.2). Binding the content hash means a
// regenerated body produces different keys, so candidates can never silently
// carry over to a new version of the text.
function buildProposalKey({
  targetKind,
  targetId,
  sourceContentHash,
  metadataKind = METADATA_KIND,
  startCodePoint,
  endCodePoint,
  extractionVersion,
}) {
  return sha256([
    targetKind,
    targetId,
    sourceContentHash,
    metadataKind,
    startCodePoint,
    endCodePoint,
    extractionVersion,
  ].join(FIELD_SEPARATOR));
}

function validateEnvelope(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: REJECTION.ENVELOPE_INVALID };
  }
  if (payload.schema_version !== SCHEMA_VERSION) {
    return { ok: false, reason: REJECTION.SCHEMA_VERSION_UNKNOWN };
  }
  if (!Array.isArray(payload.items)) {
    return { ok: false, reason: REJECTION.ENVELOPE_INVALID };
  }
  if (payload.items.length > MAX_ITEMS) {
    return { ok: false, reason: REJECTION.ITEMS_OVERFLOW };
  }
  return { ok: true };
}

function locateItem(item, segments) {
  const segmentIndex = Number(item?.segment_index);
  if (!Number.isSafeInteger(segmentIndex)) return { reason: REJECTION.SEGMENT_INDEX_INVALID };
  const arrayIndex = segmentIndex - SEGMENT_INDEX_BASE;
  const segment = segments[arrayIndex];
  if (!segment) return { reason: REJECTION.SEGMENT_INDEX_INVALID };

  const surface = String(item?.surface == null ? '' : item.surface).normalize('NFKC');
  if (!surface
    || !KATAKANA_SURFACE.test(surface)
    || codePointLength(surface) < MIN_KATAKANA_CODEPOINTS) {
    return { reason: REJECTION.SURFACE_NOT_KATAKANA };
  }

  const occurrence = item?.occurrence === undefined ? 1 : Number(item.occurrence);
  if (!Number.isSafeInteger(occurrence) || occurrence < 1) {
    return { reason: REJECTION.OCCURRENCE_INVALID };
  }

  const utf16Index = nthIndexOf(segment.text, surface, occurrence);
  if (utf16Index < 0) {
    // Distinguish "the model invented a word" from "the model over-counted a
    // real word": the two need different follow-up in the P0 report.
    const exists = segment.text.includes(surface);
    return { reason: exists ? REJECTION.OCCURRENCE_OUT_OF_RANGE : REJECTION.SURFACE_NOT_FOUND };
  }

  const startCodePoint = segment.startCodePoint + codePointLength(segment.text.slice(0, utf16Index));
  return {
    surface,
    occurrence,
    segmentIndex,
    startCodePoint,
    endCodePoint: startCodePoint + codePointLength(surface),
  };
}

function validateValue(item) {
  const originTerm = normalizeOriginTerm(item?.origin_term);
  if (!originTerm
    || codePointLength(originTerm) > MAX_ORIGIN_TERM_CODEPOINTS
    || !ORIGIN_TERM_ALLOWED.test(originTerm)) {
    return { reason: REJECTION.ORIGIN_TERM_INVALID };
  }
  const originLanguage = String(item?.origin_language || '').trim().toLowerCase();
  if (!ORIGIN_LANGUAGES.has(originLanguage)) {
    return { reason: REJECTION.ORIGIN_LANGUAGE_UNKNOWN };
  }
  const confidence = String(item?.confidence || '').trim().toLowerCase();
  if (!CONFIDENCES.has(confidence)) {
    return { reason: REJECTION.CONFIDENCE_UNKNOWN };
  }
  return { originTerm, originLanguage, confidence };
}

/**
 * Validates one extraction response against the real Japanese segments and
 * returns server-owned proposals plus an enumerated rejection list.
 *
 * Never throws on bad model output: an unusable response is a rejection with a
 * reason, because JLM-D0 §7 requires provider noise to stay distinguishable
 * from "this card genuinely has no loanwords".
 */
function evaluateExtraction(payload, context) {
  const {
    segments = [],
    targetKind,
    targetId,
    sourceContentHash,
    extractionVersion,
  } = context || {};

  const envelope = validateEnvelope(payload);
  if (!envelope.ok) {
    return { accepted: [], rejected: [{ index: null, item: null, reason: envelope.reason }] };
  }

  const located = [];
  const rejected = [];
  payload.items.forEach((item, index) => {
    const position = locateItem(item, segments);
    if (position.reason) {
      rejected.push({ index, item, reason: position.reason });
      return;
    }
    const value = validateValue(item);
    if (value.reason) {
      rejected.push({ index, item, reason: value.reason });
      return;
    }
    located.push({ index, item, position, value });
  });

  // Conflict pass: one position may carry at most one origin. Identical repeats
  // collapse; genuine disagreement rejects every candidate at that position,
  // because there is no basis for preferring one hallucination over another.
  const byPosition = new Map();
  for (const entry of located) {
    const key = `${entry.position.startCodePoint}:${entry.position.endCodePoint}`;
    if (!byPosition.has(key)) byPosition.set(key, []);
    byPosition.get(key).push(entry);
  }

  const accepted = [];
  for (const group of byPosition.values()) {
    const distinct = new Set(group.map((entry) => (
      [entry.value.originTerm.toLowerCase(), entry.value.originLanguage].join(FIELD_SEPARATOR)
    )));
    if (distinct.size > 1) {
      group.forEach((entry) => rejected.push({
        index: entry.index,
        item: entry.item,
        reason: REJECTION.CONFLICTING_CANDIDATE,
      }));
      continue;
    }
    const [winner] = group;
    accepted.push({
      proposalKey: buildProposalKey({
        targetKind,
        targetId,
        sourceContentHash,
        metadataKind: METADATA_KIND,
        startCodePoint: winner.position.startCodePoint,
        endCodePoint: winner.position.endCodePoint,
        extractionVersion,
      }),
      targetKind,
      targetId,
      sourceContentHash,
      metadataKind: METADATA_KIND,
      surface: winner.position.surface,
      segmentIndex: winner.position.segmentIndex,
      occurrence: winner.position.occurrence,
      startCodePoint: winner.position.startCodePoint,
      endCodePoint: winner.position.endCodePoint,
      value: {
        originTerm: winner.value.originTerm,
        originLanguage: winner.value.originLanguage,
      },
      confidence: winner.value.confidence,
      status: 'pending',
    });
  }

  accepted.sort((left, right) => left.startCodePoint - right.startCodePoint);
  rejected.sort((left, right) => (left.index ?? -1) - (right.index ?? -1));
  return { accepted, rejected };
}

/** Katakana candidates actually present in the text, for coverage reporting. */
function katakanaCandidates(segments = []) {
  const found = [];
  segments.forEach((segment, arrayIndex) => {
    const matches = String(segment.text || '').match(/[\p{Script=Katakana}][\p{Script=Katakana}ー]*/gu) || [];
    const counts = new Map();
    for (const surface of matches) {
      if (codePointLength(surface) < MIN_KATAKANA_CODEPOINTS) continue;
      const occurrence = (counts.get(surface) || 0) + 1;
      counts.set(surface, occurrence);
      found.push({
        segmentIndex: arrayIndex + SEGMENT_INDEX_BASE,
        surface,
        occurrence,
      });
    }
  });
  return found;
}

module.exports = {
  CONFIDENCES,
  METADATA_KIND,
  MAX_ITEMS,
  MAX_ORIGIN_TERM_CODEPOINTS,
  MIN_KATAKANA_CODEPOINTS,
  ORIGIN_LANGUAGES,
  REJECTION,
  SCHEMA_VERSION,
  SEGMENT_INDEX_BASE,
  buildProposalKey,
  evaluateExtraction,
  katakanaCandidates,
  validateHumanCorrectionValue,
};
