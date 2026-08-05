import { memo, useLayoutEffect, useRef } from 'react';
import type { CardType } from '../factory/types';
import type { CardAnnotation } from '../factory/factory-api';
import { applyAnnotations } from './annotation-render.mjs';
import { enhancePronunciationRoot } from './pronunciation-overlay';
import type { PronunciationToken } from './pronunciation-overlay';
import type { CardBlock, CardDocument, CardInline } from './card-document';

const SPAN_CLASS: Record<Extract<CardInline, { kind: 'span' }>['role'], string> = {
  explanation: 'explanation-text',
  'loanword-label': 'loanword-label',
  'loanword-line': 'loanword-line',
  'loanword-tag': 'loanword-tag',
};

function InlineNodes({ nodes }: { nodes: CardInline[] }) {
  return nodes.map((node, index) => {
    const key = `${node.kind}-${index}`;
    if (node.kind === 'text') return <span key={key}>{node.value}</span>;
    if (node.kind === 'strong') return <strong key={key}><InlineNodes nodes={node.children} /></strong>;
    if (node.kind === 'emphasis') return <em key={key}><InlineNodes nodes={node.children} /></em>;
    if (node.kind === 'span') return <span key={key} className={SPAN_CLASS[node.role]}><InlineNodes nodes={node.children} /></span>;
    if (node.kind === 'code') return <code key={key}>{node.value}</code>;
    if (node.kind === 'break') return <br key={key} />;
    if (node.kind === 'link') {
      return node.href
        ? <a key={key} href={node.href} rel="noreferrer"><InlineNodes nodes={node.children} /></a>
        : <span key={key}><InlineNodes nodes={node.children} /></span>;
    }
    if (node.kind === 'highlight') {
      const tone = ['red', 'yellow', 'green', 'blue'].includes(node.tone) ? node.tone : 'blue';
      return <mark key={key} className={`study-highlight-${tone}`}><InlineNodes nodes={node.children} /></mark>;
    }
    if (node.kind === 'pronunciation') return <span key={key}>{node.surface}</span>;
    return (
      <button
        key={key}
        type="button"
        className="audio-btn"
        aria-label={node.label}
        data-src={node.src}
      >
        ▶
      </button>
    );
  });
}

function Block({ block }: { block: CardBlock }) {
  if (block.kind === 'heading') {
    const Heading = block.depth <= 3 ? 'h3' : 'h4';
    return <Heading data-block-id={block.id}><InlineNodes nodes={block.children} /></Heading>;
  }
  if (block.kind === 'paragraph') return <p data-block-id={block.id}><InlineNodes nodes={block.children} /></p>;
  if (block.kind === 'divider') return <hr data-block-id={block.id} />;
  if (block.kind === 'aside') {
    return <aside data-block-id={block.id} className="loanword-block"><InlineNodes nodes={block.children} /></aside>;
  }
  if (block.kind === 'quote') {
    return <blockquote data-block-id={block.id}>{block.blocks.map((item) => <Block key={item.id} block={item} />)}</blockquote>;
  }
  const List = block.ordered ? 'ol' : 'ul';
  return (
    <List data-block-id={block.id}>
      {block.items.map((item, index) => {
        return (
          <li key={`${block.id}-${index}`}>
            {item.map((entry) => (
              entry.kind === 'paragraph'
                ? <InlineNodes key={entry.id} nodes={entry.children} />
                : <Block key={entry.id} block={entry} />
            ))}
          </li>
        );
      })}
    </List>
  );
}

type SurfaceProps = {
  document: CardDocument;
  cardType: CardType;
  annotations: CardAnnotation[];
  pronunciationTokens: PronunciationToken[];
};

const DecoratedSurface = memo(function DecoratedSurface({
  document,
  cardType,
  annotations,
  pronunciationTokens,
}: SurfaceProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    applyAnnotations(surface, annotations);
    enhancePronunciationRoot(surface, pronunciationTokens);
  }, [annotations, pronunciationTokens]);

  return (
    <div
      ref={surfaceRef}
      className={`react-card-renderer card-type-${cardType} card-reader-v3`}
      data-card-renderer-version="3"
      data-card-type={cardType}
      data-testid="card-reader-v3-surface"
    >
      <h1><InlineNodes nodes={document.title} /></h1>
      {document.sections.map((section) => (
        <section key={section.id} data-card-section-id={section.id} data-card-language={section.language}>
          <h2><InlineNodes nodes={section.title} /></h2>
          {section.blocks.map((block) => <Block key={block.id} block={block} />)}
        </section>
      ))}
    </div>
  );
});

export function CardReaderV3(props: SurfaceProps) {
  const annotationKey = props.annotations.map((item) => `${item.id}:${item.version}`).join('|');
  const tokenKey = props.pronunciationTokens.map((item) => `${item.tokenKey}:${item.status}:${item.readingHiragana || ''}`).join('|');
  return <DecoratedSurface key={`${annotationKey}::${tokenKey}`} {...props} />;
}
