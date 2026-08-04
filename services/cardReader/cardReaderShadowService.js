'use strict';

const log = require('../../lib/logger').child({ module: 'svc/card-reader-shadow' });

let comparatorPromise = null;

function loadComparator() {
  if (!comparatorPromise) comparatorPromise = import('./cardReaderShadow.mjs');
  return comparatorPromise;
}

function cardReaderError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function numericGenerationId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw cardReaderError('CARD_READER_SHADOW_GENERATION_INVALID', 'generationId must be a positive integer', 400);
  }
  return id;
}

function createCardReaderShadowService(options = {}) {
  const dbService = options.dbService;
  const maxMarkdownChars = Math.max(1000, Number(options.maxMarkdownChars || 200000));
  const compare = options.compare || (async (markdown, metadata) => {
    const module = await loadComparator();
    return module.compareCardReaders(markdown, metadata);
  });

  return {
    async compareGeneration(value) {
      const generationId = numericGenerationId(value);
      const generation = dbService.getGenerationById(generationId);
      if (!generation) {
        throw cardReaderError('CARD_READER_SHADOW_GENERATION_NOT_FOUND', 'Generation not found', 404);
      }
      const markdown = String(generation.markdown_content || '');
      if (Array.from(markdown).length > maxMarkdownChars) {
        throw cardReaderError('CARD_READER_SHADOW_SOURCE_TOO_LARGE', 'Card Markdown exceeds the shadow limit', 413);
      }
      const report = await compare(markdown, {
        generationId,
        cardType: generation.card_type,
        sourceContentHash: generation.content_hash,
      });
      const fields = {
        generationId: report.generationId,
        cardType: report.cardType,
        parity: report.parity,
        matches: report.matches,
        counts: report.counts,
        mismatchCodes: report.mismatchCodes,
        diagnosticCodes: report.diagnosticCodes,
        durationMs: report.durationMs,
      };
      if (report.parity) log.debug(fields, 'card reader shadow comparison passed');
      else log.warn(fields, 'card reader shadow comparison mismatch');
      return report;
    },
  };
}

module.exports = {
  createCardReaderShadowService,
  numericGenerationId,
};
