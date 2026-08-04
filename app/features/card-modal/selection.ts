import { buildVisibleTextProjection, normalizeProjectionText } from './text-projection.mjs';

// Ruby-aware 选区文本提取使用与整卡注解锚定相同的可见基文投影。这样选区生成与
// 后续 annotation selector 对 ruby、音频和外来语标签保持同一文本口径。

export function normalizeSelectionPhrase(text: string): string {
  let cleaned = normalizeProjectionText(String(text || ''));
  cleaned = cleaned
    .replace(/^[-•\s]+/, '')
    .replace(/^例句\s*\d+\s*[：:]\s*/i, '')
    .replace(/^[“"'\s]+|[”"'\s]+$/g, '');
  return cleaned.trim();
}

function extractRubyBaseText(rubyEl: Element): string {
  return normalizeSelectionPhrase(buildVisibleTextProjection(rubyEl).rawText);
}

export type SelectionCandidate = { rawText: string; normalized: string; range: Range };

function caretRangeFromPoint(document: Document, clientX: number, clientY: number): Range | null {
  const chromiumDocument = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  return chromiumDocument.caretRangeFromPoint?.(clientX, clientY) || null;
}

function isWordCharacter(value: string): boolean {
  return /[\p{L}\p{N}'’_-]/u.test(value);
}

function selectionSemanticBlock(container: HTMLElement, node: Node): Element {
  const element = node.nodeType === Node.ELEMENT_NODE
    ? (node as Element)
    : node.parentElement;
  return element?.closest('li, p, h1, h2, h3, h4, blockquote, td, th, dt, dd') || container;
}

export function selectionRangeContainsPoint(range: Range, clientX: number, clientY: number): boolean {
  const document = range.startContainer.ownerDocument;
  if (!document) return false;
  const point = caretRangeFromPoint(document, clientX, clientY);
  if (!point) return false;
  try {
    return range.comparePoint(point.startContainer, point.startOffset) === 0;
  } catch {
    return false;
  }
}

export function buildWordRangeAtPoint(
  container: HTMLElement,
  clientX: number,
  clientY: number
): Range | null {
  const caret = caretRangeFromPoint(container.ownerDocument, clientX, clientY);
  if (!caret || !container.contains(caret.startContainer)) return null;
  const node = caret.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;
  const value = node.nodeValue || '';
  if (!value) return null;

  let index = Math.min(caret.startOffset, value.length - 1);
  if (!isWordCharacter(value[index] || '') && index > 0 && isWordCharacter(value[index - 1])) index -= 1;
  if (!isWordCharacter(value[index] || '')) return null;

  let start = index;
  let end = index + 1;
  while (start > 0 && isWordCharacter(value[start - 1])) start -= 1;
  while (end < value.length && isWordCharacter(value[end])) end += 1;
  const range = container.ownerDocument.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  return range;
}

export function buildSelectionCandidate(container: HTMLElement): SelectionCandidate | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;

  const range = sel.getRangeAt(0);
  if (range.collapsed) return null;
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;

  // 选区动作面向一个词、短语或句子。拒绝跨标题、段落和列表项的大范围误选，
  // 否则一次右键可能沿用浏览器中残留的整页选区。
  if (
    selectionSemanticBlock(container, range.startContainer)
    !== selectionSemanticBlock(container, range.endContainer)
  ) return null;

  const fragment = range.cloneContents();
  const rawText = buildVisibleTextProjection(fragment).rawText.trim();
  let normalized = normalizeSelectionPhrase(rawText);

  // 用户可能只选中了 rt 注音，尝试回退到 ruby 主体文本。
  if (!normalized) {
    const anchorEl = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as Element)
      : range.startContainer.parentElement;
    const rubyEl = anchorEl?.closest?.('ruby');
    if (rubyEl && container.contains(rubyEl)) {
      normalized = extractRubyBaseText(rubyEl);
    }
  }

  if (!normalized) return null;
  if (Array.from(normalized).length > 200) return null;
  return { rawText, normalized, range };
}
