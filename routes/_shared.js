'use strict';

// Flat re-export of every service / lib symbol the route modules may touch.
// Each route file destructures just the names it uses. Centralising the
// requires here keeps the route modules to a single, uniform import line.

const { buildPrompt, buildMarkdownPrompt } = require('../services/generation/promptEngine');
const geminiService = require('../services/llm/geminiService');
const { runGeminiCli } = require('../services/llm/geminiCliService');
const { runGeminiProxy } = require('../services/llm/geminiProxyService');
const localLlmService = require('../services/llm/localLlmService');
const tesseractOcrService = require('../services/ocr/tesseractOcrService');
const {
  saveGeneratedFiles,
  buildBaseName,
  ensureTodayDirectory,
  ensureFolderDirectory,
  deleteRecordFiles,
} = require('../services/storage/fileManager');
const { generateAudioBatch } = require('../services/generation/ttsService');
const { renderHtmlFromMarkdown, buildAudioTasksFromMarkdown, prepareMarkdownForCard } = require('../services/generation/htmlRenderer');
const { postProcessGeneratedContent } = require('../services/generation/contentPostProcessor');
const geminiAuthService = require('../services/llm/geminiAuthService');
const knowledgeJobService = require('../services/knowledge/knowledgeJobService');
const generationJobService = require('../services/generation/generationJobService');
const { normalizeAudioExtension, stripKnownAudioExtension } = require('../services/generation/audioFormat');
const { TokenCounter, PerformanceMonitor, QualityChecker, PromptParser } = require('../services/observability/observabilityService');
const { HealthCheckService } = require('../services/observability/healthCheckService');
const dbService = require('../services/storage/databaseService');
const { prepareInsertData } = require('../services/storage/databaseHelpers');
const serverConfig = require('../lib/serverConfig');
const { checkGenerateThrottle } = require('../lib/throttle');
const {
  buildE2EGenerateResult,
  getE2EKnowledgeJob,
  listE2EKnowledgeJobs,
  createE2EKnowledgeJob,
  cancelE2EKnowledgeJob,
} = require('../lib/e2eFixtures');
const {
  generateWithProvider,
  generateWithAutoFallback,
} = require('../services/generation/cardGenerationService');
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
  knowledgeJobService,
  generationJobService,
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
  DEFAULT_GEMINI_MODEL: serverConfig.DEFAULT_GEMINI_MODEL,
  E2E_TEST_MODE: serverConfig.E2E_TEST_MODE,
  toNumberOr: serverConfig.toNumberOr,
  normalizeLlmProvider: serverConfig.normalizeLlmProvider,
  normalizeCardType: serverConfig.normalizeCardType,
  normalizeSourceMode: serverConfig.normalizeSourceMode,
  sanitizeGeminiModelName: serverConfig.sanitizeGeminiModelName,
  resolveGeminiModel: serverConfig.resolveGeminiModel,
  checkGenerateThrottle,
  buildE2EGenerateResult,
  getE2EKnowledgeJob,
  listE2EKnowledgeJobs,
  createE2EKnowledgeJob,
  cancelE2EKnowledgeJob,
  generateWithProvider,
  generateWithAutoFallback,
  validateGeneratedContent,
  normalizeAudioTasks,
};
