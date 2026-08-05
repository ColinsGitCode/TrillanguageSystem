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

function createTokenSpan(document: Document, token: PronunciationToken, fragmentText = token.surface, fragmentIndex = 0, fragmentCount = 1) {
  const span = document.createElement('span');
  span.className = 'pronunciation-token';
  span.dataset.pronunciationTokenKey = token.tokenKey;
  span.dataset.pronunciationSurface = token.surface;
  span.dataset.pronunciationReading = token.readingHiragana || '';
  span.dataset.pronunciationStatus = token.status;
  span.dataset.pronunciationSource = token.source;
  span.dataset.pronunciationFragmentIndex = String(fragmentIndex);
  span.dataset.pronunciationFragmentCount = String(fragmentCount);
  span.tabIndex = fragmentIndex === 0 ? 0 : -1;
  if (fragmentIndex === 0) {
    span.setAttribute('role', 'button');
    span.setAttribute('aria-label', token.readingHiragana
      ? `${token.surface}，读音 ${token.readingHiragana}`
      : `${token.surface}，读音待确认`);
  } else {
    span.setAttribute('aria-hidden', 'true');
  }
  span.textContent = fragmentText;
  return span;
}

function setRovingTabIndex(root: HTMLElement) {
  const tokens = Array.from(root.querySelectorAll<HTMLElement>('.pronunciation-token'));
  const seen = new Set<string>();
  let representativeIndex = 0;
  tokens.forEach((token) => {
    const key = token.dataset.pronunciationTokenKey || '';
    const representative = !seen.has(key);
    token.tabIndex = representative && representativeIndex === 0 ? 0 : -1;
    if (representative) {
      seen.add(key);
      representativeIndex += 1;
    }
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
  const groups: Array<{ node: Text; startOffset: number; endOffset: number }> = [];
  points.slice(token.startCodePoint, token.endCodePoint).forEach((point) => {
    if (!point.startNode || !point.endNode || point.startNode !== point.endNode) return;
    const previous = groups.at(-1);
    if (previous?.node === point.startNode && point.startOffset <= previous.endOffset) {
      previous.endOffset = Math.max(previous.endOffset, point.endOffset);
      return;
    }
    groups.push({ node: point.startNode, startOffset: point.startOffset, endOffset: point.endOffset });
  });
  if (!groups.length) return false;
  const fragmentCount = groups.length;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (!group.node.parentNode || group.endOffset > (group.node.nodeValue || '').length) return false;
    const selected = group.node.splitText(group.startOffset);
    selected.splitText(group.endOffset - group.startOffset);
    const span = createTokenSpan(root.ownerDocument, token, selected.nodeValue || '', index, fragmentCount);
    selected.replaceWith(span);
  }
  return true;
}

export function pronunciationTokenFragments(element: Element) {
  if (!(element instanceof HTMLElement)) return [];
  const key = element.dataset.pronunciationTokenKey;
  if (!key) return [];
  const root = element.closest('.pronunciation-card-content-shell, .pronunciation-text-shell') || element.parentElement;
  return Array.from(root?.querySelectorAll<HTMLElement>('.pronunciation-token') || [])
    .filter((item) => item.dataset.pronunciationTokenKey === key)
    .sort((left, right) => Number(left.dataset.pronunciationFragmentIndex || 0) - Number(right.dataset.pronunciationFragmentIndex || 0));
}

export function pronunciationTokenRect(element: Element) {
  const fragments = pronunciationTokenFragments(element);
  const rects = fragments.map((fragment) => fragment.getBoundingClientRect());
  if (!rects.length) return element.getBoundingClientRect();
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function enhancePronunciationHtml(html: string, tokens: PronunciationToken[]) {
  if (typeof document === 'undefined') return html;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  enhancePronunciationRoot(wrapper, tokens);
  return wrapper.innerHTML;
}

export function enhancePronunciationRoot(root: HTMLElement, tokens: PronunciationToken[]) {
  replaceLegacyRuby(root);
  if (!tokens.length) return root;
  for (const token of [...tokens].sort((left, right) => (
    left.startCodePoint - right.startCodePoint || right.endCodePoint - left.endCodePoint
  ))) {
    if (Array.from(root.querySelectorAll<HTMLElement>('.pronunciation-token'))
      .some((node) => node.dataset.pronunciationTokenKey === token.tokenKey)) continue;
    wrapTokenAtProjection(root, token);
  }
  setRovingTabIndex(root);
  return root;
}

export function movePronunciationFocus(root: HTMLElement, current: HTMLElement, key: string) {
  const allTokens = Array.from(root.querySelectorAll<HTMLElement>('.pronunciation-token'));
  const tokens = allTokens.filter((token, index) => allTokens.findIndex((candidate) => (
    candidate.dataset.pronunciationTokenKey === token.dataset.pronunciationTokenKey
  )) === index);
  const currentKey = current.dataset.pronunciationTokenKey;
  const index = tokens.findIndex((token) => token.dataset.pronunciationTokenKey === currentKey);
  if (index < 0 || !tokens.length) return false;
  let nextIndex = index;
  if (key === 'Home') nextIndex = 0;
  else if (key === 'End') nextIndex = tokens.length - 1;
  else if (key === 'ArrowLeft' || key === 'ArrowUp') nextIndex = (index - 1 + tokens.length) % tokens.length;
  else if (key === 'ArrowRight' || key === 'ArrowDown') nextIndex = (index + 1) % tokens.length;
  else return false;
  allTokens.forEach((token) => { token.tabIndex = -1; });
  tokens[nextIndex].tabIndex = 0;
  tokens[nextIndex].focus({ preventScroll: true });
  return true;
}

export function selectPronunciationToken(element: HTMLElement) {
  const status = element.dataset.pronunciationStatus || 'unresolved';
  if (status !== 'accepted') return false;
  const selection = element.ownerDocument.defaultView?.getSelection();
  if (!selection) return false;
  const fragments = pronunciationTokenFragments(element);
  if (!fragments.length) return false;
  const lastFragment = fragments[fragments.length - 1];
  const range = element.ownerDocument.createRange();
  range.setStartBefore(fragments[0]);
  range.setEndAfter(lastFragment);
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

export function pronunciationTokenForRange(root: HTMLElement, range: Range): PronunciationToken | null {
  const fragments = pronunciationFragmentsForRange(root, range);
  const keys = new Set(fragments.map((element) => element.dataset.pronunciationTokenKey).filter(Boolean));
  if (keys.size !== 1 || !fragments.length) return null;
  const token = pronunciationTokenFromElement(fragments[0]);
  if (!token || token.status !== 'accepted') return null;
  const selected = String(range.cloneContents().textContent || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  const surface = token.surface.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return selected === surface ? token : null;
}

function pronunciationFragmentsForRange(root: HTMLElement, range: Range) {
  return Array.from(root.querySelectorAll<HTMLElement>('.pronunciation-token'))
    .filter((element) => {
      try {
        return range.intersectsNode(element);
      } catch (_error) {
        return false;
      }
    });
}

export function rangeIntersectsPronunciationToken(root: HTMLElement, range: Range) {
  return pronunciationFragmentsForRange(root, range).some((element) => (
    element.dataset.pronunciationStatus === 'accepted'
  ));
}
