'use strict';

// Text + record helpers shared across knowledge analysis tasks. Pure
// functions — no DB, no I/O, safe to require from any task module.

const crypto = require('crypto');

function stripHtml(text) {
  return String(text || '').replace(/<[^>]*>/g, '');
}

function normalizeText(text) {
  return stripHtml(String(text || ''))
    .replace(/[ \t\r\n]+/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

function profileLang(text) {
  const input = String(text || '');
  const hasZh = /[一-鿿]/.test(input);
  const hasJa = /[぀-ヿ]/.test(input);
  const hasEn = /[A-Za-z]/.test(input);
  if (hasZh && !hasJa && !hasEn) return 'zh';
  if (!hasZh && hasJa && !hasEn) return 'ja';
  if (!hasZh && !hasJa && hasEn) return 'en';
  return 'mixed';
}

function extractEnHeadword(record) {
  const phrase = String(record.phrase || '');
  const enFromPhrase = phrase.match(/[A-Za-z][A-Za-z\s\-']*/);
  if (enFromPhrase && enFromPhrase[0]) return enFromPhrase[0].trim();
  return normalizeText(record.en_translation || '').slice(0, 80) || null;
}

function extractJaHeadword(record) {
  const phrase = String(record.phrase || '');
  if (/[぀-ヿ]/.test(phrase)) return normalizeText(phrase).slice(0, 80);
  const ja = normalizeText(record.ja_translation || '');
  if (!ja) return null;
  return ja
    .replace(/\([^)]*\)/g, '')
    .replace(/[（][^）]*[）]/g, '')
    .slice(0, 80)
    .trim() || null;
}

function extractZhHeadword(record) {
  const phrase = String(record.phrase || '');
  const zhPhrase = phrase.match(/[一-鿿]{1,}/g);
  if (zhPhrase && zhPhrase.length) return zhPhrase.join('').slice(0, 40);
  return normalizeText(record.zh_translation || '').slice(0, 40) || null;
}

function buildAliases(record) {
  const set = new Set();
  [record.phrase, record.en_translation, record.ja_translation, record.zh_translation].forEach((value) => {
    const normalized = normalizeText(value);
    if (normalized) set.add(normalized);
  });
  return Array.from(set).slice(0, 12);
}

function inferTags(record) {
  const text = normalizeText([
    record.phrase,
    record.en_translation,
    record.ja_translation,
    record.zh_translation,
    record.markdown_content
  ].join(' ')).toLowerCase();

  const tags = [];
  const rules = [
    { tag: 'ai-tech', keys: ['model', 'prompt', 'token', 'llm', '推理', '模型', '提示词'] },
    { tag: 'engineering', keys: ['api', 'queue', 'retry', 'latency', 'circuit', 'cache', 'docker', 'proxy', 'db', 'database'] },
    { tag: 'communication', keys: ['简而言之', '也就是说', '要するに', 'つまり', 'explain', 'clarify'] },
    { tag: 'grammar-ja', keys: ['文法', 'grammar', '〜', 'わけでもなく', '要するに'] }
  ];
  rules.forEach((rule) => {
    if (rule.keys.some((key) => text.includes(String(key).toLowerCase()))) {
      tags.push(rule.tag);
    }
  });
  if (!tags.length) tags.push('general');
  return Array.from(new Set(tags));
}

function extractJapaneseSentences(markdownContent) {
  const text = String(markdownContent || '');
  const sectionMatch = text.match(/##\s*2\.[\s\S]*?(?:##\s*3\.|$)/);
  if (!sectionMatch) return [];
  const section = sectionMatch[0];
  const lines = section.split('\n');
  const sentences = [];
  for (const line of lines) {
    const match = line.match(/^\s*-\s*\*\*例句\d+\*\*:\s*(.+)$/);
    if (match) {
      const sentence = normalizeText(match[1]);
      if (sentence) sentences.push(sentence);
    }
  }
  return sentences;
}

function detectGrammarPatterns(sentence) {
  const knownPatterns = [
    { pattern: '〜わけでもなく', explanationZh: '表示并非完全如此，而是部分否定或缓和表达。' },
    { pattern: '〜要するに', explanationZh: '用于总结前文，表示“简而言之/总之”。' },
    { pattern: '〜ことがある', explanationZh: '表示“有时会……”的经验或偶发事件。' },
    { pattern: '〜ておく', explanationZh: '表示提前做好某动作以备后续。' },
    { pattern: '〜てしまう', explanationZh: '表示动作完成或带有遗憾语气。' },
    { pattern: '〜ように', explanationZh: '表示目的、变化结果或请求。' }
  ];

  const normalized = String(sentence || '');
  return knownPatterns.filter((item) => normalized.includes(item.pattern.replace('〜', '')));
}

function hashFingerprint(parts) {
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex');
}

function sanitizeMcpDiagnosticText(text) {
  if (typeof text !== 'string') return '';
  const inlinePrefix = /^\s*MCP issues detected\b[\s\S]*?Run\s+\/mcp\s+list\s+for\s+status\.?\s*/i;
  const patterns = [
    /^\s*MCP issues detected\b.*$/i,
    /^\s*Run\s+\/mcp\s+list\s+for\s+status\b.*$/i
  ];
  return String(text)
    .replace(inlinePrefix, '')
    .split(/\r?\n/)
    .filter((line) => !patterns.some((pattern) => pattern.test(line)))
    .join('\n')
    .trim();
}

function getLlmResponseText(response) {
  if (!response || typeof response !== 'object') return sanitizeMcpDiagnosticText(String(response || ''));
  const text = response.markdown || response.rawOutput || response.output || response.text || '';
  return sanitizeMcpDiagnosticText(String(text || ''));
}

function percentile(values, p = 0.95) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const pos = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return Number(sorted[pos] || 0);
}

module.exports = {
  stripHtml,
  normalizeText,
  profileLang,
  extractEnHeadword,
  extractJaHeadword,
  extractZhHeadword,
  buildAliases,
  inferTags,
  extractJapaneseSentences,
  detectGrammarPatterns,
  hashFingerprint,
  sanitizeMcpDiagnosticText,
  getLlmResponseText,
  percentile,
};
