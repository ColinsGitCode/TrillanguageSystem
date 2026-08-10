'use strict';

const dbService = require('../storage/databaseService');
const deepseekService = require('../llm/deepseekService');
const {
  locateJapaneseSegments,
  stripMarkdownToJapaneseText,
} = require('../pronunciation/pronunciationService');
const {
  LANGUAGE_METADATA_ENABLED,
  LANGUAGE_METADATA_EXTRACTION_ENABLED,
  LANGUAGE_METADATA_TIMEOUT_MS,
} = require('../../lib/serverConfig');
const log = require('../../lib/logger').child({ module: 'svc/language-metadata' });
const { createLanguageMetadataExtractionService } = require('./application/extractionService');
const jobService = require('./languageMetadataJobService');

const extractionService = createLanguageMetadataExtractionService({
  dbService,
  llm: deepseekService,
  locateSegments: (markdown) => locateJapaneseSegments(
    markdown,
    stripMarkdownToJapaneseText(markdown)
  ),
  log,
  enabled: LANGUAGE_METADATA_ENABLED,
  extractionEnabled: LANGUAGE_METADATA_EXTRACTION_ENABLED,
  timeoutMs: LANGUAGE_METADATA_TIMEOUT_MS,
});

jobService.configureProcessor((job) => extractionService.processClaimedJob(job));

function enqueueGeneration(generationId) {
  const result = extractionService.enqueueForGeneration(generationId);
  if (result.status === 'queued') jobService.notifyNewJob();
  return result;
}

module.exports = {
  bootstrap: () => jobService.bootstrap(),
  enqueueGeneration,
  extractionService,
  jobService,
  shutdown: (options) => jobService.shutdown(options),
};
