'use strict';

// Core LLM-driven card generation pipeline, extracted from server.js.
// `generateWithProvider` is the single entry point used by /api/generate
// (and indirectly by the generation_jobs worker). It is purely orchestration:
//   markdown prompt build → DeepSeek provider call →
//   normalize response → compute observability (tokens / cost / quality /
//   metadata).
// It does NOT touch the DB, save files, or call TTS; that is the caller's
// responsibility (see routes/generate.js).
//
// Side effects are limited to `perf.mark(...)`. Everything else is a pure
// transform over inputs + module-scope service singletons.

const { buildMarkdownPrompt } = require('./promptEngine');
const deepseekService = require('../llm/deepseekService');
const { buildBaseName, ensureTodayDirectory, ensureFolderDirectory } = require('../storage/fileManager');
const { renderHtmlFromMarkdown, buildAudioTasksFromMarkdown, prepareMarkdownForCard } = require('./htmlRenderer');
const { TokenCounter, QualityChecker, PromptParser } = require('../observability/observabilityService');

const {
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_DEEPSEEK_TIMEOUT_MS,
  normalizeCardType,
  normalizeSourceMode,
  resolveDeepSeekModel,
} = require('../../lib/serverConfig');
const {
  validateSanitizedCardResponse,
  extractMarkdownProviderResponse,
} = require('../../lib/generationHelpers');

async function generateWithProvider(phrase, _provider, perf, options = {}) {
  const providerName = 'deepseek';
  perf.mark('promptBuild');
  const cardType = normalizeCardType(options.cardType);
  const sourceMode = normalizeSourceMode(options.sourceMode);
  const { targetDir, folderName } = options.targetFolder
    ? ensureFolderDirectory(options.targetFolder)
    : ensureTodayDirectory();
  const baseName = buildBaseName(phrase, targetDir);
  const model = resolveDeepSeekModel(options.modelOverride || DEFAULT_DEEPSEEK_MODEL);
  const timeoutMs = options.timeoutMs || DEFAULT_DEEPSEEK_TIMEOUT_MS;
  const prompt = buildMarkdownPrompt({ phrase, filenameBase: baseName, cardType });

  perf.mark('llmCall');
  const response = await deepseekService.generateMarkdown(prompt, { model, timeoutMs });
  if (!validateSanitizedCardResponse(response, cardType)) {
    throw new Error('DeepSeek markdown response failed card validation');
  }
  const markdown = extractMarkdownProviderResponse(response);
  const audioTasks = buildAudioTasksFromMarkdown(markdown);
  const preparedMarkdown = await prepareMarkdownForCard(markdown, { baseName, audioTasks });
  const htmlContent = await renderHtmlFromMarkdown(preparedMarkdown, { baseName, audioTasks, prepared: true });
  const content = {
    markdown_content: preparedMarkdown,
    html_content: htmlContent,
    audio_tasks: audioTasks
  };
  const estimatedInputTokens = TokenCounter.estimate(prompt);
  const estimatedOutputTokens = TokenCounter.estimate(markdown);
  const providerUsage = response.usage || null;
  const providerUsageTotal =
    Number(providerUsage?.input || 0) + Number(providerUsage?.output || 0) + Number(providerUsage?.total || 0);
  const hasAuthoritativeProviderUsage = providerUsageTotal > 0;
  const usage = hasAuthoritativeProviderUsage ? providerUsage : {
    input: estimatedInputTokens,
    output: estimatedOutputTokens,
    total: estimatedInputTokens + estimatedOutputTokens
  };

  perf.mark('jsonParse');

  const cost = TokenCounter.calculateCost(usage, providerName, { model });
  const quality = QualityChecker.check(content, phrase);
  const promptData = PromptParser.parse(prompt);

  return {
    output: content,
    prompt,
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
        provider: providerName,
        timestamp: Date.now(),
        model: response.model || model,
        promptText: prompt,
        promptParsed: promptData,
        cardType,
        sourceMode,
        outputMode: 'markdown',
        rawOutput: response.rawOutput || markdown,
        outputStructured: JSON.stringify(content, null, 2)
      }
    }
  };
}

module.exports = {
  generateWithProvider,
};
