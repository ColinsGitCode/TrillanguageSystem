'use strict';

// Core LLM-driven card generation pipeline, extracted from server.js.
// `generateWithProvider` is the single entry point used by /api/generate
// (and indirectly by the generation_jobs worker). It is purely orchestration:
//   prompt build → provider call (Gemini CLI / Gemini proxy / local LLM) →
//   normalize response → compute observability (tokens / cost / quality /
//   metadata).
// It does NOT touch the DB, save files, or call TTS; that is the caller's
// responsibility (see routes/generate.js).
//
// `generateWithAutoFallback` is a trivial wrapper kept for legacy callers.
//
// Side effects are limited to `perf.mark(...)`. Everything else is a pure
// transform over inputs + module-scope service singletons.

const path = require('path');

const { buildPrompt, buildMarkdownPrompt } = require('./promptEngine');
const geminiService = require('../llm/geminiService');
const { runGeminiCli } = require('../llm/geminiCliService');
const { runGeminiProxy } = require('../llm/geminiProxyService');
const localLlmService = require('../llm/localLlmService');
const { buildBaseName, ensureTodayDirectory, ensureFolderDirectory } = require('../storage/fileManager');
const { renderHtmlFromMarkdown, buildAudioTasksFromMarkdown, prepareMarkdownForCard } = require('./htmlRenderer');
const { TokenCounter, QualityChecker, PromptParser } = require('../observability/observabilityService');

const {
  RECORDS_PATH,
  normalizeCardType,
  normalizeSourceMode,
  resolveDeepSeekModel,
} = require('../../lib/serverConfig');
const {
  validateSanitizedGeminiCardResponse,
} = require('../../lib/generationHelpers');

function sanitizeLegacyGeminiModelName(modelName) {
  const model = String(modelName || '').trim();
  if (!model) return '';
  const lowered = model.toLowerCase();
  if (lowered === 'gemini-cli' || lowered === 'cli' || lowered === 'default') return '';
  if (lowered === 'deepseek-v4-flash' || lowered === 'deepseek-v4-pro' || lowered.startsWith('deepseek-')) return '';
  return model;
}

function resolveLegacyGeminiModel(mode, modelOverride) {
  const candidates = mode === 'host-proxy'
    ? [
        modelOverride,
        process.env.GEMINI_PROXY_MODEL,
        process.env.TRAINING_TEACHER_MODEL,
        process.env.GEMINI_CLI_MODEL,
        process.env.GEMINI_MODEL
      ]
    : [
        modelOverride,
        process.env.GEMINI_CLI_MODEL,
        process.env.GEMINI_MODEL,
        process.env.TRAINING_TEACHER_MODEL
      ];

  for (const candidate of candidates) {
    const sanitized = sanitizeLegacyGeminiModelName(candidate);
    if (sanitized) return sanitized;
  }
  return '';
}

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
  const resolvedModel = provider === 'deepseek'
    ? resolveDeepSeekModel(options.modelOverride)
    : (provider === 'gemini' ? resolveLegacyGeminiModel(geminiMode, options.modelOverride) : '');
  const useLocalMarkdown = provider === 'local' && localOutputMode === 'markdown';
  const useMarkdownOutput = useGeminiCli || useGeminiProxy || useLocalMarkdown;
  const prompt = useMarkdownOutput
    ? buildMarkdownPrompt({ phrase, filenameBase: baseName, cardType })
    : buildPrompt({ phrase, filenameBase: baseName, cardType });

  perf.mark('llmCall');
  let response;
  if (useGeminiCli) {
    response = await runGeminiCli(prompt, {
      baseName,
      outputDir: process.env.GEMINI_CLI_OUTPUT_DIR || path.join(RECORDS_PATH, 'cli_suggestions'),
      model: resolvedModel
    });
  } else if (useGeminiProxy) {
    response = await runGeminiProxy(prompt, {
      baseName,
      model: resolvedModel,
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
            ? (response.model || resolvedModel || 'gemini-cli')
            : (useGeminiProxy ? (response.model || resolvedModel || process.env.GEMINI_PROXY_MODEL || 'gemini-cli') : process.env.GEMINI_MODEL))
          : process.env.LLM_MODEL,
        promptText: prompt,
        promptParsed: promptData,
        cardType,
        sourceMode,
        outputMode: useMarkdownOutput ? 'markdown' : 'json',
        rawOutput: useMarkdownOutput
          ? (response.rawOutput || content?.markdown_content || '')
          : JSON.stringify(content, null, 2),
        outputStructured: JSON.stringify(content, null, 2)
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
