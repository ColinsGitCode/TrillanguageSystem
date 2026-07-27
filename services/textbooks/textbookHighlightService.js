'use strict';

const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const { textbookError } = require('./textbookErrors');

const ALLOWED_TAGS = ['div', 'section', 'span', 'ruby', 'rt', 'rp', 'mark'];
const ALLOWED_ATTR = [
  'class',
  'data-textbook-track-id',
  'data-textbook-highlight-version',
  'data-textbook-expression-id',
  'data-textbook-language',
];

function normalizedText(node, { stripRubyReadings = false } = {}) {
  const clone = node.cloneNode(true);
  if (stripRubyReadings) clone.querySelectorAll('rt, rp').forEach((child) => child.remove());
  return String(clone.textContent || '').replace(/\s+/gu, ' ').trim();
}

function expressionFragmentsFromDocument(html, expressionId) {
  if (!html) return null;
  const parsed = new JSDOM(`<body>${html}</body>`);
  try {
    const section = parsed.window.document.querySelector(`[data-textbook-expression-id="${Number(expressionId)}"]`);
    if (!section) return null;
    return {
      en: section.querySelector('[data-textbook-language="en"]')?.innerHTML || '',
      ja: section.querySelector('[data-textbook-language="ja"]')?.innerHTML || '',
      zh: section.querySelector('[data-textbook-language="zh"]')?.innerHTML || '',
      annotationCount: new Set(
        Array.from(section.querySelectorAll('mark[data-annotation-id]'))
          .map((mark) => mark.getAttribute('data-annotation-id'))
          .filter(Boolean)
      ).size,
    };
  } finally {
    parsed.window.close();
  }
}

function sanitizeHighlightDocument(html, track) {
  const input = String(html || '');
  if (!input.trim() || input.length > 2_000_000) {
    throw textbookError('TEXTBOOK_HIGHLIGHT_INVALID', 400);
  }
  const window = new JSDOM('').window;
  const DOMPurify = createDOMPurify(window);
  const safe = DOMPurify.sanitize(input, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'audio', 'source'],
    FORBID_ATTR: ['style'],
  });
  window.close();

  const parsed = new JSDOM(`<body>${safe}</body>`);
  try {
    const { body } = parsed.window.document;
    if (body.children.length !== 1) throw textbookError('TEXTBOOK_HIGHLIGHT_INVALID', 400);
    const root = body.firstElementChild;
    if (
      !root
      || root.tagName !== 'DIV'
      || Number(root.getAttribute('data-textbook-track-id')) !== Number(track.id)
    ) {
      throw textbookError('TEXTBOOK_HIGHLIGHT_INVALID', 400);
    }

    const activeExpressions = track.expressions.filter((expression) => expression.lifecycle === 'active');
    const sections = Array.from(root.children);
    if (sections.length !== activeExpressions.length) {
      throw textbookError('TEXTBOOK_HIGHLIGHT_SOURCE_MISMATCH', 409);
    }
    const byId = new Map(activeExpressions.map((expression) => [Number(expression.expression_id), expression]));
    const seen = new Set();
    for (const section of sections) {
      if (section.tagName !== 'SECTION') throw textbookError('TEXTBOOK_HIGHLIGHT_INVALID', 400);
      const expressionId = Number(section.getAttribute('data-textbook-expression-id'));
      const expression = byId.get(expressionId);
      if (!expression || seen.has(expressionId)) throw textbookError('TEXTBOOK_HIGHLIGHT_SOURCE_MISMATCH', 409);
      seen.add(expressionId);

      const languageNodes = Array.from(section.children);
      if (languageNodes.length !== 3) throw textbookError('TEXTBOOK_HIGHLIGHT_SOURCE_MISMATCH', 409);
      const expected = {
        en: expression.official_en_text,
        ja: expression.official_ja_text,
        zh: expression.zh_cue_text,
      };
      const languages = new Set();
      for (const node of languageNodes) {
        if (node.tagName !== 'DIV') throw textbookError('TEXTBOOK_HIGHLIGHT_INVALID', 400);
        const language = node.getAttribute('data-textbook-language');
        if (!language || !(language in expected) || languages.has(language)) {
          throw textbookError('TEXTBOOK_HIGHLIGHT_SOURCE_MISMATCH', 409);
        }
        languages.add(language);
        const actualText = normalizedText(node, { stripRubyReadings: language === 'ja' });
        if (actualText !== String(expected[language]).replace(/\s+/gu, ' ').trim()) {
          throw textbookError('TEXTBOOK_HIGHLIGHT_SOURCE_MISMATCH', 409);
        }
      }
    }
    root.querySelectorAll('mark').forEach((mark) => {
      if (!mark.classList.contains('study-highlight-red') || mark.closest('rt, rp')) {
        throw textbookError('TEXTBOOK_HIGHLIGHT_INVALID', 400);
      }
      mark.className = 'study-highlight-red';
    });
    return root.outerHTML;
  } finally {
    parsed.window.close();
  }
}

module.exports = {
  expressionFragmentsFromDocument,
  sanitizeHighlightDocument,
};
