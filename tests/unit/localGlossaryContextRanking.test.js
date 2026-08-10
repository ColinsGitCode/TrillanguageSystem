'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  inferContextPartOfSpeech,
  partOfSpeechMatches,
  rankDictionaryEntries,
} = require('../../services/localGlossary/localGlossaryService');

function entry(overrides) {
  return {
    id: 1,
    language: 'ja',
    normalizedForm: 'x',
    zhGloss: 'gloss',
    reading: null,
    partOfSpeech: null,
    sourceId: 'jmdict-simplified',
    sourceRef: {},
    ...overrides,
  };
}

test.describe('DIC-R2 part-of-speech tag matching', () => {
  test.it('matches the tag shapes the real dictionaries actually store', () => {
    // ECDICT writes "n." / "vt.", JMdict writes "n, vs, vt" / "adj-i", and the
    // Chinese Wiktionary extraction writes traditional 名詞 / 動詞.
    assert.equal(partOfSpeechMatches('n.', 'noun'), true);
    assert.equal(partOfSpeechMatches('noun phrase', 'noun'), true);
    assert.equal(partOfSpeechMatches('名詞', 'noun'), true);
    assert.equal(partOfSpeechMatches('名词', 'noun'), true);
    assert.equal(partOfSpeechMatches('vt.', 'verb'), true);
    assert.equal(partOfSpeechMatches('vi.', 'verb'), true);
    assert.equal(partOfSpeechMatches('動詞', 'verb'), true);
    assert.equal(partOfSpeechMatches('adj-i', 'adjective'), true);
    assert.equal(partOfSpeechMatches('n, adj-no', 'adjective'), true);
  });

  test.it('keeps a suru-noun matching both noun and verb', () => {
    assert.equal(partOfSpeechMatches('n, vs, vt', 'noun'), true);
    assert.equal(partOfSpeechMatches('n, vs, vt', 'verb'), true);
  });

  test.it('does not treat adverbs as adjectives or unknown tags as anything', () => {
    assert.equal(partOfSpeechMatches('adv', 'adjective'), false);
    assert.equal(partOfSpeechMatches('adv.', 'noun'), false);
    assert.equal(partOfSpeechMatches('unknown', 'noun'), false);
    assert.equal(partOfSpeechMatches('unknown', 'verb'), false);
    assert.equal(partOfSpeechMatches('', 'noun'), false);
    assert.equal(partOfSpeechMatches(null, 'verb'), false);
  });
});

test.describe('DIC-R2 English context inference', () => {
  test.it('separates noun, verb and adjective readings of the same word', () => {
    assert.equal(inferContextPartOfSpeech('en', 'the book fell off the shelf', 'book'), 'noun');
    assert.equal(inferContextPartOfSpeech('en', 'I want to book a room', 'book'), 'verb');
    assert.equal(inferContextPartOfSpeech('en', 'she will book it', 'book'), 'verb');
    assert.equal(inferContextPartOfSpeech('en', 'we spring into action', 'spring'), 'verb');
    assert.equal(inferContextPartOfSpeech('en', 'in spring the garden wakes', 'spring'), 'noun');
    assert.equal(inferContextPartOfSpeech('en', 'it is fresh', 'fresh'), 'adjective');
    assert.equal(inferContextPartOfSpeech('en', 'very light box', 'light'), 'adjective');
  });

  test.it('separates an attributive adjective from a subject noun after a determiner', () => {
    // "the public schedule" modifies the following noun; "the book fell" does not.
    assert.equal(inferContextPartOfSpeech('en', 'the public schedule', 'public'), 'adjective');
    assert.equal(inferContextPartOfSpeech('en', 'the book fell off the shelf', 'book'), 'noun');
    assert.equal(inferContextPartOfSpeech('en', 'the watch is expensive', 'watch'), 'noun');
    assert.equal(inferContextPartOfSpeech('en', 'please check the schedule', 'schedule'), 'noun');
  });

  test.it('reads a destination after a motion verb as a noun, not an infinitive', () => {
    assert.equal(inferContextPartOfSpeech('en', 'he went to school', 'school'), 'noun');
    assert.equal(inferContextPartOfSpeech('en', 'we want to school him', 'school'), 'verb');
  });

  test.it('treats a sentence-initial verb before a determiner as imperative', () => {
    assert.equal(inferContextPartOfSpeech('en', 'Book a room now', 'book'), 'verb');
    assert.equal(inferContextPartOfSpeech('en', 'Spring is coming', 'spring'), 'noun');
  });

  test.it('returns null rather than guessing when no cue is present', () => {
    // A wrong hint actively reorders candidates toward the wrong sense, so an
    // absent cue must stay absent.
    assert.equal(inferContextPartOfSpeech('en', '', 'book'), null);
    assert.equal(inferContextPartOfSpeech('en', 'completely unrelated text', 'book'), null);
    assert.equal(inferContextPartOfSpeech('en', 'public schedule today', 'public schedule'), null);
  });
});

test.describe('DIC-R2 Japanese context inference', () => {
  test.it('uses the following particle to pick noun, verb or adjective', () => {
    assert.equal(inferContextPartOfSpeech('ja', '本を読みます', '本'), 'noun');
    assert.equal(inferContextPartOfSpeech('ja', '春がきた', '春'), 'noun');
    assert.equal(inferContextPartOfSpeech('ja', '学校に行く', '学校'), 'noun');
    assert.equal(inferContextPartOfSpeech('ja', 'これは本です', '本'), 'noun');
    assert.equal(inferContextPartOfSpeech('ja', '毎日勉強する', '勉強'), 'verb');
    assert.equal(inferContextPartOfSpeech('ja', '会社が上場した', '上場'), 'verb');
    assert.equal(inferContextPartOfSpeech('ja', '静かな部屋', '静か'), 'adjective');
  });

  test.it('returns null when the term is absent or sentence-final', () => {
    assert.equal(inferContextPartOfSpeech('ja', '別の文です', '勉強'), null);
    assert.equal(inferContextPartOfSpeech('ja', '勉強', '勉強'), null);
  });
});

test.describe('DIC-R2 ranking with context', () => {
  test.it('promotes the sense whose part of speech the context implies', () => {
    const entries = [
      entry({ id: 1, normalizedForm: '上場', partOfSpeech: 'n', zhGloss: '上市场所' }),
      entry({ id: 2, normalizedForm: '上場', partOfSpeech: 'n, vs, vi', zhGloss: '股票上市' }),
    ];
    const options = { language: 'ja', text: '上場', forms: ['上場'], reading: '' };
    assert.equal(rankDictionaryEntries(entries, { ...options, context: '' })[0].zhGloss, '上市场所');
    assert.equal(rankDictionaryEntries(entries, { ...options, context: '会社が上場する' })[0].zhGloss, '股票上市');
  });

  test.it('keeps an English-pivoted bridge gloss low confidence even when context matches', () => {
    const entries = [
      entry({
        id: 3,
        normalizedForm: '手紙',
        partOfSpeech: 'n',
        zhGloss: '信；字母',
        sourceRef: { translationPath: 'jmdict-simplified-eng-to-ecdict-zh' },
      }),
    ];
    const ranked = rankDictionaryEntries(entries, {
      language: 'ja', text: '手紙', forms: ['手紙'], reading: '', context: '手紙を書く',
    });
    assert.equal(ranked[0].confidence, 'low');
    assert.equal(ranked[0].sourceDetail, 'JMdict · 英中桥接');
  });

  test.it('leaves ordering untouched when the context carries no usable cue', () => {
    const entries = [
      entry({ id: 1, normalizedForm: '花', partOfSpeech: 'n', zhGloss: '花' }),
      entry({ id: 2, normalizedForm: '花', partOfSpeech: 'n', zhGloss: '樱花' }),
    ];
    const options = { language: 'ja', text: '花', forms: ['花'], reading: '' };
    const withoutContext = rankDictionaryEntries(entries, { ...options, context: '' });
    const withNoise = rankDictionaryEntries(entries, { ...options, context: '無関係な文章' });
    assert.deepEqual(withNoise.map((item) => item.zhGloss), withoutContext.map((item) => item.zhGloss));
  });
});
