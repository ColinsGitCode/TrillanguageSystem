'use strict';

// Pure helpers carved out of server.js so they can be unit-tested directly.
// No Express, no I/O, no dbService. The only deps are two service modules that
// are themselves pure transforms (audio extension normalization + markdown→
// audio-task derivation).

const { normalizeAudioExtension, stripKnownAudioExtension } = require('../services/generation/audioFormat');
const { buildAudioTasksFromMarkdown } = require('../services/generation/htmlRenderer');
const {
  CURRENT_SCENARIO_EXPRESSION_COUNT,
  SCENARIO_EXPRESSIONS_HEADER_RE,
} = require('./scenarioCardContract');
const SCENARIO_TITLE_MAX_CHARS = 10;
// Raised when a provider response is well-formed but does not satisfy the card
// contract. Treated as transient by the generation worker: it is caused by LLM
// output variance (block count, title length, a missing audio line), so a
// bounded re-roll usually succeeds.
const CARD_VALIDATION_FAILED_CODE = 'CARD_VALIDATION_FAILED';
const SCENARIO_TITLE_ERROR = 'scenario_phrase title must be 1-10 characters';

function normalizeAudioTasks(tasks, baseName) {
  if (!Array.isArray(tasks)) return [];
  return tasks.map((task, index) => {
    const normalized = { ...task };
    let suffix = String(normalized.filename_suffix || '');
    if (baseName && suffix.includes(baseName)) {
      suffix = suffix.replace(baseName, '');
    }
    suffix = stripKnownAudioExtension(suffix);
    if (!suffix.trim()) {
      suffix = `_${normalized.lang || 'en'}_${index + 1}`;
    }
    normalized.filename_suffix = suffix;
    normalized.extension = normalizeAudioExtension(normalized.extension, normalized.lang);
    if (normalized.lang === 'en' && !normalized.response_format) {
      normalized.response_format = normalized.extension;
    }
    return normalized;
  });
}

function buildPersistedAudioTasks(sourceTasks, audio) {
  if (!Array.isArray(sourceTasks) || !Array.isArray(audio?.results)) return [];
  return audio.results
    .map((result) => {
      const task = sourceTasks[result.index];
      if (!task) return null;
      const persisted = {
        ...task,
        extension: result.extension || task.extension,
        filePath: result.filePath || task.filePath,
        status: result.status || 'generated',
      };
      const ttsProvider = result.ttsProvider || result.provider || task.ttsProvider;
      const ttsModel = result.ttsModel || result.model || task.ttsModel;
      const ttsVoice = result.ttsVoice || result.voice || task.ttsVoice;
      if (ttsProvider !== undefined) persisted.ttsProvider = ttsProvider;
      if (ttsModel !== undefined) persisted.ttsModel = ttsModel;
      if (ttsVoice !== undefined) persisted.ttsVoice = ttsVoice;
      return persisted;
    })
    .filter(Boolean);
}

function getScenarioExpressionBlocks(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  let inScenarioExpressions = false;
  const blocks = [];
  let currentBlock = null;

  function pushCurrentBlock() {
    if (currentBlock) blocks.push(currentBlock);
    currentBlock = null;
  }

  lines.forEach((line) => {
    const headerMatch = line.match(/^##\s*(\d+)\.\s*(.+)\s*$/);
    if (headerMatch) {
      pushCurrentBlock();
      inScenarioExpressions =
        Number(headerMatch[1]) === 2 && SCENARIO_EXPRESSIONS_HEADER_RE.test(headerMatch[2]);
      return;
    }
    const expressionMatch = line.match(/^###\s*(\d{1,2})\.\s*.*$/);
    if (inScenarioExpressions && expressionMatch) {
      pushCurrentBlock();
      currentBlock = {
        index: Number(expressionMatch[1]),
        lines: [line],
      };
      return;
    }
    if (inScenarioExpressions && currentBlock) {
      currentBlock.lines.push(line);
    }
  });
  pushCurrentBlock();
  return blocks;
}

function hasScenarioExpressionIndices(indices) {
  if (!Array.isArray(indices) || indices.length !== CURRENT_SCENARIO_EXPRESSION_COUNT) return false;
  const seen = new Set(indices);
  if (seen.size !== CURRENT_SCENARIO_EXPRESSION_COUNT) return false;
  for (let index = 1; index <= CURRENT_SCENARIO_EXPRESSION_COUNT; index += 1) {
    if (!seen.has(index)) return false;
  }
  return true;
}

function hasOneAudioTaskPerScenarioIndex(audioTasks) {
  for (let index = 1; index <= CURRENT_SCENARIO_EXPRESSION_COUNT; index += 1) {
    const englishCount = audioTasks.filter(
      (task) => task.lang === 'en' && task.filename_suffix === `_en_${index}`
    ).length;
    const japaneseCount = audioTasks.filter(
      (task) => task.lang === 'ja' && task.filename_suffix === `_ja_${index}`
    ).length;
    if (englishCount !== 1 || japaneseCount !== 1) return false;
  }
  return true;
}

function hasScenarioSections(markdown) {
  const text = String(markdown || '');
  return text.includes('## 1. 场景说明') && text.includes('## 2. 常用表达');
}

function getMarkdownTitle(markdown) {
  const match = String(markdown || '').match(/^#\s+(.+?)\s*$/m);
  return match ? match[1].trim() : '';
}

function getScenarioTitleLength(title) {
  return [...String(title || '').replace(/[\s\p{P}\p{S}]/gu, '')].length;
}

function hasValidScenarioTitle(markdown) {
  const title = getMarkdownTitle(markdown);
  const length = getScenarioTitleLength(title);
  return length >= 1 && length <= SCENARIO_TITLE_MAX_CHARS;
}

function hasRequiredScenarioBlockFields(blocks) {
  if (!Array.isArray(blocks) || blocks.length !== CURRENT_SCENARIO_EXPRESSION_COUNT) return false;
  const hasNonEmptyField = (blockText, labelPattern) => {
    const match = blockText.match(new RegExp(`^\\s*-[ \\t]*\\*\\*(?:${labelPattern})\\*\\*[ \\t]*[:：][ \\t]*(\\S.*)$`, 'im'));
    return Boolean(match && match[1].trim());
  };
  return blocks.every((block) => {
    const blockText = block.lines.join('\n');
    return hasNonEmptyField(blockText, '中文|Chinese|中国語|中國語')
      && hasNonEmptyField(blockText, '使用提示|使用场景|使用場景|Usage\\s*Tip|Tip');
  });
}

function validateScenarioMarkdown(markdown) {
  if (!hasValidScenarioTitle(markdown)) {
    return [SCENARIO_TITLE_ERROR];
  }
  if (!hasScenarioSections(markdown)) {
    return ['scenario_phrase requires 场景说明 and 常用表达 sections'];
  }
  const expressionBlocks = getScenarioExpressionBlocks(markdown);
  if (!hasScenarioExpressionIndices(expressionBlocks.map((block) => block.index))) {
    return [`scenario_phrase requires exactly ${CURRENT_SCENARIO_EXPRESSION_COUNT} expression blocks`];
  }
  if (!hasRequiredScenarioBlockFields(expressionBlocks)) {
    return ['scenario_phrase requires every expression block to include non-empty Chinese and usage hint lines'];
  }
  const audioTasks = buildAudioTasksFromMarkdown(markdown);
  const englishTaskCount = audioTasks.filter((task) => task.lang === 'en').length;
  const japaneseTaskCount = audioTasks.filter((task) => task.lang === 'ja').length;
  if (
    englishTaskCount !== CURRENT_SCENARIO_EXPRESSION_COUNT
    || japaneseTaskCount !== CURRENT_SCENARIO_EXPRESSION_COUNT
  ) {
    return [
      `scenario_phrase requires ${CURRENT_SCENARIO_EXPRESSION_COUNT} English and `
      + `${CURRENT_SCENARIO_EXPRESSION_COUNT} Japanese audio lines`,
    ];
  }
  if (!hasOneAudioTaskPerScenarioIndex(audioTasks)) {
    return ['scenario_phrase requires one English and one Japanese audio line per expression block'];
  }
  return [];
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
  const cardType = String(options.cardType || 'trilingual').trim().toLowerCase();
  if (
    cardType === 'scenario_phrase' &&
    typeof content.markdown_content === 'string' &&
    content.markdown_content.trim()
  ) {
    errors.push(...validateScenarioMarkdown(content.markdown_content));
  }
  if (!options.allowMissingHtml && (!content.html_content || !content.html_content.includes('<html'))) {
    // Strict HTML check is currently relaxed because the viewer re-renders
    // markdown locally; intentionally left as a no-op until that's revisited.
  }
  return errors;
}

function resolveCardAudioTasks(content, cardType = 'trilingual') {
  const existingAudioTasks = Array.isArray(content?.audio_tasks) ? content.audio_tasks : [];
  const derivedAudioTasks = buildAudioTasksFromMarkdown(content?.markdown_content || '');
  if (String(cardType || '').trim().toLowerCase() === 'scenario_phrase') {
    return derivedAudioTasks;
  }
  return existingAudioTasks.length ? existingAudioTasks : derivedAudioTasks;
}

function extractMarkdownProviderResponse(response) {
  if (!response || typeof response !== 'object') return '';
  return String(response.markdown || response.rawOutput || response.text || '').trim();
}

// Returns the concrete reasons a provider response is not a usable card.
// `validateSanitizedCardResponse` keeps its boolean contract on top of this, so
// yes/no callers are unaffected while the generation pipeline can report which
// rule actually failed instead of a generic "failed card validation".
function getCardResponseValidationErrors(response, cardType = 'trilingual') {
  const markdown = extractMarkdownProviderResponse(response);
  if (!markdown) return ['provider response contained no markdown'];
  if (/MCP issues detected|Run\s+\/mcp\s+list\s+for\s+status|\/mcp list/i.test(markdown)) {
    return ['provider response contained MCP diagnostics instead of card markdown'];
  }

  if (cardType === 'scenario_phrase') {
    return validateScenarioMarkdown(markdown);
  }

  const errors = [];
  const requiredSections = cardType === 'grammar_ja'
    ? ['## 1. 语法概述', '## 2. 日本語', '## 3. 常见误用']
    : ['## 1. 英文', '## 2. 日本語', '## 3. 中文'];
  const missingSections = requiredSections.filter((section) => !markdown.includes(section));
  if (missingSections.length) {
    errors.push(`missing required sections: ${missingSections.join(', ')}`);
  }

  const audioTasks = buildAudioTasksFromMarkdown(markdown);
  const minAudioTasks = cardType === 'grammar_ja' ? 3 : 4;
  if (audioTasks.length < minAudioTasks) {
    errors.push(`requires at least ${minAudioTasks} audio lines, found ${audioTasks.length}`);
  }
  return errors;
}

function validateSanitizedCardResponse(response, cardType = 'trilingual') {
  return getCardResponseValidationErrors(response, cardType).length === 0;
}

module.exports = {
  CARD_VALIDATION_FAILED_CODE,
  normalizeAudioTasks,
  resolveCardAudioTasks,
  buildPersistedAudioTasks,
  validateGeneratedContent,
  extractMarkdownProviderResponse,
  getCardResponseValidationErrors,
  validateSanitizedCardResponse,
};
