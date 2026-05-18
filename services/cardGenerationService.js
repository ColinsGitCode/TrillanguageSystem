'use strict';

// Core LLM-driven card generation pipeline, extracted from server.js.
// `generateWithProvider` is the single entry point used by /api/generate
// (and indirectly by the generation_jobs worker). It is purely orchestration:
//   prompt build → optional few-shot enhancement (token-budget aware) →
//   provider call (Gemini CLI / Gemini proxy / local LLM) → normalize
//   response → compute observability (tokens / cost / quality / metadata).
// It does NOT touch the DB, save files, or call TTS; that is the caller's
// responsibility (see routes/generate.js).
//
// `generateWithAutoFallback` is a trivial wrapper kept for legacy callers.
//
// Side effects are limited to `perf.mark(...)`. Everything else is a pure
// transform over inputs + module-scope service singletons.

const path = require('path');

const { buildPrompt, buildMarkdownPrompt } = require('./promptEngine');
const geminiService = require('./geminiService');
const { runGeminiCli } = require('./geminiCliService');
const { runGeminiProxy } = require('./geminiProxyService');
const localLlmService = require('./localLlmService');
const { buildBaseName, ensureTodayDirectory, ensureFolderDirectory } = require('./fileManager');
const { renderHtmlFromMarkdown, buildAudioTasksFromMarkdown, prepareMarkdownForCard } = require('./htmlRenderer');
const goldenExamplesService = require('./goldenExamplesService');
const { TokenCounter, QualityChecker, PromptParser } = require('./observabilityService');

const {
  RECORDS_PATH,
  toNumberOr,
  normalizeCardType,
  normalizeSourceMode,
  resolveGeminiModel,
} = require('../lib/serverConfig');
const {
  truncateExamplesForBudget,
  validateSanitizedGeminiCardResponse,
} = require('../lib/generationHelpers');

async function generateWithProvider(phrase, provider, perf, options = {}) {
  let llmService;
  try {
    llmService = provider === 'gemini' ? geminiService : localLlmService;
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
        exampleIds: examples.map((ex) => ex.metadata?.generationId).filter(Boolean),
        examples: examples.map((ex) => ({
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
  let content;
  let usage;
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
    baseName,
    targetDir,
    folderName,
    observability: {
      tokens: usage,
      cost,
      quality,
      prompt: promptData,
      metadata: {
        provider,
        timestamp: Date.now(),
        model: provider === 'gemini'
          ? (useGeminiCli
            ? (response.model || resolvedGeminiCliModel || 'gemini-cli')
            : (useGeminiProxy ? (response.model || resolvedGeminiCliModel || process.env.GEMINI_PROXY_MODEL || 'gemini-cli') : process.env.GEMINI_MODEL))
          : process.env.LLM_MODEL,
        promptText: prompt,
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

async function generateWithAutoFallback(phrase, provider, perf, options = {}) {
  return generateWithProvider(phrase, provider, perf, options);
}

module.exports = {
  generateWithProvider,
  generateWithAutoFallback,
};
