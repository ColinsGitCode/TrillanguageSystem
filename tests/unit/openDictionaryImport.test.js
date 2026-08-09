'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildEnglishGlossMap,
  compactChineseGloss,
  readEcdictEntries,
  readJmdictEntries,
} = require('../../services/localGlossary/openDictionaryImport');

test('compacts ECDICT literal newline markers and part-of-speech prefixes', () => {
  assert.equal(compactChineseGloss('n. 维护, 保持\\n[计] 维护; 维修'), '维护, 保持；维护; 维修');
});

test('parses quoted ECDICT rows and keeps the short Chinese gloss', () => {
  const csv = [
    'word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio',
    'maintenance,meɪntənəns,"n. upkeep","n. 维护, 保持, 维修\n[计] 维护",n.,2,1,cet4,100,100,,,',
  ].join('\n');
  const [entry] = readEcdictEntries(csv, { scope: 'all' });
  assert.equal(entry.normalizedForm, 'maintenance');
  assert.equal(entry.zhGloss, '维护, 保持, 维修；维护');
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
  assert.equal(kanjiEntry.zhGloss, '日程；安排');
  assert.equal(kanaEntry.reading, 'よていひょう');
});
