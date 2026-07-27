import { useCallback, useEffect, useRef } from 'react';

type ActivePlayback = {
  owner: symbol;
  stop: () => void;
};

let activePlayback: ActivePlayback | null = null;

export function claimExclusiveAudio(owner: symbol, stop: () => void) {
  if (activePlayback?.owner !== owner) activePlayback?.stop();
  activePlayback = { owner, stop };
}

export function releaseExclusiveAudio(owner: symbol) {
  if (activePlayback?.owner === owner) activePlayback = null;
}

export function useExclusiveAudio() {
  const ownerRef = useRef(Symbol('audio-playback'));
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    cleanupRef.current?.();
    cleanupRef.current = null;
    releaseExclusiveAudio(ownerRef.current);
  }, []);

  const playUrl = useCallback(async (
    url: string,
    options: {
      onEnded?: () => void;
      onError?: () => void;
      onStop?: () => void;
    } = {}
  ) => {
    stop();
    const audio = new Audio(url);
    audioRef.current = audio;
    const finish = (kind: 'ended' | 'error' | 'stop') => {
      if (audioRef.current !== audio) return;
      audioRef.current = null;
      if (kind === 'ended') options.onEnded?.();
      else if (kind === 'error') options.onError?.();
      else options.onStop?.();
      cleanupRef.current = null;
      releaseExclusiveAudio(ownerRef.current);
    };
    cleanupRef.current = () => options.onStop?.();
    audio.addEventListener('ended', () => finish('ended'), { once: true });
    audio.addEventListener('error', () => finish('error'), { once: true });
    claimExclusiveAudio(ownerRef.current, stop);
    try {
      await audio.play();
      return audio;
    } catch (error) {
      finish('error');
      throw error;
    }
  }, [stop]);

  const claimElement = useCallback((element: HTMLAudioElement) => {
    stop();
    audioRef.current = element;
    claimExclusiveAudio(ownerRef.current, stop);
  }, [stop]);

  useEffect(() => stop, [stop]);

  return {
    audioRef,
    claimElement,
    isPlaying: () => Boolean(audioRef.current && !audioRef.current.paused),
    playUrl,
    stop,
  };
}
