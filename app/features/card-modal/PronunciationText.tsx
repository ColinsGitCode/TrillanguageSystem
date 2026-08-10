import { Copy, LoaderCircle, Volume2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useExclusiveAudio } from '../../lib/audio/exclusive-audio';
import { selectionTtsApi } from './selection-tts';
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
} from './pronunciation-token-details';

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
  const [ttsState, setTtsState] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle');
  const [ttsMessage, setTtsMessage] = useState('');
  const closeTimerRef = useRef<number | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const renderedHtml = enhancePronunciationHtml(html, tokens);
  const Content = tagName;
  const overlayBasicForm = overlay ? pronunciationBasicForm(overlay.token) : null;
  const overlayForeignOrigin = overlay ? pronunciationForeignOrigin(overlay.token) : null;
  const overlayNeedsOrigin = Boolean(overlay && isKatakanaLoanwordCandidate(overlay.token) && !overlayForeignOrigin);

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
    const rect = pronunciationTokenRect(element);
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
    if (!overlay || ttsState === 'loading') return;
    controllerRef.current?.abort();
    audio.stop();
    const controller = new AbortController();
    controllerRef.current = controller;
    const startedAt = performance.now();
    const length = Array.from(overlay.token.surface).length;
    reportPronunciationTelemetry({ eventType: 'action', uiSurface: language === 'ja' ? 'textbook' : 'review', action: 'tts', outcome: 'started', length });
    reportPronunciationTelemetry({ eventType: 'lifecycle', uiSurface: language === 'ja' ? 'textbook' : 'review', resource: 'controller', outcome: 'start' });
    setTtsState('loading');
    setTtsMessage('正在生成发音…');
    try {
      const result = await selectionTtsApi.synthesize({ text: overlay.token.surface, language: 'ja', speed: 1 }, controller.signal);
      if (controller.signal.aborted) return;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(result.blob);
      await audio.playUrl(urlRef.current, {
        onEnded: () => { setTtsState('idle'); setTtsMessage(''); },
        onError: () => { setTtsState('error'); setTtsMessage('发音播放失败，请重试'); },
        onStop: () => setTtsState('idle'),
      });
      reportPronunciationTelemetry({
        eventType: 'action',
        uiSurface: language === 'ja' ? 'textbook' : 'review',
        action: 'tts',
        outcome: 'success',
        length,
        durationMs: performance.now() - startedAt,
        queueWaitMs: result.queueWaitMs,
      });
      setTtsState('playing');
      setTtsMessage(result.contended ? '发音服务较忙，已完成排队' : '');
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
        setTtsState('error');
        setTtsMessage(error instanceof Error && error.message ? error.message : '发音生成失败，请重试');
      }
    } finally {
      reportPronunciationTelemetry({ eventType: 'lifecycle', uiSurface: language === 'ja' ? 'textbook' : 'review', resource: 'controller', outcome: controller.signal.aborted ? 'aborted' : 'end' });
      if (controllerRef.current === controller) controllerRef.current = null;
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
          {(overlayBasicForm || overlayForeignOrigin || overlayNeedsOrigin) && (
            <dl className="pronunciation-token-details">
              {overlayBasicForm && <><dt>辞书形</dt><dd>{overlayBasicForm}</dd></>}
              {overlayForeignOrigin && <><dt>{overlayForeignOrigin.language}来源</dt><dd>{overlayForeignOrigin.term}</dd></>}
              {overlayNeedsOrigin && <><dt>外语来源</dt><dd className="is-unresolved">待确认</dd></>}
            </dl>
          )}
          {overlay.tooltip ? (
            <p className="pronunciation-tooltip-meta">{overlay.token.unitKind === 'word' ? '词语读音' : '汉字读音'} · 悬停不记录查询</p>
          ) : (
            <div className="pronunciation-popover-actions">
              <button type="button" onClick={() => void play()} disabled={ttsState === 'loading'}>{ttsState === 'loading' ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <Volume2 aria-hidden="true" />}{ttsState === 'loading' ? '生成中…' : ttsState === 'error' ? '重试朗读' : '朗读'}</button>
              <button type="button" onClick={() => { void navigator.clipboard?.writeText(overlay.token.surface); setOverlay(null); }}><Copy aria-hidden="true" />复制</button>
            </div>
          )}
          {!overlay.tooltip && ttsMessage && <p className="pronunciation-popover-status" role={ttsState === 'error' ? 'alert' : 'status'}>{ttsMessage}</p>}
        </div>
      )}
    </div>
  );
}
