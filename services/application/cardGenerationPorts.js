'use strict';

const { PerformanceMonitor } = require('../observability/observabilityService');
const { renderHtmlFromMarkdown, prepareMarkdownForCard } = require('../generation/htmlRenderer');
const { postProcessGeneratedContent } = require('../generation/contentPostProcessor');
const {
  cleanupGenerationArtifacts,
  createGenerationStagingArea,
  publishStagedGeneration,
  saveGeneratedFiles,
} = require('../storage/fileManager');
const { generateAudioBatch } = require('../generation/ttsService');
const { generateWithProvider } = require('../generation/cardGenerationService');
const dbService = require('../storage/databaseService');
const {
  createPronunciationService,
  locateJapaneseSegments,
  stripMarkdownToJapaneseText,
} = require('../pronunciation/pronunciationService');
const {
  createLanguageMetadataExtractionService,
} = require('../languageMetadata/application/extractionService');
const deepseekService = require('../llm/deepseekService');
const {
  LANGUAGE_METADATA_ENABLED,
  LANGUAGE_METADATA_EXTRACTION_ENABLED,
} = require('../../lib/serverConfig');

// JLM-A0: shadow only. Both flags default off, so by default this service is
// constructed but never issues a call and never writes a row.
const languageMetadataExtractionService = createLanguageMetadataExtractionService({
  dbService,
  llm: deepseekService,
  locateSegments: (markdown) => locateJapaneseSegments(
    markdown,
    stripMarkdownToJapaneseText(markdown)
  ),
  log: require('../../lib/logger').child({ module: 'svc/language-metadata' }),
  enabled: LANGUAGE_METADATA_ENABLED,
  extractionEnabled: LANGUAGE_METADATA_EXTRACTION_ENABLED,
});
const { prepareInsertData } = require('../storage/databaseHelpers');
const { buildE2EGenerateResult } = require('../../lib/e2eFixtures');
const { buildAdmissionTags } = require('../dataPreparation/cardTagging');
const {
  assertDuplicatePolicy,
  validateCardAdmission,
  validatePersistedAdmission,
} = require('./cardAdmission');
const {
  validateGeneratedContent,
  normalizeAudioTasks,
  resolveCardAudioTasks,
  buildPersistedAudioTasks,
} = require('../../lib/generationHelpers');
const {
  DEFAULT_DEEPSEEK_MODEL,
  E2E_TEST_MODE,
  PRONUNCIATION_LEGACY_RUBY_READER_ENABLED,
  normalizeCardType,
  normalizeSourceMode,
} = require('../../lib/serverConfig');
const log = require('../../lib/logger').child({ module: 'app/card-generation' });

const ACTIVE_GENERATE_PROVIDER = 'deepseek';
const pronunciationService = createPronunciationService({
  dbService,
  legacyReaderEnabled: PRONUNCIATION_LEGACY_RUBY_READER_ENABLED,
});

const cardGenerationPorts = {
  activeProvider: ACTIVE_GENERATE_PROVIDER,
  defaultModel: DEFAULT_DEEPSEEK_MODEL,
  e2eTestMode: E2E_TEST_MODE,
  log,
  createPerformanceMonitor: () => new PerformanceMonitor().start(),
  buildFixtureResult: buildE2EGenerateResult,
  generateWithProvider,
  postProcessGeneratedContent,
  validateGeneratedContent,
  resolveCardAudioTasks,
  prepareMarkdownForCard,
  renderHtmlFromMarkdown,
  createGenerationStagingArea,
  saveGeneratedFiles,
  publishStagedGeneration,
  cleanupGenerationArtifacts,
  hasTtsEndpoint: () => Boolean(process.env.TTS_EN_ENDPOINT || process.env.TTS_JA_ENDPOINT),
  normalizeAudioTasks,
  generateAudioBatch,
  buildPersistedAudioTasks,
  buildAdmissionTags,
  validateCardAdmission,
  validatePersistedAdmission,
  assertDuplicatePolicy,
  prepareInsertData,
  insertGeneration: (data) => dbService.insertGeneration(data),
  persistPronunciation: (generationId) => pronunciationService.ensureGeneration(generationId),
  extractLanguageMetadata: (generationId) => languageMetadataExtractionService
    .extractForGeneration(generationId),
  deleteGeneration: (generationId) => dbService.deleteGeneration(generationId),
  getGenerationById: (generationId) => dbService.getGenerationById(generationId),
  listCardTags: (generationId) => dbService.listCardTags(generationId, { includeSuppressed: true }),
  findDuplicateGenerations: (phrase, cardType) => dbService.findDuplicateGenerations(phrase, cardType),
  insertError: (data) => dbService.insertError(data),
  normalizeCardType,
  normalizeSourceMode,
};

module.exports = { cardGenerationPorts, ACTIVE_GENERATE_PROVIDER };
