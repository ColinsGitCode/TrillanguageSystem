// Pure rules for the optional always-on reading layer (显示注音), kept in plain
// JavaScript so the unit tests can load them without a TypeScript toolchain.

const KANJI_RE = /[㐀-䶿一-鿿豈-﫿々〆]/u;

/**
 * Whether a word gets its reading printed above it when readings are shown.
 * Only words with kanji do: kana already is the reading, and a hiragana line
 * over アイデア or プレゼン repeats the word in another script. Older cards
 * carried such readings inline, so they came through as tokens.
 */
export function showsReadingAbove(surface, readingHiragana) {
  const reading = String(readingHiragana || '').trim();
  const text = String(surface || '');
  return Boolean(reading) && reading !== text && KANJI_RE.test(text);
}
