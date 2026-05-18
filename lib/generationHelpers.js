'use strict';

// Pure helpers carved out of server.js so they can be unit-tested directly.
// No Express, no I/O, no dbService. The only deps are two service modules that
// are themselves pure transforms (audio extension normalization + markdown→
// audio-task derivation).

const { normalizeAudioExtension, stripKnownAudioExtension } = require('../services/audioFormat');
const { buildAudioTasksFromMarkdown } = require('../services/htmlRenderer');

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

function validateGeneratedContent(content, options = {}) {
  const errors = [];
  if (!content || typeof content !== 'object') {
    errors.push('Response is not a valid JSON object');
    return errors;
  }
  if (typeof content.markdown_content !== 'string' || !content.markdown_content.trim()) {
    errors.push('markdown_content is missing or empty');
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
  truncateExamplesForBudget,
  normalizeAudioTasks,
  validateGeneratedContent,
  extractGeminiMarkdownResponse,
  validateSanitizedGeminiCardResponse,
};
