import { useRef, useState } from 'react';
import { BookOpen, Braces, Check, Languages, Play, Volume2 } from 'lucide-react';
import type { CardBlock, CardDocument, CardInline, CardLanguage } from './card-document';

const languageNames: Record<CardLanguage, string> = {
  en: 'ENGLISH',
  ja: '日本語',
  zh: '中文',
  unknown: 'CONTENT',
};

function PronunciationWord({ node }: { node: Extract<CardInline, { kind: 'pronunciation' }> }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="pronunciation-anchor">
      <button
        type="button"
        className="pronunciation-word"
        aria-label={`${node.surface}，读音 ${node.reading}`}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((value) => !value)}
      >
        {node.surface}
      </button>
      {open && (
        <span className="reading-popover" role="tooltip">
          <span>{node.reading || '读音待确认'}</span>
          <small>{node.source === 'legacy-ruby' ? '历史 Ruby · 只读投影' : '读音投影'}</small>
        </span>
      )}
    </span>
  );
}

function InlineRenderer({ nodes, onAudio }: { nodes: CardInline[]; onAudio: (src: string) => void }) {
  return nodes.map((node, index) => {
    const key = `${node.kind}-${index}`;
    if (node.kind === 'text') return <span key={key}>{node.value}</span>;
    if (node.kind === 'strong') return <strong key={key}><InlineRenderer nodes={node.children} onAudio={onAudio} /></strong>;
    if (node.kind === 'emphasis') return <em key={key}><InlineRenderer nodes={node.children} onAudio={onAudio} /></em>;
    if (node.kind === 'code') return <code key={key}>{node.value}</code>;
    if (node.kind === 'break') return <br key={key} />;
    if (node.kind === 'link') return <a key={key} href={node.href} rel="noreferrer"><InlineRenderer nodes={node.children} onAudio={onAudio} /></a>;
    if (node.kind === 'highlight') return <mark key={key} className={`tone-${node.tone}`}><InlineRenderer nodes={node.children} onAudio={onAudio} /></mark>;
    if (node.kind === 'pronunciation') return <PronunciationWord key={key} node={node} />;
    return (
      <button key={key} type="button" className="inline-audio" aria-label={node.label} onClick={() => onAudio(node.src)}>
        <Play size={14} fill="currentColor" />
      </button>
    );
  });
}

function BlockRenderer({ block, onAudio }: { block: CardBlock; onAudio: (src: string) => void }) {
  const inline = 'children' in block ? <InlineRenderer nodes={block.children} onAudio={onAudio} /> : null;
  if (block.kind === 'heading') {
    const Heading = block.depth <= 3 ? 'h3' : 'h4';
    return <Heading data-block-id={block.id}>{inline}</Heading>;
  }
  if (block.kind === 'paragraph') return <p data-block-id={block.id}>{inline}</p>;
  if (block.kind === 'divider') return <hr data-block-id={block.id} />;
  if (block.kind === 'quote') return <blockquote data-block-id={block.id}>{block.blocks.map((item) => <BlockRenderer key={item.id} block={item} onAudio={onAudio} />)}</blockquote>;
  const List = block.ordered ? 'ol' : 'ul';
  return (
    <List data-block-id={block.id}>
      {block.items.map((item, index) => (
        <li key={`${block.id}-${index}`}>{item.map((entry) => <BlockRenderer key={entry.id} block={entry} onAudio={onAudio} />)}</li>
      ))}
    </List>
  );
}

export function CardReader({ document }: { document: CardDocument }) {
  const readerRef = useRef<HTMLElement | null>(null);
  const [selected, setSelected] = useState('');
  const [audioStatus, setAudioStatus] = useState('音频节点待命');

  const captureSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !readerRef.current?.contains(selection.anchorNode)) {
      setSelected('');
      return;
    }
    const text = selection.toString().replace(/\s+/g, ' ').trim();
    setSelected(Array.from(text).length <= 200 ? text : '');
  };

  const onAudio = (src: string) => {
    setAudioStatus(`受控音频节点：${src || '缺少来源'}`);
  };

  return (
    <div className="poc-shell">
      <header className="reader-header">
        <div>
          <p className="eyebrow">CARD READER V3 · STRUCTURED POC</p>
          <h1>{document.title}</h1>
          <p>Markdown 仍是来源；正文由可检查的 React 节点渲染。</p>
        </div>
        <div className="contract-status" aria-label="POC 合同状态">
          <Check size={16} />
          <span>无 innerHTML</span>
          <span>{document.sections.length} 个语言区块</span>
        </div>
      </header>

      <div className="reader-grid">
        <nav className="section-rail" aria-label="语言区块导航">
          <div className="rail-title"><Languages size={16} /> LANGUAGE MAP</div>
          {document.sections.map((section, index) => (
            <a key={section.id} href={`#${section.id}`}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{languageNames[section.language]}</strong>
              <small>{section.blocks.length} blocks</small>
            </a>
          ))}
          <div className="rail-note">
            <Braces size={15} />
            <span>{document.version}</span>
          </div>
        </nav>

        <main ref={readerRef} className="card-document" onMouseUp={captureSelection}>
          {selected && (
            <div className="selection-command" role="toolbar" aria-label="选区操作">
              <strong title={selected}>{selected}</strong>
              <button type="button">释义</button>
              <button type="button">标记</button>
              <button type="button">朗读</button>
            </div>
          )}
          {document.sections.map((section) => (
            <section id={section.id} key={section.id} className={`language-section is-${section.language}`}>
              <div className="section-heading">
                <span>{languageNames[section.language]}</span>
                <h2><InlineRenderer nodes={section.title} onAudio={onAudio} /></h2>
              </div>
              <div className="section-content">
                {section.blocks.map((block) => <BlockRenderer key={block.id} block={block} onAudio={onAudio} />)}
              </div>
            </section>
          ))}
        </main>

        <aside className="document-inspector" aria-label="结构化文档信息">
          <div className="inspector-title"><BookOpen size={16} /> DOCUMENT MAP</div>
          <dl>
            <div><dt>Source</dt><dd>Markdown</dd></div>
            <div><dt>Projection</dt><dd>CardDocument v1</dd></div>
            <div><dt>Renderer</dt><dd>React nodes</dd></div>
            <div><dt>Unsafe nodes</dt><dd>{document.diagnostics.filter((item) => item.code === 'UNSAFE_NODE_DROPPED').length} blocked</dd></div>
          </dl>
          <div className="audio-state" role="status"><Volume2 size={15} /> {audioStatus}</div>
          <div className="inspector-copy">
            <strong>POC 边界</strong>
            <p>不读取生产数据库，不写注解、读音、知识图谱或学习状态。</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
