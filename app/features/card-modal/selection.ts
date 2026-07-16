// Ruby-aware 选区文本提取。
// 行为移植自已退役旧前端 v3.5「文本选取即时生成卡片」：
// 用 range.cloneContents() 取选区片段，遍历时剔除注音(rt/rp)、音频按钮、
// 外来语标签等 UI 噪音节点，只保留可作为生成短语的正文；若用户只选中了注音，
// 回退到最近 ruby 主体文本。保持与「生成音频前先剥离读音」相同的不变量。

const CJK = '぀-ヿ㐀-鿿々〆ヵヶ';

export function normalizeSelectionPhrase(text: string): string {
  let cleaned = String(text || '');
  cleaned = cleaned
    .replace(/▶/g, ' ') // 剥离音频 ▶ 字形
    .replace(/[ \t\r\n]+/g, ' ')
    .replace(/^[-•\s]+/, '')
    .replace(/^例句\s*\d+\s*[：:]\s*/i, '')
    .replace(/^[“"'\s]+|[”"'\s]+$/g, '');
  cleaned = cleaned
    .replace(new RegExp(`([${CJK}])\\s+([${CJK}])`, 'g'), '$1$2')
    .replace(new RegExp(`([${CJK}])\\s+([、。！？：；，．])`, 'g'), '$1$2')
    .replace(new RegExp(`([（(])\\s+([${CJK}])`, 'g'), '$1$2')
    .replace(new RegExp(`([${CJK}])\\s+([）)])`, 'g'), '$1$2')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned;
}

function collectVisibleSelectionText(node: Node, pieces: string[]): void {
  if (!node) return;
  if (node.nodeType === Node.TEXT_NODE) {
    pieces.push(node.nodeValue || '');
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;

  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (['script', 'style', 'audio', 'button', 'rt', 'rp'].includes(tag)) return;
    if (
      el.classList?.contains('audio-btn') ||
      el.classList?.contains('card-selection-toolbar') ||
      el.classList?.contains('loanword-block') ||
      el.classList?.contains('loanword-label') ||
      el.classList?.contains('loanword-line') ||
      el.classList?.contains('loanword-tag')
    ) {
      return;
    }

    if (tag === 'br') {
      pieces.push('\n');
      return;
    }

    if (tag === 'ruby') {
      Array.from(el.childNodes).forEach((child) => {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const childTag = (child as HTMLElement).tagName.toLowerCase();
          if (childTag === 'rt' || childTag === 'rp') return;
        }
        collectVisibleSelectionText(child, pieces);
      });
      return;
    }

    const blockLike = ['div', 'p', 'li', 'ul', 'ol', 'section', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
    if (blockLike.includes(tag)) pieces.push(' ');
    Array.from(el.childNodes).forEach((child) => collectVisibleSelectionText(child, pieces));
    if (blockLike.includes(tag)) pieces.push(' ');
    return;
  }

  Array.from(node.childNodes || []).forEach((child) => collectVisibleSelectionText(child, pieces));
}

function extractRubyBaseText(rubyEl: Element): string {
  const parts: string[] = [];
  Array.from(rubyEl.childNodes).forEach((child) => {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = (child as HTMLElement).tagName.toLowerCase();
      if (tag === 'rt' || tag === 'rp') return;
    }
    collectVisibleSelectionText(child, parts);
  });
  return normalizeSelectionPhrase(parts.join(' '));
}

export type SelectionCandidate = { rawText: string; normalized: string; range: Range };

export function buildSelectionCandidate(container: HTMLElement): SelectionCandidate | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;

  const range = sel.getRangeAt(0);
  if (range.collapsed) return null;
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;

  const fragment = range.cloneContents();
  const pieces: string[] = [];
  collectVisibleSelectionText(fragment, pieces);
  const rawText = pieces.join(' ').trim();
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
