const KANA = /[\u3040-\u30ff]/u;
const LATIN = /[A-Za-z]/u;
const HAN = /[\p{Script=Han}々〆ヵヶ]/u;

export function inferSelectionTtsLanguage(text) {
  const normalized = String(text || '').trim();
  if (!normalized) return null;
  if (KANA.test(normalized)) return 'ja';
  if (LATIN.test(normalized) && !HAN.test(normalized)) return 'en';
  return null;
}

export function selectionCodePointLength(text) {
  return Array.from(String(text || '')).length;
}
