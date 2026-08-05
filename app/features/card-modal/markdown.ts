import createDOMPurify from 'dompurify';
import { marked } from 'marked';
import type { CardType } from '../factory/types';
import { extractCardTitle } from './card-title.mjs';
import {
  adaptAudioToButtons,
  CARD_RENDER_ALLOWED_ATTR,
  CARD_RENDER_ALLOWED_TAGS,
  normalizeLoanwordAnnotations,
} from './card-render-transforms.mjs';

function purify(html: string) {
  if (typeof window === 'undefined') {
    return '<div class="safe-render-error" role="alert">卡片内容暂时无法安全显示。</div>';
  }
  const DOMPurify = createDOMPurify(window);
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_TAGS: CARD_RENDER_ALLOWED_TAGS,
    ADD_ATTR: CARD_RENDER_ALLOWED_ATTR,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['style'],
  });
}

export function renderCardMarkdown(markdown: string, cardType: CardType, folder: string) {
  const parsed = String(marked.parse(normalizeLoanwordAnnotations(markdown || '')));
  const withAudioButtons = adaptAudioToButtons(parsed, folder);
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
  return extractCardTitle(markdown, fallback);
}
