// server.js (Partial Update)
const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { buildPrompt, buildMarkdownPrompt } = require('./services/promptEngine');
const geminiService = require('./services/geminiService');
const { runGeminiCli } = require('./services/geminiCliService');
const { runGeminiProxy } = require('./services/geminiProxyService');
const localLlmService = require('./services/localLlmService');
const tesseractOcrService = require('./services/tesseractOcrService');
const { saveGeneratedFiles, buildBaseName, ensureTodayDirectory, ensureFolderDirectory, deleteRecordFiles } = require('./services/fileManager');
const { generateAudioBatch } = require('./services/ttsService');
const { renderHtmlFromMarkdown, buildAudioTasksFromMarkdown, prepareMarkdownForCard } = require('./services/htmlRenderer');
const { postProcessGeneratedContent } = require('./services/contentPostProcessor');
const geminiAuthService = require('./services/geminiAuthService');
const goldenExamplesService = require('./services/goldenExamplesService');
const fewShotMetricsService = require('./services/fewShotMetricsService');
const experimentTrackingService = require('./services/experimentTrackingService');
const exampleReviewService = require('./services/exampleReviewService');
const knowledgeJobService = require('./services/knowledgeJobService');
const generationJobService = require('./services/generationJobService');
const trainingPackService = require('./services/trainingPackService');
const { buildFixtureContent, buildFixtureObservability, buildTrainingPayload } = require('./services/e2eFixtureService');
const crypto = require('crypto');

const { TokenCounter, PerformanceMonitor, QualityChecker, PromptParser } = require('./services/observabilityService');
const { HealthCheckService } = require('./services/healthCheckService');

// 数据库服务
const dbService = require('./services/databaseService');
const { prepareInsertData } = require('./services/databaseHelpers');

const app = express();
const PORT = process.env.PORT || 3010;
const RECORDS_PATH = process.env.RECORDS_PATH || '/data/trilingual_records';
const DEFAULT_LLM_PROVIDER = String(process.env.DEFAULT_LLM_PROVIDER || 'gemini').trim().toLowerCase() === 'local'
    ? 'local'
    : 'gemini';
const DEFAULT_GEMINI_MODEL = process.env.GEMINI_PROXY_MODEL || process.env.GEMINI_CLI_MODEL || process.env.GEMINI_MODEL || 'gemini-3-pro-preview';
const E2E_TEST_MODE = /^(1|true|yes|on)$/i.test(String(process.env.E2E_TEST_MODE || '').trim());
const e2eKnowledgeJobs = {
    nextId: 1,
    jobs: [],
    timers: new Map()
};
const e2eGenerationAttempts = new Map();

app.use(express.static('public'));
app.use('/data', express.static(RECORDS_PATH));
app.use(express.json({ limit: '10mb' }));

// ... (Keep existing throttle logic and helper functions)
const GENERATE_MIN_INTERVAL_MS = 4000;
const generationThrottle = new Map();
function checkGenerateThrottle(req) {
    if (E2E_TEST_MODE) {
        return { allowed: true, retryAfterMs: 0 };
    }
    const key = req.ip || 'unknown';
    const now = Date.now();
    const last = generationThrottle.get(key) || 0;
    const elapsed = now - last;
    if (elapsed < GENERATE_MIN_INTERVAL_MS) {
        return {
            allowed: false,
            retryAfterMs: GENERATE_MIN_INTERVAL_MS - elapsed
        };
    }
    generationThrottle.set(key, now);
    return { allowed: true, retryAfterMs: 0 };
}

function createExperimentId() {
    return `exp_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

function normalizeLlmProvider(value) {
    return String(value || DEFAULT_LLM_PROVIDER).trim().toLowerCase() === 'local'
        ? 'local'
        : 'gemini';
}

function resolveTrackingModel(provider, modelOverride = '') {
    const normalizedProvider = normalizeLlmProvider(provider);
    const explicitModel = String(modelOverride || '').trim();
    if (explicitModel) return explicitModel;
    return normalizedProvider === 'local'
        ? (process.env.LLM_MODEL || 'local-llm')
        : DEFAULT_GEMINI_MODEL;
}

function resolveRecordMarkdownContent(record) {
    const inlineMarkdown = String(record?.markdown_content || '').trim();
    if (inlineMarkdown) return inlineMarkdown;
    const mdPath = String(record?.md_file_path || '').trim();
    if (!mdPath) return '';
    try {
        if (fs.existsSync(mdPath)) {
            return fs.readFileSync(mdPath, 'utf-8');
        }
    } catch (err) {
        console.warn('[Training] Failed to read markdown file for backfill:', mdPath, err.message);
    }
    return '';
}

function truncateExamplesForBudget(examples, outputMode, maxChars) {
    if (!Array.isArray(examples)) return [];
    return examples.map((ex) => {
        const outputText = String(ex.output || '');
        if (outputMode === 'markdown') {
            if (outputText.length <= maxChars) return ex;
            return { ...ex, output: `${outputText.slice(0, maxChars)}...` };
        }

        try {
            const parsed = JSON.parse(outputText);
            if (parsed && typeof parsed === 'object') {
                const markdown = String(parsed.markdown_content || '');
                if (markdown.length > maxChars) {
                    parsed.markdown_content = `${markdown.slice(0, maxChars)}...`;
                }
                return { ...ex, output: JSON.stringify(parsed, null, 2) };
            }
        } catch (err) {
            // fall through to raw truncation
        }

        if (outputText.length <= maxChars) return ex;
        return { ...ex, output: `${outputText.slice(0, maxChars)}...` };
    });
}

function toNumberOr(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function looksLikeGateway18888(url) {
  try {
    const parsed = new URL(url);
    return parsed.port === '18888';
  } catch (err) {
    return false;
  }
}

function buildGeminiGatewayHealthUrl() {
  const apiUrl = process.env.GEMINI_PROXY_URL || 'http://host.docker.internal:18888/api/gemini';
  if (!looksLikeGateway18888(apiUrl)) return '';
  try {
    const parsed = new URL(apiUrl);
    parsed.pathname = '/health';
    parsed.search = '';
    return parsed.toString();
  } catch (err) {
    return '';
  }
}

function shouldWaitForGatewayRecovery(trainingAsset) {
  if (!trainingAsset || trainingAsset.status !== 'fallback') return false;
  const text = [
    trainingAsset.fallbackReason || '',
    ...(Array.isArray(trainingAsset.validationErrors) ? trainingAsset.validationErrors : [])
  ].join(' ');
  return /circuit breaker is open|breaker open|upstream_unavailable|timeout|timed out|aborterror/i.test(text);
}

async function waitForGeminiGatewayRecovery() {
  const healthUrl = buildGeminiGatewayHealthUrl();
  if (!healthUrl) {
    return { ok: false, skipped: true, reason: 'no_gateway_health_url' };
  }

  const timeoutMs = toNumberOr(process.env.TRAINING_BACKFILL_GATEWAY_RECOVERY_TIMEOUT_MS, 20000);
  const pollMs = toNumberOr(process.env.TRAINING_BACKFILL_GATEWAY_RECOVERY_POLL_MS, 2000);
  const deadline = Date.now() + timeoutMs;
  let lastState = 'unknown';

  while (Date.now() < deadline) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(3000, pollMs));
    try {
      const response = await fetch(healthUrl, { signal: controller.signal });
      if (response.ok) {
        const payload = await response.json().catch(() => ({}));
        lastState = String(payload.breaker_state || 'unknown');
        const inflight = Number(payload.inflight || 0);
        if (lastState === 'closed' && inflight === 0) {
          return { ok: true, state: lastState, inflight };
        }
      }
    } catch (err) {
      lastState = err?.name === 'AbortError' ? 'health_timeout' : String(err.message || 'health_error');
    } finally {
      clearTimeout(timer);
    }
    await sleep(pollMs);
  }

  return { ok: false, state: lastState, timeoutMs };
}

async function getGeminiGatewayHealth() {
  const healthUrl = buildGeminiGatewayHealthUrl();
  if (!healthUrl) {
    return { ok: false, skipped: true, reason: 'no_gateway_health_url' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(healthUrl, { signal: controller.signal });
    if (!response.ok) {
      return { ok: false, state: `http_${response.status}` };
    }
    const payload = await response.json().catch(() => ({}));
    return {
      ok: true,
      state: String(payload.breaker_state || 'unknown'),
      inflight: Number(payload.inflight || 0),
      busy: Boolean(payload.busy)
    };
  } catch (err) {
    return { ok: false, state: err?.name === 'AbortError' ? 'health_timeout' : String(err.message || 'health_error') };
  } finally {
    clearTimeout(timer);
  }
}

function buildTrainingFallbackResult({ phrase, cardType, markdown, reason, latencyMs = 0, validationErrors = [] }) {
  const fallback = trainingPackService.fallbackHeuristicPack({ phrase, cardType, markdown });
  return {
    status: fallback.ok ? 'fallback' : 'failed',
    source: 'heuristic',
    payload: fallback.ok ? fallback.payload : null,
    qualityScore: fallback.ok ? fallback.qualityScore : 0,
    coverageScore: fallback.ok ? fallback.coverageScore : 0,
    selfConfidence: fallback.ok ? fallback.selfConfidence : 0,
    validationErrors,
    fallbackReason: reason || 'heuristic_fallback',
    providerUsed: 'gemini',
    modelUsed: process.env.TRAINING_TEACHER_MODEL || process.env.GEMINI_PROXY_MODEL || 'gemini-3-pro-preview',
    promptVersion: trainingPackService.TRAINING_PROMPT_VERSION,
    schemaVersion: trainingPackService.TRAINING_SCHEMA_VERSION,
    tokensInput: 0,
    tokensOutput: 0,
    tokensTotal: 0,
    costTotal: 0,
    latencyMs,
    rawOutput: ''
  };
}

function persistTrainingAssetRecord(context = {}, trainingResult) {
  const generationId = Number(context.generationId || 0);
  const phrase = String(context.phrase || '').trim();
  const folderName = String(context.folderName || '').trim();
  const baseName = String(context.baseName || '').trim();
  const cardType = normalizeCardType(context.cardType);
  const targetDir = String(context.targetDir || '').trim();
  const sidecarPath = buildTrainingSidecarPath(targetDir, baseName);
  const sidecarPayload = buildTrainingSidecarPayload(trainingResult, {
    generationId,
    phrase,
    folderName,
    baseName,
    cardType
  });
  persistTrainingSidecar(sidecarPath, sidecarPayload);

  return dbService.upsertCardTrainingAsset({
    generationId,
    folderName,
    baseFilename: baseName,
    cardType,
    status: trainingResult.status,
    source: trainingResult.source,
    providerUsed: trainingResult.providerUsed,
    modelUsed: trainingResult.modelUsed,
    promptVersion: trainingResult.promptVersion,
    schemaVersion: trainingResult.schemaVersion,
    qualityScore: trainingResult.qualityScore,
    selfConfidence: trainingResult.selfConfidence,
    coverageScore: trainingResult.coverageScore,
    validationErrors: trainingResult.validationErrors || [],
    fallbackReason: trainingResult.fallbackReason || null,
    tokensInput: trainingResult.tokensInput || 0,
    tokensOutput: trainingResult.tokensOutput || 0,
    tokensTotal: trainingResult.tokensTotal || 0,
    costTotal: trainingResult.costTotal || 0,
    latencyMs: trainingResult.latencyMs || 0,
    payload: trainingResult.payload || null,
    sidecarFilePath: sidecarPath
  });
}

function normalizeAudioTasks(tasks, baseName) {
  if (!Array.isArray(tasks)) return [];
  return tasks.map((task, index) => {
    const normalized = { ...task };
    let suffix = String(normalized.filename_suffix || '');
    if (baseName && suffix.includes(baseName)) {
      suffix = suffix.replace(baseName, '');
    }
    suffix = suffix.replace(/\.(wav|mp3|m4a)$/i, '');
    if (!suffix.trim()) {
      suffix = `_${normalized.lang || 'en'}_${index + 1}`;
    }
    normalized.filename_suffix = suffix;
    return normalized;
  });
}

function validateGeneratedContent(content, options = {}) {
    const errors = [];
    if (!content || typeof content !== 'object') {
        errors.push('Response is not a valid JSON object');
        return errors;
    }
    if (typeof content.markdown_content !== 'string' || !content.markdown_content.trim()) {
        errors.push('markdown_content is missing or empty');
    }
    // Strict HTML check if required (skipped for local render mode)
    if (!options.allowMissingHtml && (!content.html_content || !content.html_content.includes('<html'))) {
        // errors.push('html_content is invalid'); // Relaxed for now as we render locally
    }
    return errors;
}

function extractGeminiMarkdownResponse(response) {
    if (!response || typeof response !== 'object') return '';
    return String(response.markdown || response.rawOutput || '').trim();
}

function validateSanitizedGeminiCardResponse(response, cardType = 'trilingual') {
    const markdown = extractGeminiMarkdownResponse(response);
    if (!markdown) return false;
    if (/MCP issues detected|Run\s+\/mcp\s+list\s+for\s+status|\/mcp list/i.test(markdown)) {
        return false;
    }

    const requiredSections = cardType === 'grammar_ja'
        ? ['## 1. 语法概述', '## 2. 日本語', '## 3. 常见误用']
        : ['## 1. 英文', '## 2. 日本語', '## 3. 中文'];
    if (!requiredSections.every((section) => markdown.includes(section))) {
        return false;
    }

    const audioTasks = buildAudioTasksFromMarkdown(markdown);
    const minAudioTasks = cardType === 'grammar_ja' ? 3 : 4;
    return audioTasks.length >= minAudioTasks;
}

function sanitizeGeminiModelName(modelName) {
    const model = String(modelName || '').trim();
    if (!model) return '';
    const lowered = model.toLowerCase();
    // These aliases are internal labels, not real Gemini model ids.
    if (lowered === 'gemini-cli' || lowered === 'cli' || lowered === 'default') return '';
    return model;
}

function resolveGeminiModel(mode, modelOverride) {
    const candidates = mode === 'host-proxy'
        ? [modelOverride, process.env.GEMINI_PROXY_MODEL, process.env.GEMINI_CLI_MODEL, process.env.GEMINI_MODEL]
        : [modelOverride, process.env.GEMINI_CLI_MODEL, process.env.GEMINI_MODEL];

    for (const candidate of candidates) {
        const sanitized = sanitizeGeminiModelName(candidate);
        if (sanitized) return sanitized;
    }
    return '';
}

function normalizeCardType(cardType) {
    const normalized = String(cardType || 'trilingual').trim().toLowerCase();
    return normalized === 'grammar_ja' ? 'grammar_ja' : 'trilingual';
}

function normalizeSourceMode(sourceMode) {
  const normalized = String(sourceMode || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'selection') return 'selection';
  if (normalized === 'input') return 'input';
  if (normalized === 'ocr') return 'ocr';
  return normalized;
}

async function executeGenerationJobViaHttp(job) {
  const payload = {
    phrase: job.phraseNormalized,
    llm_provider: normalizeLlmProvider(job.provider),
    enable_compare: Boolean(job.enableCompare),
    card_type: normalizeCardType(job.jobType),
    source_mode: normalizeSourceMode(job.sourceMode),
    target_folder: job.targetFolder || '',
    llm_model: job.llmModel || undefined
  };

  const response = await fetch(`http://127.0.0.1:${PORT}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Generation-Job-Worker': '1'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error || `generation job http ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

function buildE2ETrainingResult({ phrase, cardType }) {
  const payload = buildTrainingPayload(phrase, cardType);
  return {
    status: 'ready',
    source: 'llm',
    payload,
    qualityScore: 100,
    coverageScore: 1,
    selfConfidence: 1,
    validationErrors: [],
    fallbackReason: null,
    providerUsed: 'gemini',
    modelUsed: 'e2e-fixture',
    promptVersion: 'e2e_fixture_v1',
    schemaVersion: trainingPackService.TRAINING_SCHEMA_VERSION,
    tokensInput: 0,
    tokensOutput: 0,
    tokensTotal: 0,
    costTotal: 0,
    latencyMs: 0,
    rawOutput: ''
  };
}

function buildE2EGenerateResult({ phrase, cardType, requestedProvider, sourceMode }) {
  const safePhrase = String(phrase || '').trim();
  if (safePhrase.includes('__E2E_ALWAYS_FAIL__')) {
    const error = new Error('e2e_fixture_forced_failure');
    error.status = 503;
    throw error;
  }
  if (safePhrase.includes('__E2E_FAIL_ONCE__')) {
    const key = `fail_once:${safePhrase}`;
    const attempt = Number(e2eGenerationAttempts.get(key) || 0) + 1;
    e2eGenerationAttempts.set(key, attempt);
    if (attempt === 1) {
      const error = new Error('e2e_fixture_forced_retryable_failure');
      error.status = 503;
      throw error;
    }
  }

  const content = buildFixtureContent({ phrase, cardType });
  const observability = buildFixtureObservability({
    provider: requestedProvider,
    model: 'e2e-fixture',
    phrase,
    cardType,
    sourceMode
  });
  return {
    output: content,
    prompt: `E2E fixture prompt for ${String(phrase || '').trim()}`,
    observability,
    baseName: '',
    targetDir: '',
    folderName: '',
    fewShot: {
      enabled: false,
      examples: [],
      countUsed: 0
    },
    fallback: null
  };
}

function cloneE2EKnowledgeJob(job) {
    return job ? JSON.parse(JSON.stringify(job)) : null;
}

function getE2EKnowledgeJob(jobId) {
    return cloneE2EKnowledgeJob(e2eKnowledgeJobs.jobs.find((job) => Number(job.id) === Number(jobId)) || null);
}

function listE2EKnowledgeJobs(limit = 20) {
    return e2eKnowledgeJobs.jobs
        .slice()
        .sort((a, b) => Number(b.id) - Number(a.id))
        .slice(0, Math.max(1, Number(limit || 20)))
        .map(cloneE2EKnowledgeJob);
}

function clearE2EKnowledgeTimers(jobId) {
    const timers = e2eKnowledgeJobs.timers.get(Number(jobId));
    if (timers) {
        timers.forEach((timer) => clearTimeout(timer));
        e2eKnowledgeJobs.timers.delete(Number(jobId));
    }
}

function scheduleE2EKnowledgeJob(jobId) {
    const runningTimer = setTimeout(() => {
        const job = e2eKnowledgeJobs.jobs.find((item) => Number(item.id) === Number(jobId));
        if (!job || job.status === 'cancelled') return;
        job.status = 'running';
        job.startedAt = job.startedAt || new Date().toISOString();
    }, 80);

    const successTimer = setTimeout(() => {
        const job = e2eKnowledgeJobs.jobs.find((item) => Number(item.id) === Number(jobId));
        if (!job || job.status === 'cancelled') return;
        job.status = 'success';
        job.startedAt = job.startedAt || new Date().toISOString();
        job.doneBatches = 1;
        job.errorBatches = 0;
        job.finishedAt = new Date().toISOString();
        job.resultSummary = {
            task: job.jobType,
            totalCards: 3,
            doneBatches: 1,
            errorBatches: 0,
            quality: {
                confidence: 1,
                coverageRatio: 1
            },
            resultShape: ['summary'],
            synonymStats: null
        };
        clearE2EKnowledgeTimers(jobId);
    }, 4000);

    e2eKnowledgeJobs.timers.set(Number(jobId), [runningTimer, successTimer]);
}

function createE2EKnowledgeJob(payload = {}) {
    const jobId = e2eKnowledgeJobs.nextId++;
    const createdAt = new Date().toISOString();
    const job = {
        id: jobId,
        jobType: String(payload.jobType || 'summary'),
        status: 'queued',
        scope: payload.scope || {},
        batchSize: Math.max(1, Number(payload.batchSize || 50)),
        triggeredBy: String(payload.triggeredBy || 'dashboard'),
        engineVersion: 'e2e-fixture',
        totalBatches: 1,
        doneBatches: 0,
        errorBatches: 0,
        resultSummary: null,
        createdAt,
        startedAt: null,
        finishedAt: null
    };
    e2eKnowledgeJobs.jobs.push(job);
    scheduleE2EKnowledgeJob(jobId);
    return cloneE2EKnowledgeJob(job);
}

function cancelE2EKnowledgeJob(jobId) {
    const job = e2eKnowledgeJobs.jobs.find((item) => Number(item.id) === Number(jobId));
    if (!job) return false;
    if (job.status === 'success' || job.status === 'failed' || job.status === 'cancelled') {
        return cloneE2EKnowledgeJob(job);
    }
    clearE2EKnowledgeTimers(jobId);
    job.status = 'cancelled';
    job.finishedAt = new Date().toISOString();
    return cloneE2EKnowledgeJob(job);
}

function buildTrainingSidecarPath(targetDir, baseName) {
    if (!targetDir || !baseName) return '';
    return path.join(targetDir, `${baseName}.training.v1.json`);
}

function buildTrainingSidecarPayload(trainingAsset, context = {}) {
    return {
        schemaVersion: trainingAsset?.schemaVersion || 'training_pack_v1',
        generatedAt: new Date().toISOString(),
        generationId: Number(context.generationId || trainingAsset?.generationId || 0) || null,
        phrase: String(context.phrase || ''),
        folderName: String(context.folderName || ''),
        baseName: String(context.baseName || ''),
        cardType: String(context.cardType || 'trilingual'),
        status: trainingAsset?.status || 'failed',
        source: trainingAsset?.source || 'heuristic',
        providerUsed: trainingAsset?.providerUsed || 'gemini',
        modelUsed: trainingAsset?.modelUsed || '',
        promptVersion: trainingAsset?.promptVersion || '',
        qualityScore: Number(trainingAsset?.qualityScore || 0),
        coverageScore: Number(trainingAsset?.coverageScore || 0),
        selfConfidence: Number(trainingAsset?.selfConfidence || 0),
        validationErrors: Array.isArray(trainingAsset?.validationErrors) ? trainingAsset.validationErrors : [],
        fallbackReason: trainingAsset?.fallbackReason || null,
        payload: trainingAsset?.payload || null
    };
}

function persistTrainingSidecar(sidecarPath, payload) {
    if (!sidecarPath) return false;
    try {
        fs.writeFileSync(sidecarPath, JSON.stringify(payload, null, 2), 'utf-8');
        return true;
    } catch (err) {
        console.warn('[Training] Failed to write sidecar:', sidecarPath, err.message);
        return false;
    }
}

function summarizeTrainingAsset(trainingAsset) {
    if (!trainingAsset) {
        return {
            status: 'failed',
            source: 'heuristic',
            qualityScore: 0,
            assetId: null
        };
    }
    return {
        status: trainingAsset.status || 'failed',
        source: trainingAsset.source || 'heuristic',
        qualityScore: Number(trainingAsset.qualityScore || 0),
        assetId: Number(trainingAsset.id || 0) || null
    };
}

async function generateAndPersistTrainingAsset(context = {}) {
    const generationId = Number(context.generationId || 0);
    if (!generationId) {
        return {
            status: 'failed',
            source: 'heuristic',
            qualityScore: 0,
            assetId: null,
            reason: 'missing_generation_id'
        };
    }

    const phrase = String(context.phrase || '').trim();
    const cardType = normalizeCardType(context.cardType);
    const markdown = String(context.markdown || '').trim();
    const folderName = String(context.folderName || '').trim();
    const baseName = String(context.baseName || '').trim();
    const targetDir = String(context.targetDir || '').trim();
    if (!phrase || !markdown || !folderName || !baseName) {
        return {
            status: 'failed',
            source: 'heuristic',
            qualityScore: 0,
            assetId: null,
            reason: 'missing_context'
        };
    }

    let trainingResult;
    try {
        trainingResult = await trainingPackService.generateTrainingPack({
            phrase,
            cardType,
            markdown,
            providerHint: 'gemini',
            model: process.env.TRAINING_TEACHER_MODEL || process.env.GEMINI_PROXY_MODEL || 'gemini-3-pro-preview',
            baseName: `${baseName}_train`,
            runtimeMode: context.runtimeMode || 'default'
        });
    } catch (err) {
        trainingResult = buildTrainingFallbackResult({
            phrase,
            cardType,
            markdown,
            reason: 'generate_training_asset_failed',
            validationErrors: [`generate_training_asset_failed: ${err.message}`],
            latencyMs: 0
        });
        console.warn('[Training] generateAndPersistTrainingAsset fallback:', err.message);
    }

    const saved = persistTrainingAssetRecord(context, trainingResult);

    return saved || {
        ...summarizeTrainingAsset(trainingResult),
        generationId
    };
}

async function backfillTrainingAssets(options = {}) {
    const limit = Math.max(1, Math.min(200, Number(options.limit || 20)));
    const force = Boolean(options.force);
    const rawCardType = String(options.cardType || '').trim();
    const filters = {
        limit,
        force,
        folderName: String(options.folderName || '').trim(),
        cardType: rawCardType ? normalizeCardType(rawCardType) : '',
        provider: String(options.provider || '').trim().toLowerCase()
    };

    const candidates = dbService.listTrainingBackfillCandidates(filters);
    const results = [];
    let readyCount = 0;
    let repairedCount = 0;
    let fallbackCount = 0;
    let failedCount = 0;

    for (const candidate of candidates) {
        try {
            const record = dbService.getGenerationById(candidate.id);
            if (!record) {
                results.push({
                    generationId: candidate.id,
                    phrase: candidate.phrase,
                    folderName: candidate.folderName,
                    baseName: candidate.baseFilename,
                    status: 'skipped',
                    reason: 'generation_not_found'
                });
                continue;
            }

            const markdown = resolveRecordMarkdownContent(record);
            if (!markdown) {
                results.push({
                    generationId: record.id,
                    phrase: record.phrase,
                    folderName: record.folder_name,
                    baseName: record.base_filename,
                    status: 'skipped',
                    reason: 'markdown_not_found'
                });
                continue;
            }

            const targetDir = record.md_file_path ? path.dirname(record.md_file_path) : path.join(RECORDS_PATH, record.folder_name);
            let training;
            const gatewayHealth = await getGeminiGatewayHealth();
            const shouldShortCircuit = gatewayHealth.ok && gatewayHealth.state !== 'closed';
            if (shouldShortCircuit) {
                const trainingResult = buildTrainingFallbackResult({
                    phrase: record.phrase,
                    cardType: record.card_type,
                    markdown,
                    reason: `gateway_not_ready_${gatewayHealth.state}`,
                    validationErrors: [`gateway_not_ready: breaker_state=${gatewayHealth.state}, inflight=${gatewayHealth.inflight}`]
                });
                training = persistTrainingAssetRecord({
                    generationId: record.id,
                    phrase: record.phrase,
                    cardType: record.card_type,
                    folderName: record.folder_name,
                    baseName: record.base_filename,
                    targetDir
                }, trainingResult);
            } else {
                training = await generateAndPersistTrainingAsset({
                    generationId: record.id,
                    phrase: record.phrase,
                    cardType: record.card_type,
                    markdown,
                    folderName: record.folder_name,
                    baseName: record.base_filename,
                    targetDir,
                    runtimeMode: 'backfill'
                });
            }

            if (training.status === 'ready') readyCount += 1;
            else if (training.status === 'repaired') repairedCount += 1;
            else if (training.status === 'fallback') fallbackCount += 1;
            else failedCount += 1;

            results.push({
                generationId: record.id,
                phrase: record.phrase,
                folderName: record.folder_name,
                baseName: record.base_filename,
                status: training.status || 'failed',
                source: training.source || 'heuristic',
                qualityScore: Number(training.qualityScore || 0),
                assetId: Number(training.id || training.assetId || 0) || null
            });

            if (!shouldShortCircuit && shouldWaitForGatewayRecovery(training)) {
                const recovery = await waitForGeminiGatewayRecovery();
                console.warn('[Training backfill] gateway recovery wait:', {
                    generationId: record.id,
                    baseName: record.base_filename,
                    recovery
                });
            }
        } catch (err) {
            failedCount += 1;
            results.push({
                generationId: candidate.id,
                phrase: candidate.phrase,
                folderName: candidate.folderName,
                baseName: candidate.baseFilename,
                status: 'failed',
                source: 'heuristic',
                qualityScore: 0,
                assetId: null,
                reason: err.message
            });
            console.warn('[Training backfill] candidate failed:', candidate.id, err.message);
        }
    }

    const summary = dbService.getTrainingBackfillSummary({
        folderName: filters.folderName,
        cardType: filters.cardType,
        provider: filters.provider
    });

    return {
        limit,
        force,
        requestedFilters: {
            folderName: filters.folderName || null,
            cardType: filters.cardType || null,
            provider: filters.provider || null
        },
        processed: results.length,
        readyCount,
        repairedCount,
        fallbackCount,
        failedCount,
        results,
        summary
    };
}

function isGeminiUnavailableError(error) {
    const message = String(error?.message || '');
    return /ModelNotFoundError|Requested entity was not found|Gemini proxy error|Error when talking to Gemini API|API key|quota|permission|429|403|404/i.test(message);
}

async function generateWithAutoFallback(phrase, provider, perf, options = {}) {
    try {
        return await generateWithProvider(phrase, provider, perf, options);
    } catch (error) {
        const fallbackEnabled = typeof options.allowGeminiFallback === 'boolean'
            ? options.allowGeminiFallback
            : String(process.env.GEMINI_FALLBACK_TO_LOCAL || 'false').toLowerCase() === 'true';

        if (provider !== 'gemini' || !fallbackEnabled || !isGeminiUnavailableError(error)) {
            throw error;
        }

        console.warn('[Generate] Gemini unavailable, fallback to local:', error.message);
        const fallbackPerf = new PerformanceMonitor().start();
        const fallbackResult = await generateWithProvider(phrase, 'local', fallbackPerf, {
            ...options,
            modelOverride: null,
            allowGeminiFallback: false
        });

        fallbackResult.fallback = {
            from: 'gemini',
            to: 'local',
            reason: 'gemini_unavailable',
            error: error.message
        };
        fallbackResult.observability.metadata = {
            ...(fallbackResult.observability.metadata || {}),
            requestedProvider: 'gemini',
            fallbackFrom: 'gemini',
            fallbackReason: 'gemini_unavailable',
            fallbackError: error.message
        };
        return fallbackResult;
    }
}

// ========== Core Logic ==========

async function generateWithProvider(phrase, provider, perf, options = {}) {
  let llmService;
  try {
      llmService = provider === 'gemini' ? geminiService : require('./services/localLlmService');
  } catch (e) {
      throw new Error(`Provider ${provider} not available: ${e.message}`);
  }

  perf.mark('promptBuild');
  const cardType = normalizeCardType(options.cardType);
  const sourceMode = normalizeSourceMode(options.sourceMode);
  const { targetDir, folderName } = options.targetFolder
    ? ensureFolderDirectory(options.targetFolder)
    : ensureTodayDirectory();
  const baseName = buildBaseName(phrase, targetDir);
  const geminiMode = (process.env.GEMINI_MODE || 'host-proxy').toLowerCase();
  const localOutputMode = (process.env.LLM_OUTPUT_MODE || 'json').toLowerCase();
  const useGeminiCli = provider === 'gemini' && geminiMode === 'cli';
  const useGeminiProxy = provider === 'gemini' && geminiMode === 'host-proxy';
  const resolvedGeminiCliModel = resolveGeminiModel(geminiMode, options.modelOverride);
  const useLocalMarkdown = provider === 'local' && localOutputMode === 'markdown';
  const useMarkdownOutput = useGeminiCli || useGeminiProxy || useLocalMarkdown;
  let prompt = useMarkdownOutput
      ? buildMarkdownPrompt({ phrase, filenameBase: baseName, cardType })
      : buildPrompt({ phrase, filenameBase: baseName, cardType });

  const reqFewShot = options.fewshotOptions || {};
  const envFewshotEnabled = String(process.env.ENABLE_GOLDEN_EXAMPLES || '').toLowerCase() === 'true';
  const envGeminiFewshotEnabled = String(process.env.ENABLE_GEMINI_FEWSHOT || '').toLowerCase() === 'true';
  const enabledOverride = typeof reqFewShot.enabled === 'boolean' ? reqFewShot.enabled : null;
  const providerFewshotEnabled = provider === 'local'
    ? envFewshotEnabled
    : provider === 'gemini'
      ? envGeminiFewshotEnabled
      : false;
  const providerDefaultCount = provider === 'gemini'
    ? (reqFewShot.count ?? process.env.GEMINI_FEWSHOT_COUNT ?? process.env.GOLDEN_EXAMPLES_COUNT ?? 2)
    : (reqFewShot.count ?? process.env.GOLDEN_EXAMPLES_COUNT ?? 3);
  const providerDefaultMinScore = provider === 'gemini'
    ? (reqFewShot.minScore ?? process.env.GEMINI_FEWSHOT_MIN_SCORE ?? process.env.GOLDEN_EXAMPLES_MIN_SCORE ?? 85)
    : (reqFewShot.minScore ?? process.env.GOLDEN_EXAMPLES_MIN_SCORE ?? 85);
  const providerTokenBudgetRatio = provider === 'gemini'
    ? (reqFewShot.tokenBudgetRatio ?? process.env.GEMINI_FEWSHOT_TOKEN_BUDGET_RATIO ?? process.env.FEWSHOT_TOKEN_BUDGET_RATIO ?? 0.15)
    : (reqFewShot.tokenBudgetRatio ?? process.env.FEWSHOT_TOKEN_BUDGET_RATIO ?? 0.25);
  const providerExampleMaxChars = provider === 'gemini'
    ? (reqFewShot.exampleMaxChars ?? process.env.GEMINI_FEWSHOT_EXAMPLE_MAX_CHARS ?? process.env.GOLDEN_EXAMPLE_MAX_CHARS ?? 700)
    : (reqFewShot.exampleMaxChars ?? process.env.GOLDEN_EXAMPLE_MAX_CHARS ?? 900);
  const reviewGatedDefault = String(process.env.ENABLE_REVIEW_GATED_FEWSHOT || '').toLowerCase() === 'true';
  const fewShotConfig = {
      enabled: cardType === 'trilingual' &&
        (provider === 'local' || provider === 'gemini') &&
        (enabledOverride !== null ? enabledOverride : providerFewshotEnabled),
      strategy: reqFewShot.strategy || process.env.GOLDEN_EXAMPLES_STRATEGY || 'HIGH_QUALITY_GEMINI',
      count: toNumberOr(providerDefaultCount, provider === 'gemini' ? 2 : 3),
      minScore: toNumberOr(providerDefaultMinScore, 85),
      contextWindow: toNumberOr(reqFewShot.contextWindow ?? process.env.LLM_CONTEXT_WINDOW ?? 4096, 4096),
      tokenBudgetRatio: toNumberOr(providerTokenBudgetRatio, provider === 'gemini' ? 0.15 : 0.25),
      exampleMaxChars: toNumberOr(providerExampleMaxChars, provider === 'gemini' ? 700 : 900),
      teacherFirst: reqFewShot.teacherFirst !== false,
      provider: String(reqFewShot.provider || (provider === 'gemini'
        ? process.env.GEMINI_FEWSHOT_PROVIDER || 'gemini'
        : process.env.GOLDEN_EXAMPLES_PROVIDER || 'gemini')).trim().toLowerCase(),
      reviewGated: typeof reqFewShot.reviewGated === 'boolean' ? reqFewShot.reviewGated : reviewGatedDefault,
      reviewOnly: typeof reqFewShot.reviewOnly === 'boolean'
        ? reqFewShot.reviewOnly
        : String(process.env.REVIEW_GATED_FEWSHOT_ONLY || '').toLowerCase() === 'true',
      reviewMinOverall: toNumberOr(reqFewShot.reviewMinOverall ?? process.env.REVIEW_GATE_MIN_OVERALL ?? 4.2, 4.2)
  };

  const basePromptTokens = TokenCounter.estimate(prompt);
  let fewShotMeta = {
      enabled: false,
      strategy: fewShotConfig.strategy,
      countRequested: fewShotConfig.count,
      countUsed: 0,
      minScore: fewShotConfig.minScore,
      contextWindow: fewShotConfig.contextWindow,
      tokenBudgetRatio: fewShotConfig.tokenBudgetRatio,
      exampleMaxChars: fewShotConfig.exampleMaxChars,
      provider: fewShotConfig.provider,
      reviewGated: fewShotConfig.reviewGated,
      reviewOnly: fewShotConfig.reviewOnly,
      reviewMinOverall: fewShotConfig.reviewMinOverall,
      basePromptTokens,
      fewshotPromptTokens: 0,
      totalPromptTokensEst: basePromptTokens,
      fallbackReason: null,
      exampleIds: [],
      examples: []
  };

  if (fewShotConfig.enabled) {
      perf.mark('fewshotSelect');
      const outputMode = useMarkdownOutput ? 'markdown' : 'json';
      let examples = await goldenExamplesService.getRelevantExamples(phrase, fewShotConfig.count, {
          outputMode,
          provider: fewShotConfig.provider,
          minQualityScore: fewShotConfig.minScore,
          experimentId: options.experimentId || '',
          roundNumber: options.experimentRound || 0,
          maxOutputChars: fewShotConfig.exampleMaxChars,
          teacherFirst: fewShotConfig.teacherFirst,
          reviewGated: fewShotConfig.reviewGated,
          reviewOnly: fewShotConfig.reviewOnly,
          reviewMinOverall: fewShotConfig.reviewMinOverall
      });
      let enhancedPrompt = prompt;
      let fallbackReason = null;

      if (!examples.length) {
          fallbackReason = 'no_examples';
      } else {
          examples = truncateExamplesForBudget(examples, outputMode, fewShotConfig.exampleMaxChars);
          enhancedPrompt = goldenExamplesService.buildEnhancedPrompt(prompt, examples);
          let totalTokens = TokenCounter.estimate(enhancedPrompt);
          let fewshotTokens = Math.max(0, totalTokens - basePromptTokens);
          const budget = Math.floor(fewShotConfig.contextWindow * fewShotConfig.tokenBudgetRatio);

          while (fewshotTokens > budget && examples.length > 0) {
              examples = examples.slice(0, -1);
              if (!examples.length) break;
              enhancedPrompt = goldenExamplesService.buildEnhancedPrompt(prompt, examples);
              totalTokens = TokenCounter.estimate(enhancedPrompt);
              fewshotTokens = Math.max(0, totalTokens - basePromptTokens);
              fallbackReason = 'budget_reduction';
          }

          if (examples.length > 0 && fewshotTokens > budget) {
              const perExampleBudget = Math.max(120, Math.floor(budget / examples.length));
              const maxChars = perExampleBudget * 4;
              examples = truncateExamplesForBudget(examples, outputMode, maxChars);
              enhancedPrompt = goldenExamplesService.buildEnhancedPrompt(prompt, examples);
              totalTokens = TokenCounter.estimate(enhancedPrompt);
              fewshotTokens = Math.max(0, totalTokens - basePromptTokens);
              fallbackReason = 'budget_truncate';
          }

          if (fewshotTokens > budget) {
              enhancedPrompt = prompt;
              fewshotTokens = 0;
              totalTokens = basePromptTokens;
              fallbackReason = 'budget_exceeded_disable';
              examples = [];
          }

          prompt = enhancedPrompt;
          fewShotMeta = {
              ...fewShotMeta,
              enabled: examples.length > 0,
              countUsed: examples.length,
              basePromptTokens,
              fewshotPromptTokens: fewshotTokens,
              totalPromptTokensEst: totalTokens,
              fallbackReason,
              exampleIds: examples.map(ex => ex.metadata?.generationId).filter(Boolean),
              examples: examples.map(ex => ({
                  exampleGenerationId: ex.metadata?.generationId,
                  exampleQualityScore: ex.qualityScore,
                  examplePromptHash: null,
                  similarityScore: null
              }))
          };
      }

      if (!fewShotMeta.enabled && !fewShotMeta.fallbackReason) {
          fewShotMeta.fallbackReason = fallbackReason || 'disabled';
      }
  }

  perf.mark('llmCall');
  let response;
  if (useGeminiCli) {
      response = await runGeminiCli(prompt, {
          baseName,
          outputDir: process.env.GEMINI_CLI_OUTPUT_DIR || path.join(RECORDS_PATH, 'cli_suggestions'),
          model: resolvedGeminiCliModel
      });
  } else if (useGeminiProxy) {
      response = await runGeminiProxy(prompt, {
          baseName,
          model: resolvedGeminiCliModel,
          validateSanitizedResponse: (sanitizedResponse) => validateSanitizedGeminiCardResponse(sanitizedResponse, cardType)
      });
  } else {
      // Expecting { content, usage } structure
      response = await llmService.generateContent(prompt);
  }
  
  // Normalize response structure
  let content, usage;
  if (useGeminiCli || useGeminiProxy) {
      const markdown = response.markdown || '';
      const audioTasks = buildAudioTasksFromMarkdown(markdown);
      const preparedMarkdown = await prepareMarkdownForCard(markdown, { baseName, audioTasks });
      const htmlContent = await renderHtmlFromMarkdown(preparedMarkdown, { baseName, audioTasks, prepared: true });
      content = {
          markdown_content: preparedMarkdown,
          html_content: htmlContent,
          audio_tasks: audioTasks
      };
      const inputTokens = TokenCounter.estimate(prompt);
      const outputTokens = TokenCounter.estimate(markdown);
      usage = { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens };
  } else if (response.content && response.usage) {
      content = response.content;
      usage = response.usage;
  } else {
      // Fallback for services not yet updated (though we updated them)
      content = response;
      usage = { input: 0, output: 0, total: 0 };
  }

  perf.mark('jsonParse');

  const cost = TokenCounter.calculateCost(usage, provider);
  const quality = QualityChecker.check(content, phrase);
  const promptData = PromptParser.parse(prompt);

  return {
    output: content,
    prompt,
    fewShot: fewShotMeta,
    cardType,
    sourceMode,
    baseName, targetDir, folderName, // Pass file info for saving
    observability: {
      tokens: usage,
      cost,
      quality,
      prompt: promptData,  // 已包含 full 字段
      metadata: {
        provider,
        timestamp: Date.now(),
        model: provider === 'gemini'
            ? (useGeminiCli
              ? (response.model || resolvedGeminiCliModel || 'gemini-cli')
              : (useGeminiProxy ? (response.model || resolvedGeminiCliModel || process.env.GEMINI_PROXY_MODEL || 'gemini-cli') : process.env.GEMINI_MODEL))
            : process.env.LLM_MODEL,
        promptText: prompt,  // 在 metadata 中也保存一份
        promptParsed: promptData,
        cardType,
        sourceMode,
        outputMode: useMarkdownOutput ? 'markdown' : 'json',
        rawOutput: useMarkdownOutput
          ? (response.rawOutput || content?.markdown_content || '')
          : JSON.stringify(content, null, 2),
        outputStructured: JSON.stringify(content, null, 2),
        fewShot: {
          enabled: fewShotMeta.enabled,
          strategy: fewShotMeta.strategy,
          countRequested: fewShotMeta.countRequested,
          countUsed: fewShotMeta.countUsed,
          minScore: fewShotMeta.minScore,
          contextWindow: fewShotMeta.contextWindow,
          tokenBudgetRatio: fewShotMeta.tokenBudgetRatio,
          exampleMaxChars: fewShotMeta.exampleMaxChars,
          provider: fewShotMeta.provider,
          reviewGated: fewShotMeta.reviewGated,
          reviewOnly: fewShotMeta.reviewOnly,
          reviewMinOverall: fewShotMeta.reviewMinOverall,
          basePromptTokens: fewShotMeta.basePromptTokens,
          fewshotPromptTokens: fewShotMeta.fewshotPromptTokens,
          totalPromptTokensEst: fewShotMeta.totalPromptTokensEst,
          fallbackReason: fewShotMeta.fallbackReason,
          exampleIds: fewShotMeta.exampleIds
        }
      }
    }
  };
}

async function handleComparisonMode(phrase, options = {}) {
  console.log('[Comparison] Starting parallel generation...');
  const cardType = normalizeCardType(options.cardType);
  const sourceMode = normalizeSourceMode(options.sourceMode);

  const results = {
    phrase,
    gemini: { success: false },
    local: { success: false },
    comparison: null
  };

  const perfGemini = new PerformanceMonitor().start();
  const perfLocal = new PerformanceMonitor().start();

  const [geminiResult, localResult] = await Promise.allSettled([
    generateWithProvider(phrase, 'gemini', perfGemini, {
      ...(options.geminiOptions || {}),
      experimentId: options.experimentId,
      experimentRound: options.experimentRound,
      targetFolder: options.targetFolder || '',
      cardType,
      sourceMode
    }),
    generateWithProvider(phrase, 'local', perfLocal, {
      ...(options.localOptions || {}),
      fewshotOptions: options.fewshotOptions || {},
      experimentId: options.experimentId,
      experimentRound: options.experimentRound,
      targetFolder: options.targetFolder || '',
      cardType,
      sourceMode
    })
  ]);

  const createInputCard = async (baseInfo) => {
    if (!baseInfo) return null;
    const inputBaseName = `${baseInfo.baseName}_input`;
    const inputMarkdown = `# ${phrase}\n\n## 原始输入\n- ${phrase}\n\n> 模式: 双模型对比`;
    const htmlContent = await renderHtmlFromMarkdown(inputMarkdown, { baseName: inputBaseName, audioTasks: [] });
    const content = {
      markdown_content: inputMarkdown,
      html_content: htmlContent,
      audio_tasks: []
    };
    try {
      return saveGeneratedFiles(`【输入】${phrase}`, content, {
        baseName: inputBaseName,
        targetDir: baseInfo.targetDir,
        folderName: baseInfo.folderName,
        cardType,
        sourceMode: sourceMode || 'input'
      });
    } catch (err) {
      console.warn('[Comparison] Input card save failed:', err.message);
      return null;
    }
  };

  const finalizeSide = async (label, genValue, perf) => {
    const {
      output: content,
      prompt,
      observability,
      baseName,
      targetDir,
      folderName,
      cardType: sideCardType,
      sourceMode: sideSourceMode
    } = genValue;

    postProcessGeneratedContent(content);
    const validationErrors = validateGeneratedContent(content, { allowMissingHtml: true });
    if (validationErrors.length) {
      throw new Error(`Validation failed: ${validationErrors.join('; ')}`);
    }

    const derivedAudioTasks = buildAudioTasksFromMarkdown(content.markdown_content);
    if (!Array.isArray(content.audio_tasks) || !content.audio_tasks.length) {
      content.audio_tasks = derivedAudioTasks;
    }

    const compareBaseName = `${baseName}_${label}`;
    const preparedMarkdown = await prepareMarkdownForCard(content.markdown_content, { baseName: compareBaseName, audioTasks: content.audio_tasks });
    content.markdown_content = preparedMarkdown;
    content.html_content = await renderHtmlFromMarkdown(preparedMarkdown, { baseName: compareBaseName, audioTasks: content.audio_tasks });

    perf.mark('fileSave');
    let fileResult = null;
    try {
      fileResult = saveGeneratedFiles(phrase, content, {
        baseName: compareBaseName,
        targetDir,
        folderName,
        cardType: sideCardType || cardType,
        sourceMode: sideSourceMode || sourceMode
      });
    } catch (e) {
      console.error(`[Comparison] Save failed (${label}):`, e.message);
    }

    let audio = null;
    const hasTtsEndpoint = process.env.TTS_EN_ENDPOINT || process.env.TTS_JA_ENDPOINT;
    if (hasTtsEndpoint && content.audio_tasks.length && fileResult) {
      const audioTasks = normalizeAudioTasks(content.audio_tasks, fileResult.baseName);
      audio = await generateAudioBatch(audioTasks, { outputDir: fileResult.targetDir, baseName: fileResult.baseName, extension: 'wav' });
    }

    perf.mark('audioGenerate');
    observability.performance = perf.end();
    const outputStructured = observability.metadata?.outputMode === 'markdown'
      ? JSON.stringify(content, null, 2)
      : (observability.metadata?.outputStructured || JSON.stringify(content, null, 2));
    observability.metadata = {
      ...(observability.metadata || {}),
      promptText: prompt,
      outputStructured
    };

    let generationId = null;
    let trainingSummary = null;
    if (fileResult) {
      try {
        const dbData = prepareInsertData({
          phrase,
          provider: label,
          model: observability.metadata?.model || label,
          folderName,
          baseName: fileResult.baseName,
          filePaths: fileResult.absPaths,
          content,
          observability,
          prompt,
          audioTasks: content.audio_tasks,
          cardType: sideCardType || cardType,
          sourceMode: sideSourceMode || sourceMode
        });
        generationId = dbService.insertGeneration(dbData);
        try {
          exampleReviewService.ingestGeneration({
            generationId,
            phrase,
            markdownContent: content.markdown_content,
            folderName,
            baseFilename: fileResult.baseName
          });
        } catch (reviewErr) {
          console.warn('[Review] ingest generation failed:', reviewErr.message);
        }
        if (generationId) {
          try {
            const fewShot = genValue.fewShot || {};
            const experimentId = options.experimentId || createExperimentId();
            const variant = `${options.variantBase || 'compare'}_${label}`;
            const runId = fewShotMetricsService.insertFewShotRun({
              generationId,
              experimentId,
              variant,
              fewshotEnabled: fewShot.enabled || false,
              strategy: fewShot.strategy,
              exampleCount: fewShot.countUsed || 0,
              minScore: fewShot.minScore,
              contextWindow: fewShot.contextWindow,
              tokenBudgetRatio: fewShot.tokenBudgetRatio,
              basePromptTokens: fewShot.basePromptTokens,
              fewshotPromptTokens: fewShot.fewshotPromptTokens,
              totalPromptTokensEst: fewShot.totalPromptTokensEst,
              outputTokens: observability?.tokens?.output || 0,
              outputChars: content?.markdown_content?.length || 0,
              qualityScore: observability?.quality?.score || 0,
              qualityDimensions: observability?.quality?.dimensions || {},
              latencyTotalMs: observability?.performance?.totalTime || 0,
              success: true,
              fallbackReason: fewShot.fallbackReason,
              promptText: prompt
            });
            if (runId && Array.isArray(fewShot.examples) && fewShot.examples.length) {
              fewShotMetricsService.insertFewShotExamples(runId, fewShot.examples);
            }

            experimentTrackingService.recordExperimentSample({
              generationId,
              phrase,
              provider: label,
              experimentId,
              roundNumber: options.experimentRound || 0,
              roundName: options.roundName || null,
              variant,
              isTeacherReference: Boolean(options.isTeacherReference && label === 'gemini'),
              observability,
              fewShot,
              promptText: prompt,
              content
            });
          } catch (fsErr) {
            console.warn('[FewShot] Compare run record failed:', fsErr.message);
          }
        }
      } catch (dbErr) {
        console.error('[Database] Compare insert failed:', dbErr.message);
      }

      if (generationId) {
        try {
          const trainingAsset = await generateAndPersistTrainingAsset({
            generationId,
            phrase,
            cardType: sideCardType || cardType,
            markdown: content.markdown_content,
            folderName,
            baseName: fileResult.baseName,
            targetDir: fileResult.targetDir
          });
          trainingSummary = summarizeTrainingAsset(trainingAsset);
        } catch (trainingErr) {
          console.warn('[Training] Compare generation failed:', trainingErr.message);
          trainingSummary = {
            status: 'failed',
            source: 'heuristic',
            qualityScore: 0,
            assetId: null
          };
        }
      }
    }

    return {
      output: content,
      observability,
      result: fileResult,
      audio,
      generationId: generationId || null,
      training: trainingSummary
    };
  };

  if (geminiResult.status === 'fulfilled') {
    try {
      const finalized = await finalizeSide('gemini', geminiResult.value, perfGemini);
      results.gemini = { success: true, ...finalized };
    } catch (err) {
      results.gemini = { success: false, error: err.message };
    }
  } else {
    results.gemini = { success: false, error: geminiResult.reason.message };
  }

  if (localResult.status === 'fulfilled') {
    try {
      const finalized = await finalizeSide('local', localResult.value, perfLocal);
      results.local = { success: true, ...finalized };
    } catch (err) {
      results.local = { success: false, error: err.message };
    }
  } else {
    results.local = { success: false, error: localResult.reason.message };
  }

  // Create an input card for comparison mode
  try {
    const baseInfo = geminiResult.status === 'fulfilled'
      ? geminiResult.value
      : (localResult.status === 'fulfilled' ? localResult.value : null);
    if (baseInfo) {
      const inputCard = await createInputCard(baseInfo);
      if (inputCard) results.input = { success: true, result: inputCard };
    }
  } catch (err) {
    console.warn('[Comparison] Input card generation failed:', err.message);
  }

  // Comparison Logic
  if (results.gemini.success && results.local.success) {
    const geminiObs = results.gemini.observability;
    const localObs = results.local.observability;
    
    // Normalize score logic: Quality (0-100) vs Time (ms, lower is better)
    const geminiScore = geminiObs.quality.score * 0.7 + (5000 / Math.max(geminiObs.performance.totalTime, 500)) * 30;
    const localScore = localObs.quality.score * 0.7 + (5000 / Math.max(localObs.performance.totalTime, 500)) * 30;

    let winner = 'tie';
    if (geminiScore > localScore + 5) winner = 'gemini';
    if (localScore > geminiScore + 5) winner = 'local';

    // 提示词差异分析（简单的长度比较）
    const geminiPromptLen = geminiObs.prompt?.text?.length || 0;
    const localPromptLen = localObs.prompt?.text?.length || 0;
    const promptSimilarity = Math.abs(geminiPromptLen - localPromptLen) < 100 ? 'identical' : 'different';

    results.comparison = {
      metrics: {
        speed: { gemini: geminiObs.performance.totalTime, local: localObs.performance.totalTime },
        quality: { gemini: geminiObs.quality.score, local: localObs.quality.score },
        tokens: { gemini: geminiObs.tokens.total, local: localObs.tokens.total },
        cost: {
          gemini: typeof geminiObs.cost?.total === 'number' ? geminiObs.cost.total : 0,
          local: typeof localObs.cost?.total === 'number' ? localObs.cost.total : 0
        }
      },
      winner,
      recommendation: winner === 'gemini' ? 'Gemini wins on speed/quality balance.' :
                      winner === 'local' ? 'Local LLM wins on speed/quality balance.' : 'Tie.',
      promptComparison: {
        similarity: promptSimilarity,
        geminiLength: geminiPromptLen,
        localLength: localPromptLen
      }
    };
  }

  return results;
}

// API Endpoints

app.post('/api/generation-jobs', async (req, res) => {
  try {
    const phrase = String(req.body?.phrase || '').trim();
    if (!phrase) {
      return res.status(400).json({ error: 'Phrase required' });
    }

    const jobType = normalizeCardType(req.body?.card_type || req.body?.job_type || 'trilingual');
    const sourceMode = normalizeSourceMode(req.body?.source_mode);
    const provider = normalizeLlmProvider(req.body?.llm_provider);
    const llmModel = sanitizeGeminiModelName(req.body?.llm_model || '');
    const enableCompare = Boolean(req.body?.enable_compare);
    const targetFolder = String(req.body?.target_folder || '').trim();
    const sourceContext = req.body?.source_context && typeof req.body.source_context === 'object'
      ? req.body.source_context
      : {};

    const job = generationJobService.enqueue({
      jobType,
      phraseRaw: phrase,
      phraseNormalized: phrase,
      sourceMode,
      targetFolder,
      provider,
      llmModel,
      enableCompare,
      sourceContext,
      createdByClient: req.get('user-agent') || 'browser',
      requestPayload: {
        phrase,
        llm_provider: provider,
        enable_compare: enableCompare,
        card_type: jobType,
        source_mode: sourceMode,
        target_folder: targetFolder,
        llm_model: llmModel || null,
        source_context: sourceContext
      }
    });

    return res.json({ success: true, job, summary: generationJobService.getSummary() });
  } catch (err) {
    const message = String(err?.message || 'enqueue generation job failed');
    const status = message === 'duplicate_active_generation_job' ? 409 : 500;
    return res.status(status).json({ error: message });
  }
});

app.get('/api/generation-jobs', (req, res) => {
  try {
    const limit = Number(req.query.limit || 30);
    const jobs = generationJobService.listJobs(limit);
    return res.json({ success: true, jobs });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/generation-jobs/summary', (req, res) => {
  try {
    return res.json({ success: true, summary: generationJobService.getSummary() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/generation-jobs/events', (req, res) => {
  try {
    const jobId = Number(req.query.jobId || 0);
    const limit = Number(req.query.limit || 20);
    const events = generationJobService.listEvents({ jobId, limit });
    return res.json({ success: true, events });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/generation-jobs/clear-done', (req, res) => {
  try {
    const result = generationJobService.clearCompleted();
    return res.json({ success: true, ...result, summary: generationJobService.getSummary() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/generation-jobs/:id/retry', (req, res) => {
  try {
    const job = generationJobService.retryJob(Number(req.params.id));
    if (!job) {
      return res.status(404).json({ error: 'job not retryable' });
    }
    return res.json({ success: true, job, summary: generationJobService.getSummary() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/generation-jobs/:id/cancel', (req, res) => {
  try {
    const job = generationJobService.cancelJob(Number(req.params.id));
    if (!job) {
      return res.status(404).json({ error: 'job not cancellable' });
    }
    return res.json({ success: true, job, summary: generationJobService.getSummary() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/generate', async (req, res) => {
  const perf = new PerformanceMonitor().start();
  try {
    const skipThrottle = req.get('X-Generation-Job-Worker') === '1';
    const throttle = skipThrottle ? { allowed: true, retryAfterMs: 0 } : checkGenerateThrottle(req);
    if (!throttle.allowed) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        retry_after_ms: throttle.retryAfterMs,
        hint: 'Please wait a few seconds before generating again.'
      });
    }

    // 默认走 Gemini CLI Proxy；仅在显式指定时才使用 local。
    const {
      phrase,
      llm_provider = DEFAULT_LLM_PROVIDER,
      enable_compare = false,
      card_type = 'trilingual',
      source_mode = null,
      target_folder = '',
      experiment_id,
      variant,
      experiment_round = 0,
      round_name,
      is_teacher_reference = false,
      fewshot_options = {},
      llm_model
    } = req.body;
    if (!phrase) return res.status(400).json({ error: 'Phrase required' });
    const requestedProvider = normalizeLlmProvider(llm_provider);
    const cardType = normalizeCardType(card_type);
    const sourceMode = normalizeSourceMode(source_mode);

    const roundNumber = Number.isFinite(Number(experiment_round))
      ? Math.max(0, Math.floor(Number(experiment_round)))
      : 0;

    // Mode: Comparison
    if (enable_compare) {
        const expId = experiment_id || createExperimentId();
        const result = await handleComparisonMode(phrase, {
          experimentId: expId,
          experimentRound: roundNumber,
          roundName: round_name || null,
          isTeacherReference: Boolean(is_teacher_reference),
          variantBase: variant || 'compare',
          fewshotOptions: fewshot_options,
          targetFolder: target_folder || '',
          cardType,
          sourceMode
        });
        return res.json(result);
    }

    // Mode: Single
    const genResult = E2E_TEST_MODE
      ? buildE2EGenerateResult({
          phrase,
          cardType,
          requestedProvider,
          sourceMode
        })
      : await generateWithAutoFallback(phrase, requestedProvider, perf, {
          fewshotOptions: fewshot_options,
          experimentId: experiment_id || '',
          experimentRound: roundNumber,
          modelOverride: llm_model || null,
          targetFolder: target_folder || '',
          cardType,
          sourceMode
        });
    const { output: content, prompt, observability, baseName, targetDir, folderName } = genResult;
    const providerUsed = observability?.metadata?.provider || requestedProvider;

    postProcessGeneratedContent(content);

    // Validate
    const validationErrors = validateGeneratedContent(content, { allowMissingHtml: true });
    if (validationErrors.length) {
        return res.status(422).json({ error: 'Validation failed', details: validationErrors, prompt, llm_output: content });
    }

    // Post-process (Audio Tasks & HTML)
    const derivedAudioTasks = buildAudioTasksFromMarkdown(content.markdown_content);
    if (!Array.isArray(content.audio_tasks) || !content.audio_tasks.length) {
      content.audio_tasks = derivedAudioTasks;
    }

    const preparedMarkdown = await prepareMarkdownForCard(content.markdown_content, { baseName, audioTasks: content.audio_tasks });
    content.markdown_content = preparedMarkdown;
    content.html_content = await renderHtmlFromMarkdown(preparedMarkdown, { baseName, audioTasks: content.audio_tasks });

    // Save
    perf.mark('fileSave');
    const result = saveGeneratedFiles(phrase, content, {
      baseName,
      targetDir,
      folderName,
      cardType,
      sourceMode
    });

    // TTS
    let audio = null;
    const hasTtsEndpoint = !E2E_TEST_MODE && (process.env.TTS_EN_ENDPOINT || process.env.TTS_JA_ENDPOINT);
    if (hasTtsEndpoint && content.audio_tasks.length) {
        const audioTasks = normalizeAudioTasks(content.audio_tasks, result.baseName);
        audio = await generateAudioBatch(audioTasks, { outputDir: result.targetDir, baseName: result.baseName, extension: 'wav' });
    }

    perf.mark('audioGenerate');
    observability.performance = perf.end(); // Finalize perf stats

    // 插入数据库
    let generationId = null;
    let trainingSummary = null;
    try {
      const dbData = prepareInsertData({
        phrase,
        provider: providerUsed,
        model: observability.metadata?.model || providerUsed,
        folderName,
        baseName: result.baseName,
        filePaths: {
          md: result.absPaths.md,
          html: result.absPaths.html,
          meta: result.absPaths.meta
        },
        content,
        observability,
        prompt,
        audioTasks: audio?.tasks || [],
        cardType,
        sourceMode
      });

      generationId = dbService.insertGeneration(dbData);
      try {
        exampleReviewService.ingestGeneration({
          generationId,
          phrase,
          markdownContent: content.markdown_content,
          folderName,
          baseFilename: result.baseName
        });
      } catch (reviewErr) {
        console.warn('[Review] ingest generation failed:', reviewErr.message);
      }
      console.log('[Database] Inserted generation:', generationId);
    } catch (dbError) {
      console.error('[Database] Insert failed:', dbError.message);
      // 数据库插入失败不影响主流程
    }

    // Few-shot run record (baseline/fewshot)
    const expId = experiment_id || createExperimentId();
    if (generationId) {
      try {
        const runVariant = variant || (genResult.fewShot?.enabled ? 'fewshot' : 'baseline');
        const fewShot = genResult.fewShot || {};
        const runId = fewShotMetricsService.insertFewShotRun({
          generationId,
          experimentId: expId,
          variant: runVariant,
          fewshotEnabled: fewShot.enabled || false,
          strategy: fewShot.strategy,
          exampleCount: fewShot.countUsed || 0,
          minScore: fewShot.minScore,
          contextWindow: fewShot.contextWindow,
          tokenBudgetRatio: fewShot.tokenBudgetRatio,
          basePromptTokens: fewShot.basePromptTokens,
          fewshotPromptTokens: fewShot.fewshotPromptTokens,
          totalPromptTokensEst: fewShot.totalPromptTokensEst,
          outputTokens: observability?.tokens?.output || 0,
          outputChars: content?.markdown_content?.length || 0,
          qualityScore: observability?.quality?.score || 0,
          qualityDimensions: observability?.quality?.dimensions || {},
          latencyTotalMs: observability?.performance?.totalTime || 0,
          success: true,
          fallbackReason: fewShot.fallbackReason,
          promptText: genResult.prompt
        });
        if (runId && Array.isArray(fewShot.examples) && fewShot.examples.length) {
          fewShotMetricsService.insertFewShotExamples(runId, fewShot.examples);
        }

        experimentTrackingService.recordExperimentSample({
          generationId,
          phrase,
          provider: providerUsed,
          experimentId: expId,
          roundNumber,
          roundName: round_name || null,
          variant: runVariant,
          isTeacherReference: Boolean(is_teacher_reference),
          observability,
          fewShot,
          promptText: genResult.prompt,
          content
        });
      } catch (fsErr) {
        console.warn('[FewShot] Run record failed:', fsErr.message);
      }
    }

    if (generationId) {
      try {
        const trainingAsset = E2E_TEST_MODE
          ? persistTrainingAssetRecord({
              generationId,
              phrase,
              cardType,
              folderName: result.folder,
              baseName: result.baseName,
              targetDir: result.targetDir
            }, buildE2ETrainingResult({ phrase, cardType }))
          : await generateAndPersistTrainingAsset({
              generationId,
              phrase,
              cardType,
              markdown: content.markdown_content,
              folderName: result.folder,
              baseName: result.baseName,
              targetDir: result.targetDir
            });
        trainingSummary = summarizeTrainingAsset(trainingAsset);
      } catch (trainingErr) {
        console.warn('[Training] Generation failed:', trainingErr.message);
        trainingSummary = {
          status: 'failed',
          source: 'heuristic',
          qualityScore: 0,
          assetId: null
        };
      }
    }

    res.json({
        success: true,
        experiment_id: expId,
        experiment_round: roundNumber,
        card_type: cardType,
        source_mode: sourceMode,
        provider_requested: requestedProvider,
        provider_used: providerUsed,
        fallback: genResult.fallback || null,
        generationId, // 返回数据库ID
        result,
        audio,
        prompt,
        llm_output: content,
        observability,
        training: trainingSummary || {
          status: 'failed',
          source: 'heuristic',
          qualityScore: 0,
          assetId: null
        }
    });

  } catch (err) {
      console.error('[Generate] Error:', err);

      try {
        const {
          experiment_id,
          experiment_round = 0,
          round_name,
          variant,
          llm_provider = DEFAULT_LLM_PROVIDER,
          is_teacher_reference = false,
          llm_model
        } = req.body || {};
        const requestedProvider = normalizeLlmProvider(llm_provider);
        if (experiment_id && req.body?.phrase) {
          experimentTrackingService.recordExperimentSample({
            generationId: null,
            phrase: req.body.phrase,
            provider: requestedProvider,
            experimentId: experiment_id,
            roundNumber: experiment_round,
            roundName: round_name || null,
            variant: variant || 'error',
            isTeacherReference: Boolean(is_teacher_reference),
            observability: {
              quality: { score: 0, dimensions: {} },
              tokens: { total: 0 },
              performance: { totalTime: 0 },
              metadata: { model: resolveTrackingModel(requestedProvider, llm_model) }
            },
            fewShot: { enabled: false, countUsed: 0 },
            promptText: '',
            content: '',
            success: false,
            errorMessage: err.message
          });
        }
      } catch (trackErr) {
        console.warn('[Experiment] Failed to record error sample:', trackErr.message);
      }

      // 记录错误到数据库
      try {
        const requestedProvider = normalizeLlmProvider(req.body?.llm_provider || DEFAULT_LLM_PROVIDER);
        dbService.insertError({
          phrase: req.body.phrase || 'unknown',
          llmProvider: requestedProvider,
          requestId: null,
          errorType: err.name || 'UnknownError',
          errorMessage: err.message,
          errorStack: err.stack,
          prompt: null,
          llmResponse: null,
          validationErrors: null
        });
      } catch (dbErr) {
        console.error('[Database] Error insert failed:', dbErr.message);
      }

      res.status(500).json({ error: err.message });
  }
});

// Reuse existing endpoints
app.post('/api/ocr', async (req, res) => {
    try {
        const { image, provider, langs } = req.body || {};
        if (!image) return res.status(400).json({ error: 'No image' });

        if (E2E_TEST_MODE) {
          return res.json({
            text: 'Queue   state ◆\nキューに追加する\npersistent   highlight',
            provider: 'e2e-fixture'
          });
        }

        const selectedProvider = String(provider || process.env.OCR_PROVIDER || 'tesseract').toLowerCase();
        let text = '';
        let actualProvider = selectedProvider;

        if (selectedProvider === 'tesseract') {
          text = await tesseractOcrService.recognizeImage(image, { langs });
        } else if (selectedProvider === 'local') {
          text = await localLlmService.recognizeImage(image);
        } else if (selectedProvider === 'auto') {
          try {
            text = await tesseractOcrService.recognizeImage(image, { langs });
            actualProvider = 'tesseract';
          } catch (ocrErr) {
            console.warn('[OCR] Tesseract failed in auto mode, fallback to local OCR:', ocrErr.message);
            text = await localLlmService.recognizeImage(image);
            actualProvider = 'local';
          }
        } else {
          return res.status(400).json({ error: `Unsupported OCR provider: ${selectedProvider}` });
        }

        res.json({ text: text || 'No text found', provider: actualProvider });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/health', async (req, res) => {
    try {
        const status = await HealthCheckService.checkAll();
        if (status && typeof status === 'object') {
          status.e2e_test_mode = E2E_TEST_MODE;
        }
        res.json(status);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ========== Gemini CLI Auth ==========
app.get('/api/gemini/auth/status', (req, res) => {
  const enabled = (process.env.GEMINI_MODE || 'host-proxy').toLowerCase() === 'cli';
  const status = geminiAuthService.getStatus();
  res.json({ enabled, ...status });
});

app.post('/api/gemini/auth/start', async (req, res) => {
  const enabled = (process.env.GEMINI_MODE || 'host-proxy').toLowerCase() === 'cli';
  if (!enabled) return res.status(400).json({ error: 'Gemini CLI not enabled' });
  try {
    const status = await geminiAuthService.startAuth();
    res.json({ enabled, ...status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/gemini/auth/submit', async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'Missing authorization code' });
  try {
    const result = await geminiAuthService.submitCode(code);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/gemini/auth/cancel', (req, res) => {
  const result = geminiAuthService.cancelAuth();
  res.json(result);
});

// ========== 数据库查询API ==========

// 历史记录查询（分页）
app.get('/api/history', (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            search,
            provider,
            card_type,
            dateFrom,
            dateTo
        } = req.query;
        const cardTypeFilter = card_type ? normalizeCardType(card_type) : null;

        const records = dbService.queryGenerations({
            page: Number(page),
            limit: Number(limit),
            search,
            provider,
            cardType: cardTypeFilter,
            dateFrom,
            dateTo
        });

        const total = dbService.getTotalCount({
            search,
            provider,
            cardType: cardTypeFilter,
            dateFrom,
            dateTo
        });

        res.json({
            success: true,
            records,
            pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                totalPages: Math.ceil(total / limit),
                hasNext: Number(page) * Number(limit) < total,
                hasPrev: Number(page) > 1
            }
        });
    } catch (e) {
        console.error('[API /history] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// 获取单条记录详情
app.get('/api/history/:id', (req, res) => {
    try {
        const record = dbService.getGenerationById(Number(req.params.id));

        if (!record) {
            return res.status(404).json({ error: 'Record not found' });
        }

        res.json({
            success: true,
            record
        });
    } catch (e) {
        console.error('[API /history/:id] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// 统计分析
app.get('/api/statistics', (req, res) => {
    try {
        const {
            provider,
            dateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            dateTo = new Date().toISOString().split('T')[0]
        } = req.query;

        const stats = dbService.getStatistics({
            provider,
            dateFrom,
            dateTo
        });

        res.json({
            success: true,
            statistics: stats,
            period: { dateFrom, dateTo }
        });
    } catch (e) {
        console.error('[API /statistics] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// 全文搜索
app.get('/api/search', (req, res) => {
    try {
        const { q, limit = 20 } = req.query;

        if (!q) {
            return res.status(400).json({ error: 'Query parameter "q" is required' });
        }

        const results = dbService.fullTextSearch(q, Number(limit));

        res.json({
            success: true,
            query: q,
            results,
            count: results.length
        });
    } catch (e) {
        console.error('[API /search] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// 最近记录
app.get('/api/recent', (req, res) => {
    try {
        const { limit = 10 } = req.query;
        const records = dbService.getRecentGenerations(Number(limit));

        res.json({
            success: true,
            records
        });
    } catch (e) {
        console.error('[API /recent] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ========== Dashboard 聚合 API ==========

app.get('/api/dashboard/review-stats', (req, res) => {
    try {
        const reviewStats = dbService.getReviewStats();
        const activeCampaign = exampleReviewService.getActiveCampaign();
        let campaignProgress = null;
        if (activeCampaign) {
            campaignProgress = exampleReviewService.getCampaignProgress(activeCampaign.id);
        }
        res.json({ success: true, ...reviewStats, campaign: campaignProgress });
    } catch (e) {
        console.error('[API /dashboard/review-stats] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/dashboard/fewshot-stats', (req, res) => {
    try {
        const stats = dbService.getFewShotStats();
        res.json({ success: true, ...stats });
    } catch (e) {
        console.error('[API /dashboard/fewshot-stats] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/dashboard/highlight-stats', (req, res) => {
    try {
        const {
            provider,
            cardType,
            dateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            dateTo = new Date().toISOString().split('T')[0]
        } = req.query;
        const stats = dbService.getHighlightStats({ provider, cardType, dateFrom, dateTo });
        res.json({
            success: true,
            ...stats,
            period: { dateFrom, dateTo }
        });
    } catch (e) {
        console.error('[API /dashboard/highlight-stats] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ========== 例句评审与注入门控 API ==========

app.get('/api/review/campaigns', (req, res) => {
  try {
    const campaigns = exampleReviewService.getCampaigns();
    res.json({ success: true, campaigns });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/review/campaigns/active', (req, res) => {
  try {
    const campaign = exampleReviewService.getActiveCampaign();
    if (!campaign) return res.json({ success: true, campaign: null });
    const progress = exampleReviewService.getCampaignProgress(campaign.id);
    res.json({ success: true, campaign: progress || campaign });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/review/campaigns', (req, res) => {
  try {
    const { name, createdBy, notes } = req.body || {};
    const campaign = exampleReviewService.createCampaign({ name, createdBy, notes });
    res.json({ success: true, campaign });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/review/campaigns/:id/progress', (req, res) => {
  try {
    const progress = exampleReviewService.getCampaignProgress(Number(req.params.id));
    if (!progress) return res.status(404).json({ error: 'Campaign not found' });
    res.json({ success: true, progress });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/review/campaigns/:id/finalize', (req, res) => {
  try {
    const campaignId = Number(req.params.id);
    const progress = exampleReviewService.finalizeCampaign(campaignId, req.body || {});
    res.json({ success: true, progress });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/review/campaigns/:id/rollback', (req, res) => {
  try {
    const campaignId = Number(req.params.id);
    const progress = exampleReviewService.rollbackCampaign(campaignId);
    res.json({ success: true, progress });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/review/backfill', (req, res) => {
  try {
    const { limit = 0 } = req.body || {};
    const result = exampleReviewService.backfillMissingGenerations(Number(limit || 0));
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/review/generations/:id/examples', (req, res) => {
  try {
    const generationId = Number(req.params.id);
    if (!generationId) return res.status(400).json({ error: 'Invalid generation id' });
    const campaignId = req.query.campaignId ? Number(req.query.campaignId) : null;
    const reviewer = String(req.query.reviewer || process.env.REVIEW_DEFAULT_REVIEWER || 'owner');
    const examples = exampleReviewService.getGenerationExamples(generationId, { campaignId, reviewer });
    res.json({ success: true, examples });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/review/examples/:id/reviews', (req, res) => {
  try {
    const exampleId = Number(req.params.id);
    const {
      campaignId = null,
      reviewer = process.env.REVIEW_DEFAULT_REVIEWER || 'owner',
      scoreSentence,
      scoreTranslation,
      scoreTts,
      decision = 'neutral',
      comment = ''
    } = req.body || {};

    const result = exampleReviewService.upsertReview({
      exampleId,
      campaignId,
      reviewer,
      scoreSentence,
      scoreTranslation,
      scoreTts,
      decision,
      comment
    });

    res.json({ success: true, review: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ========== Knowledge analysis jobs API ==========

app.post('/api/knowledge/jobs/start', (req, res) => {
  try {
    const {
      jobType,
      scope = {},
      batchSize = 50,
      triggeredBy = 'owner',
      options = {}
    } = req.body || {};

    if (!jobType) {
      return res.status(400).json({ error: 'jobType is required' });
    }

    if (E2E_TEST_MODE) {
      const job = createE2EKnowledgeJob({
        jobType,
        scope,
        batchSize,
        triggeredBy
      });
      return res.json({ success: true, job });
    }

    const normalizedScope = {
      folderFrom: scope.folderFrom || null,
      folderTo: scope.folderTo || null,
      cardTypes: Array.isArray(scope.cardTypes) ? scope.cardTypes : undefined,
      limit: scope.limit ? Number(scope.limit) : undefined
    };

    const job = knowledgeJobService.startJob({
      jobType,
      scope: normalizedScope,
      batchSize: Number(batchSize || 50),
      triggeredBy: String(triggeredBy || 'owner'),
      options: {
        minCandidateScore: options.minCandidateScore,
        maxPairs: options.maxPairs,
        maxLlmPairs: options.maxLlmPairs,
        llmEnabled: options.llmEnabled,
        llmTransport: options.llmTransport,
        model: options.model,
        promptVersion: options.promptVersion,
        schemaVersion: options.schemaVersion,
        llmTimeoutMs: options.llmTimeoutMs
      }
    });
    return res.json({ success: true, job });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

app.get('/api/knowledge/jobs', (req, res) => {
  try {
    const limit = Number(req.query.limit || 20);
    if (E2E_TEST_MODE) {
      return res.json({ success: true, jobs: listE2EKnowledgeJobs(limit) });
    }
    const jobs = knowledgeJobService.listJobs(limit);
    res.json({ success: true, jobs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/knowledge/jobs/:id', (req, res) => {
  try {
    const jobId = Number(req.params.id);
    if (!jobId) return res.status(400).json({ error: 'invalid job id' });
    if (E2E_TEST_MODE) {
      const job = getE2EKnowledgeJob(jobId);
      if (!job) return res.status(404).json({ error: 'job not found' });
      return res.json({ success: true, job });
    }
    const job = knowledgeJobService.getJob(jobId);
    if (!job) return res.status(404).json({ error: 'job not found' });
    res.json({ success: true, job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/knowledge/jobs/:id/cancel', (req, res) => {
  try {
    const jobId = Number(req.params.id);
    if (!jobId) return res.status(400).json({ error: 'invalid job id' });
    if (E2E_TEST_MODE) {
      const cancelled = cancelE2EKnowledgeJob(jobId);
      return res.json({ success: true, cancelled: Boolean(cancelled) });
    }
    const cancelled = knowledgeJobService.cancelJob(jobId);
    res.json({ success: true, cancelled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/knowledge/index', (req, res) => {
  try {
    const query = String(req.query.query || '');
    const limit = Number(req.query.limit || 100);
    const entries = dbService.getKnowledgeIndex({ query, limit });
    res.json({ success: true, entries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/knowledge/synonyms', (req, res) => {
  try {
    const phrase = String(req.query.phrase || '');
    if (!phrase) return res.status(400).json({ error: 'phrase is required' });
    const limit = Number(req.query.limit || 20);
    const groups = dbService.getKnowledgeSynonymsByPhrase(phrase, limit);
    res.json({ success: true, groups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/knowledge/synonyms/list', (req, res) => {
  try {
    const page = Number(req.query.page || 1);
    const pageSize = Number(req.query.pageSize || 20);
    const jobId = req.query.jobId ? Number(req.query.jobId) : undefined;
    const riskLevel = req.query.riskLevel ? String(req.query.riskLevel) : undefined;
    const query = req.query.query ? String(req.query.query) : '';
    const data = dbService.listKnowledgeSynonymBoundaries({
      jobId,
      riskLevel,
      query,
      page,
      pageSize
    });
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/knowledge/synonyms/:pairKey', (req, res) => {
  try {
    const pairKey = String(req.params.pairKey || '').trim();
    if (!pairKey) return res.status(400).json({ error: 'pairKey is required' });
    const jobId = req.query.jobId ? Number(req.query.jobId) : undefined;
    const detail = dbService.getKnowledgeSynonymBoundaryDetail({ pairKey, jobId });
    if (!detail) return res.status(404).json({ error: 'synonym boundary not found' });
    res.json({ success: true, detail });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/knowledge/grammar', (req, res) => {
  try {
    const pattern = String(req.query.pattern || '');
    const limit = Number(req.query.limit || 30);
    const patterns = dbService.getKnowledgeGrammarPatterns({ pattern, limit });
    res.json({ success: true, patterns });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/knowledge/clusters', (req, res) => {
  try {
    const limit = Number(req.query.limit || 20);
    const clusters = dbService.getKnowledgeClusters(limit);
    res.json({ success: true, clusters });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/knowledge/issues', (req, res) => {
  try {
    const issueType = req.query.issueType ? String(req.query.issueType) : undefined;
    const severity = req.query.severity ? String(req.query.severity) : undefined;
    const resolved = req.query.resolved === undefined
      ? undefined
      : ['1', 'true', 'yes'].includes(String(req.query.resolved).toLowerCase());
    const limit = Number(req.query.limit || 100);
    const issues = dbService.getKnowledgeIssues({ issueType, severity, resolved, limit });
    res.json({ success: true, issues });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/knowledge/overview', (req, res) => {
  try {
    const limit = Number(req.query.limit || 8);
    const overview = dbService.getKnowledgeOverview({ limit });
    res.json({ success: true, overview });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/knowledge/cards/:generationId/relations', (req, res) => {
  try {
    const generationId = Number(req.params.generationId);
    if (!generationId) return res.status(400).json({ error: 'invalid generation id' });
    const limit = Number(req.query.limit || 12);
    const relations = dbService.getKnowledgeCardRelations(generationId, { limit });
    if (!relations) return res.status(404).json({ error: 'card not found' });
    res.json({ success: true, relations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/knowledge/terms/:term/relations', (req, res) => {
  try {
    const term = String(req.params.term || '').trim();
    if (!term) return res.status(400).json({ error: 'term is required' });
    const limit = Number(req.query.limit || 20);
    const relations = dbService.getKnowledgeTermRelations(term, { limit });
    res.json({ success: true, relations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/knowledge/patterns/:pattern/relations', (req, res) => {
  try {
    const pattern = String(req.params.pattern || '').trim();
    if (!pattern) return res.status(400).json({ error: 'pattern is required' });
    const limit = Number(req.query.limit || 20);
    const relations = dbService.getKnowledgePatternRelations(pattern, { limit });
    res.json({ success: true, relations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/knowledge/clusters/:clusterKey/relations', (req, res) => {
  try {
    const clusterKey = String(req.params.clusterKey || '').trim();
    if (!clusterKey) return res.status(400).json({ error: 'clusterKey is required' });
    const limit = Number(req.query.limit || 20);
    const relations = dbService.getKnowledgeClusterRelations(clusterKey, { limit });
    res.json({ success: true, relations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/knowledge/summary/latest', (req, res) => {
  try {
    const summary = dbService.getLatestKnowledgeSummary();
    res.json({ success: true, summary: summary || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/training/backfill/summary', (req, res) => {
    try {
        const summary = dbService.getTrainingBackfillSummary({
            folderName: String(req.query.folder || '').trim(),
            cardType: String(req.query.cardType || '').trim(),
            provider: String(req.query.provider || '').trim().toLowerCase()
        });
        res.json({ success: true, summary });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/training/backfill', async (req, res) => {
    try {
        const {
            limit = 20,
            force = false,
            folder = '',
            cardType = '',
            provider = ''
        } = req.body || {};

        const result = await backfillTrainingAssets({
            limit,
            force,
            folderName: folder,
            cardType,
            provider
        });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/training/by-generation/:id', (req, res) => {
    try {
        const generationId = Number(req.params.id || 0);
        if (!generationId) {
            return res.status(400).json({ error: 'invalid generation id' });
        }
        const training = dbService.getCardTrainingAssetByGenerationId(generationId);
        if (!training) {
            return res.status(404).json({ error: 'training asset not found' });
        }
        res.json({ success: true, training });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/training/by-file', (req, res) => {
    try {
        const folder = String(req.query.folder || '').trim();
        const base = String(req.query.base || '').trim();
        if (!folder || !base) {
            return res.status(400).json({ error: 'folder and base are required' });
        }
        const training = dbService.getCardTrainingAssetByFile(folder, base);
        if (!training) {
            return res.status(404).json({ error: 'training asset not found' });
        }
        res.json({ success: true, training });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/training/by-generation/:id/regenerate', async (req, res) => {
    try {
        const generationId = Number(req.params.id || 0);
        if (!generationId) {
            return res.status(400).json({ error: 'invalid generation id' });
        }
        const record = dbService.getGenerationById(generationId);
        if (!record) {
            return res.status(404).json({ error: 'generation not found' });
        }
        const targetDir = record.md_file_path ? path.dirname(record.md_file_path) : '';
        const training = E2E_TEST_MODE
          ? persistTrainingAssetRecord({
              generationId: record.id,
              phrase: record.phrase,
              cardType: record.card_type,
              folderName: record.folder_name,
              baseName: record.base_filename,
              targetDir
            }, buildE2ETrainingResult({ phrase: record.phrase, cardType: record.card_type }))
          : await generateAndPersistTrainingAsset({
              generationId: record.id,
              phrase: record.phrase,
              cardType: record.card_type,
              markdown: record.markdown_content || '',
              folderName: record.folder_name,
              baseName: record.base_filename,
              targetDir
            });
        res.json({ success: true, training });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/folders', (req, res) => {
    const listFoldersWithHtml = require('./services/fileManager').listFoldersWithHtml; // Lazy require
    try {
        const folders = listFoldersWithHtml();
        res.json({ folders });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/folders/:folder/files', (req, res) => {
    const listHtmlFilesInFolder = require('./services/fileManager').listHtmlFilesInFolder;
    try {
        const files = listHtmlFilesInFolder(req.params.folder);
        res.json({ files });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/folders/:folder/files/:file', (req, res) => {
    const readFileInFolder = require('./services/fileManager').readFileInFolder;
    try {
        const content = readFileInFolder(req.params.folder, req.params.file);
        const ext = path.extname(req.params.file || '').toLowerCase();
        if (ext === '.wav') {
            res.set('Content-Type', 'audio/wav');
            res.send(content);
            return;
        }
        if (ext === '.mp3') {
            res.set('Content-Type', 'audio/mpeg');
            res.send(content);
            return;
        }
        res.send(content);
    } catch (e) { res.status(404).send('Not Found'); }
});

// 卡片标红：读取（按 folder/base/sourceHash）
app.get('/api/highlights/by-file', (req, res) => {
    try {
        const folder = String(req.query.folder || '').trim();
        const base = String(req.query.base || '').trim();
        const sourceHash = String(req.query.sourceHash || '').trim();
        if (!folder || !base || !sourceHash) {
            return res.status(400).json({ error: 'folder, base and sourceHash are required' });
        }
        const highlight = dbService.getCardHighlightByFile(folder, base, sourceHash);
        res.json({ success: true, highlight: highlight || null });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 卡片标红：保存（upsert）
app.put('/api/highlights/by-file', (req, res) => {
    try {
        const {
            folder,
            base,
            sourceHash,
            html,
            generationId = null,
            version = 1,
            updatedBy = 'ui'
        } = req.body || {};

        const folderName = String(folder || '').trim();
        const baseFilename = String(base || '').trim();
        const hash = String(sourceHash || '').trim();
        const htmlContent = String(html || '');
        if (!folderName || !baseFilename || !hash) {
            return res.status(400).json({ error: 'folder, base and sourceHash are required' });
        }
        if (!htmlContent.trim()) {
            return res.status(400).json({ error: 'html is required' });
        }
        if (htmlContent.length > 2_000_000) {
            return res.status(400).json({ error: 'html too large' });
        }

        const saved = dbService.upsertCardHighlight({
            folderName,
            baseFilename,
            sourceHash: hash,
            htmlContent,
            generationId: generationId ? Number(generationId) : null,
            version: Number(version || 1),
            updatedBy
        });

        res.json({ success: true, highlight: saved });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// 卡片标红：删除（可选 sourceHash，默认删该卡片全部版本）
app.delete('/api/highlights/by-file', (req, res) => {
    try {
        const folder = String(req.query.folder || '').trim();
        const base = String(req.query.base || '').trim();
        const sourceHash = String(req.query.sourceHash || '').trim();
        if (!folder || !base) {
            return res.status(400).json({ error: 'folder and base are required' });
        }
        const deleted = dbService.deleteCardHighlightByFile(folder, base, sourceHash);
        res.json({ success: true, deleted });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 根据文件夹+文件名定位记录
app.get('/api/records/by-file', (req, res) => {
    try {
        const folder = String(req.query.folder || '').trim();
        const baseRaw = String(req.query.base || '');
        const baseTrimmed = baseRaw.trim();
        if (!folder || !baseTrimmed) {
            return res.status(400).json({ error: 'folder and base are required' });
        }

        const baseCandidates = Array.from(new Set([baseRaw, baseTrimmed].filter(Boolean)));
        let record = null;
        for (const candidate of baseCandidates) {
            record = dbService.getGenerationByFile(folder, candidate);
            if (record) break;
        }
        if (!record) {
            return res.status(404).json({ error: 'Record not found' });
        }
        const fullRecord = dbService.getGenerationById(record.id);
        res.json({ record: fullRecord || record });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 按文件名删除记录与文件（支持无数据库记录的历史文件）
app.delete('/api/records/by-file', (req, res) => {
    try {
        const folder = String(req.query.folder || '').trim();
        const baseRaw = String(req.query.base || '');
        const baseTrimmed = baseRaw.trim();
        if (!folder || !baseTrimmed) {
            return res.status(400).json({ error: 'folder and base are required' });
        }

        const deletedPaths = new Set();
        const baseCandidates = Array.from(new Set([baseRaw, baseTrimmed].filter(Boolean)));

        // 1) 尝试按数据库记录删除
        let record = null;
        for (const candidate of baseCandidates) {
            record = dbService.getGenerationByFile(folder, candidate);
            if (record) break;
        }
        if (record) {
            const recordDetail = dbService.getGenerationById(record.id);
            const recordFiles = [
                recordDetail?.md_file_path,
                recordDetail?.html_file_path,
                recordDetail?.meta_file_path,
            ].filter(Boolean);
            if (recordDetail?.md_file_path && recordDetail?.base_filename) {
                recordFiles.push(buildTrainingSidecarPath(path.dirname(recordDetail.md_file_path), recordDetail.base_filename));
            }

            if (recordDetail?.audioFiles?.length) {
                recordDetail.audioFiles.forEach((audio) => {
                    if (audio.file_path) recordFiles.push(audio.file_path);
                });
            }

            recordFiles.forEach((filePath) => {
                try {
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                        deletedPaths.add(filePath);
                    }
                } catch (err) {
                    console.warn(`[Delete] Failed to remove file: ${filePath}`, err.message);
                }
            });

            dbService.deleteGeneration(record.id);
        }

        // 2) 兜底：按文件名扫描删除
        const fallbackDeleted = deleteRecordFiles(folder, baseRaw);
        fallbackDeleted.forEach((p) => deletedPaths.add(p));

        // 3) 清理卡片标红（兼容 generation_id 缺失场景）
        let highlightDeleted = 0;
        baseCandidates.forEach((candidate) => {
            highlightDeleted += dbService.deleteCardHighlightByFile(folder, candidate);
        });
        let trainingDeleted = 0;
        baseCandidates.forEach((candidate) => {
            trainingDeleted += dbService.deleteCardTrainingAssetByFile(folder, candidate);
        });

        res.json({
            success: true,
            deletedFiles: deletedPaths.size,
            recordDeleted: Boolean(record),
            highlightDeleted,
            trainingDeleted
        });
    } catch (err) {
        console.error('[API /records/by-file DELETE] Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Few-shot experiment data export
app.get('/api/experiments/:id', (req, res) => {
    try {
        const experimentId = String(req.params.id || '').trim();
        if (!experimentId) {
            return res.status(400).json({ error: 'experiment id required' });
        }
        const runs = dbService.getFewShotRuns(experimentId);
        const examples = dbService.getFewShotExamples(runs.map(r => r.id));
        const rounds = dbService.getExperimentRoundTrend(experimentId);
        const samples = dbService.getExperimentSamples(experimentId);
        const teacherRefs = dbService.getTeacherReferences(experimentId);
        const baseline = rounds.find((r) => Number(r.roundNumber) === 0) || rounds[0] || null;
        const deltas = rounds.map((round) => ({
            roundNumber: round.roundNumber,
            roundName: round.roundName,
            deltaQuality: baseline ? (Number(round.avgQualityScore || 0) - Number(baseline.avgQualityScore || 0)) : 0,
            deltaTokens: baseline ? (Number(round.avgTokensTotal || 0) - Number(baseline.avgTokensTotal || 0)) : 0,
            deltaLatency: baseline ? (Number(round.avgLatencyMs || 0) - Number(baseline.avgLatencyMs || 0)) : 0,
            deltaTeacherGap: baseline ? (Number(round.teacherGap || 0) - Number(baseline.teacherGap || 0)) : 0
        }));
        res.json({
            experimentId,
            runs,
            examples,
            rounds,
            samples,
            teacherRefs,
            deltas,
            trend: {
                roundCount: rounds.length,
                sampleCount: samples.length,
                hasTeacher: teacherRefs.length > 0
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 删除记录（数据库 + 文件）
app.delete('/api/records/:id', async (req, res) => {
    try {
        const recordId = Number(req.params.id);

        // 1. 从数据库获取记录详情
        const record = dbService.getGenerationById(recordId);

        if (!record) {
            return res.status(404).json({ error: 'Record not found' });
        }

        // 2. 删除物理文件
        const filesToDelete = [
            record.md_file_path,
            record.html_file_path,
            record.meta_file_path,
            record.md_file_path && record.base_filename
                ? buildTrainingSidecarPath(path.dirname(record.md_file_path), record.base_filename)
                : null
        ].filter(Boolean);

        // 获取音频文件路径
        if (record.audioFiles && Array.isArray(record.audioFiles)) {
            record.audioFiles.forEach(audio => {
                if (audio.file_path) {
                    filesToDelete.push(audio.file_path);
                }
            });
        }

        // 删除文件
        const deletedPaths = new Set();
        for (const filePath of filesToDelete) {
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    deletedPaths.add(filePath);
                    console.log(`[Delete] Removed file: ${filePath}`);
                }
            } catch (fileErr) {
                console.warn(`[Delete] Failed to remove file: ${filePath}`, fileErr.message);
            }
        }

        // 兜底清理：处理历史遗留的音频/sidecar文件（即使未写入 audio_files 表也可清理）
        try {
            const fallbackDeleted = deleteRecordFiles(record.folder_name, record.base_filename);
            fallbackDeleted.forEach((filePath) => deletedPaths.add(filePath));
        } catch (cleanupErr) {
            console.warn('[Delete] Fallback file cleanup failed:', cleanupErr.message);
        }

        // 3. 从数据库删除记录（级联删除会自动删除音频和observability记录）
        dbService.deleteGeneration(recordId);

        // 兼容旧数据：若标红记录未绑定 generation_id，则按 folder/base 再清理一次
        const highlightDeleted = dbService.deleteCardHighlightByFile(record.folder_name, record.base_filename);
        const trainingDeleted = dbService.deleteCardTrainingAssetByFile(record.folder_name, record.base_filename);

        console.log(`[Delete] Record ${recordId} deleted (${deletedPaths.size} files removed)`);

        res.json({
            success: true,
            message: 'Record deleted successfully',
            deletedFiles: deletedPaths.size,
            highlightDeleted,
            trainingDeleted
        });

    } catch (err) {
        console.error('[API /records/:id DELETE] Error:', err);
        res.status(500).json({ error: err.message });
    }
});

const serverInstance = app.listen(PORT, () => {
    generationJobService.configureExecutor(executeGenerationJobViaHttp);
    generationJobService.bootstrap();
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Mission Control available at http://localhost:${PORT}/dashboard.html`);
});

module.exports = { app, serverInstance };
