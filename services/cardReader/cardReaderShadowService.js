'use strict';

const log = require('../../lib/logger').child({ module: 'svc/card-reader-shadow' });

let cardReaderModulePromise = null;

function loadCardReaderModule() {
  if (!cardReaderModulePromise) cardReaderModulePromise = import('./cardReaderShadow.mjs');
  return cardReaderModulePromise;
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
  const canaryGenerationIds = new Set(options.canaryGenerationIds || []);
  const compare = options.compare || (async (markdown, metadata) => {
    const module = await loadCardReaderModule();
    return module.compareCardReaders(markdown, metadata);
  });
  const project = options.project || (async (markdown) => {
    const module = await loadCardReaderModule();
    return module.projectCardDocument(markdown);
  });

  function readGeneration(value) {
    const generationId = numericGenerationId(value);
    const generation = dbService.getGenerationById(generationId);
    if (!generation) {
      throw cardReaderError('CARD_READER_SHADOW_GENERATION_NOT_FOUND', 'Generation not found', 404);
    }
    const markdown = String(generation.markdown_content || '');
    if (Array.from(markdown).length > maxMarkdownChars) {
      throw cardReaderError('CARD_READER_SHADOW_SOURCE_TOO_LARGE', 'Card Markdown exceeds the reader limit', 413);
    }
    return { generationId, generation, markdown };
  }

  return {
    async compareGeneration(value) {
      const { generationId, generation, markdown } = readGeneration(value);
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
    async readCanaryGeneration(value) {
      const { generationId, generation, markdown } = readGeneration(value);
      if (!canaryGenerationIds.has(generationId)) {
        throw cardReaderError('CARD_READER_V3_CANARY_NOT_ALLOWLISTED', 'Generation is not in the Card Reader v3 Canary', 404);
      }
      if (generation.card_type !== 'trilingual') {
        throw cardReaderError('CARD_READER_V3_CANARY_CARD_TYPE_UNSUPPORTED', 'Only trilingual cards are supported in CR-P2', 409);
      }
      const report = await compare(markdown, {
        generationId,
        cardType: generation.card_type,
        sourceContentHash: generation.content_hash,
      });
      if (!report.parity) {
        throw cardReaderError('CARD_READER_V3_CANARY_PARITY_FAILED', 'Card Reader v3 parity gate failed', 409);
      }
      const document = await project(markdown);
      if (document.diagnostics.length > 0) {
        throw cardReaderError('CARD_READER_V3_CANARY_DIAGNOSTICS_PRESENT', 'Card Reader v3 diagnostics require v2 fallback', 409);
      }
      log.info({ generationId, cardType: generation.card_type }, 'card reader v3 canary document served');
      return {
        version: 'card-reader-canary-v1',
        rendererVersion: 3,
        generationId,
        cardType: generation.card_type,
        sourceContentHash: generation.content_hash,
        document,
      };
    },
  };
}

module.exports = {
  createCardReaderShadowService,
  numericGenerationId,
};
