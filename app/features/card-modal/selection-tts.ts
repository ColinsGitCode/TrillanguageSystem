import { ApiError } from '../../lib/api/client';
import {
  inferSelectionTtsLanguage,
  selectionCodePointLength,
} from './selection-tts-domain.mjs';

export type SelectionTtsLanguage = 'en' | 'ja';
export type SelectionTtsSpeed = 0.8 | 1 | 1.2;

export { inferSelectionTtsLanguage, selectionCodePointLength };

export type SelectionTtsAudio = {
  blob: Blob;
  cacheStatus: 'HIT' | 'MISS' | 'BYPASS';
  contended: boolean;
  queueWaitMs: number;
  provider: string;
  model: string;
  voice: string;
};

export const selectionTtsApi = {
  config: async () => {
    const response = await fetch('/api/tts/selection');
    const payload = await response.json();
    if (!response.ok) throw new ApiError(payload?.error || '无法读取朗读配置', response.status, payload);
    return payload as {
      success: true;
      enabled: boolean;
      languages: SelectionTtsLanguage[];
      speeds: SelectionTtsSpeed[];
      maxChars: number;
    };
  },
  synthesize: async (
    payload: { text: string; language: SelectionTtsLanguage; speed: SelectionTtsSpeed },
    signal: AbortSignal
  ): Promise<SelectionTtsAudio> => {
    const response = await fetch('/api/tts/selection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
    if (!response.ok) {
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      const message = typeof body === 'object' && body && 'error' in body
        ? String((body as { error: unknown }).error)
        : '发音生成失败';
      throw new ApiError(message, response.status, body);
    }
    return {
      blob: await response.blob(),
      cacheStatus: (response.headers.get('x-tts-cache') || 'MISS') as SelectionTtsAudio['cacheStatus'],
      contended: response.headers.get('x-tts-contended') === '1',
      queueWaitMs: Number(response.headers.get('x-tts-queue-wait-ms') || 0),
      provider: response.headers.get('x-tts-provider') || '',
      model: response.headers.get('x-tts-model') || '',
      voice: response.headers.get('x-tts-voice') || '',
    };
  },
};
