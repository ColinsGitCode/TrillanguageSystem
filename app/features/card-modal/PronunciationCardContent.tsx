import { Copy, LoaderCircle, Search, Sparkles, Volume2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent, RefObject } from 'react';
import { ApiError } from '../../lib/api/client';
import { useExclusiveAudio } from '../../lib/audio/exclusive-audio';
import { factoryApi } from '../factory/factory-api';
import { selectionTtsApi } from './selection-tts';
import { reportPronunciationTelemetry } from './pronunciation-telemetry';
import {
  enhancePronunciationHtml,
  movePronunciationFocus,
  pronunciationTokenFromElement,
  selectPronunciationToken,
} from './pronunciation-overlay';
import type { PronunciationToken } from './pronunciation-overlay';

type Props = {
  html: string;
  generationId: number | null;
  readOnly: boolean;
  contentRef: RefObject<HTMLDivElement | null>;
  onCaptureSelection: (keyboard: boolean) => void;
  onContentClick: (event: MouseEvent<HTMLDivElement>) => void;
  onContextMenuCapture: (event: MouseEvent<HTMLDivElement>) => void;
  onKnowledge: (surface: string) => void;
  onGenerateCard: (surface: string) => void;
  onCorrectionSaved: (result: Awaited<ReturnType<typeof factoryApi.correctPronunciation>>) => void;
  onToast: (message: string) => void;
};

type OverlayState = {
  token: PronunciationToken;
  left: number;
  top: number;
  mode: 'tooltip' | 'popover';
};

const TOOLTIP_DELAY_MS = 250;

function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : '发音生成失败，请重试';
}

export function PronunciationCardContent({
  html,
  generationId,
  readOnly,
  contentRef,
  onCaptureSelection,
  onContentClick,
  onContextMenuCapture,
  onKnowledge,
  onGenerateCard,
  onCorrectionSaved,
  onToast,
}: Props) {
  const audio = useExclusiveAudio();
  const pronunciationQuery = useQuery({
    queryKey: ['pronunciation', 'generation', generationId],
    queryFn: () => factoryApi.pronunciation('generation', Number(generationId)),
    enabled: Boolean(generationId),
    retry: false,
  });
  const tokens = pronunciationQuery.data?.tokens || [];
  const tokenRef = useRef<PronunciationToken[]>([]);
  const closeTimerRef = useRef<number | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const [overlay, setOverlay] = useState<OverlayState | null>(null);
  const [ttsState, setTtsState] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle');
  const [ttsMessage, setTtsMessage] = useState('');
  const [correctionReading, setCorrectionReading] = useState('');
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
    controllerRef.current?.abort();
    audio.stop();
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
  }, [audio.stop]);

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
    const rect = element.getBoundingClientRect();
    const width = mode === 'popover' ? 360 : 240;
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), Math.max(12, window.innerWidth - width - 12));
    const top = Math.min(Math.max(12, rect.bottom + 8), Math.max(12, window.innerHeight - (mode === 'popover' ? 280 : 90)));
    cancelClose();
    const open = () => {
      setOverlay({ token, left, top, mode });
      if (mode === 'popover') {
        setCorrectionReading(token.readingHiragana || '');
        setTtsState('idle');
        setTtsMessage('');
      }
    };
    if (mode === 'tooltip') {
      closeTimerRef.current = window.setTimeout(open, TOOLTIP_DELAY_MS);
    } else {
      open();
    }
  };

  const playPronunciation = async () => {
    const token = overlay?.token;
    if (!token || ttsState === 'loading') return;
    controllerRef.current?.abort();
    audio.stop();
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    const controller = new AbortController();
    controllerRef.current = controller;
    const startedAt = performance.now();
    const length = Array.from(token.surface).length;
    reportPronunciationTelemetry({ eventType: 'action', uiSurface: 'card-modal', action: 'tts', outcome: 'started', length });
    reportPronunciationTelemetry({ eventType: 'lifecycle', uiSurface: 'card-modal', resource: 'controller', outcome: 'start' });
    setTtsState('loading');
    setTtsMessage('正在生成发音…');
    try {
      const result = await selectionTtsApi.synthesize({ text: token.surface, language: 'ja', speed: 1 }, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(result.blob);
      audioUrlRef.current = url;
      await audio.playUrl(url, {
        onEnded: () => setTtsState('idle'),
        onError: () => {
          setTtsState('error');
          setTtsMessage('发音播放失败，请重试');
        },
        onStop: () => setTtsState('idle'),
      });
      reportPronunciationTelemetry({ eventType: 'action', uiSurface: 'card-modal', action: 'tts', outcome: 'success', length, durationMs: performance.now() - startedAt, queueWaitMs: result.queueWaitMs });
      setTtsState('playing');
      setTtsMessage(result.contended ? '发音服务较忙，已完成排队' : '');
    } catch (error) {
      if (controller.signal.aborted) return;
      reportPronunciationTelemetry({ eventType: 'action', uiSurface: 'card-modal', action: 'tts', outcome: 'error', length, durationMs: performance.now() - startedAt, errorCode: 'TTS_FAILED', statusCode: error instanceof ApiError ? error.status : 500 });
      setTtsState('error');
      setTtsMessage(errorMessage(error));
    } finally {
      if (controller.signal.aborted) reportPronunciationTelemetry({ eventType: 'action', uiSurface: 'card-modal', action: 'tts', outcome: 'aborted', length });
      reportPronunciationTelemetry({ eventType: 'lifecycle', uiSurface: 'card-modal', resource: 'controller', outcome: controller.signal.aborted ? 'aborted' : 'end' });
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  };

  const saveCorrection = async () => {
    const token = overlay?.token;
    const document = pronunciationQuery.data?.document;
    if (!token || !document || !generationId || !correctionReading.trim() || correctionBusy || readOnly) return;
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

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const token = (event.target as HTMLElement).closest<HTMLElement>('.pronunciation-token');
    if (token && (window.getSelection()?.isCollapsed ?? true)) {
      event.preventDefault();
      openOverlay(token, 'popover');
      return;
    }
    onContentClick(event);
  };

  const contentHtml = enhancePronunciationHtml(html, tokens);
  return (
    <div className="pronunciation-card-content-shell">
      <div
        ref={(node) => { contentRef.current = node; }}
        className="react-card-markdown"
        data-testid="react-card-content"
        tabIndex={0}
        aria-label="学习卡片正文，可选择文字后操作"
        onMouseUp={() => onCaptureSelection(false)}
        onClick={handleClick}
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
          setOverlay(null);
          window.requestAnimationFrame(() => onCaptureSelection(true));
        }}
        onContextMenuCapture={onContextMenuCapture}
        dangerouslySetInnerHTML={{ __html: contentHtml }}
      />
      {overlay && (
        <div
          className={`pronunciation-popover is-${overlay.mode}`}
          role={overlay.mode === 'tooltip' ? 'tooltip' : 'dialog'}
          aria-label={overlay.mode === 'tooltip' ? '日语读音' : '读音与学习动作'}
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
          {overlay.mode === 'tooltip' ? (
            <p className="pronunciation-tooltip-meta">{overlay.token.unitKind === 'word' ? '词语读音' : '汉字读音'} · {overlay.token.source === 'manual' ? '人工确认' : '系统分析'}</p>
          ) : (
            <>
              <div className="pronunciation-popover-meta">
                <span>{overlay.token.unitKind === 'word' ? '词语' : '单字/词素'}</span>
                <span>{overlay.token.source === 'manual' ? '人工确认' : overlay.token.source === 'dictionary' ? '词典' : '分析器'}</span>
              </div>
              <div className="pronunciation-popover-actions">
                <button type="button" onClick={() => void playPronunciation()} disabled={ttsState === 'loading'}>{ttsState === 'loading' ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <Volume2 aria-hidden="true" />}{ttsState === 'loading' ? '生成中…' : '朗读'}</button>
                <button type="button" onClick={() => { reportPronunciationTelemetry({ eventType: 'action', uiSurface: 'card-modal', action: 'knowledge', outcome: 'started' }); onKnowledge(overlay.token.surface); setOverlay(null); }}><Search aria-hidden="true" />查知识点</button>
                <button type="button" onClick={() => { reportPronunciationTelemetry({ eventType: 'action', uiSurface: 'card-modal', action: 'generate-card', outcome: 'started' }); onGenerateCard(overlay.token.surface); setOverlay(null); }}><Sparkles aria-hidden="true" />生成三语卡</button>
                <button type="button" onClick={() => { void navigator.clipboard?.writeText(overlay.token.surface); onToast('词语已复制'); }}><Copy aria-hidden="true" />复制</button>
              </div>
              {ttsMessage && <p className="pronunciation-popover-status" role="status">{ttsMessage}</p>}
              <div className="pronunciation-correction">
                <label htmlFor="pronunciation-correction-reading">修正平假名</label>
                <div>
                  <input id="pronunciation-correction-reading" value={correctionReading} onChange={(event) => setCorrectionReading(event.target.value)} inputMode="text" placeholder="例如：きんむひょう" disabled={readOnly} />
                  <button type="button" disabled={readOnly || correctionBusy || !correctionReading.trim()} onClick={() => void saveCorrection()}>{correctionBusy ? '保存中…' : '保存'}</button>
                </div>
                <small>只修正读音数据，不改写卡片正文。</small>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
