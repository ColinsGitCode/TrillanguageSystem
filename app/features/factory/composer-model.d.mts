import type { CardType, GenerationJob } from './types';

export const BATCH_CARD_TYPES: Set<CardType>;
export const MEDIAN_SECONDS: Record<CardType, number>;
export function composerLines(text: string, cardType: CardType): string[];
export function detectLineLanguage(text: string): 'en' | 'ja' | null;
export function parseServerTime(value?: string | null): number | null;
export function estimateDuration(count: number, cardType: CardType): string;
export function describeJob(
  job: GenerationJob,
  jobs: GenerationJob[],
  now: number,
): { tone: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'; text: string };
