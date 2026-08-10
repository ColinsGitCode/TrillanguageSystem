'use strict';

const {
  buildProposalKey,
  METADATA_KIND,
  validateHumanCorrectionValue,
} = require('../domain/foreignOriginExtraction');
const { stripMarkdownToJapaneseText } = require('../../pronunciation/pronunciationService');

const HUMAN_CORRECTION_VERSION = 'jlm-human-correction-v1';
const HASH_RE = /^[a-f0-9]{64}$/u;

function correctionError(message, code, status = 400, details) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  return error;
}

function resolveTarget(dbService, targetKind, targetId) {
  if (targetKind === 'generation') {
    const row = dbService.getGenerationById(targetId);
    if (!row) throw correctionError('generation not found', 'LANGUAGE_METADATA_TARGET_NOT_FOUND', 404);
    return {
      sourceContentHash: row.content_hash,
      plainText: stripMarkdownToJapaneseText(row.markdown_content || ''),
    };
  }
  if (targetKind === 'textbook_expression') {
    const row = dbService.getTextbookExpression(targetId);
    if (!row) throw correctionError('textbook expression not found', 'LANGUAGE_METADATA_TARGET_NOT_FOUND', 404);
    return {
      sourceContentHash: row.ja_unit_hash,
      plainText: stripMarkdownToJapaneseText(row.ja_ruby_html || row.official_ja_text || ''),
    };
  }
  throw correctionError('unsupported correction target', 'LANGUAGE_METADATA_TARGET_INVALID');
}

function createLanguageMetadataCorrectionService({
  dbService,
  now = () => new Date().toISOString(),
}) {
  if (!dbService) throw new TypeError('LanguageMetadataCorrectionService requires dbService');

  function correct(payload = {}) {
    const targetKind = String(payload.targetKind || 'generation');
    const targetId = Number(payload.targetId);
    const sourceContentHash = String(payload.sourceContentHash || '').trim().toLowerCase();
    const startCodePoint = Number(payload.startCodePoint);
    const endCodePoint = Number(payload.endCodePoint);
    if (!Number.isSafeInteger(targetId) || targetId <= 0
      || !HASH_RE.test(sourceContentHash)
      || !Number.isSafeInteger(startCodePoint) || startCodePoint < 0
      || !Number.isSafeInteger(endCodePoint) || endCodePoint <= startCodePoint) {
      throw correctionError('invalid correction target or range', 'LANGUAGE_METADATA_CORRECTION_INVALID');
    }

    const target = resolveTarget(dbService, targetKind, targetId);
    if (!HASH_RE.test(String(target.sourceContentHash || ''))
      || target.sourceContentHash !== sourceContentHash) {
      throw correctionError('source content changed', 'LANGUAGE_METADATA_SOURCE_CONFLICT', 409);
    }

    const codePoints = Array.from(target.plainText);
    if (endCodePoint > codePoints.length) {
      throw correctionError('correction range is outside the target', 'LANGUAGE_METADATA_RANGE_INVALID');
    }
    const serverSurface = codePoints.slice(startCodePoint, endCodePoint).join('');
    const value = validateHumanCorrectionValue({
      surface: payload.surface,
      originTerm: payload.originTerm,
      originLanguage: payload.originLanguage || 'en',
    });
    if (!value.ok || serverSurface !== value.surface) {
      throw correctionError('correction does not match the current target text',
        'LANGUAGE_METADATA_CORRECTION_INVALID', 400, { reason: value.reason || 'surface-mismatch' });
    }

    const prior = dbService.listLanguageMetadataProposals({
      targetKind,
      targetId,
      sourceContentHash,
    }).filter((proposal) => (
      proposal.origin === 'human'
      && proposal.status === 'accepted'
      && proposal.metadataKind === METADATA_KIND
      && proposal.startCodePoint === startCodePoint
      && proposal.endCodePoint === endCodePoint
    )).at(-1) || null;

    if (prior
      && prior.value?.originTerm === value.originTerm
      && prior.value?.originLanguage === value.originLanguage) {
      return { proposal: prior, created: false, replaced: false, idempotent: true };
    }

    const proposalKey = buildProposalKey({
      targetKind,
      targetId,
      sourceContentHash,
      metadataKind: METADATA_KIND,
      startCodePoint,
      endCodePoint,
      extractionVersion: `${HUMAN_CORRECTION_VERSION}:${value.originLanguage}:${value.originTerm.toLowerCase()}`,
    });
    const result = dbService.insertLanguageMetadataProposal({
      proposalKey,
      targetKind,
      targetId,
      sourceContentHash,
      metadataKind: METADATA_KIND,
      surface: value.surface,
      startCodePoint,
      endCodePoint,
      valueJson: JSON.stringify({
        originTerm: value.originTerm,
        originLanguage: value.originLanguage,
      }),
      confidence: 'high',
      origin: 'human',
      status: 'accepted',
      supersedesProposalId: prior?.id || null,
      nowUtc: now(),
    });
    if (result.conflict) {
      throw correctionError('correction key conflicts with another value',
        'LANGUAGE_METADATA_CORRECTION_CONFLICT', 409);
    }
    return {
      proposal: result.proposal,
      created: result.created,
      replaced: Boolean(prior),
      idempotent: !result.created,
    };
  }

  return { correct, resolveTarget: (targetKind, targetId) => resolveTarget(dbService, targetKind, targetId) };
}

module.exports = {
  HUMAN_CORRECTION_VERSION,
  createLanguageMetadataCorrectionService,
};
