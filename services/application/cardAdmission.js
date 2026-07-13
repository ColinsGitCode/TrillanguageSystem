'use strict';

const fs = require('node:fs');
const { analyzeMarkdown, contentHash, normalizeTagValue } = require('../dataPreparation/rules');
const { toRuleRecord } = require('../dataPreparation/cardTagging');

class CardAdmissionError extends Error {
  constructor(message, { code = 'CARD_ADMISSION_FAILED', status = 422, details = [] } = {}) {
    super(message);
    this.name = 'CardAdmissionError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function normalizeDuplicatePolicy(value) {
  return String(value || '').trim().toLowerCase() === 'create-version' ? 'create-version' : 'reject';
}

function assertDuplicatePolicy({ cardType, duplicates = [], duplicatePolicy = 'reject' }) {
  const policy = normalizeDuplicatePolicy(duplicatePolicy);
  if (!duplicates.length || policy === 'create-version') return { policy, duplicates };
  throw new CardAdmissionError('A card with the same normalized phrase and type already exists', {
    code: 'CARD_DUPLICATE_EXISTS',
    status: 409,
    details: duplicates.map((item) => ({
      generationId: Number(item.id),
      phrase: item.phrase,
      cardType: item.card_type || item.cardType || cardType,
      contentHash: item.content_hash || item.contentHash || null,
    })),
  });
}

function validateAudioCompletion({ audioTasks = [], audio, e2eTestMode = false, ttsConfigured = false }) {
  if (e2eTestMode) return { policy: 'fixture-skip', expected: audioTasks.length, generated: 0 };
  if (!audioTasks.length) return { policy: 'not-required', expected: 0, generated: 0 };
  if (!ttsConfigured) {
    throw new CardAdmissionError('TTS is required because the card contains explicit audio references', {
      code: 'CARD_AUDIO_SERVICE_REQUIRED',
      status: 503,
    });
  }
  const results = Array.isArray(audio?.results) ? audio.results : [];
  const errors = Array.isArray(audio?.errors) ? audio.errors : [];
  const resultIndices = new Set(results.map((item) => Number(item.index)));
  const missingIndices = audioTasks
    .map((_task, index) => index)
    .filter((index) => !resultIndices.has(index));
  const missingFiles = results
    .filter((item) => !item.filePath || !fs.existsSync(item.filePath) || fs.statSync(item.filePath).size <= 0)
    .map((item) => item.index);
  if (errors.length || results.length !== audioTasks.length || missingIndices.length || missingFiles.length) {
    throw new CardAdmissionError('Not all referenced audio files were generated', {
      code: 'CARD_AUDIO_INCOMPLETE',
      status: 503,
      details: [{ errors, missingIndices, missingFiles, expected: audioTasks.length, generated: results.length }],
    });
  }
  return { policy: 'required', expected: audioTasks.length, generated: results.length };
}

function validateCardAdmission({ generation, audioTasks, audio, e2eTestMode, ttsConfigured }) {
  const record = toRuleRecord(generation);
  const structure = analyzeMarkdown(record, record.markdown_content);
  if (structure.reviewRequired) {
    throw new CardAdmissionError('Generated card failed canonical structure admission', {
      code: 'CARD_STRUCTURE_INCOMPLETE',
      status: 422,
      details: [structure],
    });
  }
  const expectedHash = contentHash(record.markdown_content);
  const actualHash = generation.content_hash || generation.contentHash;
  if (actualHash && actualHash !== expectedHash) {
    throw new CardAdmissionError('Generated card content hash does not match canonical Markdown', {
      code: 'CARD_CONTENT_HASH_MISMATCH',
      status: 422,
    });
  }
  const audioAdmission = validateAudioCompletion({ audioTasks, audio, e2eTestMode, ttsConfigured });
  return {
    status: 'eligible',
    contentHash: expectedHash,
    structure,
    audio: audioAdmission,
  };
}

function validatePersistedAdmission({ generation, tags = [], expectedHash, expectedAudioRows = 0 }) {
  const errors = [];
  if (!generation) errors.push('generation-readback-missing');
  if (generation?.content_hash !== expectedHash) errors.push('content-hash-readback-mismatch');
  if ((generation?.audioFiles || []).length !== expectedAudioRows) errors.push('audio-registry-readback-mismatch');
  for (const namespace of ['lang', 'src']) {
    const count = tags.filter((tag) => tag.status === 'active' && tag.namespace === namespace).length;
    if (count !== 1) errors.push(`${namespace}-tag-count-${count}`);
  }
  if (errors.length) {
    throw new CardAdmissionError('Persisted card failed admission readback', {
      code: 'CARD_ADMISSION_READBACK_FAILED',
      status: 500,
      details: errors,
    });
  }
  return true;
}

function findNormalizedDuplicates(records, phrase, cardType) {
  const normalizedPhrase = normalizeTagValue(phrase);
  return records.filter((item) =>
    String(item.card_type || item.cardType || 'trilingual') === String(cardType)
    && normalizeTagValue(item.phrase) === normalizedPhrase
  );
}

module.exports = {
  CardAdmissionError,
  assertDuplicatePolicy,
  findNormalizedDuplicates,
  normalizeDuplicatePolicy,
  validateAudioCompletion,
  validateCardAdmission,
  validatePersistedAdmission,
};
