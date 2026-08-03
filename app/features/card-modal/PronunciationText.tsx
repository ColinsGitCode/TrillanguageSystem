import { Copy, LoaderCircle, Volume2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useExclusiveAudio } from '../../lib/audio/exclusive-audio';
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
  tokens: PronunciationToken[];
  className?: string;
  testId?: string;
  tagName?: 'div' | 'h3';
  language?: 'en' | 'ja';
};

const PRONUNCIATION_TOOLTIP_DELAY_MS = 250;

export function PronunciationText({ html, tokens, className = '', testId, tagName = 'div', language }: Props) {
  const audio = useExclusiveAudio();
  const [overlay, setOverlay] = useState<{ token: PronunciationToken; left: number; top: number; tooltip: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const renderedHtml = enhancePronunciationHtml(html, tokens);
  const Content = tagName;

  useEffect(() => () => {
    controllerRef.current?.abort();
    audio.stop();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, [audio.stop]);

  useEffect(() => {
    if (!overlay) return undefined;
    const close = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('.pronunciation-token, .pronunciation-popover')) setOverlay(null);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [overlay]);

  const cancelClose = () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => setOverlay((current) => current?.tooltip ? null : current), 140);
  };
  const open = (element: Element, tooltip: boolean) => {
    const compact = pronunciationTokenFromElement(element);
    if (!compact) return;
    const token = tokens.find((item) => item.tokenKey === compact.tokenKey) || compact;
    const rect = element.getBoundingClientRect();
    const width = tooltip ? 240 : 320;
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), Math.max(12, window.innerWidth - width - 12));
    const top = Math.min(Math.max(12, rect.bottom + 8), Math.max(12, window.innerHeight - (tooltip ? 90 : 210)));
    cancelClose();
    if (tooltip) {
      closeTimerRef.current = window.setTimeout(() => setOverlay({ token, left, top, tooltip }), PRONUNCIATION_TOOLTIP_DELAY_MS);
      return;
    }
    setOverlay({ token, left, top, tooltip });
  };
  const play = async () => {
    if (!overlay || loading) return;
    controllerRef.current?.abort();
    audio.stop();
    const controller = new AbortController();
    controllerRef.current = controller;
    const startedAt = performance.now();
    const length = Array.from(overlay.token.surface).length;
    reportPronunciationTelemetry({ eventType: 'action', uiSurface: language === 'ja' ? 'textbook' : 'review', action: 'tts', outcome: 'started', length });
    reportPronunciationTelemetry({ eventType: 'lifecycle', uiSurface: language === 'ja' ? 'textbook' : 'review', resource: 'controller', outcome: 'start' });
    setLoading(true);
    try {
      const result = await selectionTtsApi.synthesize({ text: overlay.token.surface, language: 'ja', speed: 1 }, controller.signal);
      if (controller.signal.aborted) return;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(result.blob);
      await audio.playUrl(urlRef.current, { onEnded: () => setLoading(false), onError: () => setLoading(false), onStop: () => setLoading(false) });
      reportPronunciationTelemetry({
        eventType: 'action',
        uiSurface: language === 'ja' ? 'textbook' : 'review',
        action: 'tts',
        outcome: 'success',
        length,
        durationMs: performance.now() - startedAt,
        queueWaitMs: result.queueWaitMs,
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        reportPronunciationTelemetry({
          eventType: 'action',
          uiSurface: language === 'ja' ? 'textbook' : 'review',
          action: 'tts',
          outcome: 'error',
          length,
          durationMs: performance.now() - startedAt,
          errorCode: 'TTS_FAILED',
        });
      }
      throw error;
    } finally {
      reportPronunciationTelemetry({ eventType: 'lifecycle', uiSurface: language === 'ja' ? 'textbook' : 'review', resource: 'controller', outcome: controller.signal.aborted ? 'aborted' : 'end' });
      if (controllerRef.current === controller) controllerRef.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  return (
    <div className="pronunciation-text-shell">
      <Content
        ref={(node) => {
          contentRef.current = node;
        }}
        className={`pronunciation-text ${className}`.trim()}
        data-testid={testId}
        data-textbook-language={language}
        onMouseOver={(event) => {
        const token = (event.target as HTMLElement).closest<HTMLElement>('.pronunciation-token');
        if (token && !window.getSelection()?.toString()) {
          reportPronunciationTelemetry({ eventType: 'token', uiSurface: language === 'ja' ? 'textbook' : 'review', tokenSource: token.dataset.pronunciationSource as PronunciationToken['source'], tokenStatus: token.dataset.pronunciationStatus as PronunciationToken['status'], outcome: 'open' });
          open(token, true);
        }
        }}
        onMouseOut={(event) => {
        if ((event.target as HTMLElement).closest('.pronunciation-token')) scheduleClose();
        }}
        onFocus={(event) => {
        const token = (event.target as HTMLElement).closest<HTMLElement>('.pronunciation-token');
        if (token) open(token, true);
        }}
        onKeyDown={(event) => {
        const token = (event.target as HTMLElement).closest<HTMLElement>('.pronunciation-token');
        if (!token) return;
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          movePronunciationFocus(contentRef.current || event.currentTarget, token, event.key);
          return;
        }
        if (!['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        open(token, false);
        }}
        onDoubleClick={(event) => {
        const token = (event.target as HTMLElement).closest<HTMLElement>('.pronunciation-token');
        if (!token || !selectPronunciationToken(token)) return;
        event.preventDefault();
        setOverlay(null);
        }}
        onClick={(event) => {
        const token = (event.target as HTMLElement).closest<HTMLElement>('.pronunciation-token');
        if (token && (window.getSelection()?.isCollapsed ?? true)) {
          event.preventDefault();
          open(token, false);
        }
        }}
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
      />
      {overlay && (
        <div
          className={`pronunciation-popover is-${overlay.tooltip ? 'tooltip' : 'popover'}`}
          role={overlay.tooltip ? 'tooltip' : 'dialog'}
          style={{ left: overlay.left, top: overlay.top }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="pronunciation-popover-heading">
            <strong>{overlay.token.surface}</strong>
            <span className={overlay.token.readingHiragana ? 'is-accepted' : 'is-unresolved'}>{overlay.token.readingHiragana || '读音待确认'}</span>
            {!overlay.tooltip && <button type="button" className="icon-button" aria-label="关闭读音浮层" onClick={() => setOverlay(null)}><X aria-hidden="true" /></button>}
          </div>
          {overlay.tooltip ? (
            <p className="pronunciation-tooltip-meta">{overlay.token.unitKind === 'word' ? '词语读音' : '汉字读音'} · 悬停不记录查询</p>
          ) : (
            <div className="pronunciation-popover-actions">
              <button type="button" onClick={() => void play()} disabled={loading}>{loading ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <Volume2 aria-hidden="true" />}{loading ? '生成中…' : '朗读'}</button>
              <button type="button" onClick={() => { void navigator.clipboard?.writeText(overlay.token.surface); setOverlay(null); }}><Copy aria-hidden="true" />复制</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
