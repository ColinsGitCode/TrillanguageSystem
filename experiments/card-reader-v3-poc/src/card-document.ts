import type { Element, Root, RootContent, Text } from 'hast';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';

export type CardLanguage = 'en' | 'ja' | 'zh' | 'unknown';

export type CardInline =
  | { kind: 'text'; value: string }
  | { kind: 'strong' | 'emphasis'; children: CardInline[] }
  | { kind: 'code'; value: string }
  | { kind: 'link'; href: string; children: CardInline[] }
  | { kind: 'highlight'; tone: string; children: CardInline[] }
  | { kind: 'pronunciation'; surface: string; reading: string; source: 'legacy-ruby' }
  | { kind: 'audio'; src: string; label: string }
  | { kind: 'break' };

export type CardBlock =
  | { kind: 'heading'; depth: number; id: string; children: CardInline[] }
  | { kind: 'paragraph'; id: string; children: CardInline[] }
  | { kind: 'quote'; id: string; blocks: CardBlock[] }
  | { kind: 'list'; id: string; ordered: boolean; items: CardBlock[][] }
  | { kind: 'divider'; id: string };

export type CardSection = {
  id: string;
  language: CardLanguage;
  title: CardInline[];
  blocks: CardBlock[];
};

export type CardDiagnostic = {
  code: 'UNSAFE_NODE_DROPPED' | 'UNSUPPORTED_NODE_FLATTENED';
  tag: string;
};

export type CardDocument = {
  version: 'card-document-v1';
  title: string;
  sections: CardSection[];
  diagnostics: CardDiagnostic[];
};

const unsafeTags = new Set(['script', 'style', 'iframe', 'object', 'embed']);
const blockTags = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'blockquote', 'hr']);

function element(node: RootContent): node is Element {
  return node.type === 'element';
}

function textValue(node: RootContent): string {
  if (node.type === 'text') return node.value;
  if (!element(node)) return '';
  if (['rt', 'rp', 'script', 'style'].includes(node.tagName)) return '';
  return node.children.map((child) => textValue(child as RootContent)).join('');
}

function allText(node: RootContent): string {
  if (node.type === 'text') return node.value;
  if (!element(node)) return '';
  return node.children.map((child) => allText(child as RootContent)).join('');
}

function inlineNodes(nodes: RootContent[], diagnostics: CardDiagnostic[]): CardInline[] {
  return nodes.flatMap((node): CardInline[] => {
    if (node.type === 'text') return [{ kind: 'text', value: node.value }];
    if (!element(node)) return [];
    if (unsafeTags.has(node.tagName)) {
      diagnostics.push({ code: 'UNSAFE_NODE_DROPPED', tag: node.tagName });
      return [];
    }
    const children = () => inlineNodes(node.children as RootContent[], diagnostics);
    if (['strong', 'b'].includes(node.tagName)) return [{ kind: 'strong', children: children() }];
    if (['em', 'i'].includes(node.tagName)) return [{ kind: 'emphasis', children: children() }];
    if (node.tagName === 'code') return [{ kind: 'code', value: allText(node) }];
    if (node.tagName === 'br') return [{ kind: 'break' }];
    if (node.tagName === 'a') {
      const href = typeof node.properties?.href === 'string' ? node.properties.href : '';
      return [{ kind: 'link', href, children: children() }];
    }
    if (node.tagName === 'mark') {
      const tone = typeof node.properties?.dataTone === 'string' ? node.properties.dataTone : 'blue';
      return [{ kind: 'highlight', tone, children: children() }];
    }
    if (node.tagName === 'ruby') {
      const reading = node.children
        .filter((child) => element(child as RootContent) && (child as Element).tagName === 'rt')
        .map((child) => allText(child as RootContent))
        .join('');
      return [{ kind: 'pronunciation', surface: textValue(node), reading, source: 'legacy-ruby' }];
    }
    if (node.tagName === 'audio' || (node.tagName === 'button' && node.properties?.className?.includes('audio-btn'))) {
      const source = node.children.find((child) => element(child as RootContent) && (child as Element).tagName === 'source') as Element | undefined;
      const srcValue = node.properties?.src || node.properties?.dataSrc || source?.properties?.src || '';
      return [{ kind: 'audio', src: String(srcValue), label: '播放语音' }];
    }
    return children();
  });
}

function stableId(node: RootContent, fallback: string): string {
  const line = node.position?.start.line;
  const column = node.position?.start.column;
  return line && column ? `source-${line}-${column}` : fallback;
}

function blocksFromChildren(
  nodes: RootContent[],
  diagnostics: CardDiagnostic[],
  fallback: string,
): CardBlock[] {
  const blocks: CardBlock[] = [];
  let inlineBuffer: RootContent[] = [];
  const flushInline = () => {
    if (!inlineBuffer.length) return;
    const children = inlineNodes(inlineBuffer, diagnostics);
    if (inlineText(children).trim()) blocks.push({ kind: 'paragraph', id: `${fallback}-inline-${blocks.length}`, children });
    inlineBuffer = [];
  };

  nodes.forEach((node, index) => {
    const isBlock = element(node) && blockTags.has(node.tagName);
    if (!isBlock) {
      inlineBuffer.push(node);
      return;
    }
    flushInline();
    blocks.push(...blockNode(node, diagnostics, `${fallback}-block-${index}`));
  });
  flushInline();
  return blocks;
}

function blockNode(node: RootContent, diagnostics: CardDiagnostic[], fallback: string): CardBlock[] {
  if (node.type === 'text') {
    return node.value.trim() ? [{ kind: 'paragraph', id: fallback, children: [{ kind: 'text', value: node.value }] }] : [];
  }
  if (!element(node)) return [];
  if (unsafeTags.has(node.tagName)) {
    diagnostics.push({ code: 'UNSAFE_NODE_DROPPED', tag: node.tagName });
    return [];
  }
  const id = stableId(node, fallback);
  if (/^h[1-6]$/u.test(node.tagName)) {
    return [{ kind: 'heading', depth: Number(node.tagName.slice(1)), id, children: inlineNodes(node.children as RootContent[], diagnostics) }];
  }
  if (node.tagName === 'p') return [{ kind: 'paragraph', id, children: inlineNodes(node.children as RootContent[], diagnostics) }];
  if (node.tagName === 'hr') return [{ kind: 'divider', id }];
  if (node.tagName === 'blockquote') {
    return [{ kind: 'quote', id, blocks: blocksFromChildren(node.children as RootContent[], diagnostics, id) }];
  }
  if (node.tagName === 'ul' || node.tagName === 'ol') {
    const items = node.children.filter((child) => element(child as RootContent) && (child as Element).tagName === 'li').map((child, itemIndex) => (
      blocksFromChildren((child as Element).children as RootContent[], diagnostics, `${id}-${itemIndex}`)
    ));
    return [{ kind: 'list', id, ordered: node.tagName === 'ol', items }];
  }
  diagnostics.push({ code: 'UNSUPPORTED_NODE_FLATTENED', tag: node.tagName });
  const flattened = inlineNodes(node.children as RootContent[], diagnostics);
  return flattened.length ? [{ kind: 'paragraph', id, children: flattened }] : [];
}

export function cardLanguage(title: string): CardLanguage {
  if (/英文|english/i.test(title)) return 'en';
  if (/日本語|日语|japanese/i.test(title)) return 'ja';
  if (/中文|chinese/i.test(title)) return 'zh';
  return 'unknown';
}

export function inlineText(nodes: CardInline[]): string {
  return nodes.map((node) => {
    if (node.kind === 'text' || node.kind === 'code') return node.value;
    if (node.kind === 'pronunciation') return node.surface;
    if (node.kind === 'audio' || node.kind === 'break') return '';
    return inlineText(node.children);
  }).join('');
}

export function parseCardDocument(markdown: string): CardDocument {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw);
  const mdast = processor.parse(markdown);
  const root = processor.runSync(mdast) as Root;
  const diagnostics: CardDiagnostic[] = [];
  const sections: CardSection[] = [];
  let title = 'Untitled card';
  let current: CardSection | null = null;

  root.children.forEach((node, index) => {
    if (element(node) && node.tagName === 'h1') {
      title = allText(node).trim() || title;
      return;
    }
    if (element(node) && node.tagName === 'h2') {
      const titleInline = inlineNodes(node.children as RootContent[], diagnostics);
      const sectionTitle = inlineText(titleInline).trim();
      current = {
        id: `section-${sections.length + 1}`,
        language: cardLanguage(sectionTitle),
        title: titleInline,
        blocks: [],
      };
      sections.push(current);
      return;
    }
    const blocks = blockNode(node, diagnostics, `block-${index + 1}`);
    if (!blocks.length) return;
    if (!current) {
      current = { id: 'section-preamble', language: 'unknown', title: [], blocks: [] };
      sections.push(current);
    }
    current.blocks.push(...blocks);
  });

  return { version: 'card-document-v1', title, sections, diagnostics };
}
