import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Copy,
  Eraser,
  Highlighter,
  Languages,
  X,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { knowledgeApi } from '../knowledge/knowledge-api';
import { factoryApi } from '../factory/factory-api';
import type {
  AnnotationColor,
  AnnotationTarget,
  CardAnnotation,
} from '../factory/factory-api';
import type { CardSelection, CardType } from '../factory/types';
import { ApiError } from '../../lib/api/client';
import { useExclusiveAudio } from '../../lib/audio/exclusive-audio';
import { markUiInteractionEnd } from '../../lib/performance';
import { createAnchor, resolveAnchor } from './annotation-anchor.mjs';
import { applyAnnotations } from './annotation-render.mjs';
import type { CardAnnotationSelector } from './annotation-render.mjs';
import {
  buildSelectionCandidate,
  buildWordRangeAtPoint,
  selectionRangeContainsPoint,
} from './selection';
import {
  extractMarkdownTitle,
  renderCardMarkdown,
} from './markdown';
import { extractGrammarSummary, extractScenarioOutline, extractTrilingualSummary } from './card-layout.mjs';
import { CardMoreMenu } from './CardMoreMenu';
import {
  inferLookupKind,
  inferLookupLanguage,
  isKeyboardSelectionKey,
} from './selection-actions';
import type {
  KnowledgeLookupDraft,
} from './SelectionKnowledgePanel';
import {
  pronunciationTokenForRange,
  rangeIntersectsPronunciationToken,
  selectPronunciationToken,
} from './pronunciation-overlay';
import type { PronunciationToken } from './pronunciation-overlay';
import type { NoteDraft } from './SelectionNoteEditor';
import type { CardLookupLanguage } from './selection-actions';
import '../../styles/card-modal.css';

const DeferredSelectionMoreActions = lazy(() => import('./SelectionExtraControls').then((m) => ({ default: m.SelectionMoreActions })));
const DeferredSelectionScopeControls = lazy(() => import('./SelectionExtraControls').then((m) => ({ default: m.SelectionScopeControls })));
const DeferredSelectionHighlightAction = lazy(() => import('./SelectionMenuActions').then((m) => ({ default: m.SelectionHighlightAction })));
const DeferredSelectionGenerateAction = lazy(() => import('./SelectionMenuActions').then((m) => ({ default: m.SelectionGenerateAction })));
const DeferredSelectionNoteEditor = lazy(async () => {
  const module = await import('./SelectionNoteEditor');
  return { default: module.SelectionNoteEditor };
});
const DeferredIntelPanel = lazy(async () => {
  const module = await import('./IntelPanel');
  return { default: module.IntelPanel };
});
const DeferredSelectionKnowledgePanel = lazy(async () => {
  const module = await import('./SelectionKnowledgePanel');
  return { default: module.SelectionKnowledgePanel };
});
const DeferredSelectionTtsControls = lazy(async () => {
  const module = await import('./SelectionTtsControls');
  return { default: module.SelectionTtsControls };
});
const DeferredSelectionGlossaryInline = lazy(async () => {
  const module = await import('./SelectionGlossaryInline');
  return { default: module.SelectionGlossaryInline };
});
const DeferredManualTagBar = lazy(async () => {
  const module = await import('../manual-tags/ManualTagBar');
  return { default: module.ManualTagBar };
});
const DeferredCardOpenRecorder = lazy(async () => {
  const module = await import('./CardEngagementMeta');
  return { default: module.CardOpenRecorder };
});
const DeferredCardEngagementSummary = lazy(async () => {
  const module = await import('./CardEngagementMeta');
  return { default: module.CardEngagementSummary };
});
const DeferredCardSummaryStrip = lazy(async () => {
  const module = await import('./CardReadingAids');
  return { default: module.CardSummaryStrip };
});
const DeferredGrammarSummaryStrip = lazy(async () => {
  const module = await import('./CardReadingAids');
  return { default: module.GrammarSummaryStrip };
});
const DeferredScenarioOutline = lazy(async () => {
  const module = await import('./CardReadingAids');
  return { default: module.ScenarioOutline };
});
const DeferredPronunciationCardContent = lazy(async () => {
  const module = await import('./PronunciationCardContent');
  return { default: module.PronunciationCardContent };
});

type Props = {
  selection: CardSelection;
  readOnly?: boolean;
  onClose: () => void;
  restoreFocusTo?: HTMLElement | null;
};

const CARD_TYPE_LABEL: Record<CardType, string> = {
  trilingual: '三语卡',
  grammar_ja: '语法卡',
  scenario_phrase: '场景卡',
};
const SELECTION_CARD_TYPES: CardType[] = ['trilingual', 'grammar_ja', 'scenario_phrase'];
const HIGHLIGHT_COLORS: Array<{
  value: AnnotationColor;
  label: string;
}> = [
  { value: 'red', label: '红色重点' },
  { value: 'yellow', label: '黄色提示' },
  { value: 'green', label: '绿色掌握' },
  { value: 'blue', label: '蓝色补充' },
];
const COLOR_LABEL = Object.fromEntries(
  HIGHLIGHT_COLORS.map((item) => [item.value, item.label])
) as Record<AnnotationColor, string>;

type SelectionToolbarState = {
  top: number;
  left: number;
  anchorLeft: number;
  anchorTop: number;
  anchorBottom: number;
  placeBelow: boolean;
  phrase: string;
  rawText: string;
  annotationId: string | null;
  language: CardLookupLanguage | null;
  pronunciationToken: PronunciationToken | null;
  contextText: string;
};

const READINGS_STORAGE_KEY = 'three-lans:card-show-readings';
const LEGACY_READINGS_STORAGE_KEY = 'three-lans:card-show-readings:legacy';
// Cards generated before 2026-08 carry inline <ruby> in their Markdown and were
// always read with furigana above the kanji, so for them the layer starts on.
// Newer cards have no inline readings and start off. Each kind keeps its own
// choice, so turning one off does not change how the other opens.
const LEGACY_RUBY_PATTERN = /<ruby[\s>]/iu;

type ReadingsPreference = { current: boolean; legacy: boolean };
const DEFAULT_READINGS: ReadingsPreference = { current: false, legacy: true };

// A per-reader view preference, so it survives card changes and reloads. Any
// storage failure (private window, blocked site data) simply means the default
// applies; it must never keep the card from rendering.
function readStoredShowReadings(): ReadingsPreference {
  const read = (key: string, fallback: boolean) => {
    try {
      const value = window.localStorage.getItem(key);
      return value === null ? fallback : value === '1';
    } catch {
      return fallback;
    }
  };
  return {
    current: read(READINGS_STORAGE_KEY, DEFAULT_READINGS.current),
    legacy: read(LEGACY_READINGS_STORAGE_KEY, DEFAULT_READINGS.legacy),
  };
}

function storeShowReadings(legacy: boolean, next: boolean) {
  try {
    window.localStorage.setItem(legacy ? LEGACY_READINGS_STORAGE_KEY : READINGS_STORAGE_KEY, next ? '1' : '0');
  } catch {
    // A reader who cannot persist the preference still gets it this session.
  }
}

function lookupErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return '知识点查询失败，请重试。';
  const payload = error.payload as { code?: string } | null;
  if (error.status === 404 || payload?.code === 'KG_FEATURE_DISABLED') {
    return '知识点功能当前未启用。';
  }
  if (error.status === 400) {
    return '选区内容与所选语言不匹配，请重新确认语言或知识类型。';
  }
  if (error.status === 409) return '这次查询与已有记录冲突，请重新发起。';
  return '知识点查询失败，请重试。';
}

export function CardModal({
  selection,
  readOnly = false,
  onClose,
  restoreFocusTo = null,
}: Props) {
  const queryClient = useQueryClient();
  const onCloseRef = useRef(onClose);
  const closeRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const cardAudio = useExclusiveAudio();
  const selectedRangeRef = useRef<Range | null>(null);
  const selectedAnchorRef = useRef<CardAnnotationSelector | null>(null);
  const selectedTextRef = useRef('');
  const originalScopeAnchorRef = useRef<CardAnnotationSelector | null>(null);
  const [selectionScope, setSelectionScope] = useState('original');
  const [detailHost, setDetailHost] = useState<HTMLDivElement | null>(null);
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteExit, setNoteExit] = useState<'note' | 'card' | 'delete' | null>(null);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const lookupSourceRef = useRef<Record<string, unknown>>({});
  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolbarFirstActionRef = useRef<HTMLButtonElement>(null);
  const generateTriggerRef = useRef<HTMLButtonElement>(null);
  const lookupTriggerRef = useRef<HTMLButtonElement>(null);
  const focusToolbarAfterSelectionRef = useRef(false);
  const keyboardSelectionRef = useRef(false);
  // One id per modal mount. The "card was opened" fact belongs to the modal,
  // not to the sidebar that renders it: the sidebar lives inside the content
  // tab and unmounts whenever the user visits 生成信息, so a key minted there
  // is new on every return and the server can never dedupe it.
  const modalOpenIdRef = useRef('');
  if (!modalOpenIdRef.current) modalOpenIdRef.current = crypto.randomUUID();
  const [tab, setTab] = useState<'content' | 'intel'>('content');
  const [readingsPreference, setReadingsPreference] = useState<ReadingsPreference>(
    () => (typeof window === 'undefined' ? DEFAULT_READINGS : readStoredShowReadings())
  );
  const [renderedHtml, setRenderedHtml] = useState('');
  const [annotationSnapshot, setAnnotationSnapshot] = useState<CardAnnotation[]>([]);
  const [annotationMode, setAnnotationMode] = useState<'pending' | 'annotations' | 'unavailable'>('pending');
  const [isSavingAnnotation, setIsSavingAnnotation] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toolbar, setToolbar] = useState<SelectionToolbarState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [genMenuOpen, setGenMenuOpen] = useState(false);
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const [knowledgeDraft, setKnowledgeDraft] = useState<KnowledgeLookupDraft | null>(null);
  const [pronunciationDetailTokenKey, setPronunciationDetailTokenKey] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const annotationStateRef = useRef<{
    target: AnnotationTarget;
    annotations: CardAnnotation[];
  } | null>(null);
  const cardQuery = useQuery({
    queryKey: ['card', selection.folder, selection.baseName],
    queryFn: () => factoryApi.card(selection),
  });
  const generationId = cardQuery.data?.record?.id || selection.generationId || null;
  const legacyRubyCard = LEGACY_RUBY_PATTERN.test(cardQuery.data?.markdown || '');
  const showReadings = legacyRubyCard ? readingsPreference.legacy : readingsPreference.current;
  const cardReaderShadowConfig = useQuery({
    queryKey: ['card-reader-shadow', 'config'],
    queryFn: factoryApi.cardReaderShadowConfig,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  useQuery({
    queryKey: ['card-reader-shadow', generationId],
    queryFn: () => factoryApi.cardReaderShadow(Number(generationId)),
    enabled: Boolean(generationId) && cardReaderShadowConfig.data?.enabled === true,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const canaryEligible = Boolean(
    generationId
    && selection.cardType === 'trilingual'
    && cardReaderShadowConfig.data?.canaryEnabled
    && cardReaderShadowConfig.data.canaryGenerationIds.includes(Number(generationId))
  );
  const cardReaderCanary = useQuery({
    queryKey: ['card-reader-canary', generationId],
    queryFn: () => factoryApi.cardReaderCanary(Number(generationId)),
    enabled: canaryEligible,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const displayTitle = extractMarkdownTitle(cardQuery.data?.markdown || '', selection.title);
  // Reading aids read the Markdown, never the rendered body, so nothing they
  // show enters the text that highlights are anchored to.
  const summary = useMemo(() => (
    selection.cardType === 'trilingual' ? extractTrilingualSummary(cardQuery.data?.markdown || '') : null
  ), [cardQuery.data?.markdown, selection.cardType]);
  const grammarSummary = useMemo(() => (
    selection.cardType === 'grammar_ja' ? extractGrammarSummary(cardQuery.data?.markdown || '') : null
  ), [cardQuery.data?.markdown, selection.cardType]);
  const outline = useMemo(() => (
    selection.cardType === 'scenario_phrase' ? extractScenarioOutline(cardQuery.data?.markdown || '') : []
  ), [cardQuery.data?.markdown, selection.cardType]);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const getContentRoot = useCallback(() => contentRef.current, []);

  useEffect(() => {
    markUiInteractionEnd('card-modal-open');
  }, []);

  useEffect(() => setPreviewExpanded(false), [toolbar?.phrase]);

  useEffect(() => {
    if (!noteExit) return;
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>('.note-exit-confirm button')?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [noteExit]);

  useEffect(() => {
    onCloseRef.current = () => requestNoteExit('card');
  });

  useEffect(() => {
    if (!noteDraft || (noteDraft.text === noteDraft.initialText && !noteBusy)) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [noteDraft, noteBusy]);

  useEffect(() => {
    const markdown = cardQuery.data?.markdown;
    if (!markdown) return;
    let cancelled = false;
    const freshHtml = renderCardMarkdown(markdown, selection.cardType, selection.folder, { readingLayout: true });
    annotationStateRef.current = null;
    setAnnotationSnapshot([]);
    setAnnotationMode('pending');
    setRenderedHtml(freshHtml);

    const renderAnnotations = (annotations: CardAnnotation[]) => {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = freshHtml;
      applyAnnotations(wrapper, annotations);
      return wrapper.firstElementChild?.outerHTML || freshHtml;
    };
    const generationId = cardQuery.data?.record?.id;
    if (!generationId) {
      setAnnotationMode('unavailable');
    } else {
      factoryApi.annotations('generation', generationId)
        .then((result) => {
          if (cancelled) return;
          annotationStateRef.current = {
            target: result.target,
            annotations: result.annotations,
          };
          setAnnotationSnapshot(result.annotations);
          setRenderedHtml(renderAnnotations(result.annotations));
          setAnnotationMode('annotations');
        })
        .catch(() => {
          if (!cancelled) {
            setAnnotationSnapshot([]);
            setAnnotationMode('unavailable');
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [cardQuery.data?.markdown, cardQuery.data?.record?.id, readOnly, selection]);

  useEffect(() => {
    const previous = restoreFocusTo
      || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        const target = event.target instanceof Element ? event.target : null;
        // Radix menus are portaled outside the dialog. Let their own Escape and
        // focus-restoration contract run before considering the dialog close.
        if (target?.closest('.csa-gen-menu, .note-exit-confirm')) return;
        if (target?.closest('.manual-tag-dialog')) return;
        if (target?.closest('.pronunciation-popover')) return;
        if (target?.closest('.card-knowledge-inspector')) {
          event.preventDefault();
          setKnowledgeDraft(null);
          lookupTriggerRef.current?.focus({ preventScroll: true });
          return;
        }
        if (target?.closest('.csa-tts-language')) return;
        if (target?.closest('.card-selection-toolbar')) {
          event.preventDefault();
          setToolbar(null);
          contentRef.current?.focus({ preventScroll: true });
          return;
        }
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = closeRef.current?.closest('[role="dialog"]');
      const focusable = Array.from(dialog?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]'
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
      cardAudio.stop();
      previous?.focus({ preventScroll: true });
    };
  }, [cardAudio.stop, restoreFocusTo]);

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
      const dimensions = node.getBoundingClientRect();
      const halfWidth = dimensions.width / 2;
      const minimum = viewportPadding + halfWidth;
      const maximum = window.innerWidth - viewportPadding - halfWidth;
      setToolbar((current) => {
        if (!current) return current;
        const left = minimum > maximum
          ? window.innerWidth / 2
          : Math.min(maximum, Math.max(minimum, current.anchorLeft));
        const aboveSpace = current.anchorTop - viewportPadding * 2;
        const belowSpace = window.innerHeight - current.anchorBottom - viewportPadding * 2;
        const placeBelow = aboveSpace < dimensions.height && belowSpace > aboveSpace;
        const anchorTop = placeBelow ? current.anchorBottom : current.anchorTop;
        const minimumTop = placeBelow ? 0 : dimensions.height + (viewportPadding * 2);
        const maximumTop = placeBelow
          ? window.innerHeight - dimensions.height - (viewportPadding * 2)
          : window.innerHeight - viewportPadding;
        const top = minimumTop > maximumTop
          ? window.innerHeight / 2
          : Math.min(maximumTop, Math.max(minimumTop, anchorTop));
        return Math.abs(current.left - left) > 0.5 || Math.abs(current.top - top) > 0.5 || current.placeBelow !== placeBelow
          ? { ...current, left, top, placeBelow }
          : current;
      });
    };
    clampToViewport();
    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(clampToViewport)
      : null;
    if (resizeObserver && toolbarRef.current) resizeObserver.observe(toolbarRef.current);
    window.addEventListener('resize', clampToViewport);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', clampToViewport);
    };
  }, [
    toolbar?.anchorLeft,
    toolbar?.left,
    toolbar?.phrase,
    toolbar?.placeBelow,
    toolbar?.top,
  ]);

  useEffect(() => {
    if (!toolbar || !focusToolbarAfterSelectionRef.current) return;
    window.requestAnimationFrame(() => {
      const firstAction = toolbarFirstActionRef.current
        || (readOnly ? toolbarRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])') : null);
      if (firstAction) { focusToolbarAfterSelectionRef.current = false; firstAction.focus({ preventScroll: true }); }
    });
  }, [toolbar?.annotationId, toolbar?.phrase]);

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
      selectedRangeRef.current = null;
      selectedAnchorRef.current = null;
      selectedTextRef.current = '';
      originalScopeAnchorRef.current = null;
      setToolbar(null);
      setGenMenuOpen(false);
      setColorMenuOpen(false);
      setKnowledgeDraft(null);
      setHasSelection(false);
      showToast(`✦ 已加入生成队列 · ${CARD_TYPE_LABEL[vars.cardType]}`);
    },
    onError: (error) => {
      const duplicate = error instanceof ApiError && error.status === 409;
      showToast(duplicate ? '该短语已存在或已在生成队列中' : '生成入队失败，请重试');
    },
  });

  const knowledgeMutation = useMutation({
    mutationFn: (draft: KnowledgeLookupDraft) => knowledgeApi.lookup({
      eventKey: `card-lookup:${crypto.randomUUID()}`,
      inputText: draft.phrase,
      language: draft.language!,
      kindHint: draft.kind,
      timeZone: 'Asia/Tokyo',
      sourceContext: {
        surface: 'card-modal',
        ...lookupSourceRef.current,
      },
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['knowledge'] });
    },
  });

  const renderAnnotationSnapshot = (annotations: CardAnnotation[]) => {
    const markdown = cardQuery.data?.markdown || '';
    const freshHtml = renderCardMarkdown(markdown, selection.cardType, selection.folder, { readingLayout: true });
    const wrapper = document.createElement('div');
    wrapper.innerHTML = freshHtml;
    applyAnnotations(wrapper, annotations);
    return wrapper.firstElementChild?.outerHTML || freshHtml;
  };

  const replaceAnnotationSnapshot = (annotations: CardAnnotation[]) => {
    const state = annotationStateRef.current;
    if (!state) return;
    annotationStateRef.current = { ...state, annotations };
    setAnnotationSnapshot(annotations);
    setRenderedHtml(renderAnnotationSnapshot(annotations));
  };

  const clearSelectionActions = () => {
    window.getSelection()?.removeAllRanges();
    selectedRangeRef.current = null;
    selectedAnchorRef.current = null;
    selectedTextRef.current = '';
    originalScopeAnchorRef.current = null;
    setHasSelection(false);
    setToolbar(null);
    setGenMenuOpen(false);
    setColorMenuOpen(false);
    setKnowledgeDraft(null);
    setPronunciationDetailTokenKey(null);
    knowledgeMutation.reset();
  };

  const saveHighlight = async (color: AnnotationColor = 'red') => {
    if (annotationMode !== 'annotations') {
      showToast('当前卡片无法保存标记，请刷新后重试');
      return;
    }
    const state = annotationStateRef.current;
    const generationId = cardQuery.data?.record?.id;
    const selector = selectedAnchorRef.current;
    if (!state || !generationId || !selector || isSavingAnnotation) return;
    setIsSavingAnnotation(true);
    try {
      const currentId = toolbar?.annotationId;
      if (currentId) {
        const current = state.annotations.find((annotation) => annotation.id === currentId);
        if (!current) throw new Error('Selected annotation is no longer available');
        const result = await factoryApi.updateAnnotation(current.id, {
          expectedVersion: current.version,
          color,
        });
        replaceAnnotationSnapshot(state.annotations.map((annotation) => (
          annotation.id === current.id ? result.annotation : annotation
        )));
        clearSelectionActions();
        showToast(`已改为${COLOR_LABEL[color]}`);
        return;
      }

      if (!selectedRangeRef.current) return;
      const result = await factoryApi.createAnnotation({
        id: crypto.randomUUID(),
        targetKind: 'generation',
        targetId: generationId,
        expectedTargetRevision: state.target.targetRevision,
        selector,
        annotationKind: 'highlight',
        color,
      });
      replaceAnnotationSnapshot([...state.annotations, result.annotation]);
      clearSelectionActions();
      showToast(`${COLOR_LABEL[color]}已保存`);
    } catch (error) {
      console.error('Cards Factory annotation save failed', error);
      const conflict = error instanceof ApiError && error.status === 409;
      showToast(conflict ? '卡片内容或标记已变化，请重新选择' : '标记保存失败，请重试');
    } finally {
      setIsSavingAnnotation(false);
    }
  };

  const removeHighlight = async () => {
    const state = annotationStateRef.current;
    const currentId = toolbar?.annotationId;
    if (!state || !currentId || isSavingAnnotation || noteBusy) return;
    if (noteDraft?.annotationId === currentId && noteDraft.text !== noteDraft.initialText) {
      showToast('请先保存或取消此标记的笔记修改');
      focusNote();
      return;
    }
    const current = state.annotations.find((annotation) => annotation.id === currentId);
    if (!current) return;
    setIsSavingAnnotation(true);
    try {
      await factoryApi.deleteAnnotation(current.id, current.version);
      replaceAnnotationSnapshot(state.annotations.filter((annotation) => annotation.id !== current.id));
      if (noteDraft?.annotationId === currentId) setNoteDraft(null);
      clearSelectionActions();
      showToast('标记已取消');
    } catch (error) {
      console.error('Cards Factory annotation removal failed', error);
      const conflict = error instanceof ApiError && error.status === 409;
      showToast(conflict ? '标记已在其它页面变化，请重新打开卡片' : '取消标记失败，请重试');
    } finally {
      setIsSavingAnnotation(false);
    }
  };

  const focusNote = () => window.requestAnimationFrame(() => {
    document.querySelector<HTMLTextAreaElement>('.csa-note-editor textarea')?.focus({ preventScroll: true });
  });
  const finishNoteExit = (action: 'note' | 'card' | 'delete') => {
    setNoteDraft(null);
    setNoteExit(null);
    if (action === 'card') onClose();
    else if (action === 'delete') setConfirmDelete(true);
    else (lookupTriggerRef.current || contentRef.current)?.focus({ preventScroll: true });
  };
  const requestNoteExit = (action: 'note' | 'card' | 'delete') => {
    if (noteBusy) { showToast('正在保存笔记，请稍候'); return; }
    if (noteDraft && noteDraft.text !== noteDraft.initialText) setNoteExit(action);
    else finishNoteExit(action);
  };
  const openNote = (annotation?: CardAnnotation) => {
    if (readOnly) return;
    if (noteDraft) { focusNote(); showToast('请先保存或取消正在编辑的笔记'); return; }
    const state = annotationStateRef.current;
    const existing = annotation || state?.annotations.find((item) => item.id === toolbar?.annotationId);
    const selector = existing?.selector || selectedAnchorRef.current;
    if (!state || !selector || !generationId) { showToast('当前卡片无法添加笔记，请刷新后重试'); return; }
    const initialText = existing?.noteText || '';
    // Freeze the source anchor and version: subsequent selections must never retarget a draft.
    setNoteDraft({ initialText, text: initialText, state, selector, generationId: Number(generationId), annotationId: existing?.id || null });
  };
  const changeSelectionScope = async (scope: 'original' | 'word' | 'phrase' | 'sentence') => {
    const container = contentRef.current;
    const original = originalScopeAnchorRef.current;
    if (!container || !original) return;
    const { resizeSelectionRange } = await import('./selection-scope.mjs');
    if (originalScopeAnchorRef.current !== original || !container.isConnected) return;
    // Re-resolve after the lazy import: a background refresh may replace text nodes.
    const restored = resolveAnchor(container, original).range;
    const range = restored && (scope === 'original' ? restored : resizeSelectionRange(container, restored, scope));
    if (!range) { showToast('无法确定此范围，请手动调整选区'); return; }
    const selection = window.getSelection();
    selection?.removeAllRanges(); selection?.addRange(range);
    captureSelection(false, true, true);
    setSelectionScope(scope);
  };

  const copySelectedText = async () => {
    const text = toolbar?.phrase || selectedTextRef.current || toolbar?.rawText || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast('选区已复制');
    } catch {
      showToast('无法访问剪贴板，请检查浏览器权限');
    }
  };

  const openKnowledgeLookup = () => {
    const phrase = toolbar?.phrase || '';
    if (!phrase) return;
    const language = toolbar?.language || inferLookupLanguage(phrase);
    const generationId = cardQuery.data?.record?.id;
    lookupSourceRef.current = {
      targetKind: 'generation',
      targetId: generationId || null,
      annotationId: toolbar?.annotationId || null,
      quoteExact: selectedAnchorRef.current?.textQuote.exact || phrase,
      positionStart: selectedAnchorRef.current?.textPosition.start ?? null,
      positionEnd: selectedAnchorRef.current?.textPosition.end ?? null,
    };
    knowledgeMutation.reset();
    setKnowledgeDraft({
      phrase,
      language,
      kind: inferLookupKind(phrase, language),
    });
  };

  const activateAnnotation = (annotationId: string, focusToolbar = false) => {
    const container = contentRef.current;
    const state = annotationStateRef.current;
    const annotation = state?.annotations.find((item) => item.id === annotationId);
    if (!container || !annotation) return;
    const fragments = Array.from(
      container.querySelectorAll<HTMLElement>('[data-annotation-id]')
    ).filter((node) => node.dataset.annotationId === annotationId);
    const rects = fragments.map((node) => node.getBoundingClientRect()).filter((rect) => rect.width > 0);
    if (!rects.length) return;
    const leftEdge = Math.min(...rects.map((rect) => rect.left));
    const rightEdge = Math.max(...rects.map((rect) => rect.right));
    const topEdge = Math.min(...rects.map((rect) => rect.top));
    const bottomEdge = Math.max(...rects.map((rect) => rect.bottom));
    const placeBelow = topEdge < 64;
    const anchorLeft = leftEdge + (rightEdge - leftEdge) / 2;

    window.getSelection()?.removeAllRanges();
    selectedRangeRef.current = null;
    selectedAnchorRef.current = annotation.selector;
    selectedTextRef.current = annotation.selector.textQuote.exact;
    setHasSelection(false);
    if (annotation.noteText) openNote(annotation);
    setKnowledgeDraft(null);
    knowledgeMutation.reset();
    focusToolbarAfterSelectionRef.current = focusToolbar;
    setToolbar({
      top: placeBelow ? bottomEdge : topEdge,
      left: anchorLeft,
      anchorLeft,
      anchorTop: topEdge,
      anchorBottom: bottomEdge,
      placeBelow,
      phrase: annotation.selector.textQuote.exact,
      rawText: annotation.selector.textQuote.exact,
      annotationId,
      language: inferLookupLanguage(annotation.selector.textQuote.exact),
      pronunciationToken: null,
      contextText: annotation.selector.textQuote.exact,
    });
    setGenMenuOpen(false);
    setColorMenuOpen(false);
  };

  const captureSelection = (focusToolbar = false, ignoreAnnotationOverlap = false, preserveScope = false) => {
    const container = contentRef.current;
    if (!container) return;
    const candidate = buildSelectionCandidate(container);
    if (!candidate) {
      window.getSelection()?.removeAllRanges();
      selectedRangeRef.current = null;
      selectedAnchorRef.current = null;
      selectedTextRef.current = '';
      originalScopeAnchorRef.current = null;
      setHasSelection(false);
      setToolbar(null);
      setGenMenuOpen(false);
      setColorMenuOpen(false);
      return;
    }
    const overlappingIds = new Set(
      Array.from(container.querySelectorAll<HTMLElement>('[data-annotation-id]'))
        .filter((node) => candidate.range.intersectsNode(node))
        .map((node) => node.dataset.annotationId)
        .filter((id): id is string => Boolean(id))
    );
    if (!ignoreAnnotationOverlap && overlappingIds.size === 1) {
      activateAnnotation([...overlappingIds][0], focusToolbar);
      return;
    }
    if (!ignoreAnnotationOverlap && overlappingIds.size > 1) {
      showToast('选区包含多个标记，请点击单个标记后操作');
      setToolbar(null);
      return;
    }
    if (!preserveScope) {
      setSelectionScope('original');
    }
    selectedRangeRef.current = candidate.range.cloneRange();
    try {
      selectedAnchorRef.current = createAnchor(container, candidate.range);
    } catch {
      selectedAnchorRef.current = null;
    }
    if (!preserveScope) originalScopeAnchorRef.current = selectedAnchorRef.current;
    // Keep highlight recovery aligned with the ruby-free phrase shown in the toolbar.
    selectedTextRef.current = candidate.rawText;
    setHasSelection(true);
    const rect = candidate.range.getBoundingClientRect();
    const placeBelow = rect.top < 64;
    const anchorLeft = rect.left + rect.width / 2;
    const pronunciationToken = pronunciationTokenForRange(container, candidate.range);
    const isJapaneseProjection = rangeIntersectsPronunciationToken(container, candidate.range);
    setKnowledgeDraft(null);
    knowledgeMutation.reset();
    focusToolbarAfterSelectionRef.current = focusToolbar;
    setToolbar({
      top: placeBelow ? rect.bottom : rect.top,
      left: anchorLeft,
      anchorLeft,
      anchorTop: rect.top,
      anchorBottom: rect.bottom,
      placeBelow,
      phrase: candidate.normalized,
      rawText: candidate.rawText,
      annotationId: null,
      language: isJapaneseProjection ? 'ja' : inferLookupLanguage(candidate.normalized),
      pronunciationToken,
      contextText: candidate.contextText,
    });
    setGenMenuOpen(false);
    setColorMenuOpen(false);
  };

  useEffect(() => {
    let frame = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.shiftKey && isKeyboardSelectionKey(event.key)) {
        keyboardSelectionRef.current = true;
      }
    };
    const captureKeyboardSelection = () => {
      if (!keyboardSelectionRef.current) return;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => captureSelection(true));
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!isKeyboardSelectionKey(event.key)) return;
      captureKeyboardSelection();
      keyboardSelectionRef.current = false;
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('selectionchange', captureKeyboardSelection);
    document.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('selectionchange', captureKeyboardSelection);
      document.removeEventListener('keyup', onKeyUp, true);
    };
  });

  const handleContentClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.audio-btn');
    if (button) {
      const source = button.dataset.src;
      if (!source) return;
      cardAudio.stop();
      contentRef.current?.querySelectorAll('.audio-btn.is-playing').forEach((node) => node.classList.remove('is-playing'));
      button.classList.add('is-playing');
      void cardAudio.playUrl(
        `/api/folders/${encodeURIComponent(selection.folder)}/files/${encodeURIComponent(source)}`,
        {
          onEnded: () => button.classList.remove('is-playing'),
          onError: () => button.classList.remove('is-playing'),
          onStop: () => button.classList.remove('is-playing'),
        }
      ).catch(() => button.classList.remove('is-playing'));
      return;
    }
    const marker = (event.target as HTMLElement).closest<HTMLElement>('[data-annotation-id]');
    if (marker?.dataset.annotationId) activateAnnotation(marker.dataset.annotationId);
  };

  const handlePronunciationCorrectionSaved = (result: Awaited<ReturnType<typeof factoryApi.correctPronunciation>>) => {
    if (!generationId) return;
    queryClient.setQueryData(['pronunciation', 'generation', generationId], (current: {
      document: unknown;
      tokens: unknown[];
    } | undefined) => (
      current ? { ...current, document: result.document, tokens: result.tokens } : current
    ));
  };

  const preserveSelectionOutsideActions = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLElement) || !event.target.closest('button, input, select, textarea')) event.preventDefault();
  };

  const restoreGenerateTriggerFocus = (event: Event) => {
    event.preventDefault();
    generateTriggerRef.current?.focus({ preventScroll: true });
  };

  const handleToolbarKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])')
    ).filter((button) => button.offsetParent !== null);
    if (!buttons.length) return;
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : event.key === 'ArrowLeft'
          ? (currentIndex <= 0 ? buttons.length - 1 : currentIndex - 1)
          : (currentIndex + 1) % buttons.length;
    event.preventDefault();
    buttons[nextIndex]?.focus();
  };

  const handleContentContextMenuCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const marker = (event.target as HTMLElement).closest<HTMLElement>('[data-annotation-id]');
    if (marker?.dataset.annotationId) {
      activateAnnotation(marker.dataset.annotationId, true);
      return;
    }
    const container = contentRef.current;
    if (!container) return;

    const current = buildSelectionCandidate(container);
    if (current && ((event.clientX === 0 && event.clientY === 0) || selectionRangeContainsPoint(current.range, event.clientX, event.clientY))) {
      window.requestAnimationFrame(() => captureSelection(true));
      return;
    }

    const storedRange = selectedRangeRef.current;
    if (storedRange && selectionRangeContainsPoint(storedRange, event.clientX, event.clientY)) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(storedRange.cloneRange());
      window.requestAnimationFrame(() => captureSelection(true));
      return;
    }

    const token = (event.target as HTMLElement).closest<HTMLElement>('.pronunciation-token');
    if (token && selectPronunciationToken(token)) {
      window.requestAnimationFrame(() => captureSelection(true, true));
      return;
    }

    const range = buildWordRangeAtPoint(container, event.clientX, event.clientY);
    if (range) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      window.requestAnimationFrame(() => captureSelection(true, true));
      return;
    }

    window.getSelection()?.removeAllRanges();
    selectedRangeRef.current = null;
    selectedAnchorRef.current = null;
    selectedTextRef.current = '';
    originalScopeAnchorRef.current = null;
    setHasSelection(false);
    setToolbar(null);
    event.stopPropagation();
  };

  const plainCardContent = renderedHtml ? (
    <div
      ref={contentRef}
      className="react-card-markdown"
      data-testid="react-card-content"
      tabIndex={0}
      aria-label="学习卡片正文，可选择文字后操作"
      onMouseUp={() => captureSelection(false)}
      onKeyDown={(event) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault(); window.requestAnimationFrame(() => captureSelection(true));
        }
      }}
      onClick={handleContentClick}
      onContextMenuCapture={handleContentContextMenuCapture}
      dangerouslySetInnerHTML={{ __html: renderedHtml }}
    />
  ) : null;

  const cardContent = renderedHtml ? (
    <Suspense fallback={plainCardContent}>
      <DeferredPronunciationCardContent
        html={renderedHtml}
        document={cardReaderCanary.data?.canary.document || null}
        annotations={annotationSnapshot}
        cardType={selection.cardType}
        generationId={generationId ? Number(generationId) : null}
        readOnly={readOnly}
        showReadings={showReadings}
        contentRef={contentRef}
        onCaptureSelection={captureSelection}
        onContentClick={handleContentClick}
        onContextMenuCapture={handleContentContextMenuCapture}
        requestedDetailTokenKey={pronunciationDetailTokenKey}
        onDetailRequestHandled={() => setPronunciationDetailTokenKey(null)}
        onCorrectionSaved={handlePronunciationCorrectionSaved}
        onToast={showToast}
      />
    </Suspense>
  ) : null;

  return (
    <div className="card-modal-backdrop" data-testid="react-card-modal" onMouseDown={(event) => {
      if (event.target === event.currentTarget) { event.preventDefault(); requestNoteExit('card'); }
    }}>
      <section className="react-card-modal" role="dialog" aria-modal="true" aria-labelledby="react-card-title">
        <header className="react-card-head">
          <div className="card-head-title">
            <h1 id="react-card-title" title={displayTitle}>{displayTitle}</h1>
            <span className={`card-type-chip type-${selection.cardType}`}>{CARD_TYPE_LABEL[selection.cardType] || '学习卡'}</span>
            {readOnly && <span className="card-modal-readonly">READ ONLY</span>}
            {cardQuery.data?.record?.id && (
              <Suspense fallback={null}>
                <DeferredManualTagBar
                  targetKind="generation"
                  targetId={cardQuery.data.record.id}
                  readOnly={readOnly}
                  inline
                />
              </Suspense>
            )}
          </div>
          <nav className="card-modal-tabs" aria-label="学习卡片视图" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'content'} className={tab === 'content' ? 'active' : ''} onClick={() => setTab('content')}>学习内容</button>
            <button type="button" role="tab" aria-selected={tab === 'intel'} className={tab === 'intel' ? 'active' : ''} onClick={() => setTab('intel')}>生成信息</button>
          </nav>
          <div className="card-head-actions">
            {tab === 'content' && (
              <button
                className="reading-toggle-button"
                type="button"
                aria-pressed={showReadings}
                data-testid="card-reading-toggle"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  const next = !showReadings;
                  setReadingsPreference((current) => ({ ...current, [legacyRubyCard ? 'legacy' : 'current']: next }));
                  storeShowReadings(legacyRubyCard, next);
                }}
              >
                <Languages aria-hidden="true" /> {showReadings ? '隐藏注音' : '显示注音'}
              </button>
            )}
            {tab === 'content' && !readOnly && (
              <button
                className="highlight-selection-button"
                type="button"
                aria-label="标记为高亮"
                disabled={!hasSelection || annotationMode !== 'annotations' || isSavingAnnotation}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void saveHighlight()}
              >
                <Highlighter aria-hidden="true" /> {isSavingAnnotation ? '保存中…' : '标记'}
              </button>
            )}
            {!readOnly && <CardMoreMenu onDelete={() => requestNoteExit('delete')} />}
            <button ref={closeRef} className="icon-button" type="button" aria-label="关闭学习卡片" data-testid="react-card-modal-close" onClick={() => requestNoteExit('card')}>
              <X aria-hidden="true" />
            </button>
          </div>
        </header>

        <Suspense fallback={null}>
          <DeferredCardOpenRecorder
            generationId={generationId}
            openEventKey={`card-open:${modalOpenIdRef.current}`}
            phrase={cardQuery.data?.record?.phrase || selection.title}
            cardType={selection.cardType}
            readOnly={readOnly}
          />
        </Suspense>

        <div ref={setScrollRoot} className="react-card-scroll" onScroll={() => {
          setToolbar(null);
        }}>
          {cardQuery.isLoading && <div className="modal-state">正在读取 Markdown…</div>}
          {cardQuery.isError && <div className="modal-state error">无法读取卡片内容。</div>}
          {tab === 'content' && renderedHtml && (
            <div className={`card-content-layout${summary || grammarSummary ? ' has-summary' : ''}${outline.length ? ' has-outline' : ''}`}>
              {outline.length > 0 && (
                <Suspense fallback={null}>
                  <DeferredScenarioOutline items={outline} getContentRoot={getContentRoot} scrollRoot={scrollRoot} />
                </Suspense>
              )}
              <div className="card-reading-column">
                {summary && (
                  <Suspense fallback={null}>
                    <DeferredCardSummaryStrip summary={summary} generationId={generationId ? Number(generationId) : null} />
                  </Suspense>
                )}
                {grammarSummary && (
                  <Suspense fallback={null}>
                    <DeferredGrammarSummaryStrip summary={grammarSummary} />
                  </Suspense>
                )}
                {cardContent}
              </div>
            </div>
          )}
          {tab === 'intel' && (
            <Suspense fallback={<div className="modal-panel-loading" role="status">正在载入生成信息…</div>}>
              <DeferredCardEngagementSummary generationId={generationId ? Number(generationId) : null} />
              <DeferredIntelPanel record={cardQuery.data?.record || null} />
            </Suspense>
          )}
        </div>

        {tab === 'content' && toolbar && (
          <div
            ref={toolbarRef}
            className="card-selection-toolbar"
            data-testid="card-selection-toolbar"
            data-placement={toolbar.placeBelow ? 'below' : 'above'}
            style={{ top: toolbar.top, left: toolbar.left }}
            role="toolbar"
            aria-label="选区操作"
            onMouseDown={preserveSelectionOutsideActions}
            onKeyDown={handleToolbarKeyDown}
          >
            <div className="csa-context-row" data-testid="card-selection-context-row">
              <output
                className={`csa-selection-preview${previewExpanded ? ' is-expanded' : ''}`}
                data-testid="card-selection-preview"
                title={toolbar.phrase}
              >
                <span>已选</span>
                <strong tabIndex={previewExpanded ? 0 : undefined}>{toolbar.phrase}</strong>
                {toolbar.phrase.length > 16 && <button type="button" aria-expanded={previewExpanded}
                  onClick={() => setPreviewExpanded((value) => !value)}>{previewExpanded ? '收起全文' : '展开选区全文'}</button>}
              </output>
              <div className="csa-gloss-slot">
                <Suspense fallback={<span className="csa-gloss is-muted" role="status">正在载入本地释义…</span>}>
                  <DeferredSelectionGlossaryInline
                    key={[toolbar.phrase, toolbar.contextText, toolbar.language, toolbar.pronunciationToken?.readingHiragana].join('|')}
                    detailHost={detailHost}
                    readOnly={readOnly}
                    onNote={() => openNote()}
                    onKnowledge={openKnowledgeLookup}
                    phrase={toolbar.phrase}
                    language={toolbar.language}
                    generationId={generationId ? Number(generationId) : null}
                    contextLabel={displayTitle}
                    contextText={toolbar.contextText}
                    readingHint={toolbar.pronunciationToken?.readingHiragana || null}
                    onToast={showToast}
                  />
                </Suspense>
              </div>
            </div>
            <Suspense fallback={<span role="status">正在载入选区操作…</span>}><div className="csa-action-row" data-testid="card-selection-action-row">
              <div className="csa-action-tabs">
                {!readOnly && <DeferredSelectionHighlightAction colorMenuOpen={colorMenuOpen} setColorMenuOpen={setColorMenuOpen}
                  toolbarFirstActionRef={(node) => {
                    toolbarFirstActionRef.current = node;
                    if (node && focusToolbarAfterSelectionRef.current) {
                      focusToolbarAfterSelectionRef.current = false;
                      node.focus({ preventScroll: true });
                    }
                  }} annotationMode={annotationMode} isSavingAnnotation={isSavingAnnotation}
                  annotationId={toolbar.annotationId} colors={HIGHLIGHT_COLORS} saveHighlight={saveHighlight} />}
                {!readOnly && toolbar.annotationId && (
                  <button
                    type="button"
                    className="csa-icon-action csa-remove-highlight"
                    aria-label="取消标记"
                    title="取消标记"
                    disabled={isSavingAnnotation}
                    onClick={() => void removeHighlight()}
                  >
                    <Eraser aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  className="csa-icon-action"
                  aria-label="复制选区"
                  title="复制选区"
                  onClick={() => void copySelectedText()}
                >
                  <Copy aria-hidden="true" />复制
                </button>
                <Suspense fallback={<span className="csa-tool-loading" aria-label="正在载入朗读工具" />}>
                  <DeferredSelectionTtsControls phrase={toolbar.phrase} languageHint={toolbar.language} />
                </Suspense>
                <Suspense fallback={null}><DeferredSelectionMoreActions hasPronunciation={Boolean(toolbar.pronunciationToken)} readOnly={readOnly}
                  triggerRef={lookupTriggerRef} onKnowledge={openKnowledgeLookup} onNote={() => openNote()}
                  onPronunciation={() => setPronunciationDetailTokenKey(toolbar.pronunciationToken?.tokenKey || null)} /></Suspense>
              </div>
              <div className="csa-primary-actions">
                <DeferredSelectionGenerateAction genMenuOpen={genMenuOpen} setGenMenuOpen={setGenMenuOpen}
                  generateTriggerRef={generateTriggerRef} pending={generateMutation.isPending} restoreGenerateTriggerFocus={restoreGenerateTriggerFocus}
                  types={SELECTION_CARD_TYPES} labels={CARD_TYPE_LABEL} onGenerate={(type) => generateMutation.mutate({ phrase: toolbar.phrase, cardType: type })} />
              </div>
            </div>
            </Suspense>
            {!toolbar.annotationId && <Suspense fallback={null}><DeferredSelectionScopeControls value={selectionScope} onChange={(scope) => void changeSelectionScope(scope)} /></Suspense>}
            <div ref={setDetailHost} />

          </div>
        )}

        {noteDraft && !readOnly && (
          <Suspense fallback={<div className="card-note-panel" role="status">正在载入笔记…</div>}>
            <div className="card-note-panel">
              <DeferredSelectionNoteEditor draft={noteDraft}
                onChange={(text) => setNoteDraft((current) => current ? { ...current, text } : null)}
                onBusyChange={setNoteBusy} onClose={() => requestNoteExit('note')} onToast={showToast}
                onSaved={(annotation) => {
                  const latest = annotationStateRef.current?.annotations || [];
                  replaceAnnotationSnapshot([...latest.filter((item) => item.id !== annotation.id), annotation]);
                  setNoteDraft(null); clearSelectionActions(); contentRef.current?.focus({ preventScroll: true });
                }} />
            </div>
          </Suspense>
        )}
        {noteExit && (
          <div className="note-exit-backdrop" onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setNoteExit(null); focusNote(); }
            if (event.key === 'Tab') {
              event.preventDefault();
              const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button');
              (document.activeElement === buttons[0] ? buttons[1] : buttons[0])?.focus();
            }
          }}>
            <div className="note-exit-confirm" role="alertdialog" aria-modal="true" aria-labelledby="note-exit-title" aria-describedby="note-exit-description">
              <strong id="note-exit-title">笔记尚未保存</strong>
              <p id="note-exit-description">离开会丢弃这次修改。可以继续编辑并保存。</p>
              <button type="button" autoFocus onClick={() => { setNoteExit(null); focusNote(); }}>继续编辑</button>
              <button type="button" className="danger-button" onClick={() => finishNoteExit(noteExit)}>放弃修改{noteExit === 'card' ? '并关闭' : ''}</button>
            </div>
          </div>
        )}

        {knowledgeDraft && (
          <Suspense fallback={<div className="card-knowledge-loading" role="status">正在载入知识查询…</div>}>
            <DeferredSelectionKnowledgePanel
              draft={knowledgeDraft}
              result={knowledgeMutation.data?.lookup || null}
              error={knowledgeMutation.isError ? lookupErrorMessage(knowledgeMutation.error) : ''}
              pending={knowledgeMutation.isPending}
              onChange={(next) => {
                knowledgeMutation.reset();
                setKnowledgeDraft(next);
              }}
              onSubmit={() => {
                if (knowledgeDraft.language && !knowledgeMutation.isPending) {
                  knowledgeMutation.mutate(knowledgeDraft);
                }
              }}
              onClose={() => {
                setKnowledgeDraft(null);
                knowledgeMutation.reset();
                (lookupTriggerRef.current || contentRef.current)?.focus({ preventScroll: true });
              }}
            />
          </Suspense>
        )}

        {toast && <div className="card-selection-toast" role="status">{toast}</div>}

        {confirmDelete && !readOnly && (
          <div className="delete-confirm" role="alertdialog" aria-label="确认删除卡片">
            <strong>删除此学习卡片？</strong>
            <p>卡片、音频和关联记录都会被删除。</p>
            {deleteMutation.isError && <p className="form-error">删除失败，请重试。</p>}
            <div>
              <button type="button" autoFocus onClick={() => setConfirmDelete(false)}>取消</button>
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
