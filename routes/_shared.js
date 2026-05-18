'use strict';

// Flat re-export of every service / lib symbol the route modules may touch.
// Each route file destructures just the names it uses. Centralising the
// requires here keeps the route modules to a single, uniform import line.

const { buildPrompt, buildMarkdownPrompt } = require('../services/promptEngine');
const geminiService = require('../services/geminiService');
const { runGeminiCli } = require('../services/geminiCliService');
const { runGeminiProxy } = require('../services/geminiProxyService');
const localLlmService = require('../services/localLlmService');
const tesseractOcrService = require('../services/tesseractOcrService');
const {
  saveGeneratedFiles,
  buildBaseName,
  ensureTodayDirectory,
  ensureFolderDirectory,
  deleteRecordFiles,
} = require('../services/fileManager');
const { generateAudioBatch } = require('../services/ttsService');
const { renderHtmlFromMarkdown, buildAudioTasksFromMarkdown, prepareMarkdownForCard } = require('../services/htmlRenderer');
const { postProcessGeneratedContent } = require('../services/contentPostProcessor');
const geminiAuthService = require('../services/geminiAuthService');
const goldenExamplesService = require('../services/goldenExamplesService');
const fewShotMetricsService = require('../services/fewShotMetricsService');
const experimentTrackingService = require('../services/experimentTrackingService');
const exampleReviewService = require('../services/exampleReviewService');
const knowledgeJobService = require('../services/knowledgeJobService');
const generationJobService = require('../services/generationJobService');
const trainingPackService = require('../services/trainingPackService');
const { normalizeAudioExtension, stripKnownAudioExtension } = require('../services/audioFormat');
const { TokenCounter, PerformanceMonitor, QualityChecker, PromptParser } = require('../services/observabilityService');
const { HealthCheckService } = require('../services/healthCheckService');
const dbService = require('../services/databaseService');
const { prepareInsertData } = require('../services/databaseHelpers');
const serverConfig = require('../lib/serverConfig');
const { checkGenerateThrottle } = require('../lib/throttle');
const {
  buildE2ETrainingResult,
  buildE2EGenerateResult,
  getE2EKnowledgeJob,
  listE2EKnowledgeJobs,
  createE2EKnowledgeJob,
  cancelE2EKnowledgeJob,
} = require('../lib/e2eFixtures');
const { buildTrainingSidecarPath } = require('../lib/trainingSidecar');
const {
  persistTrainingAssetRecord,
  generateAndPersistTrainingAsset,
  summarizeTrainingAsset,
  backfillTrainingAssets,
} = require('../services/trainingAssetService');
const {
  generateWithProvider,
  generateWithAutoFallback,
} = require('../services/cardGenerationService');
const { validateGeneratedContent, normalizeAudioTasks } = require('../lib/generationHelpers');

module.exports = {
  buildPrompt,
  buildMarkdownPrompt,
  geminiService,
  runGeminiCli,
  runGeminiProxy,
  localLlmService,
  tesseractOcrService,
  saveGeneratedFiles,
  buildBaseName,
  ensureTodayDirectory,
  ensureFolderDirectory,
  deleteRecordFiles,
  generateAudioBatch,
  renderHtmlFromMarkdown,
  buildAudioTasksFromMarkdown,
  prepareMarkdownForCard,
  postProcessGeneratedContent,
  geminiAuthService,
  goldenExamplesService,
  fewShotMetricsService,
  experimentTrackingService,
  exampleReviewService,
  knowledgeJobService,
  generationJobService,
  trainingPackService,
  normalizeAudioExtension,
  stripKnownAudioExtension,
  TokenCounter,
  PerformanceMonitor,
  QualityChecker,
  PromptParser,
  HealthCheckService,
  dbService,
  prepareInsertData,
  // lib/serverConfig
  PORT: serverConfig.PORT,
  RECORDS_PATH: serverConfig.RECORDS_PATH,
  DEFAULT_LLM_PROVIDER: serverConfig.DEFAULT_LLM_PROVIDER,
  TRAINING_TEACHER_MODEL: serverConfig.TRAINING_TEACHER_MODEL,
  DEFAULT_GEMINI_MODEL: serverConfig.DEFAULT_GEMINI_MODEL,
  E2E_TEST_MODE: serverConfig.E2E_TEST_MODE,
  toNumberOr: serverConfig.toNumberOr,
  createExperimentId: serverConfig.createExperimentId,
  normalizeLlmProvider: serverConfig.normalizeLlmProvider,
  resolveTrackingModel: serverConfig.resolveTrackingModel,
  normalizeCardType: serverConfig.normalizeCardType,
  normalizeSourceMode: serverConfig.normalizeSourceMode,
  sanitizeGeminiModelName: serverConfig.sanitizeGeminiModelName,
  resolveGeminiModel: serverConfig.resolveGeminiModel,
  checkGenerateThrottle,
  buildE2ETrainingResult,
  buildE2EGenerateResult,
  getE2EKnowledgeJob,
  listE2EKnowledgeJobs,
  createE2EKnowledgeJob,
  cancelE2EKnowledgeJob,
  buildTrainingSidecarPath,
  persistTrainingAssetRecord,
  generateAndPersistTrainingAsset,
  summarizeTrainingAsset,
  backfillTrainingAssets,
  generateWithProvider,
  generateWithAutoFallback,
  validateGeneratedContent,
  normalizeAudioTasks,
};
