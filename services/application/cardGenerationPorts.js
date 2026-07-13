'use strict';

const { PerformanceMonitor } = require('../observability/observabilityService');
const { renderHtmlFromMarkdown, prepareMarkdownForCard } = require('../generation/htmlRenderer');
const { postProcessGeneratedContent } = require('../generation/contentPostProcessor');
const { saveGeneratedFiles } = require('../storage/fileManager');
const { generateAudioBatch } = require('../generation/ttsService');
const { generateWithProvider } = require('../generation/cardGenerationService');
const dbService = require('../storage/databaseService');
const { prepareInsertData } = require('../storage/databaseHelpers');
const { buildE2EGenerateResult } = require('../../lib/e2eFixtures');
const {
  validateGeneratedContent,
  normalizeAudioTasks,
  resolveCardAudioTasks,
  buildPersistedAudioTasks,
} = require('../../lib/generationHelpers');
const {
  DEFAULT_DEEPSEEK_MODEL,
  E2E_TEST_MODE,
  normalizeCardType,
  normalizeSourceMode,
} = require('../../lib/serverConfig');
const log = require('../../lib/logger').child({ module: 'app/card-generation' });

const ACTIVE_GENERATE_PROVIDER = 'deepseek';

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
  saveGeneratedFiles,
  hasTtsEndpoint: () => Boolean(process.env.TTS_EN_ENDPOINT || process.env.TTS_JA_ENDPOINT),
  normalizeAudioTasks,
  generateAudioBatch,
  buildPersistedAudioTasks,
  prepareInsertData,
  insertGeneration: (data) => dbService.insertGeneration(data),
  insertError: (data) => dbService.insertError(data),
  normalizeCardType,
  normalizeSourceMode,
};

module.exports = { cardGenerationPorts, ACTIVE_GENERATE_PROVIDER };
