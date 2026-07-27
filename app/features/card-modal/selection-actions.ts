import type { KnowledgeKind } from '../knowledge/types';

export type CardLookupLanguage = 'en' | 'ja';

const JAPANESE_KANA = /[\u3040-\u30ff]/u;
const LATIN = /[A-Za-z]/u;
const HAN = /[\p{Script=Han}々〆ヵヶ]/u;
const PHRASE_PUNCTUATION = /[。！？!?、,;；:：]/u;

export function inferLookupLanguage(text: string): CardLookupLanguage | null {
  const normalized = String(text || '').trim();
  if (!normalized) return null;
  if (JAPANESE_KANA.test(normalized)) return 'ja';
  if (LATIN.test(normalized) && !HAN.test(normalized)) return 'en';
  // A kanji-only selection is ambiguous between Japanese and Chinese. CA-I1
  // requires an explicit user choice before recording an append-only KG lookup.
  return null;
}
export function inferLookupKind(text: string, language: CardLookupLanguage | null): KnowledgeKind {
  const normalized = String(text || '').trim();
  if (!normalized) return 'lexeme';
  if (language === 'en') return /\s/u.test(normalized) ? 'phrase' : 'lexeme';
  return normalized.length > 12 || PHRASE_PUNCTUATION.test(normalized) ? 'phrase' : 'lexeme';
}

export function isKeyboardSelectionKey(key: string): boolean {
  return [
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Home',
    'End',
    'PageUp',
    'PageDown',
  ].includes(key);
}
