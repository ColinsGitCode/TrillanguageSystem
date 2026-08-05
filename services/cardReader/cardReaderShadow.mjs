import crypto from 'node:crypto';
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { marked } from 'marked';
import {
  CARD_RENDER_ALLOWED_ATTR,
  CARD_RENDER_ALLOWED_TAGS,
  normalizeLoanwordAnnotations,
} from '../../app/features/card-modal/card-render-transforms.mjs';
import {
  buildVisibleTextProjection,
  normalizeProjectionText,
} from '../../app/features/card-modal/text-projection.mjs';
import {
  cardDocumentInlineText,
  cardLanguage,
  parseCardDocument,
} from './cardDocument.mjs';

const REPORT_VERSION = 'card-reader-shadow-v1';
const MAX_MISMATCH_CODES = 8;

function blockText(block) {
  if (block.kind === 'aside') return '';
  if (block.kind === 'heading' || block.kind === 'paragraph') {
    return cardDocumentInlineText(block.children);
  }
  if (block.kind === 'quote') return block.blocks.map(blockText).join(' ');
  if (block.kind === 'list') return block.items.flatMap((item) => item.map(blockText)).join(' ');
  return '';
}

function countInlinePronunciation(nodes) {
  if (!Array.isArray(nodes)) return 0;
  return nodes.reduce((count, node) => {
    if (!node || typeof node !== 'object') return count;
    const self = node.kind === 'pronunciation' ? 1 : 0;
    return count + self + countInlinePronunciation(node.children);
  }, 0);
}

function countBlockPronunciation(block) {
  if (!block || typeof block !== 'object') return 0;
  if (block.kind === 'paragraph' || block.kind === 'heading') return countInlinePronunciation(block.children);
  if (block.kind === 'quote') return block.blocks.reduce((sum, item) => sum + countBlockPronunciation(item), 0);
  if (block.kind === 'list') {
    return block.items.reduce(
      (sum, item) => sum + item.reduce((inner, node) => inner + countBlockPronunciation(node), 0),
      0
    );
  }
  return 0;
}

function countDocumentPronunciation(document) {
  return countInlinePronunciation(document.title)
    + document.sections.reduce(
      (count, section) => count
        + countInlinePronunciation(section.title)
        + section.blocks.reduce((sum, block) => sum + countBlockPronunciation(block), 0),
      0
    );
}

function documentVisibleText(document) {
  const parts = [cardDocumentInlineText(document.title)];
  document.sections.forEach((section) => {
    parts.push(cardDocumentInlineText(section.title));
    parts.push(...section.blocks.map(blockText));
  });
  return normalizeProjectionText(parts.join(' '));
}

export function projectCardDocument(markdown) {
  return parseCardDocument(normalizeLoanwordAnnotations(String(markdown || '')));
}

function countAudioInline(nodes) {
  return nodes.reduce((count, node) => {
    if (node.kind === 'audio') return count + 1;
    if ('children' in node) return count + countAudioInline(node.children);
    return count;
  }, 0);
}

function countAudioBlock(block) {
  if (block.kind === 'aside') return countAudioInline(block.children);
  if (block.kind === 'heading' || block.kind === 'paragraph') return countAudioInline(block.children);
  if (block.kind === 'quote') return block.blocks.reduce((count, child) => count + countAudioBlock(child), 0);
  if (block.kind === 'list') {
    return block.items.flat().reduce((count, child) => count + countAudioBlock(child), 0);
  }
  return 0;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function v2Projection(markdown) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  try {
    const purifier = createDOMPurify(dom.window);
    const parsed = String(marked.parse(normalizeLoanwordAnnotations(markdown)));
    const safe = purifier.sanitize(parsed, {
      USE_PROFILES: { html: true },
      ADD_TAGS: CARD_RENDER_ALLOWED_TAGS,
      ADD_ATTR: CARD_RENDER_ALLOWED_ATTR,
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
      FORBID_ATTR: ['style'],
    });
    const root = dom.window.document.createElement('div');
    root.innerHTML = safe;
    const text = buildVisibleTextProjection(root).text;
    const sectionLanguages = Array.from(root.querySelectorAll('h2'))
      .map((heading) => cardLanguage(heading.textContent || ''));
    return {
      text,
      sectionLanguages,
      audioNodes: root.querySelectorAll('audio, button.audio-btn').length,
    };
  } finally {
    dom.window.close();
  }
}

export function compareCardReaders(markdown, metadata = {}) {
  const startedAt = performance.now();
  const source = String(markdown || '');
  const v2 = v2Projection(source);
  const document = projectCardDocument(source);
  const v3Text = documentVisibleText(document);
  const v3Languages = document.sections.map((section) => section.language);
  const v3AudioNodes = document.sections.reduce(
    (count, section) => count + section.blocks.reduce((sum, block) => sum + countAudioBlock(block), 0),
    0
  );
  // Ruby must survive as structured pronunciation nodes. A silent drop keeps
  // diagnostics empty (the Canary admission gate would pass) while injecting the
  // reading into visible text, so the count is checked as its own invariant.
  // Loanword blocks are excluded from the projection by contract, and code spans
  // keep their literal text, so ruby inside either is not expected to appear as a
  // pronunciation node.
  const projectableSource = source
    .replace(/<div class="loanword-block">[\s\S]*?<\/div>/gi, '')
    .replace(/`[^`\n]*`/g, '');
  const sourceRubyCount = (projectableSource.match(/<ruby[\s>]/gi) || []).length;
  const v3PronunciationCount = countDocumentPronunciation(document);
  const matches = {
    visibleText: v2.text === v3Text,
    sectionLanguages: JSON.stringify(v2.sectionLanguages) === JSON.stringify(v3Languages),
    audioNodes: v2.audioNodes === v3AudioNodes,
    pronunciationNodes: sourceRubyCount === v3PronunciationCount,
  };
  const mismatchCodes = [];
  if (!matches.visibleText) mismatchCodes.push('VISIBLE_TEXT_MISMATCH');
  if (!matches.sectionLanguages) mismatchCodes.push('SECTION_LANGUAGE_MISMATCH');
  if (!matches.audioNodes) mismatchCodes.push('AUDIO_NODE_MISMATCH');
  if (!matches.pronunciationNodes) mismatchCodes.push('PRONUNCIATION_NODE_MISMATCH');
  const diagnosticCodes = Array.from(new Set(document.diagnostics.map((item) => item.code))).slice(0, 8);

  return {
    version: REPORT_VERSION,
    generationId: Number(metadata.generationId || 0),
    cardType: String(metadata.cardType || 'unknown'),
    sourceContentHash: String(metadata.sourceContentHash || ''),
    parity: Object.values(matches).every(Boolean),
    matches,
    counts: {
      sourceChars: Array.from(source).length,
      v2VisibleChars: Array.from(v2.text).length,
      v3VisibleChars: Array.from(v3Text).length,
      v2Sections: v2.sectionLanguages.length,
      v3Sections: v3Languages.length,
      v2AudioNodes: v2.audioNodes,
      v3AudioNodes,
      sourceRubyNodes: sourceRubyCount,
      v3PronunciationNodes: v3PronunciationCount,
      diagnostics: document.diagnostics.length,
    },
    hashes: {
      v2VisibleText: sha256(v2.text),
      v3VisibleText: sha256(v3Text),
    },
    mismatchCodes: mismatchCodes.slice(0, MAX_MISMATCH_CODES),
    diagnosticCodes,
    durationMs: Number((performance.now() - startedAt).toFixed(2)),
  };
}

export { REPORT_VERSION };
