import createDOMPurify from 'dompurify';
import type { TextbookTrack } from './types';

const ALLOWED_TAGS = ['div', 'section', 'span', 'ruby', 'rt', 'rp', 'mark'];
const ALLOWED_ATTR = [
  'class',
  'data-textbook-track-id',
  'data-textbook-highlight-version',
  'data-textbook-expression-id',
  'data-textbook-language',
];

export function escapeTextbookText(value: string) {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

export function sanitizeTextbookHighlightDocument(html: string) {
  if (typeof window === 'undefined') return '';
  const DOMPurify = createDOMPurify(window);
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'audio', 'source'],
    FORBID_ATTR: ['style'],
  });
}

export function buildTextbookHighlightDocument(track: TextbookTrack) {
  const expressions = track.expressions.filter((expression) => expression.lifecycle === 'active').map((expression) => `
    <section data-textbook-expression-id="${expression.expression_id}">
      <div data-textbook-language="en">${escapeTextbookText(expression.official_en_text)}</div>
      <div data-textbook-language="ja">${expression.ja_ruby_html}</div>
      <div data-textbook-language="zh">${escapeTextbookText(expression.zh_cue_text)}</div>
    </section>`).join('');
  return sanitizeTextbookHighlightDocument(
    `<div data-textbook-track-id="${track.id}" data-textbook-highlight-version="1">${expressions}</div>`
  );
}

export function expressionHighlightFragments(html: string, expressionId: number) {
  if (typeof window === 'undefined' || !html) return null;
  const parsed = new DOMParser().parseFromString(sanitizeTextbookHighlightDocument(html), 'text/html');
  const section = parsed.querySelector(`[data-textbook-expression-id="${expressionId}"]`);
  if (!section) return null;
  return {
    en: section.querySelector('[data-textbook-language="en"]')?.innerHTML || '',
    ja: section.querySelector('[data-textbook-language="ja"]')?.innerHTML || '',
    zh: section.querySelector('[data-textbook-language="zh"]')?.innerHTML || '',
  };
}

export function updateExpressionHighlightDocument(
  html: string,
  expressionId: number,
  content: HTMLElement
) {
  const parsed = new DOMParser().parseFromString(sanitizeTextbookHighlightDocument(html), 'text/html');
  const section = parsed.querySelector(`[data-textbook-expression-id="${expressionId}"]`);
  if (!section) return html;
  for (const language of ['en', 'ja', 'zh']) {
    const source = content.querySelector<HTMLElement>(`[data-textbook-language="${language}"]`);
    const target = section.querySelector<HTMLElement>(`[data-textbook-language="${language}"]`);
    if (source && target) target.innerHTML = source.innerHTML;
  }
  const root = parsed.body.firstElementChild;
  return sanitizeTextbookHighlightDocument(root?.outerHTML || html);
}

export function highlightedExpressionIds(html: string) {
  if (typeof window === 'undefined' || !html) return new Set<number>();
  const parsed = new DOMParser().parseFromString(sanitizeTextbookHighlightDocument(html), 'text/html');
  const ids = Array.from(parsed.querySelectorAll('[data-textbook-expression-id]'))
    .filter((section) => section.querySelector('mark.study-highlight-red'))
    .map((section) => Number(section.getAttribute('data-textbook-expression-id')))
    .filter((id) => Number.isInteger(id));
  return new Set(ids);
}
