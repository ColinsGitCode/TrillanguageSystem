'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildEnglishGlossMap,
  compactChineseGloss,
  readEcdictEntries,
  readJmdictEntries,
  readZhwiktionaryEntry,
} = require('../../services/localGlossary/openDictionaryImport');

test('compacts ECDICT literal newline markers and part-of-speech prefixes', () => {
  assert.equal(compactChineseGloss('n. 维护, 保持\\n[计] 维护; 维修'), '维护');
});

test('parses quoted ECDICT rows and keeps the short Chinese gloss', () => {
  const csv = [
    'word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio',
    'maintenance,meɪntənəns,"n. upkeep","n. 维护, 保持, 维修\n[计] 维护",n.,2,1,cet4,100,100,,,',
  ].join('\n');
  const [entry] = readEcdictEntries(csv, { scope: 'all' });
  assert.equal(entry.normalizedForm, 'maintenance');
  assert.equal(entry.zhGloss, '维护');
  assert.equal(entry.partOfSpeech, 'n.');
});

test('common ECDICT scope keeps useful learning vocabulary', () => {
  const csv = [
    'word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio',
    'maintenance,,,"维护",n.,2,0,,,,,,,',
    'obscure,,,"晦涩",adj.,0,0,,,,,,,',
  ].join('\n');
  const entries = readEcdictEntries(csv, { scope: 'common' });
  assert.deepEqual(entries.map((entry) => entry.normalizedForm), ['maintenance']);
});

test('accepts reduced ECDICT columns when required fields are present', () => {
  const entries = readEcdictEntries([
    'word,translation',
    'maintenance,"n. 维护"',
  ].join('\n'), { scope: 'all' });
  assert.equal(entries[0].zhGloss, '维护');
  assert.equal(entries[0].reading, null);
  assert.equal(entries[0].partOfSpeech, 'n.');
});

test('rejects ECDICT input with a clear required-column error', () => {
  assert.throws(
    () => readEcdictEntries('word,phonetic\nmaintenance,foo', { scope: 'all' }),
    /ECDICT CSV 缺少必需列: translation/u,
  );
});

test('maps JMdict English glosses to Chinese only when ECDICT has a match', () => {
  const ecdict = readEcdictEntries([
    'word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio',
    'schedule,,,"日程；安排",n.,1,1,,,,,,,',
  ].join('\n'), { scope: 'all' });
  const entries = readJmdictEntries({
    words: [{
      id: '100',
      kanji: [{ text: '予定表', common: true }],
      kana: [{ text: 'よていひょう', appliesToKanji: ['予定表'] }],
      sense: [
        { partOfSpeech: ['n'], gloss: [{ lang: 'eng', text: 'schedule' }] },
      ],
    }, {
      id: '101',
      kanji: [{ text: '未収録', common: true }],
      kana: [{ text: 'みしゅうろく', appliesToKanji: ['未収録'] }],
      sense: [
        { partOfSpeech: ['n'], gloss: [{ lang: 'eng', text: 'unmapped gloss' }] },
      ],
    }],
  }, { englishGlossMap: buildEnglishGlossMap(ecdict) });

  assert.equal(entries.length, 2);
  const kanjiEntry = entries.find((entry) => entry.surfaceForm === '予定表');
  const kanaEntry = entries.find((entry) => entry.surfaceForm === 'よていひょう');
  assert.equal(kanjiEntry.reading, 'よていひょう');
  assert.equal(kanjiEntry.zhGloss, '日程');
  assert.equal(kanaEntry.reading, 'よていひょう');
});

test('parses direct Japanese to Chinese Wiktionary senses with a whole-word reading', () => {
  const entries = readZhwiktionaryEntry({
    word: '手紙',
    lang_code: 'ja',
    pos: 'noun',
    pos_title: '名詞',
    forms: [{ form: '手紙', tags: ['canonical'], ruby: [['手', 'て'], ['紙', 'がみ']] }],
    senses: [
      { id: 'zh-test-1', glosses: ['信，信件。'] },
      { id: 'zh-test-2', glosses: ['箋'], tags: ['archaic'] },
    ],
  });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].reading, 'てがみ');
  assert.equal(entries[0].zhGloss, '信，信件');
  assert.equal(entries[0].sourceRef.directTranslation, true);
  assert.equal(entries[0].sourceRef.chineseNormalization, 'opencc-js-t-to-cn-v1');
});

test('normalizes direct Wiktionary glosses to Simplified Chinese during import', () => {
  const [entry] = readZhwiktionaryEntry({
    word: '会議',
    lang_code: 'ja',
    pos_title: '名詞',
    senses: [{ id: 'zh-test-4', glosses: ['可供參考的會議資料。'] }],
  });
  assert.equal(entry.zhGloss, '可供参考的会议资料');
});

test('keeps kana outside ruby bases when deriving mixed-script readings', () => {
  const [entry] = readZhwiktionaryEntry({
    word: '食べる',
    lang_code: 'ja',
    pos: 'verb',
    forms: [{ form: '食べる', tags: ['canonical'], ruby: [['食', 'た']] }],
    senses: [{ id: 'zh-test-3', glosses: ['吃'] }],
  });
  assert.equal(entry.reading, 'たべる');
});
