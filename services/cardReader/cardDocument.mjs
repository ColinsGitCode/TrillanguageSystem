import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';

const UNSAFE_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed']);
const BLOCK_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'blockquote', 'hr', 'div']);

function isElement(node) {
  return node?.type === 'element';
}

function textValue(node) {
  if (node?.type === 'text') return node.value;
  if (!isElement(node)) return '';
  if (['rt', 'rp', 'script', 'style'].includes(node.tagName)) return '';
  return node.children.map(textValue).join('');
}

function allText(node) {
  if (node?.type === 'text') return node.value;
  if (!isElement(node)) return '';
  return node.children.map(allText).join('');
}

function hasClass(node, className) {
  const value = node?.properties?.className;
  if (Array.isArray(value)) return value.includes(className);
  return String(value || '').split(/\s+/u).includes(className);
}

function inlineNodes(nodes, diagnostics) {
  return nodes.flatMap((node) => {
    if (node.type === 'text') return [{ kind: 'text', value: node.value }];
    if (!isElement(node)) return [];
    if (UNSAFE_TAGS.has(node.tagName)) {
      diagnostics.push({ code: 'UNSAFE_NODE_DROPPED', tag: node.tagName });
      return [];
    }
    const children = () => inlineNodes(node.children, diagnostics);
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
        .filter((child) => isElement(child) && child.tagName === 'rt')
        .map(allText)
        .join('');
      return [{ kind: 'pronunciation', surface: textValue(node), reading, source: 'legacy-ruby' }];
    }
    if (node.tagName === 'audio' || (node.tagName === 'button' && node.properties?.className?.includes('audio-btn'))) {
      const source = node.children.find((child) => isElement(child) && child.tagName === 'source');
      const srcValue = node.properties?.src || node.properties?.dataSrc || source?.properties?.src || '';
      return [{ kind: 'audio', src: String(srcValue), label: '播放语音' }];
    }
    return children();
  });
}

function inlineText(nodes) {
  return nodes.map((node) => {
    if (node.kind === 'text' || node.kind === 'code') return node.value;
    if (node.kind === 'pronunciation') return node.surface;
    if (node.kind === 'break') return ' ';
    if (node.kind === 'audio') return '';
    return inlineText(node.children);
  }).join('');
}

function stableId(node, fallback) {
  const line = node.position?.start.line;
  const column = node.position?.start.column;
  return line && column ? `source-${line}-${column}` : fallback;
}

function blocksFromChildren(nodes, diagnostics, fallback) {
  const blocks = [];
  let inlineBuffer = [];
  const flushInline = () => {
    if (!inlineBuffer.length) return;
    const children = inlineNodes(inlineBuffer, diagnostics);
    if (inlineText(children).trim()) {
      blocks.push({ kind: 'paragraph', id: `${fallback}-inline-${blocks.length}`, children });
    }
    inlineBuffer = [];
  };

  nodes.forEach((node, index) => {
    const isBlock = isElement(node) && BLOCK_TAGS.has(node.tagName);
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

function blockNode(node, diagnostics, fallback) {
  if (node.type === 'text') {
    return node.value.trim()
      ? [{ kind: 'paragraph', id: fallback, children: [{ kind: 'text', value: node.value }] }]
      : [];
  }
  if (!isElement(node)) return [];
  if (UNSAFE_TAGS.has(node.tagName)) {
    diagnostics.push({ code: 'UNSAFE_NODE_DROPPED', tag: node.tagName });
    return [];
  }
  const id = stableId(node, fallback);
  if (node.tagName === 'div' && hasClass(node, 'loanword-block')) {
    return [{
      kind: 'aside',
      id,
      role: 'loanword',
      children: inlineNodes(node.children, diagnostics),
    }];
  }
  if (/^h[1-6]$/u.test(node.tagName)) {
    return [{ kind: 'heading', depth: Number(node.tagName.slice(1)), id, children: inlineNodes(node.children, diagnostics) }];
  }
  if (node.tagName === 'p') {
    return [{ kind: 'paragraph', id, children: inlineNodes(node.children, diagnostics) }];
  }
  if (node.tagName === 'hr') return [{ kind: 'divider', id }];
  if (node.tagName === 'blockquote') {
    return [{ kind: 'quote', id, blocks: blocksFromChildren(node.children, diagnostics, id) }];
  }
  if (node.tagName === 'ul' || node.tagName === 'ol') {
    const items = node.children
      .filter((child) => isElement(child) && child.tagName === 'li')
      .map((child, index) => blocksFromChildren(child.children, diagnostics, `${id}-${index}`));
    return [{ kind: 'list', id, ordered: node.tagName === 'ol', items }];
  }
  diagnostics.push({ code: 'UNSUPPORTED_NODE_FLATTENED', tag: node.tagName });
  const flattened = inlineNodes(node.children, diagnostics);
  return flattened.length ? [{ kind: 'paragraph', id, children: flattened }] : [];
}

export function cardLanguage(title) {
  if (/英文|english/iu.test(title)) return 'en';
  if (/日本語|日语|japanese/iu.test(title)) return 'ja';
  if (/中文|chinese/iu.test(title)) return 'zh';
  return 'unknown';
}

export function parseCardDocument(markdown) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw);
  const root = processor.runSync(processor.parse(String(markdown || '')));
  const diagnostics = [];
  const sections = [];
  let title = 'Untitled card';
  let current = null;

  root.children.forEach((node, index) => {
    if (isElement(node) && node.tagName === 'h1') {
      title = allText(node).trim() || title;
      return;
    }
    if (isElement(node) && node.tagName === 'h2') {
      const titleInline = inlineNodes(node.children, diagnostics);
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

export function cardDocumentInlineText(nodes) {
  return inlineText(nodes);
}
