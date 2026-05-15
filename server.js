// server.js (Partial Update)
const express = require('express');
const path = require('path');
require('dotenv').config();

const { buildPrompt, buildMarkdownPrompt } = require('./services/promptEngine');
const geminiService = require('./services/geminiService');
const { runGeminiCli } = require('./services/geminiCliService');
const { runGeminiProxy } = require('./services/geminiProxyService');
const localLlmService = require('./services/localLlmService');
const tesseractOcrService = require('./services/tesseractOcrService');
const { saveGeneratedFiles, buildBaseName, ensureTodayDirectory, ensureFolderDirectory } = require('./services/fileManager');
const { generateAudioBatch } = require('./services/ttsService');
const { renderHtmlFromMarkdown, buildAudioTasksFromMarkdown, prepareMarkdownForCard } = require('./services/htmlRenderer');
const { postProcessGeneratedContent } = require('./services/contentPostProcessor');
const goldenExamplesService = require('./services/goldenExamplesService');
const fewShotMetricsService = require('./services/fewShotMetricsService');
const experimentTrackingService = require('./services/experimentTrackingService');
const exampleReviewService = require('./services/exampleReviewService');
const generationJobService = require('./services/generationJobService');
const {
    persistTrainingAssetRecord,
    generateAndPersistTrainingAsset,
    summarizeTrainingAsset,
} = require('./services/trainingAssetService');
const {
    truncateExamplesForBudget,
    normalizeAudioTasks,
    validateGeneratedContent,
    validateSanitizedGeminiCardResponse,
} = require('./lib/generationHelpers');

const { TokenCounter, PerformanceMonitor, QualityChecker, PromptParser } = require('./services/observabilityService');

// 数据库服务
const dbService = require('./services/databaseService');
const { prepareInsertData } = require('./services/databaseHelpers');

const app = express();
const {
    PORT,
    RECORDS_PATH,
    DEFAULT_LLM_PROVIDER,
    DEFAULT_GEMINI_MODEL,
    E2E_TEST_MODE,
    toNumberOr,
    createExperimentId,
    normalizeLlmProvider,
    resolveTrackingModel,
    normalizeCardType,
    normalizeSourceMode,
    resolveGeminiModel,
} = require('./lib/serverConfig');
const { checkGenerateThrottle } = require('./lib/throttle');
const {
    buildE2ETrainingResult,
    buildE2EGenerateResult,
} = require('./lib/e2eFixtures');
const log = require('./lib/logger').child({ module: 'http' });

app.use(express.static('public'));
// Do NOT mount RECORDS_PATH as static. In the docker layout DB_PATH lives
// inside RECORDS_PATH, so an `/data/<dbfile>` would have served the entire
// SQLite database (verified: 200 OK on /data/trilingual_records.db and
// /data/trilingual_records.db-wal). All audio + file reads go through
// /api/folders/:folder/files/:file, which validates the path properly.
app.use(express.json({ limit: '10mb' }));

async function executeGenerationJobViaHttp(job) {
  const payload = {
    phrase: job.phraseNormalized,
    llm_provider: 'gemini',
    card_type: normalizeCardType(job.jobType),
    source_mode: normalizeSourceMode(job.sourceMode),
    target_folder: job.targetFolder || '',
    llm_model: DEFAULT_GEMINI_MODEL
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

async function generateWithAutoFallback(phrase, provider, perf, options = {}) {
    return generateWithProvider(phrase, provider, perf, options);
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

// API Endpoints

app.use(require('./routes/generationJobs'));

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
      card_type = 'trilingual',
      source_mode = null,
      target_folder = '',
      experiment_id,
      variant,
      experiment_round = 0,
      round_name,
      is_teacher_reference = false,
      fewshot_options = {},
    } = req.body;
    if (!phrase) return res.status(400).json({ error: 'Phrase required' });
    const requestedProvider = 'gemini';
    const cardType = normalizeCardType(card_type);
    const sourceMode = normalizeSourceMode(source_mode);

    const roundNumber = Number.isFinite(Number(experiment_round))
      ? Math.max(0, Math.floor(Number(experiment_round)))
      : 0;

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
          modelOverride: DEFAULT_GEMINI_MODEL,
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
        audio = await generateAudioBatch(audioTasks, { outputDir: result.targetDir, baseName: result.baseName });
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
      log.error({ err, route: '/api/generate' }, 'generate failed');

      try {
        const {
          experiment_id,
          experiment_round = 0,
          round_name,
          variant,
          is_teacher_reference = false,
          llm_model
        } = req.body || {};
        const requestedProvider = 'gemini';
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

app.use(require('./routes/health'));

// ========== 数据库查询API ==========

// 历史记录查询（分页）
app.use(require('./routes/history'));

// ========== Dashboard 聚合 API ==========

app.use(require('./routes/dashboard'));

// ========== 例句评审与注入门控 API ==========

app.use(require('./routes/review'));

// ========== Knowledge analysis jobs API ==========

app.use(require('./routes/knowledge'));

app.use(require('./routes/training'));

app.use(require('./routes/files'));

// Few-shot experiment data export
app.use(require('./routes/misc'));

// Central error handler — must be registered after all routes. Catches
// synchronous throws in handlers and anything passed to next(err) so a single
// bad request can't crash the process or leak a stack trace to the client.
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    log.error({ err, method: req.method, route: req.originalUrl }, 'unhandled route error');
    const status = Number(err && (err.status || err.statusCode)) || 500;
    res.status(status).json({
        error: (err && err.message) || 'Internal server error',
        code: (err && err.code) || undefined
    });
});

// Last-resort process guards: log instead of crashing on a stray rejection,
// but treat an uncaught exception as fatal (the process is in an unknown
// state) and let the supervisor restart it.
process.on('unhandledRejection', (reason) => {
    log.error({ err: reason instanceof Error ? reason : { message: String(reason) } }, 'unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
    log.error({ err }, 'uncaught exception — exiting');
    process.exit(1);
});

const serverInstance = app.listen(PORT, () => {
    generationJobService.configureExecutor(executeGenerationJobViaHttp);
    generationJobService.bootstrap();
    log.info({ port: PORT, dashboard: `http://localhost:${PORT}/dashboard.html` }, 'server listening');
});

module.exports = { app, serverInstance };
