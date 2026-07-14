import { useEffect, useMemo, useRef, useState } from 'react';
import { Highlighter, Trash2, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { factoryApi } from '../factory/factory-api';
import type { CardSelection } from '../factory/types';
import { applyMarkerHighlight, applyTextHighlight } from './highlight';
import {
  computeTextHash,
  extractMarkdownTitle,
  renderCardMarkdown,
  sanitizePersistedCardHtml,
} from './markdown';
import { IntelPanel } from './IntelPanel';

type Props = {
  selection: CardSelection;
  readOnly?: boolean;
  onClose: () => void;
};

export function CardModal({ selection, readOnly = false, onClose }: Props) {
  const queryClient = useQueryClient();
  const closeRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const selectedRangeRef = useRef<Range | null>(null);
  const selectedTextRef = useRef('');
  const [tab, setTab] = useState<'content' | 'intel'>('content');
  const [renderedHtml, setRenderedHtml] = useState('');
  const [hasSelection, setHasSelection] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cardQuery = useQuery({
    queryKey: ['card', selection.folder, selection.baseName],
    queryFn: () => factoryApi.card(selection),
  });
  const sourceHash = useMemo(
    () => computeTextHash(cardQuery.data?.markdown || ''),
    [cardQuery.data?.markdown]
  );
  const displayTitle = extractMarkdownTitle(cardQuery.data?.markdown || '', selection.title);

  useEffect(() => {
    const markdown = cardQuery.data?.markdown;
    if (!markdown) return;
    const freshHtml = renderCardMarkdown(markdown, selection.cardType, selection.folder);
    setRenderedHtml(freshHtml);
    factoryApi.highlight(selection.folder, selection.baseName, computeTextHash(markdown))
      .then(({ highlight }) => {
        if (highlight?.htmlContent) {
          setRenderedHtml(sanitizePersistedCardHtml(highlight.htmlContent, selection.cardType));
        }
      })
      .catch(() => {});
  }, [cardQuery.data?.markdown, selection]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = closeRef.current?.closest('[role="dialog"]');
      const focusable = Array.from(dialog?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]'
      ) || []).filter((node) => node.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      audioRef.current?.pause();
      previous?.focus({ preventScroll: true });
    };
  }, [onClose]);

  const deleteMutation = useMutation({
    mutationFn: () => factoryApi.deleteRecord(cardQuery.data?.record || null, selection),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['folders'] });
      await queryClient.invalidateQueries({ queryKey: ['files'] });
      await queryClient.invalidateQueries({ queryKey: ['history'] });
      onClose();
    },
  });

  const saveHighlight = async () => {
    const container = contentRef.current;
    const range = selectedRangeRef.current;
    if (!container || !range) return;
    const applied = applyMarkerHighlight(container, range)
      || applyTextHighlight(container, selectedTextRef.current);
    if (!applied) return;
    window.getSelection()?.removeAllRanges();
    selectedRangeRef.current = null;
    selectedTextRef.current = '';
    setHasSelection(false);
    const renderer = container.querySelector<HTMLElement>('[data-card-renderer-version="2"]');
    if (!renderer) return;
    const html = renderer.outerHTML;
    setRenderedHtml(html);
    await factoryApi.saveHighlight({
      folder: selection.folder,
      base: selection.baseName,
      sourceHash,
      html,
      generationId: cardQuery.data?.record?.id || null,
    });
  };

  const captureSelection = () => {
    const selectionState = window.getSelection();
    const range = selectionState?.rangeCount ? selectionState.getRangeAt(0) : null;
    if (!range || range.collapsed || !contentRef.current?.contains(range.commonAncestorContainer)) {
      selectedRangeRef.current = null;
      selectedTextRef.current = '';
      setHasSelection(false);
      return;
    }
    selectedRangeRef.current = range.cloneRange();
    selectedTextRef.current = selectionState?.toString() || '';
    setHasSelection(true);
  };

  const handleContentClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.audio-btn');
    if (!button) return;
    const source = button.dataset.src;
    if (!source) return;
    audioRef.current?.pause();
    contentRef.current?.querySelectorAll('.audio-btn.is-playing').forEach((node) => node.classList.remove('is-playing'));
    const audio = new Audio(`/api/folders/${encodeURIComponent(selection.folder)}/files/${encodeURIComponent(source)}`);
    audioRef.current = audio;
    button.classList.add('is-playing');
    audio.addEventListener('ended', () => button.classList.remove('is-playing'), { once: true });
    audio.play().catch(() => button.classList.remove('is-playing'));
  };

  return (
    <div className="card-modal-backdrop" data-testid="react-card-modal" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="react-card-modal" role="dialog" aria-modal="true" aria-labelledby="react-card-title">
        <header className="react-card-head">
          {readOnly ? <span className="card-modal-readonly">READ ONLY</span> : (
            <button className="icon-button danger" type="button" aria-label="删除卡片" onClick={() => setConfirmDelete(true)}>
              <Trash2 aria-hidden="true" />
            </button>
          )}
          <div>
            <h1 id="react-card-title">{displayTitle}</h1>
            <p>{selection.cardType === 'scenario_phrase' ? 'SCENARIO' : selection.cardType === 'grammar_ja' ? 'GRAMMAR' : 'TRILINGUAL'} · MARKDOWN</p>
          </div>
          <button ref={closeRef} className="icon-button" type="button" aria-label="关闭学习卡片" data-testid="react-card-modal-close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>

        <nav className="card-modal-tabs" aria-label="学习卡片视图" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'content'} className={tab === 'content' ? 'active' : ''} onClick={() => setTab('content')}>CONTENT</button>
          <button type="button" role="tab" aria-selected={tab === 'intel'} className={tab === 'intel' ? 'active' : ''} onClick={() => setTab('intel')}>INTEL</button>
          {tab === 'content' && !readOnly && (
            <button
              className="highlight-selection-button"
              type="button"
              disabled={!hasSelection}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void saveHighlight()}
            >
              <Highlighter aria-hidden="true" /> 标红选区
            </button>
          )}
        </nav>

        <div className="react-card-scroll">
          {cardQuery.isLoading && <div className="modal-state">正在读取 Markdown…</div>}
          {cardQuery.isError && <div className="modal-state error">无法读取卡片内容。</div>}
          {tab === 'content' && renderedHtml && (
            <div className="card-content-layout">
              <div
                ref={contentRef}
                className="react-card-markdown"
                data-testid="react-card-content"
                onMouseUp={captureSelection}
                onClick={handleContentClick}
                dangerouslySetInnerHTML={{ __html: renderedHtml }}
              />
              <aside className="card-study-meta">
                <p className="eyebrow">CARD INFO</p>
                <dl>
                  <div><dt>Type</dt><dd>{selection.cardType}</dd></div>
                  <div><dt>Model</dt><dd>{cardQuery.data?.record?.llm_model || 'unknown'}</dd></div>
                  <div><dt>Source</dt><dd>Markdown</dd></div>
                </dl>
              </aside>
            </div>
          )}
          {tab === 'intel' && <IntelPanel record={cardQuery.data?.record || null} />}
        </div>

        {confirmDelete && !readOnly && (
          <div className="delete-confirm" role="alertdialog" aria-label="确认删除卡片">
            <strong>删除此学习卡片？</strong>
            <p>卡片、音频和关联记录都会被删除。</p>
            {deleteMutation.isError && <p className="form-error">删除失败，请重试。</p>}
            <div>
              <button type="button" onClick={() => setConfirmDelete(false)}>取消</button>
              <button className="danger-button" type="button" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
                {deleteMutation.isPending ? '删除中…' : '确认删除'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
