'use strict';

// /api/generate — the request-side orchestration around
// services/cardGenerationService.generateWithProvider. Handles throttle,
// validation, post-processing, file save, TTS, DB insert, few-shot
// run-record + experiment tracking, and the training-asset sidecar.

const express = require('express');
const {
  PerformanceMonitor,
  buildAudioTasksFromMarkdown,
  renderHtmlFromMarkdown,
  prepareMarkdownForCard,
  postProcessGeneratedContent,
  saveGeneratedFiles,
  generateAudioBatch,
  exampleReviewService,
  fewShotMetricsService,
  experimentTrackingService,
  persistTrainingAssetRecord,
  generateAndPersistTrainingAsset,
  summarizeTrainingAsset,
  generateWithAutoFallback,
  validateGeneratedContent,
  normalizeAudioTasks,
  buildE2EGenerateResult,
  buildE2ETrainingResult,
  checkGenerateThrottle,
  dbService,
  prepareInsertData,
  normalizeCardType,
  normalizeSourceMode,
  normalizeLlmProvider,
  resolveTrackingModel,
  createExperimentId,
  DEFAULT_LLM_PROVIDER,
  DEFAULT_GEMINI_MODEL,
  E2E_TEST_MODE,
} = require('./_shared');
const log = require('../lib/logger').child({ module: 'route/generate' });

const router = express.Router();

router.post('/api/generate', async (req, res) => {
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

    const genResult = E2E_TEST_MODE
      ? buildE2EGenerateResult({ phrase, cardType, requestedProvider, sourceMode })
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

    const validationErrors = validateGeneratedContent(content, { allowMissingHtml: true });
    if (validationErrors.length) {
      return res.status(422).json({ error: 'Validation failed', details: validationErrors, prompt, llm_output: content });
    }

    const derivedAudioTasks = buildAudioTasksFromMarkdown(content.markdown_content);
    if (!Array.isArray(content.audio_tasks) || !content.audio_tasks.length) {
      content.audio_tasks = derivedAudioTasks;
    }

    const preparedMarkdown = await prepareMarkdownForCard(content.markdown_content, { baseName, audioTasks: content.audio_tasks });
    content.markdown_content = preparedMarkdown;
    content.html_content = await renderHtmlFromMarkdown(preparedMarkdown, { baseName, audioTasks: content.audio_tasks });

    perf.mark('fileSave');
    const result = saveGeneratedFiles(phrase, content, {
      baseName,
      targetDir,
      folderName,
      cardType,
      sourceMode
    });

    let audio = null;
    const hasTtsEndpoint = !E2E_TEST_MODE && (process.env.TTS_EN_ENDPOINT || process.env.TTS_JA_ENDPOINT);
    if (hasTtsEndpoint && content.audio_tasks.length) {
      const audioTasks = normalizeAudioTasks(content.audio_tasks, result.baseName);
      audio = await generateAudioBatch(audioTasks, { outputDir: result.targetDir, baseName: result.baseName });
    }

    perf.mark('audioGenerate');
    observability.performance = perf.end();

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
        log.warn({ err: reviewErr }, 'review ingest failed');
      }
      log.info({ generationId }, 'inserted generation');
    } catch (dbError) {
      log.error({ err: dbError }, 'database insert failed');
    }

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
        log.warn({ err: fsErr }, 'fewshot run record failed');
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
        log.warn({ err: trainingErr }, 'training generation failed');
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
      generationId,
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
      log.warn({ err: trackErr }, 'failed to record error sample');
    }

    try {
      const requestedProvider = normalizeLlmProvider(req.body?.llm_provider || DEFAULT_LLM_PROVIDER);
      dbService.insertError({
        phrase: req.body?.phrase || 'unknown',
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
      log.error({ err: dbErr }, 'error insert failed');
    }

    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
