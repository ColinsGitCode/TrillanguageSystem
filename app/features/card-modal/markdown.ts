import createDOMPurify from 'dompurify';
import { marked } from 'marked';
import type { CardType } from '../factory/types';

const ALLOWED_TAGS = ['audio', 'source', 'ruby', 'rt', 'rp', 'button', 'mark'];
const ALLOWED_ATTR = [
  'class', 'src', 'data-src', 'data-folder', 'data-card-renderer-version',
  'data-card-type', 'preload', 'controls', 'href', 'title', 'alt', 'aria-label', 'type',
];

function purify(html: string) {
  if (typeof window === 'undefined') {
    return '<div class="safe-render-error" role="alert">卡片内容暂时无法安全显示。</div>';
  }
  const DOMPurify = createDOMPurify(window);
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_TAGS: ALLOWED_TAGS,
    ADD_ATTR: ALLOWED_ATTR,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['style'],
  });
}

function normalizeLoanwordAnnotations(markdown: string) {
  if (!markdown || markdown.includes('loanword-block')) return markdown || '';
  return markdown.split(/\r?\n/).map((line) => {
    const match = line.match(/^\s*-\s*外来语标注[:：]\s*(.*)$/i);
    if (!match) return line;
    const items = String(match[1] || '无')
      .split(/[，,、；;]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const [left, ...rest] = item.split('=');
        const right = rest.join('=').trim();
        return `<span class="loanword-tag">${left.trim()}${right ? ` → ${right}` : ''}</span>`;
      })
      .join(' ');
    return `<div class="loanword-block"><span class="loanword-label">外来语标注</span><span>${items}</span></div>`;
  }).join('\n');
}

export function renderCardMarkdown(markdown: string, cardType: CardType, folder: string) {
  const parsed = String(marked.parse(normalizeLoanwordAnnotations(markdown || '')));
  const withAudioButtons = parsed.replace(
    /<audio\b([^>]*?)\s+src=(['"])([^'"]+)\2([^>]*)>(?:<\/audio>)?/gi,
    (_match, _pre, _quote, src) => (
      `<button class="audio-btn" type="button" aria-label="播放语音" data-src="${src}" data-folder="${folder}">▶</button>`
    )
  );
  const safe = purify(withAudioButtons);
  return `<div class="react-card-renderer card-type-${cardType}" data-card-renderer-version="2" data-card-type="${cardType}">${safe}</div>`;
}

export function sanitizePersistedCardHtml(html: string, cardType: CardType) {
  const safe = purify(html || '');
  if (/data-card-renderer-version=["']2["']/.test(safe)) return safe;
  return `<div class="react-card-renderer card-type-${cardType}" data-card-renderer-version="2" data-card-type="${cardType}">${safe}</div>`;
}

export function computeTextHash(input: string) {
  const text = String(input || '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function extractMarkdownTitle(markdown: string, fallback: string) {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback;
}
