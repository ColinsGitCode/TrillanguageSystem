import { useQuery } from '@tanstack/react-query';
import { Component, useEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode, RefObject } from 'react';
import { ApiError } from '../../lib/api/client';
import { factoryApi } from '../factory/factory-api';
import { reportPronunciationTelemetry } from './pronunciation-telemetry';
import {
  enhancePronunciationHtml,
  movePronunciationFocus,
  pronunciationTokenFromElement,
  pronunciationTokenRect,
  selectPronunciationToken,
} from './pronunciation-overlay';
import type { PronunciationToken } from './pronunciation-overlay';
import {
  isKatakanaLoanwordCandidate,
  pronunciationBasicForm,
  pronunciationForeignOrigin,
  ORIGIN_TIER_LABEL,
} from './pronunciation-token-details';
import { languageMetadataApi } from './language-metadata';
import type { CardDocument } from './card-document';
import type { CardAnnotation } from '../factory/factory-api';
import type { CardType } from '../factory/types';
import { CardReaderV3 } from './CardReaderV3';

type Props = {
  html: string;
  document?: CardDocument | null;
  annotations?: CardAnnotation[];
  cardType?: CardType;
  generationId: number | null;
  readOnly: boolean;
  contentRef: RefObject<HTMLDivElement | null>;
  onCaptureSelection: (keyboard: boolean, ignoreAnnotationOverlap?: boolean) => void;
  onContentClick: (event: MouseEvent<HTMLDivElement>) => void;
  onContextMenuCapture: (event: MouseEvent<HTMLDivElement>) => void;
  requestedDetailTokenKey: string | null;
  onDetailRequestHandled: () => void;
  onCorrectionSaved: (result: Awaited<ReturnType<typeof factoryApi.correctPronunciation>>) => void;
  onToast: (message: string) => void;
};

class CanaryBoundary extends Component<{ fallback: ReactNode; resetKey: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Card Reader v3 Canary fell back to v2', error);
  }

  componentDidUpdate(previous: Readonly<{ resetKey: string }>) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

type OverlayState = {
  token: PronunciationToken;
  left: number;
  top: number;
  mode: 'tooltip' | 'popover';
};

const TOOLTIP_DELAY_MS = 250;

export function PronunciationCardContent({
  html,
  document: cardDocument = null,
  annotations = [],
  cardType = 'trilingual',
  generationId,
  readOnly,
  contentRef,
  onCaptureSelection,
  onContentClick,
  onContextMenuCapture,
  requestedDetailTokenKey,
  onDetailRequestHandled,
  onCorrectionSaved,
  onToast,
}: Props) {
  const pronunciationQuery = useQuery({
    queryKey: ['pronunciation', 'generation', generationId],
    queryFn: () => factoryApi.pronunciation('generation', Number(generationId)),
    enabled: Boolean(generationId),
    retry: false,
  });
  const tokens = pronunciationQuery.data?.tokens || [];
  const tokenRef = useRef<PronunciationToken[]>([]);
  const closeTimerRef = useRef<number | null>(null);
  const [overlay, setOverlay] = useState<OverlayState | null>(null);
  const [correctionReading, setCorrectionReading] = useState('');
  const [originTerm, setOriginTerm] = useState('');
  const [originBusy, setOriginBusy] = useState(false);
  const [correctionBusy, setCorrectionBusy] = useState(false);

  useEffect(() => {
    tokenRef.current = tokens;
  }, [tokens]);

  useEffect(() => {
    const pronunciation = pronunciationQuery.data;
    if (!pronunciation) return;
    const status: 'ready' | 'partial' | 'stale' | 'error' = ['ready', 'partial', 'stale'].includes(pronunciation.document.status)
      ? pronunciation.document.status as 'ready' | 'partial' | 'stale'
      : 'error';
    reportPronunciationTelemetry({ eventType: 'state', uiSurface: 'card-modal', requestKind: 'pronunciation', outcome: status });
    if (pronunciation.tokens.some((token) => token.source === 'legacy-ruby')) {
      reportPronunciationTelemetry({ eventType: 'state', uiSurface: 'card-modal', requestKind: 'pronunciation', outcome: 'legacy-hit' });
    }
  }, [pronunciationQuery.data?.document?.revision]);

  useEffect(() => () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => {
    if (!overlay) return undefined;
    reportPronunciationTelemetry({
      eventType: 'token',
      uiSurface: 'card-modal',
      tokenSource: overlay.token.source,
      tokenStatus: overlay.token.status,
      outcome: 'open',
    });
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('.pronunciation-token, .pronunciation-popover')) setOverlay(null);
    };
    const onScroll = () => setOverlay(null);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    reportPronunciationTelemetry({ eventType: 'lifecycle', uiSurface: 'card-modal', resource: 'listener', outcome: 'start' });
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      reportPronunciationTelemetry({ eventType: 'lifecycle', uiSurface: 'card-modal', resource: 'listener', outcome: 'end' });
    };
  }, [overlay]);

  const cancelClose = () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      setOverlay((current) => current?.mode === 'tooltip' ? null : current);
    }, 140);
  };

  const openOverlay = (element: Element, mode: OverlayState['mode']) => {
    const compact = pronunciationTokenFromElement(element);
    if (!compact) return;
    const token = tokenRef.current.find((item) => item.tokenKey === compact.tokenKey) || compact;
    const rect = pronunciationTokenRect(element);
    const width = mode === 'popover' ? 360 : 240;
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), Math.max(12, window.innerWidth - width - 12));
    const top = Math.min(Math.max(12, rect.bottom + 8), Math.max(12, window.innerHeight - (mode === 'popover' ? 280 : 90)));
    cancelClose();
    const open = () => {
      setOverlay({ token, left, top, mode });
      if (mode === 'popover') {
        setCorrectionReading(token.readingHiragana || '');
      }
    };
    if (mode === 'tooltip') {
      closeTimerRef.current = window.setTimeout(open, TOOLTIP_DELAY_MS);
    } else {
      open();
    }
  };

  useEffect(() => {
    if (!requestedDetailTokenKey || !contentRef.current) return;
    const element = Array.from(contentRef.current.querySelectorAll<HTMLElement>('.pronunciation-token'))
      .find((item) => item.dataset.pronunciationTokenKey === requestedDetailTokenKey);
    if (element) openOverlay(element, 'popover');
    onDetailRequestHandled();
  }, [requestedDetailTokenKey, tokens.length]);

  // JLM-A1 adjudication. Refetches rather than patching local state so the
  // resolved tier always comes from the server's priority order.
  const decideOrigin = async (proposalId: number, decision: 'accept' | 'reject') => {
    setOriginBusy(true);
    try {
      await languageMetadataApi.decide(proposalId, decision);
      setOverlay(null);
      await pronunciationQuery.refetch();
    } finally {
      setOriginBusy(false);
    }
  };

  const saveOriginCorrection = async () => {
    const token = overlay?.token;
    const hash = pronunciationQuery.data?.document?.sourceContentHash;
    if (!token || !generationId || !hash || !originTerm.trim() || originBusy) return;
    setOriginBusy(true);
    try {
      await languageMetadataApi.correct({
        targetKind: 'generation',
        targetId: generationId,
        sourceContentHash: hash,
        surface: token.surface,
        startCodePoint: token.startCodePoint,
        endCodePoint: token.endCodePoint,
        originTerm: originTerm.trim(),
      });
      setOriginTerm('');
      setOverlay(null);
      await pronunciationQuery.refetch();
    } finally {
      setOriginBusy(false);
    }
  };

  const saveCorrection = async () => {
    const token = overlay?.token;
    const document = pronunciationQuery.data?.document;
    if (!token || !document || document.persisted === false || !generationId || !correctionReading.trim() || correctionBusy || readOnly) return;
    setCorrectionBusy(true);
    reportPronunciationTelemetry({ eventType: 'action', uiSurface: 'card-modal', action: 'correction', outcome: 'started' });
    try {
      const result = await factoryApi.correctPronunciation({
        targetId: generationId,
        tokenKey: token.tokenKey,
        eventKey: `pronunciation:${document.id}:${document.revision}:${token.tokenKey}:${crypto.randomUUID()}`,
        eventType: 'reading',
        expectedRevision: document.revision,
        readingRaw: correctionReading.trim(),
        readingHiragana: correctionReading.trim(),
        status: 'accepted',
      });
      onCorrectionSaved(result);
      setOverlay(null);
      reportPronunciationTelemetry({ eventType: 'action', uiSurface: 'card-modal', action: 'correction', outcome: 'success' });
      onToast('读音修正已保存');
    } catch (error) {
      reportPronunciationTelemetry({ eventType: 'action', uiSurface: 'card-modal', action: 'correction', outcome: error instanceof ApiError && error.status === 409 ? 'stale' : 'error', errorCode: 'PRONUNCIATION_CORRECTION_FAILED', statusCode: error instanceof ApiError ? error.status : 500 });
      onToast(error instanceof ApiError && error.status === 409 ? '读音已被其它页面修改，请重新打开' : '读音修正失败，请重试');
    } finally {
      setCorrectionBusy(false);
    }
  };

  const contentHtml = enhancePronunciationHtml(html, tokens);
  const legacySurface = <div dangerouslySetInnerHTML={{ __html: contentHtml }} />;
  const canaryResetKey = `${generationId || 0}:${cardDocument?.version || 'v2'}`;
  const overlayBasicForm = overlay ? pronunciationBasicForm(overlay.token) : null;
  const overlayForeignOrigin = overlay ? pronunciationForeignOrigin(overlay.token) : null;
  const overlayNeedsOrigin = Boolean(overlay && isKatakanaLoanwordCandidate(overlay.token) && !overlayForeignOrigin);
  return (
    <div className="pronunciation-card-content-shell">
      <div
        ref={(node) => { contentRef.current = node; }}
        className="react-card-markdown"
        data-testid="react-card-content"
        tabIndex={0}
        aria-label="学习卡片正文，可选择文字后操作"
        onMouseUp={() => onCaptureSelection(false)}
        onClick={onContentClick}
        onMouseOver={(event) => {
          const token = (event.target as HTMLElement).closest<HTMLElement>('.pronunciation-token');
          if (!token || (event.relatedTarget instanceof Node && token.contains(event.relatedTarget))) return;
          if (window.getSelection() && !window.getSelection()?.isCollapsed) return;
          openOverlay(token, 'tooltip');
        }}
        onMouseOut={(event) => {
          const token = (event.target as HTMLElement).closest<HTMLElement>('.pronunciation-token');
          if (token && !(event.relatedTarget instanceof Node && token.contains(event.relatedTarget))) scheduleClose();
        }}
        onFocus={(event) => {
          const token = (event.target as HTMLElement).closest<HTMLElement>('.pronunciation-token');
          if (token) openOverlay(token, 'tooltip');
        }}
        onKeyDown={(event) => {
          const token = (event.target as HTMLElement).closest<HTMLElement>('.pronunciation-token');
          if (!token) return;
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            movePronunciationFocus(contentRef.current || event.currentTarget, token, event.key);
            return;
          }
          if (['Enter', ' '].includes(event.key)) {
            event.preventDefault();
            openOverlay(token, 'popover');
          }
        }}
        onDoubleClick={(event) => {
          const token = (event.target as HTMLElement).closest<HTMLElement>('.pronunciation-token');
          if (!token || !selectPronunciationToken(token)) return;
          event.preventDefault();
          onCaptureSelection(true, true);
          setOverlay(null);
        }}
        onContextMenuCapture={onContextMenuCapture}
      >
        {cardDocument ? (
          <CanaryBoundary fallback={legacySurface} resetKey={canaryResetKey}>
            <CardReaderV3
              document={cardDocument}
              cardType={cardType}
              annotations={annotations}
              pronunciationTokens={tokens}
            />
          </CanaryBoundary>
        ) : legacySurface}
      </div>
      {overlay && (
        <div
          className={`pronunciation-popover is-${overlay.mode}`}
          role={overlay.mode === 'tooltip' ? 'tooltip' : 'dialog'}
          aria-label={overlay.mode === 'tooltip' ? '日语读音' : '读音详情'}
          style={{ left: overlay.left, top: overlay.top }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setOverlay(null);
            }
          }}
        >
          <div className="pronunciation-popover-heading">
            <strong>{overlay.token.surface}</strong>
            <span className={overlay.token.status === 'accepted' ? 'is-accepted' : 'is-unresolved'}>{overlay.token.readingHiragana || '读音待确认'}</span>
          </div>
          {(overlayBasicForm || overlayForeignOrigin || overlayNeedsOrigin) && (
            <dl className="pronunciation-token-details">
              {overlayBasicForm && <><dt>辞书形</dt><dd>{overlayBasicForm}</dd></>}
              {overlayForeignOrigin && (
                <>
                  {/* A pending candidate is never worded like a confirmed
                      source; the tier badge carries that distinction. */}
                  <dt>{overlayForeignOrigin.tier === 'pending' ? 'AI 候选' : `${overlayForeignOrigin.language}来源`}</dt>
                  <dd>
                    {overlayForeignOrigin.term}
                    <small className="pronunciation-origin-tier" data-tier={overlayForeignOrigin.tier}>
                      {ORIGIN_TIER_LABEL[overlayForeignOrigin.tier]}
                    </small>
                  </dd>
                </>
              )}
              {overlayNeedsOrigin && <><dt>外语来源</dt><dd className="is-unresolved">待确认</dd></>}
            </dl>
          )}
          {overlay.mode !== 'tooltip' && !readOnly && (overlayForeignOrigin || overlayNeedsOrigin) && (
            <div className="pronunciation-origin-review" data-testid="pronunciation-origin-review">
              {overlayForeignOrigin?.tier === 'pending' && overlayForeignOrigin.proposalId !== null && (
                <div className="pronunciation-popover-actions is-adjudication">
                  <button
                    type="button"
                    className="is-primary"
                    data-testid="origin-accept"
                    disabled={originBusy}
                    onClick={() => void decideOrigin(overlayForeignOrigin.proposalId as number, 'accept')}
                  >接受</button>
                  <button
                    type="button"
                    data-testid="origin-reject"
                    disabled={originBusy}
                    onClick={() => void decideOrigin(overlayForeignOrigin.proposalId as number, 'reject')}
                  >不对</button>
                </div>
              )}
              {/* Available for every tier, including curated: without it the top
                  of the priority ladder would be unreachable and a wrong curated
                  entry could never be overridden. */}
              <div className="pronunciation-correction">
                <label htmlFor="pronunciation-origin-term">
                  {overlayForeignOrigin ? '更正外语原词' : '补充外语原词'}
                </label>
                <div>
                  <input
                    id="pronunciation-origin-term"
                    data-testid="origin-term-input"
                    value={originTerm}
                    onChange={(event) => setOriginTerm(event.target.value)}
                    placeholder={overlayForeignOrigin?.term || '例如：software'}
                    disabled={originBusy}
                  />
                  <button
                    type="button"
                    data-testid="origin-correct"
                    disabled={originBusy || !originTerm.trim()}
                    onClick={() => void saveOriginCorrection()}
                  >{originBusy ? '保存中…' : '保存'}</button>
                </div>
                <small>人工确认的来源优先于精选词典，且不改写卡片正文。</small>
              </div>
            </div>
          )}
          {overlay.mode === 'tooltip' ? (
            <p className="pronunciation-tooltip-meta">{overlay.token.unitKind === 'word' ? '词语读音' : '汉字读音'} · {overlay.token.source === 'manual' ? '人工确认' : '系统分析'}</p>
          ) : (
            <>
              <div className="pronunciation-popover-meta">
                <span>{overlay.token.unitKind === 'word' ? '词语' : '单字/词素'}</span>
                <span>{overlay.token.source === 'manual' ? '人工确认' : overlay.token.source === 'dictionary' ? '词典' : '分析器'}</span>
              </div>
              <div className="pronunciation-correction">
                <label htmlFor="pronunciation-correction-reading">修正平假名</label>
                <div>
                  <input id="pronunciation-correction-reading" value={correctionReading} onChange={(event) => setCorrectionReading(event.target.value)} inputMode="text" placeholder="例如：きんむひょう" disabled={readOnly || pronunciationQuery.data?.document.persisted === false} />
                  <button type="button" disabled={readOnly || pronunciationQuery.data?.document.persisted === false || correctionBusy || !correctionReading.trim()} onClick={() => void saveCorrection()}>{correctionBusy ? '保存中…' : '保存'}</button>
                </div>
                <small>{pronunciationQuery.data?.document.persisted === false ? '历史卡当前使用只读临时注音；完成受控迁移后才可纠音。' : '只修正读音数据，不改写卡片正文。'}</small>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
