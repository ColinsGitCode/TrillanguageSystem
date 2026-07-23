import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Highlighter, Sparkles, Trash2, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { factoryApi } from '../factory/factory-api';
import type { CardSelection, CardType } from '../factory/types';
import { ApiError } from '../../lib/api/client';
import { applyMarkerHighlight, applyTextHighlight } from './highlight';
import { buildSelectionCandidate } from './selection';
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

const CARD_TYPE_LABEL: Record<CardType, string> = {
  trilingual: '单词卡',
  grammar_ja: '语法卡',
  scenario_phrase: '场景卡',
};
const SELECTION_CARD_TYPES: CardType[] = ['trilingual', 'grammar_ja', 'scenario_phrase'];

export function CardModal({ selection, readOnly = false, onClose }: Props) {
  const queryClient = useQueryClient();
  const closeRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const selectedRangeRef = useRef<Range | null>(null);
  const selectedTextRef = useRef('');
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<'content' | 'intel'>('content');
  const [renderedHtml, setRenderedHtml] = useState('');
  const [hasSelection, setHasSelection] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toolbar, setToolbar] = useState<{
    top: number;
    left: number;
    anchorLeft: number;
    placeBelow: boolean;
    phrase: string;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [genMenuOpen, setGenMenuOpen] = useState(false);
  const toastTimerRef = useRef<number | null>(null);
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

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2400);
  };
  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  useLayoutEffect(() => {
    if (!toolbar) return;
    const clampToViewport = () => {
      const node = toolbarRef.current;
      if (!node) return;
      const viewportPadding = 8;
      const halfWidth = node.getBoundingClientRect().width / 2;
      const minimum = viewportPadding + halfWidth;
      const maximum = window.innerWidth - viewportPadding - halfWidth;
      const left = minimum > maximum
        ? window.innerWidth / 2
        : Math.min(maximum, Math.max(minimum, toolbar.anchorLeft));
      setToolbar((current) => (
        current && Math.abs(current.left - left) > 0.5 ? { ...current, left } : current
      ));
    };
    clampToViewport();
    window.addEventListener('resize', clampToViewport);
    return () => window.removeEventListener('resize', clampToViewport);
  }, [toolbar?.anchorLeft, toolbar?.phrase]);

  const generateMutation = useMutation({
    mutationFn: (vars: { phrase: string; cardType: CardType }) => factoryApi.enqueue({
      phrase: vars.phrase,
      cardType: vars.cardType,
      sourceMode: 'selection',
      targetFolder: selection.folder,
    }),
    onSuccess: async (_data, vars) => {
      await queryClient.invalidateQueries({ queryKey: ['queue'] });
      window.getSelection()?.removeAllRanges();
      setToolbar(null);
      setGenMenuOpen(false);
      setHasSelection(false);
      showToast(`✦ 已加入生成队列 · ${CARD_TYPE_LABEL[vars.cardType]}`);
    },
    onError: (error) => {
      const duplicate = error instanceof ApiError && error.status === 409;
      showToast(duplicate ? '该短语已存在或已在生成队列中' : '生成入队失败，请重试');
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
    setToolbar(null);
    setGenMenuOpen(false);
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
    const container = contentRef.current;
    if (!container) return;
    const candidate = buildSelectionCandidate(container);
    if (!candidate) {
      selectedRangeRef.current = null;
      selectedTextRef.current = '';
      setHasSelection(false);
      setToolbar(null);
      setGenMenuOpen(false);
      return;
    }
    selectedRangeRef.current = candidate.range.cloneRange();
    // Keep highlight recovery aligned with the ruby-free phrase shown in the toolbar.
    selectedTextRef.current = candidate.rawText;
    setHasSelection(true);
    const rect = candidate.range.getBoundingClientRect();
    const placeBelow = rect.top < 64;
    const anchorLeft = rect.left + rect.width / 2;
    setToolbar({
      top: placeBelow ? rect.bottom : rect.top,
      left: anchorLeft,
      anchorLeft,
      placeBelow,
      phrase: candidate.normalized,
    });
    setGenMenuOpen(false);
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

        <div className="react-card-scroll" onScroll={() => setToolbar(null)}>
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

        {tab === 'content' && !readOnly && toolbar && (
          <div
            ref={toolbarRef}
            className="card-selection-toolbar"
            data-placement={toolbar.placeBelow ? 'below' : 'above'}
            style={{ top: toolbar.top, left: toolbar.left }}
            role="toolbar"
            aria-label="选区操作"
            onMouseDown={(event) => event.preventDefault()}
          >
            <output
              className="csa-selection-preview"
              data-testid="card-selection-preview"
              title={toolbar.phrase}
            >
              <span>已选</span>
              <strong>{toolbar.phrase}</strong>
            </output>
            <span className="csa-sep" aria-hidden="true" />
            <button type="button" className="csa-highlight" onClick={() => void saveHighlight()}>
              <Highlighter aria-hidden="true" /> 标红
            </button>
            <span className="csa-sep" aria-hidden="true" />
            <div className="csa-generate-wrap">
              <button
                type="button"
                className="csa-generate"
                disabled={generateMutation.isPending}
                aria-haspopup="menu"
                aria-expanded={genMenuOpen}
                onClick={() => setGenMenuOpen((open) => !open)}
              >
                <Sparkles aria-hidden="true" /> {generateMutation.isPending ? '入队中…' : '生成卡片'}
                <ChevronDown aria-hidden="true" className="csa-caret" />
              </button>
              {genMenuOpen && !generateMutation.isPending && (
                <div className="csa-gen-menu" role="menu">
                  {SELECTION_CARD_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      role="menuitem"
                      onClick={() => generateMutation.mutate({ phrase: toolbar.phrase, cardType: type })}
                    >
                      {CARD_TYPE_LABEL[type]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {toast && <div className="card-selection-toast" role="status">{toast}</div>}

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
