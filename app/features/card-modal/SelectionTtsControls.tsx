import { useEffect, useRef, useState } from 'react';
import { CircleAlert, LoaderCircle, RotateCcw, Square, Volume2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../../lib/api/client';
import { useExclusiveAudio } from '../../lib/audio/exclusive-audio';
import {
  inferSelectionTtsLanguage,
  selectionTtsApi,
  type SelectionTtsLanguage,
  type SelectionTtsSpeed,
} from './selection-tts';

type PlaybackState = 'idle' | 'loading' | 'playing' | 'ready' | 'error';

function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    const payload = error.payload as { code?: string } | null;
    if (payload?.code === 'SELECTION_TTS_BUSY') return '发音服务正忙，请稍后重试';
    if (payload?.code === 'SELECTION_TTS_TIMEOUT') return '发音生成超时，请重试';
    if (payload?.code === 'SELECTION_TTS_TEXT_TOO_LONG') return '选区过长，请缩短后重试';
  }
  return '发音生成失败，请重试';
}

export function SelectionTtsControls({ phrase }: { phrase: string }) {
  const configQuery = useQuery({
    queryKey: ['selection-tts', 'config'],
    queryFn: selectionTtsApi.config,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const playback = useExclusiveAudio();
  const controllerRef = useRef<AbortController | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const busyTimerRef = useRef<number | null>(null);
  const mainButtonRef = useRef<HTMLButtonElement | null>(null);
  const firstLanguageButtonRef = useRef<HTMLButtonElement | null>(null);
  const [state, setState] = useState<PlaybackState>('idle');
  const [speed, setSpeed] = useState<SelectionTtsSpeed>(1);
  const [language, setLanguage] = useState<SelectionTtsLanguage | null>(null);
  const [confirmLanguage, setConfirmLanguage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const clearBlob = () => {
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    blobUrlRef.current = null;
  };
  const cancelRequest = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    if (busyTimerRef.current) window.clearTimeout(busyTimerRef.current);
    busyTimerRef.current = null;
    setBusy(false);
  };
  const reset = () => {
    cancelRequest();
    playback.stop();
    clearBlob();
    setState('idle');
    setLanguage(null);
    setConfirmLanguage(false);
    setMessage('');
  };

  useEffect(() => reset, [phrase]);
  useEffect(() => () => {
    cancelRequest();
    playback.stop();
    clearBlob();
  }, []);
  useEffect(() => {
    if (!confirmLanguage) return;
    const frame = window.requestAnimationFrame(() => firstLanguageButtonRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [confirmLanguage]);

  if (configQuery.isLoading) {
    return <span className="csa-tts csa-tts-placeholder" aria-hidden="true" />;
  }
  if (!configQuery.data?.enabled) return null;

  const play = async (confirmedLanguage?: SelectionTtsLanguage) => {
    const resolvedLanguage = confirmedLanguage || language || inferSelectionTtsLanguage(phrase);
    if (!resolvedLanguage) {
      setConfirmLanguage(true);
      return;
    }
    cancelRequest();
    playback.stop();
    clearBlob();
    setLanguage(resolvedLanguage);
    setConfirmLanguage(false);
    setState('loading');
    setMessage('正在生成发音');
    const controller = new AbortController();
    controllerRef.current = controller;
    busyTimerRef.current = window.setTimeout(() => setBusy(true), 600);
    try {
      const audio = await selectionTtsApi.synthesize({
        text: phrase,
        language: resolvedLanguage,
        speed,
      }, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(audio.blob);
      blobUrlRef.current = url;
      setMessage(audio.contended || audio.queueWaitMs > 600 ? '发音服务刚才较忙，已生成' : '');
      await playback.playUrl(url, {
        onEnded: () => setState('ready'),
        onError: () => {
          setState('error');
          setMessage('音频播放失败，请重试');
        },
        onStop: () => setState((current) => current === 'playing' ? 'ready' : current),
      });
      setState('playing');
    } catch (error) {
      if (controller.signal.aborted) return;
      setState('error');
      setMessage(errorMessage(error));
      window.requestAnimationFrame(() => mainButtonRef.current?.focus());
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      if (busyTimerRef.current) window.clearTimeout(busyTimerRef.current);
      busyTimerRef.current = null;
      setBusy(false);
    }
  };

  const onMainAction = () => {
    if (state === 'playing') {
      playback.stop();
      setState('ready');
      return;
    }
    void play();
  };

  const icon = state === 'loading'
    ? <LoaderCircle className="is-spinning" aria-hidden="true" />
    : state === 'playing'
      ? <Square aria-hidden="true" />
      : state === 'ready'
        ? <RotateCcw aria-hidden="true" />
        : state === 'error'
          ? <CircleAlert aria-hidden="true" />
          : <Volume2 aria-hidden="true" />;
  const actionLabel = state === 'playing'
    ? '停止朗读'
    : state === 'ready'
      ? '重播选区'
      : state === 'error'
        ? '重试朗读选区'
        : '朗读选区';

  return (
    <span className={`csa-tts is-${state}`}>
      <button
        ref={mainButtonRef}
        type="button"
        className="csa-icon-action csa-tts-action"
        aria-label={actionLabel}
        title={actionLabel}
        disabled={state === 'loading'}
        onClick={onMainAction}
      >
        {icon}
      </button>
      <select
        aria-label="朗读速度"
        title="朗读速度"
        value={speed}
        disabled={state === 'loading' || state === 'playing'}
        onChange={(event) => {
          setSpeed(Number(event.target.value) as SelectionTtsSpeed);
          setState('idle');
          setMessage('');
        }}
      >
        <option value="0.8">0.8×</option>
        <option value="1">1.0×</option>
        <option value="1.2">1.2×</option>
      </select>
      {(state === 'loading' || state === 'error' || message) && (
        <span className={`csa-tts-status${state === 'error' ? ' is-error' : ''}`} role="status">
          {busy && state === 'loading' ? '发音服务正忙，正在排队…' : message}
        </span>
      )}
      {confirmLanguage && (
        <span
          className="csa-tts-language"
          role="dialog"
          aria-label="选择朗读语言"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            setConfirmLanguage(false);
            window.requestAnimationFrame(() => mainButtonRef.current?.focus());
          }}
        >
          <strong>按哪种语言朗读？</strong>
          <button ref={firstLanguageButtonRef} type="button" onClick={() => void play('en')}>English</button>
          <button type="button" onClick={() => void play('ja')}>日本語</button>
          <button
            type="button"
            onClick={() => {
              setConfirmLanguage(false);
              window.requestAnimationFrame(() => mainButtonRef.current?.focus());
            }}
          >
            取消
          </button>
        </span>
      )}
    </span>
  );
}
