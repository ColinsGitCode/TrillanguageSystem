const Kuroshiro = require('kuroshiro').default || require('kuroshiro');
const KuromojiAnalyzer = require('kuroshiro-analyzer-kuromoji');

let kuroshiroInstance = null;
const KANJI_REGEX = /[\u3400-\u9FFF々〆ヵヶ]/;

function stripNonKanjiRuby(html) {
  return String(html || '').replace(
    /<ruby>([\s\S]*?)<rt>[\s\S]*?<\/rt><\/ruby>/gi,
    (match, baseText) => (KANJI_REGEX.test(baseText) ? match : baseText)
  );
}

async function getKuroshiro() {
  if (kuroshiroInstance) return kuroshiroInstance;
  const kuroshiro = new Kuroshiro();
  await kuroshiro.init(new KuromojiAnalyzer());
  kuroshiroInstance = kuroshiro;
  return kuroshiroInstance;
}

async function toRuby(text) {
  const kuroshiro = await getKuroshiro();
  const converted = await kuroshiro.convert(text, { mode: 'furigana', to: 'hiragana' });
  return stripNonKanjiRuby(converted).replace(/<rp>.*?<\/rp>/g, '');
}

module.exports = { toRuby };
