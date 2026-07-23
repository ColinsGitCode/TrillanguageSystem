import { BookOpenCheck, Highlighter, Languages, Play, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { applyMarkerHighlight, applyTextHighlight } from '../../card-modal/highlight';
import {
  escapeTextbookText,
  expressionHighlightFragments,
  highlightedExpressionIds,
  updateExpressionHighlightDocument,
} from '../textbook-highlight';
import type { TextbookAudio, TextbookExpression } from '../types';

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

export function TextbookPublishedBrowser({
  expressions,
  activeExpressionId,
  highlightHtml,
  audioFiles,
  busy,
  message,
  onSelect,
  onSaveHighlight,
  onDerive,
  onPlayAudio,
}: {
  expressions: TextbookExpression[];
  activeExpressionId: number | null;
  highlightHtml: string;
  audioFiles: TextbookAudio[];
  busy: boolean;
  message: string;
  onSelect: (id: number) => void;
  onSaveHighlight: (html: string) => void;
  onDerive: (payload: { expressionId: number; selectionText: string; selectionLanguage: 'en' | 'ja'; targetCardType: 'trilingual' | 'grammar_ja' }) => void;
  onPlayAudio: (url: string) => void;
}) {
  const expression = expressions.find((row) => row.id === activeExpressionId) || expressions[0] || null;
  const contentRef = useRef<HTMLDivElement>(null);
  const rangeRef = useRef<Range | null>(null);
  const selectionRef = useRef('');
  const [selectedText, setSelectedText] = useState('');
  const marked = highlightedExpressionIds(highlightHtml);
  useEffect(() => {
    rangeRef.current = null;
    selectionRef.current = '';
    setSelectedText('');
  }, [expression?.id]);
  if (!expression) return <section className="surface textbook-empty-workbench"><h2>没有可浏览表达</h2></section>;
  const fragments = expressionHighlightFragments(highlightHtml, expression.expression_id);
  const expressionKey = expression.expression_key.replace(/^expr:/u, '').replace(/[^a-z0-9]+/giu, '_');
  const matchingAudio = audioFiles.filter((audio) => audio.filename_suffix.endsWith(`_expr_${expressionKey}`));
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
    const applied = applyMarkerHighlight(contentRef.current, rangeRef.current)
      || applyTextHighlight(contentRef.current, selectionRef.current);
    if (!applied) return;
    onSaveHighlight(updateExpressionHighlightDocument(highlightHtml, expression.expression_id, contentRef.current));
    window.getSelection()?.removeAllRanges();
    setSelectedText('');
  };
  return (
    <div className="textbook-published-browser">
      <aside className="surface textbook-published-list">
        <header><p className="eyebrow">EXPRESSIONS</p><h2>教材浏览</h2></header>
        <ol>{expressions.map((row) => (
          <li key={row.id}>
            <button type="button" className={row.id === expression.id ? 'active' : ''} onClick={() => onSelect(row.id)}>
              <span>{String(row.display_ordinal).padStart(2, '0')}</span>
              <strong>{row.official_en_text}</strong>
              <small>{row.official_ja_text}</small>
              {marked.has(row.expression_id) && <i>含标红</i>}
            </button>
          </li>
        ))}</ol>
      </aside>
      <article className="surface textbook-study-detail">
        <header><p className="eyebrow">EXPR {String(expression.display_ordinal).padStart(2, '0')}</p><h2>英日表达</h2></header>
        <div ref={contentRef} className="textbook-expression-content" onMouseUp={captureSelection}>
          <section>
            <p className="textbook-lang-label">English official</p>
            <h3 data-textbook-language="en" dangerouslySetInnerHTML={{ __html: fragments?.en || escapeTextbookText(expression.official_en_text) }} />
            <button type="button" disabled={!canPlay(enAudio)} onClick={() => enAudio && onPlayAudio(enAudio.playback_url)}><Play aria-hidden="true" />{canPlay(enAudio) ? '播放 EN' : 'EN 语音未生成'}</button>
          </section>
          <section>
            <p className="textbook-lang-label">Japanese official</p>
            <h3 className="textbook-ja" data-textbook-language="ja" dangerouslySetInnerHTML={{ __html: fragments?.ja || expression.ja_ruby_html }} />
            <button type="button" disabled={!canPlay(jaAudio)} onClick={() => jaAudio && onPlayAudio(jaAudio.playback_url)}><Play aria-hidden="true" />{canPlay(jaAudio) ? '播放 JA' : 'JA 语音未生成'}</button>
          </section>
          <div className="textbook-zh-cue"><Languages aria-hidden="true" /><span dangerouslySetInnerHTML={{ __html: fragments?.zh || escapeTextbookText(expression.zh_cue_text) }} /></div>
        </div>
        <section className="textbook-selection-panel">
          <p className="textbook-lang-label">Selection to card</p>
          <strong>{selectedText || '选中英文或日文片段后，可标红或生成派生卡。'}</strong>
          <div>
            <button type="button" disabled={!selectedText || busy} onMouseDown={(event) => event.preventDefault()} onClick={saveHighlight}><Highlighter aria-hidden="true" />标红选区</button>
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
