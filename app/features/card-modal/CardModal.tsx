import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  ChevronDown,
  ChevronRight,
  BookOpen,
  Copy,
  Eraser,
  Highlighter,
  Palette,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ContextMenu from '@radix-ui/react-context-menu';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
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
import { createAnchor } from './annotation-anchor.mjs';
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
import type { CardLookupLanguage } from './selection-actions';
import '../../styles/card-modal.css';

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
const DeferredCardEngagementMeta = lazy(async () => {
  const module = await import('./CardEngagementMeta');
  return { default: module.CardEngagementMeta };
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
  trilingual: '单词卡',
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
  placeBelow: boolean;
  phrase: string;
  rawText: string;
  annotationId: string | null;
  language: CardLookupLanguage | null;
  pronunciationToken: PronunciationToken | null;
  contextText: string;
};

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
  const lookupSourceRef = useRef<Record<string, unknown>>({});
  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolbarFirstActionRef = useRef<HTMLButtonElement>(null);
  const generateTriggerRef = useRef<HTMLButtonElement>(null);
  const lookupTriggerRef = useRef<HTMLButtonElement>(null);
  const focusToolbarAfterSelectionRef = useRef(false);
  const focusKnowledgeAfterMenuRef = useRef(false);
  const keyboardSelectionRef = useRef(false);
  const [tab, setTab] = useState<'content' | 'intel'>('content');
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

  useEffect(() => {
    markUiInteractionEnd('card-modal-open');
  }, []);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const markdown = cardQuery.data?.markdown;
    if (!markdown) return;
    let cancelled = false;
    const freshHtml = renderCardMarkdown(markdown, selection.cardType, selection.folder);
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
      if (event.key === 'Escape') {
        const target = event.target instanceof Element ? event.target : null;
        // Radix menus are portaled outside the dialog. Let their own Escape and
        // focus-restoration contract run before considering the dialog close.
        if (target?.closest('.csa-gen-menu')) return;
        if (target?.closest('.manual-tag-dialog')) return;
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
        const minimumTop = current.placeBelow ? 0 : dimensions.height + (viewportPadding * 2);
        const maximumTop = current.placeBelow
          ? window.innerHeight - dimensions.height - (viewportPadding * 2)
          : window.innerHeight - viewportPadding;
        const top = minimumTop > maximumTop
          ? window.innerHeight / 2
          : Math.min(maximumTop, Math.max(minimumTop, current.top));
        return Math.abs(current.left - left) > 0.5 || Math.abs(current.top - top) > 0.5
          ? { ...current, left, top }
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
    focusToolbarAfterSelectionRef.current = false;
    window.requestAnimationFrame(() => {
      const firstAction = toolbarFirstActionRef.current
        || toolbarRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])');
      firstAction?.focus({ preventScroll: true });
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
    const freshHtml = renderCardMarkdown(markdown, selection.cardType, selection.folder);
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
    if (!state || !currentId || isSavingAnnotation) return;
    const current = state.annotations.find((annotation) => annotation.id === currentId);
    if (!current) return;
    setIsSavingAnnotation(true);
    try {
      await factoryApi.deleteAnnotation(current.id, current.version);
      replaceAnnotationSnapshot(state.annotations.filter((annotation) => annotation.id !== current.id));
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

  const copySelectedText = async () => {
    const text = selectedTextRef.current || toolbar?.rawText || toolbar?.phrase || '';
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
    focusKnowledgeAfterMenuRef.current = true;
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
    setKnowledgeDraft(null);
    knowledgeMutation.reset();
    focusToolbarAfterSelectionRef.current = focusToolbar;
    setToolbar({
      top: placeBelow ? bottomEdge : topEdge,
      left: anchorLeft,
      anchorLeft,
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

  const captureSelection = (focusToolbar = false, ignoreAnnotationOverlap = false) => {
    const container = contentRef.current;
    if (!container) return;
    const candidate = buildSelectionCandidate(container);
    if (!candidate) {
      window.getSelection()?.removeAllRanges();
      selectedRangeRef.current = null;
      selectedAnchorRef.current = null;
      selectedTextRef.current = '';
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
    selectedRangeRef.current = candidate.range.cloneRange();
    try {
      selectedAnchorRef.current = createAnchor(container, candidate.range);
    } catch {
      selectedAnchorRef.current = null;
    }
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

  const restoreReadingFocus = (event: Event) => {
    event.preventDefault();
    if (focusKnowledgeAfterMenuRef.current) {
      focusKnowledgeAfterMenuRef.current = false;
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('.card-knowledge-inspector')?.focus({ preventScroll: true });
      });
      return;
    }
    contentRef.current?.focus({ preventScroll: true });
  };

  const handleToolbarKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
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
    const marker = (event.target as HTMLElement).closest<HTMLElement>('[data-annotation-id]');
    if (marker?.dataset.annotationId) {
      activateAnnotation(marker.dataset.annotationId);
      return;
    }
    const container = contentRef.current;
    if (!container) return;

    const current = buildSelectionCandidate(container);
    if (current && selectionRangeContainsPoint(current.range, event.clientX, event.clientY)) {
      window.requestAnimationFrame(() => captureSelection(false));
      return;
    }

    const storedRange = selectedRangeRef.current;
    if (storedRange && selectionRangeContainsPoint(storedRange, event.clientX, event.clientY)) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(storedRange.cloneRange());
      window.requestAnimationFrame(() => captureSelection(false));
      return;
    }

    const token = (event.target as HTMLElement).closest<HTMLElement>('.pronunciation-token');
    if (token && selectPronunciationToken(token)) {
      window.requestAnimationFrame(() => captureSelection(false, true));
      return;
    }

    const range = buildWordRangeAtPoint(container, event.clientX, event.clientY);
    if (range) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      window.requestAnimationFrame(() => captureSelection(false, true));
      return;
    }

    window.getSelection()?.removeAllRanges();
    selectedRangeRef.current = null;
    selectedAnchorRef.current = null;
    selectedTextRef.current = '';
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
          <button type="button" role="tab" aria-selected={tab === 'content'} className={tab === 'content' ? 'active' : ''} onClick={() => setTab('content')}>学习内容</button>
          <button type="button" role="tab" aria-selected={tab === 'intel'} className={tab === 'intel' ? 'active' : ''} onClick={() => setTab('intel')}>生成信息</button>
          {tab === 'content' && !readOnly && (
            <button
              className="highlight-selection-button"
              type="button"
              disabled={!hasSelection || annotationMode !== 'annotations' || isSavingAnnotation}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void saveHighlight()}
            >
              <Highlighter aria-hidden="true" /> {isSavingAnnotation ? '保存中…' : '标红选区'}
            </button>
          )}
        </nav>

        {cardQuery.data?.record?.id && (
          <Suspense fallback={null}>
            <DeferredManualTagBar
              targetKind="generation"
              targetId={cardQuery.data.record.id}
              readOnly={readOnly}
            />
          </Suspense>
        )}

        <div className="react-card-scroll" onScroll={() => {
          setToolbar(null);
        }}>
          {cardQuery.isLoading && <div className="modal-state">正在读取 Markdown…</div>}
          {cardQuery.isError && <div className="modal-state error">无法读取卡片内容。</div>}
          {tab === 'content' && renderedHtml && (
            <div className="card-content-layout">
              {readOnly ? cardContent : (
                <ContextMenu.Root>
                  <ContextMenu.Trigger asChild>
                    <div className="card-context-menu-trigger">
                      {cardContent}
                    </div>
                  </ContextMenu.Trigger>
                  <ContextMenu.Portal>
                    <ContextMenu.Content
                      className="csa-gen-menu csa-context-menu"
                      aria-label="选区操作菜单"
                      onCloseAutoFocus={restoreReadingFocus}
                    >
                      <ContextMenu.Sub>
                        <ContextMenu.SubTrigger className="csa-menu-subtrigger csa-highlight">
                          <Palette aria-hidden="true" />
                          {toolbar?.annotationId ? '更改颜色' : '标记颜色'}
                          <ChevronRight aria-hidden="true" />
                        </ContextMenu.SubTrigger>
                        <ContextMenu.Portal>
                          <ContextMenu.SubContent className="csa-gen-menu csa-color-menu" aria-label="选择标记颜色">
                            {HIGHLIGHT_COLORS.map((color) => (
                              <ContextMenu.Item key={color.value} asChild disabled={isSavingAnnotation}>
                                <button
                                  type="button"
                                  disabled={isSavingAnnotation}
                                  onClick={() => void saveHighlight(color.value)}
                                >
                                  <span className={`csa-color-swatch is-${color.value}`} aria-hidden="true" />
                                  {color.label}
                                </button>
                              </ContextMenu.Item>
                            ))}
                          </ContextMenu.SubContent>
                        </ContextMenu.Portal>
                      </ContextMenu.Sub>
                      {toolbar?.annotationId && (
                        <ContextMenu.Item asChild>
                          <button
                            type="button"
                            className="csa-remove-highlight"
                            disabled={isSavingAnnotation}
                            onClick={() => void removeHighlight()}
                          >
                            <Eraser aria-hidden="true" /> 取消标记
                          </button>
                        </ContextMenu.Item>
                      )}
                      <ContextMenu.Item asChild>
                        <button type="button" onClick={() => void copySelectedText()}>
                          <Copy aria-hidden="true" /> 复制
                        </button>
                      </ContextMenu.Item>
                      <ContextMenu.Item asChild>
                        <button type="button" onClick={openKnowledgeLookup}>
                          <Search aria-hidden="true" /> 查知识点
                        </button>
                      </ContextMenu.Item>
                      <ContextMenu.Separator className="csa-menu-separator" />
                      <ContextMenu.Sub>
                        <ContextMenu.SubTrigger className="csa-menu-subtrigger">
                          <Sparkles aria-hidden="true" /> 生成卡片 <ChevronRight aria-hidden="true" />
                        </ContextMenu.SubTrigger>
                        <ContextMenu.Portal>
                          <ContextMenu.SubContent className="csa-gen-menu" aria-label="选择生成卡型">
                            {SELECTION_CARD_TYPES.map((type) => (
                              <ContextMenu.Item key={type} asChild disabled={generateMutation.isPending}>
                                <button
                                  type="button"
                                  disabled={generateMutation.isPending}
                                  onClick={() => generateMutation.mutate({ phrase: toolbar?.phrase || '', cardType: type })}
                                >
                                  {CARD_TYPE_LABEL[type]}
                                </button>
                              </ContextMenu.Item>
                            ))}
                          </ContextMenu.SubContent>
                        </ContextMenu.Portal>
                      </ContextMenu.Sub>
                    </ContextMenu.Content>
                  </ContextMenu.Portal>
                </ContextMenu.Root>
              )}
              <aside className="card-study-meta">
                <p className="eyebrow">CARD INFO</p>
                <dl>
                  <div><dt>Type</dt><dd>{selection.cardType}</dd></div>
                  <div><dt>Model</dt><dd>{cardQuery.data?.record?.llm_model || 'unknown'}</dd></div>
                  <div><dt>Source</dt><dd>Markdown</dd></div>
                  <Suspense fallback={null}>
                    <DeferredCardEngagementMeta
                      generationId={generationId}
                      phrase={cardQuery.data?.record?.phrase || selection.title}
                      cardType={selection.cardType}
                      readOnly={readOnly}
                    />
                  </Suspense>
                </dl>
              </aside>
            </div>
          )}
          {tab === 'intel' && (
            <Suspense fallback={<div className="modal-panel-loading" role="status">正在载入生成信息…</div>}>
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
                className="csa-selection-preview"
                data-testid="card-selection-preview"
                title={toolbar.phrase}
              >
                <span>已选</span>
                <strong>{toolbar.phrase}</strong>
              </output>
              <div className="csa-gloss-slot">
                <Suspense fallback={<span className="csa-gloss is-muted" role="status">正在载入本地释义…</span>}>
                  <DeferredSelectionGlossaryInline
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
            <div className="csa-action-row" data-testid="card-selection-action-row">
              <div className="csa-action-tabs">
                {!readOnly && <DropdownMenu.Root open={colorMenuOpen} onOpenChange={setColorMenuOpen} modal={false}>
                  <DropdownMenu.Trigger asChild>
                    <button
                      ref={toolbarFirstActionRef}
                      type="button"
                      className="csa-highlight csa-command-tab"
                      disabled={annotationMode !== 'annotations' || isSavingAnnotation}
                      aria-label={toolbar.annotationId ? '更改标记颜色' : '标记选区'}
                    >
                      {toolbar.annotationId ? <Palette aria-hidden="true" /> : <Highlighter aria-hidden="true" />}
                      {isSavingAnnotation ? '保存中…' : toolbar.annotationId ? '改色' : '标记'}
                      <ChevronDown aria-hidden="true" className="csa-caret" />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      className="csa-gen-menu csa-color-menu"
                      sideOffset={5}
                      align="start"
                    >
                      {HIGHLIGHT_COLORS.map((color) => (
                        <DropdownMenu.Item key={color.value} asChild disabled={isSavingAnnotation}>
                          <button
                            type="button"
                            disabled={isSavingAnnotation}
                            onClick={() => void saveHighlight(color.value)}
                          >
                            <span className={`csa-color-swatch is-${color.value}`} aria-hidden="true" />
                            {color.label}
                          </button>
                        </DropdownMenu.Item>
                      ))}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>}
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
                  <Copy aria-hidden="true" />
                </button>
                <Suspense fallback={<span className="csa-tool-loading" aria-label="正在载入朗读工具" />}>
                  <DeferredSelectionTtsControls phrase={toolbar.phrase} languageHint={toolbar.language} />
                </Suspense>
                {toolbar.pronunciationToken && (
                  <button
                    type="button"
                    className="csa-icon-action"
                    aria-label="查看日语读音详情"
                    title="查看日语读音详情"
                    onClick={() => setPronunciationDetailTokenKey(toolbar.pronunciationToken?.tokenKey || null)}
                  >
                    <BookOpen aria-hidden="true" />
                  </button>
                )}
                <button
                  ref={lookupTriggerRef}
                  type="button"
                  className="csa-knowledge csa-command-tab"
                  onClick={openKnowledgeLookup}
                >
                  <Search aria-hidden="true" /> 查知识点
                </button>
              </div>
              <div className="csa-primary-actions">
                <div className="csa-generate-wrap">
                  <DropdownMenu.Root open={genMenuOpen} onOpenChange={setGenMenuOpen} modal={false}>
                    <DropdownMenu.Trigger asChild>
                      <button
                        ref={generateTriggerRef}
                        type="button"
                        className="csa-generate csa-command-tab"
                        disabled={generateMutation.isPending}
                      >
                        <Sparkles aria-hidden="true" /> {generateMutation.isPending ? '入队中…' : '生成卡片'}
                        <ChevronDown aria-hidden="true" className="csa-caret" />
                      </button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content
                        className="csa-gen-menu"
                        sideOffset={5}
                        align="end"
                        onCloseAutoFocus={restoreGenerateTriggerFocus}
                      >
                        {SELECTION_CARD_TYPES.map((type) => (
                          <DropdownMenu.Item key={type} asChild disabled={generateMutation.isPending}>
                            <button
                              type="button"
                              disabled={generateMutation.isPending}
                              onClick={() => generateMutation.mutate({ phrase: toolbar.phrase, cardType: type })}
                            >
                              {CARD_TYPE_LABEL[type]}
                            </button>
                          </DropdownMenu.Item>
                        ))}
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                </div>
              </div>
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
