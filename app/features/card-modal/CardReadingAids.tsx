import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LoaderCircle, Play, Square } from 'lucide-react';
import { factoryApi } from '../factory/factory-api';
import { useExclusiveAudio } from '../../lib/audio/exclusive-audio';
import { selectionTtsApi, type SelectionTtsLanguage } from './selection-tts';
import { readingFromTokens } from './card-layout.mjs';
import type { GrammarSummary, ScenarioOutlineItem, TrilingualSummary } from './card-layout.mjs';

type Playback = { lang: SelectionTtsLanguage; status: 'loading' | 'playing' } | null;

/**
 * The three ways to say the card's phrase, side by side above the body. The
 * phrase itself had no audio before (only example sentences did), so English
 * and Japanese are voiced on demand by the selection read-aloud service, which
 * writes nothing. Chinese has no speech service in this project.
 */
export function CardSummaryStrip({ summary, generationId }: { summary: TrilingualSummary; generationId: number | null }) {
  const [playback, setPlayback] = useState<Playback>(null);
  const [error, setError] = useState('');
  const controllerRef = useRef<AbortController | null>(null);
  const blobUrlRef = useRef('');
  const audio = useExclusiveAudio();

  const configQuery = useQuery({
    queryKey: ['selection-tts', 'config'],
    queryFn: selectionTtsApi.config,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const pronunciationQuery = useQuery({
    queryKey: ['pronunciation', 'generation', generationId],
    queryFn: () => factoryApi.pronunciation('generation', Number(generationId)),
    enabled: Boolean(generationId) && !summary.jaRubyReading,
    retry: false,
  });
  const jaReading = summary.jaRubyReading || (pronunciationQuery.data
    ? readingFromTokens(pronunciationQuery.data.plainText, pronunciationQuery.data.tokens, summary.ja)
    : null);
  const voices = configQuery.data?.enabled ? configQuery.data.languages : [];

  const release = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    blobUrlRef.current = '';
  };
  useEffect(() => release, []);

  const play = async (lang: SelectionTtsLanguage, text: string) => {
    if (playback?.lang === lang) {
      release();
      audio.stop();
      setPlayback(null);
      return;
    }
    release();
    audio.stop();
    setError('');
    setPlayback({ lang, status: 'loading' });
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const result = await selectionTtsApi.synthesize({ text, language: lang, speed: 1 }, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(result.blob);
      blobUrlRef.current = url;
      await audio.playUrl(url, {
        onEnded: () => setPlayback(null),
        onError: () => { setPlayback(null); setError('播放失败，请重试'); },
        onStop: () => setPlayback((current) => (current?.lang === lang ? null : current)),
      });
      setPlayback({ lang, status: 'playing' });
    } catch {
      if (controller.signal.aborted) return;
      setPlayback(null);
      setError('发音生成失败，请重试');
    }
  };

  const voiceButton = (lang: SelectionTtsLanguage, text: string, name: string) => {
    if (!voices.includes(lang)) return null;
    const state = playback?.lang === lang ? playback.status : null;
    return (
      <button
        type="button"
        className={`card-summary-voice lang-${lang}`}
        aria-label={state === 'playing' ? `停止播放${name}` : `播放${name}`}
        aria-busy={state === 'loading'}
        onClick={() => void play(lang, text)}
      >
        {state === 'loading' ? <LoaderCircle aria-hidden="true" className="is-spinning" />
          : state === 'playing' ? <Square aria-hidden="true" /> : <Play aria-hidden="true" />}
      </button>
    );
  };

  return (
    <section className="card-summary" aria-label="三种说法" data-testid="card-summary">
      <div className="card-summary-cell lang-en">
        <header><span>英文</span>{voiceButton('en', summary.en, '英文说法')}</header>
        <p lang="en">{summary.en}</p>
      </div>
      <div className="card-summary-cell lang-ja">
        <header><span>日本語</span>{voiceButton('ja', summary.ja, '日语说法')}</header>
        <p lang="ja">
          {jaReading && <small data-testid="card-summary-reading">{jaReading}</small>}
          {summary.ja}
        </p>
      </div>
      <div className="card-summary-cell lang-zh">
        <header><span>中文</span>{summary.register && <em>{summary.register}</em>}</header>
        <p lang="zh-CN">{summary.zh}</p>
      </div>
      {error && <p className="card-summary-error" role="alert">{error}</p>}
    </section>
  );
}

/**
 * What a grammar card is about, before its sections: the grammar point and
 * its structure. No voice button: the title often mixes in Chinese, and the
 * example sentences below already have audio.
 */
export function GrammarSummaryStrip({ summary }: { summary: GrammarSummary }) {
  return (
    <section className="card-summary is-grammar" aria-label="语法要点" data-testid="card-summary">
      <div className="card-summary-cell">
        <header><span>语法点</span></header>
        <p>{summary.point}</p>
      </div>
      <div className="card-summary-cell">
        <header><span>核心结构</span></header>
        <p>{summary.structure}</p>
      </div>
    </section>
  );
}

/**
 * Jump list for a scenario card's expressions. Each is labelled by its Chinese
 * sentence, because the card itself only numbers them ("01.").
 */
export function ScenarioOutline({ items, getContentRoot, scrollRoot }: {
  items: ScenarioOutlineItem[];
  getContentRoot: () => HTMLElement | null;
  scrollRoot: HTMLElement | null;
}) {
  const [active, setActive] = useState(items[0]?.index || '');
  // A jump owns the highlight until its scroll has settled: the last few blocks
  // cannot reach the top, so reading the position would pick a neighbour. The
  // lock ends 200ms after the last scroll event, however long the scroll takes.
  const jumpLockRef = useRef({ active: false, timer: 0 });
  const holdJumpLock = (ms: number) => {
    const lock = jumpLockRef.current;
    lock.active = true;
    window.clearTimeout(lock.timer);
    lock.timer = window.setTimeout(() => { lock.active = false; }, ms);
  };
  useEffect(() => () => window.clearTimeout(jumpLockRef.current.timer), []);

  // The block nearest the top of the reading area is the current one. Read on
  // scroll rather than observed, so it does not depend on when the lazily
  // loaded card body finishes mounting.
  useEffect(() => {
    if (!scrollRoot) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      const blocks = Array.from(getContentRoot()?.querySelectorAll<HTMLElement>('.card-scenario-block') || []);
      if (!blocks.length) return;
      const top = scrollRoot.getBoundingClientRect().top + 120;
      let current = blocks[0];
      for (const block of blocks) {
        if (block.getBoundingClientRect().top <= top) current = block;
        else break;
      }
      setActive(current.dataset.blockIndex || '');
    };
    const onScroll = () => {
      if (jumpLockRef.current.active) {
        holdJumpLock(200);
        return;
      }
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    scrollRoot.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scrollRoot.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [getContentRoot, scrollRoot]);

  const jump = (index: string) => {
    const block = getContentRoot()?.querySelector<HTMLElement>(`.card-scenario-block[data-block-index="${index}"]`);
    if (!block) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    holdJumpLock(1500);
    block.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    setActive(index);
  };

  return (
    <nav className="card-scenario-outline" aria-label="场景卡目录" data-testid="card-scenario-outline">
      <p>{items.length} 个表达</p>
      <ol>
        {items.map((item) => (
          <li key={item.index}>
            <button
              type="button"
              aria-current={active === item.index ? 'true' : undefined}
              title={item.label}
              onClick={() => jump(item.index)}
            >
              <span className="card-outline-index">{item.index}</span>
              <span className="card-outline-label">{item.label}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
