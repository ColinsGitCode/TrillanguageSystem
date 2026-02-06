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
const { saveGeneratedFiles, buildBaseName, ensureTodayDirectory } = require('./services/fileManager');
const { generateAudioBatch } = require('./services/ttsService');
const { renderHtmlFromMarkdown, buildAudioTasksFromMarkdown, prepareMarkdownForCard } = require('./services/htmlRenderer');
const { postProcessGeneratedContent } = require('./services/contentPostProcessor');
const geminiAuthService = require('./services/geminiAuthService');
const goldenExamplesService = require('./services/goldenExamplesService');
const fewShotMetricsService = require('./services/fewShotMetricsService');
const crypto = require('crypto');

const { TokenCounter, PerformanceMonitor, QualityChecker, PromptParser } = require('./services/observabilityService');
const { HealthCheckService } = require('./services/healthCheckService');

// 数据库服务
const dbService = require('./services/databaseService');
const { prepareInsertData } = require('./services/databaseHelpers');

const app = express();
const PORT = process.env.PORT || 3010;
const RECORDS_PATH = process.env.RECORDS_PATH || '/data/trilingual_records';

app.use(express.static('public'));
app.use('/data', express.static(RECORDS_PATH));
app.use(express.json({ limit: '10mb' }));

// ... (Keep existing throttle logic and helper functions)
const GENERATE_MIN_INTERVAL_MS = 4000;
const generationThrottle = new Map();
function canGenerate(req) {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const last = generationThrottle.get(key) || 0;
    if (now - last < GENERATE_MIN_INTERVAL_MS) {
        return false;
    }
    generationThrottle.set(key, now);
    return true;
}

function createExperimentId() {
    return `exp_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
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

// ========== Core Logic ==========

async function generateWithProvider(phrase, provider, perf) {
  let llmService;
  try {
      llmService = provider === 'gemini' ? geminiService : require('./services/localLlmService');
  } catch (e) {
      throw new Error(`Provider ${provider} not available: ${e.message}`);
  }

  perf.mark('promptBuild');
  const { targetDir, folderName } = ensureTodayDirectory();
  const baseName = buildBaseName(phrase, targetDir);
  const geminiMode = (process.env.GEMINI_MODE || 'cli').toLowerCase();
  const localOutputMode = (process.env.LLM_OUTPUT_MODE || 'json').toLowerCase();
  const useGeminiCli = provider === 'gemini' && geminiMode === 'cli';
  const useGeminiProxy = provider === 'gemini' && geminiMode === 'host-proxy';
  const useLocalMarkdown = provider === 'local' && localOutputMode === 'markdown';
  const useMarkdownOutput = useGeminiCli || useGeminiProxy || useLocalMarkdown;
  let prompt = useMarkdownOutput
      ? buildMarkdownPrompt({ phrase, filenameBase: baseName })
      : buildPrompt({ phrase, filenameBase: baseName });

  const fewShotConfig = {
      enabled: provider === 'local' && String(process.env.ENABLE_GOLDEN_EXAMPLES || '').toLowerCase() === 'true',
      strategy: process.env.GOLDEN_EXAMPLES_STRATEGY || 'HIGH_QUALITY_GEMINI',
      count: Number(process.env.GOLDEN_EXAMPLES_COUNT || 3),
      minScore: Number(process.env.GOLDEN_EXAMPLES_MIN_SCORE || 85),
      contextWindow: Number(process.env.LLM_CONTEXT_WINDOW || 4096),
      tokenBudgetRatio: Number(process.env.FEWSHOT_TOKEN_BUDGET_RATIO || 0.25)
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
          minQualityScore: fewShotConfig.minScore
      });
      let enhancedPrompt = prompt;
      let fallbackReason = null;

      if (!examples.length) {
          fallbackReason = 'no_examples';
      } else {
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
          outputDir: process.env.GEMINI_CLI_OUTPUT_DIR || path.join(RECORDS_PATH, 'cli_suggestions')
      });
  } else if (useGeminiProxy) {
      response = await runGeminiProxy(prompt, { baseName });
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
              ? (process.env.GEMINI_CLI_MODEL || 'gemini-cli')
              : (useGeminiProxy ? (process.env.GEMINI_PROXY_MODEL || 'gemini-cli') : process.env.GEMINI_MODEL))
            : process.env.LLM_MODEL,
        promptText: prompt,  // 在 metadata 中也保存一份
        promptParsed: promptData,
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

  const results = {
    phrase,
    gemini: { success: false },
    local: { success: false },
    comparison: null
  };

  const perfGemini = new PerformanceMonitor().start();
  const perfLocal = new PerformanceMonitor().start();

  const [geminiResult, localResult] = await Promise.allSettled([
    generateWithProvider(phrase, 'gemini', perfGemini),
    generateWithProvider(phrase, 'local', perfLocal)
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
        folderName: baseInfo.folderName
      });
    } catch (err) {
      console.warn('[Comparison] Input card save failed:', err.message);
      return null;
    }
  };

  const finalizeSide = async (label, genValue, perf) => {
    const { output: content, prompt, observability, baseName, targetDir, folderName } = genValue;

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
      fileResult = saveGeneratedFiles(phrase, content, { baseName: compareBaseName, targetDir, folderName });
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
          audioTasks: content.audio_tasks
        });
        const generationId = dbService.insertGeneration(dbData);
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
          } catch (fsErr) {
            console.warn('[FewShot] Compare run record failed:', fsErr.message);
          }
        }
      } catch (dbErr) {
        console.error('[Database] Compare insert failed:', dbErr.message);
      }
    }

    return { output: content, observability, result: fileResult, audio };
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

app.post('/api/generate', async (req, res) => {
  const perf = new PerformanceMonitor().start();
  try {
    if (!canGenerate(req)) return res.status(429).json({ error: 'Rate limit exceeded' });

    // 默认使用本地LLM（Gemini已封存）
    const { phrase, llm_provider = 'local', enable_compare = false, experiment_id, variant } = req.body;
    if (!phrase) return res.status(400).json({ error: 'Phrase required' });

    // Mode: Comparison
    if (enable_compare) {
        const expId = experiment_id || createExperimentId();
        const result = await handleComparisonMode(phrase, { experimentId: expId, variantBase: variant || 'compare' });
        return res.json(result);
    }

    // Mode: Single
    const genResult = await generateWithProvider(phrase, llm_provider, perf);
    const { output: content, prompt, observability, baseName, targetDir, folderName } = genResult;

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
    const result = saveGeneratedFiles(phrase, content, { baseName, targetDir, folderName });

    // TTS
    let audio = null;
    const hasTtsEndpoint = process.env.TTS_EN_ENDPOINT || process.env.TTS_JA_ENDPOINT;
    if (hasTtsEndpoint && content.audio_tasks.length) {
        const audioTasks = normalizeAudioTasks(content.audio_tasks, result.baseName);
        audio = await generateAudioBatch(audioTasks, { outputDir: result.targetDir, baseName: result.baseName, extension: 'wav' });
    }

    perf.mark('audioGenerate');
    observability.performance = perf.end(); // Finalize perf stats

    // 插入数据库
    let generationId = null;
    try {
      const dbData = prepareInsertData({
        phrase,
        provider: llm_provider,
        model: observability.metadata?.model || llm_provider,
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
        audioTasks: audio?.tasks || []
      });

      generationId = dbService.insertGeneration(dbData);
      console.log('[Database] Inserted generation:', generationId);
    } catch (dbError) {
      console.error('[Database] Insert failed:', dbError.message);
      // 数据库插入失败不影响主流程
    }

    // Few-shot run record (baseline/fewshot)
    if (generationId) {
      try {
        const expId = experiment_id || createExperimentId();
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
      } catch (fsErr) {
        console.warn('[FewShot] Run record failed:', fsErr.message);
      }
    }

    res.json({
        success: true,
        generationId, // 返回数据库ID
        result,
        audio,
        prompt,
        llm_output: content,
        observability
    });

  } catch (err) {
      console.error('[Generate] Error:', err);

      // 记录错误到数据库
      try {
        dbService.insertError({
          phrase: req.body.phrase || 'unknown',
          llmProvider: req.body.llm_provider || 'unknown',
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
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: 'No image' });
        const text = await localLlmService.recognizeImage(image);
        res.json({ text: text || 'No text found' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/health', async (req, res) => {
    try {
        const status = await HealthCheckService.checkAll();
        res.json(status);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ========== Gemini CLI Auth ==========
app.get('/api/gemini/auth/status', (req, res) => {
  const enabled = (process.env.GEMINI_MODE || 'cli').toLowerCase() === 'cli';
  const status = geminiAuthService.getStatus();
  res.json({ enabled, ...status });
});

app.post('/api/gemini/auth/start', async (req, res) => {
  const enabled = (process.env.GEMINI_MODE || 'cli').toLowerCase() === 'cli';
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
            dateFrom,
            dateTo
        } = req.query;

        const records = dbService.queryGenerations({
            page: Number(page),
            limit: Number(limit),
            search,
            provider,
            dateFrom,
            dateTo
        });

        const total = dbService.getTotalCount({
            search,
            provider,
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

// 根据文件夹+文件名定位记录
app.get('/api/records/by-file', (req, res) => {
    try {
        const folder = String(req.query.folder || '').trim();
        const base = String(req.query.base || '').trim();
        if (!folder || !base) {
            return res.status(400).json({ error: 'folder and base are required' });
        }

        const record = dbService.getGenerationByFile(folder, base);
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
        const base = String(req.query.base || '').trim();
        if (!folder || !base) {
            return res.status(400).json({ error: 'folder and base are required' });
        }

        const { deleteRecordFiles } = require('./services/fileManager');
        const deletedPaths = new Set();

        // 1) 尝试按数据库记录删除
        const record = dbService.getGenerationByFile(folder, base);
        if (record) {
            const recordDetail = dbService.getGenerationById(record.id);
            const recordFiles = [
                recordDetail?.md_file_path,
                recordDetail?.html_file_path,
                recordDetail?.meta_file_path,
            ].filter(Boolean);

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
        const fallbackDeleted = deleteRecordFiles(folder, base);
        fallbackDeleted.forEach((p) => deletedPaths.add(p));

        res.json({
            success: true,
            deletedFiles: deletedPaths.size,
            recordDeleted: Boolean(record)
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
        res.json({ experimentId, runs, examples });
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
            record.meta_file_path
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
        let deletedCount = 0;
        for (const filePath of filesToDelete) {
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    deletedCount++;
                    console.log(`[Delete] Removed file: ${filePath}`);
                }
            } catch (fileErr) {
                console.warn(`[Delete] Failed to remove file: ${filePath}`, fileErr.message);
            }
        }

        // 3. 从数据库删除记录（级联删除会自动删除音频和observability记录）
        dbService.deleteGeneration(recordId);

        console.log(`[Delete] Record ${recordId} deleted (${deletedCount} files removed)`);

        res.json({
            success: true,
            message: 'Record deleted successfully',
            deletedFiles: deletedCount
        });

    } catch (err) {
        console.error('[API /records/:id DELETE] Error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Mission Control available at http://localhost:${PORT}/dashboard.html`);
});
