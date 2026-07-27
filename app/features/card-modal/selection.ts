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

export function buildSelectionCandidate(container: HTMLElement): SelectionCandidate | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;

  const range = sel.getRangeAt(0);
  if (range.collapsed) return null;
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;

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
  if (normalized.length > 200) return null;
  return { rawText, normalized, range };
}
