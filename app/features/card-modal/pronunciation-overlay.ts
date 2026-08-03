export type PronunciationToken = {
  id?: number;
  tokenKey: string;
  surface: string;
  startCodePoint: number;
  endCodePoint: number;
  readingRaw: string | null;
  readingHiragana: string | null;
  unitKind: 'word' | 'component' | 'kanji' | 'punctuation' | 'unresolved';
  status: 'accepted' | 'unresolved' | 'rejected' | 'superseded';
  source: 'textbook' | 'manual' | 'dictionary' | 'analyzer' | 'rule' | 'llm-proposal' | 'legacy-ruby';
  ruleVersion: string;
  evidence?: Record<string, unknown>;
  components?: Array<Record<string, unknown>>;
};

const SKIP_SELECTOR = 'button, audio, source, script, style, .audio-btn';
const BLOCK_TAGS = new Set(['article', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ol', 'p', 'section', 'tr', 'ul']);
const CJK_RE = /[぀-ヿ㐀-鿿々〆ヵヶ]/u;

function createTokenSpan(document: Document, token: PronunciationToken) {
  const span = document.createElement('span');
  span.className = 'pronunciation-token';
  span.dataset.pronunciationTokenKey = token.tokenKey;
  span.dataset.pronunciationSurface = token.surface;
  span.dataset.pronunciationReading = token.readingHiragana || '';
  span.dataset.pronunciationStatus = token.status;
  span.dataset.pronunciationSource = token.source;
  span.tabIndex = 0;
  span.setAttribute('role', 'button');
  span.setAttribute('aria-label', token.readingHiragana
    ? `${token.surface}，读音 ${token.readingHiragana}`
    : `${token.surface}，读音待确认`);
  span.textContent = token.surface;
  return span;
}

function setRovingTabIndex(root: HTMLElement) {
  const tokens = Array.from(root.querySelectorAll<HTMLElement>('.pronunciation-token'));
  tokens.forEach((token, index) => {
    token.tabIndex = index === 0 ? 0 : -1;
  });
}

function replaceLegacyRuby(root: HTMLElement) {
  const rubyElements = Array.from(root.querySelectorAll<HTMLElement>('ruby'));
  rubyElements.forEach((ruby) => {
    if (!ruby.isConnected) return;
    const base = Array.from(ruby.childNodes)
      .filter((node) => !(node instanceof HTMLElement && ['RT', 'RP'].includes(node.tagName)))
      .map((node) => node.textContent || '')
      .join('');
    // Ruby is an input format only. The pronunciation API remains authoritative;
    // if it is unavailable, this deliberately leaves readable plain text.
    ruby.replaceWith(root.ownerDocument.createTextNode(base));
  });
}

type ProjectionPoint = {
  character: string;
  startNode: Text | null;
  startOffset: number;
  endNode: Text | null;
  endOffset: number;
  synthetic?: boolean;
};

function appendProjectionText(output: ProjectionPoint[], value: string, node: Text | null = null, offset = 0) {
  let utf16Offset = offset;
  for (const character of String(value || '')) {
    const normalized = character === '▶' ? ' ' : character.normalize('NFKC');
    for (const normalizedCharacter of normalized) {
      output.push({
        character: normalizedCharacter,
        startNode: node,
        startOffset: utf16Offset,
        endNode: node,
        endOffset: utf16Offset + character.length,
        synthetic: false,
      });
    }
    utf16Offset += character.length;
  }
}

function appendProjectionBoundary(output: ProjectionPoint[]) {
  const previous = output.at(-1);
  if (previous?.character === ' ') return;
  output.push({ character: ' ', startNode: null, startOffset: 0, endNode: null, endOffset: 0, synthetic: true });
}

function buildProjectionPoints(root: HTMLElement) {
  const points: ProjectionPoint[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node as Text;
      if (text.nodeValue && !text.parentElement?.closest(SKIP_SELECTOR)) {
        appendProjectionText(points, text.nodeValue, text, 0);
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    if (element.matches(SKIP_SELECTOR)) return;
    if (element.tagName.toLowerCase() === 'br') {
      appendProjectionBoundary(points);
      return;
    }
    const block = BLOCK_TAGS.has(element.tagName.toLowerCase());
    if (block) appendProjectionBoundary(points);
    element.childNodes.forEach(walk);
    if (block) appendProjectionBoundary(points);
  };
  walk(root);

  const collapsed: ProjectionPoint[] = [];
  for (const point of points) {
    if (/\s/u.test(point.character)) {
      const previous = collapsed.at(-1);
      if (previous?.character === ' ') {
        // Prefer a real text-node space over a block-boundary placeholder so
        // the projection keeps the same offsets as the plain-text source.
        if (previous.synthetic && !point.synthetic) collapsed[collapsed.length - 1] = { ...point, character: ' ' };
        continue;
      }
      collapsed.push({ ...point, character: ' ' });
    } else {
      collapsed.push(point);
    }
  }

  const normalized = collapsed.filter((point, index) => {
    const previous = collapsed[index - 1]?.character;
    const next = collapsed[index + 1]?.character;
    if (point.character !== ' ' || !point.synthetic || !previous || !next) return true;
    return !(
      (CJK_RE.test(previous) && (CJK_RE.test(next) || /[、。！？：；，．）)]/u.test(next)))
      || (/[（(]/u.test(previous) && CJK_RE.test(next))
    );
  });
  while (normalized[0]?.character === ' ') normalized.shift();
  while (normalized.at(-1)?.character === ' ') normalized.pop();
  return normalized;
}

function wrapTokenAtProjection(root: HTMLElement, token: PronunciationToken) {
  const points = buildProjectionPoints(root);
  const startPoint = points[token.startCodePoint];
  const endPoint = points[token.endCodePoint - 1];
  if (!startPoint?.startNode || !endPoint?.endNode) return false;
  const projected = points
    .slice(token.startCodePoint, token.endCodePoint)
    .map((point) => point.character)
    .join('');
  if (projected.normalize('NFKC') !== token.surface.normalize('NFKC')) return false;
  const range = root.ownerDocument.createRange();
  range.setStart(startPoint.startNode, startPoint.startOffset);
  range.setEnd(endPoint.endNode, endPoint.endOffset);
  try {
    range.surroundContents(createTokenSpan(root.ownerDocument, token));
    return true;
  } catch {
    // Cross-node or annotation-overlapping spans are intentionally left plain.
    // A missing visual token is safer than attaching a reading to the wrong text.
    return false;
  }
}

export function enhancePronunciationHtml(html: string, tokens: PronunciationToken[]) {
  if (typeof document === 'undefined') return html;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  replaceLegacyRuby(wrapper);
  if (!tokens.length) return wrapper.innerHTML;
  for (const token of [...tokens].sort((left, right) => (
    left.startCodePoint - right.startCodePoint || right.endCodePoint - left.endCodePoint
  ))) {
    if (Array.from(wrapper.querySelectorAll<HTMLElement>('.pronunciation-token'))
      .some((node) => node.dataset.pronunciationTokenKey === token.tokenKey)) continue;
    wrapTokenAtProjection(wrapper, token);
  }
  setRovingTabIndex(wrapper);
  return wrapper.innerHTML;
}

export function movePronunciationFocus(root: HTMLElement, current: HTMLElement, key: string) {
  const tokens = Array.from(root.querySelectorAll<HTMLElement>('.pronunciation-token'));
  const index = tokens.indexOf(current);
  if (index < 0 || !tokens.length) return false;
  let nextIndex = index;
  if (key === 'Home') nextIndex = 0;
  else if (key === 'End') nextIndex = tokens.length - 1;
  else if (key === 'ArrowLeft' || key === 'ArrowUp') nextIndex = (index - 1 + tokens.length) % tokens.length;
  else if (key === 'ArrowRight' || key === 'ArrowDown') nextIndex = (index + 1) % tokens.length;
  else return false;
  tokens.forEach((token, tokenIndex) => { token.tabIndex = tokenIndex === nextIndex ? 0 : -1; });
  tokens[nextIndex].focus({ preventScroll: true });
  return true;
}

export function selectPronunciationToken(element: HTMLElement) {
  const status = element.dataset.pronunciationStatus || 'unresolved';
  if (status !== 'accepted') return false;
  const selection = element.ownerDocument.defaultView?.getSelection();
  if (!selection) return false;
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

export function pronunciationTokenFromElement(element: Element | null): PronunciationToken | null {
  if (!(element instanceof HTMLElement) || !element.matches('.pronunciation-token')) return null;
  const surface = element.dataset.pronunciationSurface || element.textContent || '';
  return {
    tokenKey: element.dataset.pronunciationTokenKey || '',
    surface,
    startCodePoint: 0,
    endCodePoint: Array.from(surface).length,
    readingRaw: element.dataset.pronunciationReading || null,
    readingHiragana: element.dataset.pronunciationReading || null,
    unitKind: 'word',
    status: (element.dataset.pronunciationStatus as PronunciationToken['status']) || 'unresolved',
    source: (element.dataset.pronunciationSource as PronunciationToken['source']) || 'analyzer',
    ruleVersion: 'dom-v1',
  };
}
