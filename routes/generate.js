'use strict';

// /api/generate — the request-side orchestration around
// services/generation/cardGenerationService.generateWithProvider. Handles throttle,
// validation, post-processing, file save, TTS, and DB insert.

const express = require('express');
const {
  PerformanceMonitor,
  buildAudioTasksFromMarkdown,
  renderHtmlFromMarkdown,
  prepareMarkdownForCard,
  postProcessGeneratedContent,
  saveGeneratedFiles,
  generateAudioBatch,
  generateWithAutoFallback,
  validateGeneratedContent,
  normalizeAudioTasks,
  buildE2EGenerateResult,
  checkGenerateThrottle,
  dbService,
  prepareInsertData,
  normalizeCardType,
  normalizeSourceMode,
  normalizeLlmProvider,
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
    } = req.body;
    if (!phrase) return res.status(400).json({ error: 'Phrase required' });
    const requestedProvider = 'gemini';
    const cardType = normalizeCardType(card_type);
    const sourceMode = normalizeSourceMode(source_mode);

    const genResult = E2E_TEST_MODE
      ? buildE2EGenerateResult({ phrase, cardType, requestedProvider, sourceMode })
      : await generateWithAutoFallback(phrase, requestedProvider, perf, {
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
      log.info({ generationId }, 'inserted generation');
    } catch (dbError) {
      log.error({ err: dbError }, 'database insert failed');
    }

    res.json({
      success: true,
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
      observability
    });
  } catch (err) {
    log.error({ err, route: '/api/generate' }, 'generate failed');

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
