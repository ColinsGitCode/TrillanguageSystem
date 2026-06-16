'use strict';

// Pure helpers carved out of server.js so they can be unit-tested directly.
// No Express, no I/O, no dbService. The only deps are two service modules that
// are themselves pure transforms (audio extension normalization + markdown→
// audio-task derivation).

const { normalizeAudioExtension, stripKnownAudioExtension } = require('../services/generation/audioFormat');
const { buildAudioTasksFromMarkdown } = require('../services/generation/htmlRenderer');

const SCENARIO_EXPRESSIONS_HEADER_RE =
  /常用表达|常用表現|常用表達|common\s+(?:expressions?|phrases?)|useful\s+(?:expressions?|phrases?)|よく使う(?:表現|フレーズ)/i;

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

function getScenarioExpressionIndices(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  let inScenarioExpressions = false;
  const indices = [];
  lines.forEach((line) => {
    const headerMatch = line.match(/^##\s*(\d+)\.\s*(.+)\s*$/);
    if (headerMatch) {
      inScenarioExpressions =
        Number(headerMatch[1]) === 2 && SCENARIO_EXPRESSIONS_HEADER_RE.test(headerMatch[2]);
      return;
    }
    const expressionMatch = line.match(/^###\s*(\d{1,2})\.\s*.*$/);
    if (inScenarioExpressions && expressionMatch) {
      indices.push(Number(expressionMatch[1]));
    }
  });
  return indices;
}

function hasScenarioExpressionIndices(indices) {
  if (!Array.isArray(indices) || indices.length !== 12) return false;
  const seen = new Set(indices);
  if (seen.size !== 12) return false;
  for (let index = 1; index <= 12; index += 1) {
    if (!seen.has(index)) return false;
  }
  return true;
}

function hasOneAudioTaskPerScenarioIndex(audioTasks) {
  for (let index = 1; index <= 12; index += 1) {
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

function validateScenarioMarkdown(markdown) {
  if (!hasScenarioSections(markdown)) {
    return ['scenario_phrase requires 场景说明 and 常用表达 sections'];
  }
  if (!hasScenarioExpressionIndices(getScenarioExpressionIndices(markdown))) {
    return ['scenario_phrase requires exactly 12 expression blocks'];
  }
  const audioTasks = buildAudioTasksFromMarkdown(markdown);
  const englishTaskCount = audioTasks.filter((task) => task.lang === 'en').length;
  const japaneseTaskCount = audioTasks.filter((task) => task.lang === 'ja').length;
  if (englishTaskCount !== 12 || japaneseTaskCount !== 12) {
    return ['scenario_phrase requires 12 English and 12 Japanese audio lines'];
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

  if (cardType === 'scenario_phrase') {
    return validateScenarioMarkdown(markdown).length === 0;
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

module.exports = {
  normalizeAudioTasks,
  validateGeneratedContent,
  extractGeminiMarkdownResponse,
  validateSanitizedGeminiCardResponse,
};
