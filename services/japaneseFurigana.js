const Kuroshiro = require('kuroshiro').default || require('kuroshiro');
const KuromojiAnalyzer = require('kuroshiro-analyzer-kuromoji');

let kuroshiroInstance = null;

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
  return converted.replace(/<rp>.*?<\/rp>/g, '');
}

module.exports = { toRuby };
