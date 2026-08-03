import { BookOpenCheck, Highlighter, Languages, Play, Sparkles } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DesktopVirtualList } from '../../../components/virtual';
import { createAnchor, resolveAnchor } from '../../card-modal/annotation-anchor.mjs';
import type { CardAnnotationSelector } from '../../card-modal/annotation-render.mjs';
import {
  buildTextbookHighlightDocument,
  escapeTextbookText,
  expressionHighlightFragments,
  highlightedExpressionIds,
} from '../textbook-highlight';
import type { TextbookAudio, TextbookTrack } from '../types';
import { factoryApi } from '../../factory/factory-api';

const DeferredManualTagBar = lazy(async () => {
  const module = await import('../../manual-tags/ManualTagBar');
  return { default: module.ManualTagBar };
});
const DeferredPronunciationText = lazy(async () => {
  const module = await import('../../card-modal/PronunciationText');
  return { default: module.PronunciationText };
});

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function selectionLanguage(text: string): 'en' | 'ja' {
  return /[\u3040-\u30ff\u3400-\u9fff]/u.test(text) ? 'ja' : 'en';
}

function canPlay(audio?: TextbookAudio) {
  return Boolean(audio && ['generated', 'fallback_generated'].includes(audio.status));
}

function getExpressionItemKey(expression: TextbookTrack['expressions'][number]) {
  return expression.id;
}

export function TextbookPublishedBrowser({
  track,
  activeExpressionId,
  highlightHtml,
  annotationMode,
  audioFiles,
  busy,
  message,
  onSelect,
  onSaveAnnotation,
  onDerive,
  onPlayAudio,
}: {
  track: TextbookTrack;
  activeExpressionId: number | null;
  highlightHtml: string;
  annotationMode: 'annotations' | 'pending' | 'unavailable';
  audioFiles: TextbookAudio[];
  busy: boolean;
  message: string;
  onSelect: (id: number) => void;
  onSaveAnnotation: (selector: CardAnnotationSelector) => void;
  onDerive: (payload: { expressionId: number; selectionText: string; selectionLanguage: 'en' | 'ja'; targetCardType: 'trilingual' | 'grammar_ja' }) => void;
  onPlayAudio: (url: string) => void;
}) {
  const expressions = track.expressions;
  const expression = expressions.find((row) => row.id === activeExpressionId) || expressions[0] || null;
  const contentRef = useRef<HTMLDivElement>(null);
  const rangeRef = useRef<Range | null>(null);
  const anchorRef = useRef<CardAnnotationSelector | null>(null);
  const selectionRef = useRef('');
  const [selectedText, setSelectedText] = useState('');
  const marked = highlightedExpressionIds(highlightHtml);
  useEffect(() => {
    rangeRef.current = null;
    anchorRef.current = null;
    selectionRef.current = '';
    setSelectedText('');
  }, [expression?.id]);
  const pronunciationQuery = useQuery({
    queryKey: ['pronunciation', 'textbook_expression', expression?.expression_id || null],
    queryFn: () => factoryApi.pronunciation('textbook_expression', Number(expression?.expression_id)),
    enabled: Boolean(expression?.expression_id),
    retry: false,
  });
  if (!expression) return <section className="surface textbook-empty-workbench"><h2>没有可浏览表达</h2></section>;
  const fragments = expressionHighlightFragments(highlightHtml, expression.expression_id);
  const expressionAudioKey = expression.expression_key.replace(/^expr:/u, '').replace(/[^a-z0-9]+/giu, '_');
  const matchingAudio = audioFiles.filter((audio) => audio.filename_suffix.endsWith(`_expr_${expressionAudioKey}`));
  const enAudio = matchingAudio.find((audio) => audio.language === 'en');
  const jaAudio = matchingAudio.find((audio) => audio.language === 'ja');
  const phrases = parseJson<Array<{ label: string; explanation: string }>>(expression.phrase_analysis_json, []);
  const grammar = parseJson<Array<{ label: string; explanation: string }>>(expression.grammar_points_json, []);
  const captureSelection = () => {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const text = selection?.toString().trim() || '';
    if (!range || range.collapsed || !text || !contentRef.current?.contains(range.commonAncestorContainer)) {
      rangeRef.current = null;
      anchorRef.current = null;
      selectionRef.current = '';
      setSelectedText('');
      return;
    }
    const startElement = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer as Element
      : range.startContainer.parentElement;
    const endElement = range.endContainer.nodeType === Node.ELEMENT_NODE
      ? range.endContainer as Element
      : range.endContainer.parentElement;
    const startLanguage = startElement?.closest<HTMLElement>('[data-textbook-language]');
    const endLanguage = endElement?.closest<HTMLElement>('[data-textbook-language]');
    if (!startLanguage || startLanguage !== endLanguage) {
      rangeRef.current = null;
      anchorRef.current = null;
      selectionRef.current = '';
      setSelectedText('');
      return;
    }
    try {
      const localAnchor = createAnchor(startLanguage, range);
      const canonical = new DOMParser().parseFromString(
        buildTextbookHighlightDocument(track),
        'text/html'
      );
      const canonicalRoot = canonical.body.firstElementChild as HTMLElement | null;
      const language = startLanguage.dataset.textbookLanguage;
      const canonicalLanguage = canonicalRoot?.querySelector<HTMLElement>(
        `[data-textbook-expression-id="${expression.expression_id}"] [data-textbook-language="${language}"]`
      );
      const resolved = canonicalLanguage ? resolveAnchor(canonicalLanguage, localAnchor) : null;
      if (!canonicalRoot || !resolved?.range) throw new Error('Textbook selection cannot be anchored');
      anchorRef.current = createAnchor(canonicalRoot, resolved.range);
    } catch {
      rangeRef.current = null;
      anchorRef.current = null;
      selectionRef.current = '';
      setSelectedText('');
      return;
    }
    rangeRef.current = range.cloneRange();
    selectionRef.current = text;
    setSelectedText(text);
  };
  const saveHighlight = () => {
    if (!rangeRef.current || !contentRef.current) return;
    if (annotationMode !== 'annotations' || !anchorRef.current) return;
    onSaveAnnotation(anchorRef.current);
    window.getSelection()?.removeAllRanges();
    rangeRef.current = null;
    anchorRef.current = null;
    selectionRef.current = '';
    setSelectedText('');
  };
  return (
    <div className="textbook-published-browser">
      <div className="textbook-track-tags">
        <span>Track 标签</span>
        <Suspense fallback={null}><DeferredManualTagBar targetKind="textbook_track" targetId={track.id} compact /></Suspense>
      </div>
      <aside className="surface textbook-published-list">
        <header><p className="eyebrow">EXPRESSIONS</p><h2>教材浏览</h2></header>
        <DesktopVirtualList
          items={expressions}
          getItemKey={getExpressionItemKey}
          estimateSize={59}
          activeKey={expression.id}
          ariaLabel="教材表达列表"
          className="textbook-published-list-viewport"
          testId="textbook-published-virtual-list"
          renderItem={(row) => (
            <button type="button" className={row.id === expression.id ? 'active' : ''} onClick={() => onSelect(row.id)}>
              <span>{String(row.display_ordinal).padStart(2, '0')}</span>
              <strong>{row.official_en_text}</strong>
              <small>{row.official_ja_text}</small>
              {marked.has(row.expression_id) && <i>含标红</i>}
            </button>
          )}
        />
      </aside>
      <article className="surface textbook-study-detail">
        <header><p className="eyebrow">EXPR {String(expression.display_ordinal).padStart(2, '0')}</p><h2>英日表达</h2></header>
        <Suspense fallback={null}><DeferredManualTagBar targetKind="textbook_expression" targetId={expression.expression_id} compact /></Suspense>
        <div ref={contentRef} className="textbook-expression-content" onMouseUp={captureSelection}>
          <section>
            <p className="textbook-lang-label">English official</p>
            <h3 data-textbook-language="en" dangerouslySetInnerHTML={{ __html: fragments?.en || escapeTextbookText(expression.official_en_text) }} />
            <button type="button" disabled={!canPlay(enAudio)} onClick={() => enAudio && onPlayAudio(enAudio.playback_url)}><Play aria-hidden="true" />{canPlay(enAudio) ? '播放 EN' : 'EN 语音未生成'}</button>
          </section>
          <section>
            <p className="textbook-lang-label">Japanese official</p>
            <Suspense fallback={<h3 className="textbook-ja" data-textbook-language="ja" dangerouslySetInnerHTML={{ __html: escapeTextbookText(expression.official_ja_text) }} />}>
              <DeferredPronunciationText
                tagName="h3"
                className="textbook-ja"
                language="ja"
                html={fragments?.ja || escapeTextbookText(expression.official_ja_text)}
                tokens={pronunciationQuery.data?.tokens || []}
              />
            </Suspense>
            <button type="button" disabled={!canPlay(jaAudio)} onClick={() => jaAudio && onPlayAudio(jaAudio.playback_url)}><Play aria-hidden="true" />{canPlay(jaAudio) ? '播放 JA' : 'JA 语音未生成'}</button>
          </section>
          <div className="textbook-zh-cue"><Languages aria-hidden="true" /><span dangerouslySetInnerHTML={{ __html: fragments?.zh || escapeTextbookText(expression.zh_cue_text) }} /></div>
        </div>
        <section className="textbook-selection-panel">
          <p className="textbook-lang-label">Selection to card</p>
          <strong>{selectedText || '选中英文或日文片段后，可标红或生成派生卡。'}</strong>
          <div>
            <button type="button" disabled={!selectedText || busy || annotationMode !== 'annotations'} onMouseDown={(event) => event.preventDefault()} onClick={saveHighlight}><Highlighter aria-hidden="true" />标红选区</button>
            <button type="button" disabled={!selectedText || busy} onClick={() => onDerive({ expressionId: expression.expression_id, selectionText: selectedText, selectionLanguage: selectionLanguage(selectedText), targetCardType: 'trilingual' })}>生成三语卡</button>
            <button type="button" disabled={!selectedText || busy || selectionLanguage(selectedText) !== 'ja'} onClick={() => onDerive({ expressionId: expression.expression_id, selectionText: selectedText, selectionLanguage: 'ja', targetCardType: 'grammar_ja' })}>生成语法卡</button>
          </div>
          <small>{message || '选区使用规范化派生键；重复选择会复用既有关系。'}</small>
        </section>
        <section className="textbook-analysis-list">
          <h3><Sparkles aria-hidden="true" />重点短语</h3>
          {phrases.map((item) => <p key={`${item.label}-${item.explanation}`}><strong>{item.label}</strong><span>{item.explanation}</span></p>)}
          {!phrases.length && <small>暂无重点短语。</small>}
          <h3><BookOpenCheck aria-hidden="true" />语法点</h3>
          {grammar.map((item) => <p key={`${item.label}-${item.explanation}`}><strong>{item.label}</strong><span>{item.explanation}</span></p>)}
          {!grammar.length && <small>暂无语法点。</small>}
        </section>
      </article>
    </div>
  );
}
