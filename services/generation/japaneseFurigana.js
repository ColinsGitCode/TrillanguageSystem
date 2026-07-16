const Kuroshiro = require('kuroshiro').default || require('kuroshiro');
const KuromojiAnalyzer = require('kuroshiro-analyzer-kuromoji');

let kuroshiroInstance = null;
let kuroshiroInitPromise = null;
let kuromojiAnalyzerInstance = null;
const KANJI_REGEX = /[\u3400-\u9FFF々〆ヵヶ]/;

function stripNonKanjiRuby(html) {
  return String(html || '').replace(
    /<ruby>([\s\S]*?)<rt>[\s\S]*?<\/rt><\/ruby>/gi,
    (match, baseText) => (KANJI_REGEX.test(baseText) ? match : baseText)
  );
}

async function getKuroshiro() {
  if (kuroshiroInstance) return kuroshiroInstance;
  if (!kuroshiroInitPromise) {
    kuroshiroInitPromise = (async () => {
      const kuroshiro = new Kuroshiro();
      const analyzer = new KuromojiAnalyzer();
      await kuroshiro.init(analyzer);
      kuromojiAnalyzerInstance = analyzer;
      kuroshiroInstance = kuroshiro;
      return kuroshiro;
    })();
  }
  return kuroshiroInitPromise;
}

async function analyzeJapaneseTokens(text) {
  await getKuroshiro();
  return kuromojiAnalyzerInstance.parse(String(text || ''));
}

async function toRuby(text) {
  const kuroshiro = await getKuroshiro();
  const converted = await kuroshiro.convert(text, { mode: 'furigana', to: 'hiragana' });
  return stripNonKanjiRuby(converted).replace(/<rp>.*?<\/rp>/g, '');
}

module.exports = { analyzeJapaneseTokens, toRuby };
