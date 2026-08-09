'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseService } = require('../../services/storage/databaseService');
const { readCatalog } = require('../../services/localGlossary/localDictionaryCatalog');
const { LocalGlossaryService } = require('../../services/localGlossary/localGlossaryService');
const localDictionaryDomain = require('../../services/storage/db/localDictionary');

test('loads the versioned local English/Japanese starter dictionary into SQLite', () => {
  const database = new DatabaseService(':memory:');
  try {
    const catalog = readCatalog();
    const count = database.db.prepare(
      'SELECT COUNT(*) AS count FROM local_dictionary_entries WHERE dictionary_version = ?'
    ).get(catalog.version).count;
    assert.equal(Number(count), catalog.entries.length);
    assert.equal(database.findLocalDictionaryEntry('en', ['public schedule']).zhGloss, '公共日程；共享日历');
    assert.equal(database.findLocalDictionaryEntry('ja', ['勤務表']).reading, 'きんむひょう');
  } finally {
    database.close();
  }
});

test('returns a simple dictionary gloss without writing glossary or learning data', async () => {
  const database = new DatabaseService(':memory:');
  try {
    const service = new LocalGlossaryService({ database, llmEnabled: false });
    const result = await service.lookup({ language: 'en', text: 'public schedule' });
    assert.equal(result.status, 'exact');
    assert.equal(result.gloss.sourceKind, 'dictionary');
    assert.equal(result.gloss.zhGloss, '公共日程；共享日历');
    assert.equal(result.gloss.partOfSpeech, 'noun phrase');
    assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM local_glossary_entries').get().count, 0);
    assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM local_glossary_proposals').get().count, 0);
  } finally {
    database.close();
  }
});

test('uses the Japanese dictionary form as a conservative candidate', async () => {
  const database = new DatabaseService(':memory:');
  try {
    const service = new LocalGlossaryService({ database, llmEnabled: false });
    const result = await service.lookup({ language: 'ja', text: '食べた' });
    assert.equal(result.status, 'candidate');
    assert.equal(result.gloss.sourceKind, 'dictionary');
    assert.equal(result.gloss.reading, 'たべる');
    assert.equal(result.gloss.zhGloss, '吃');
  } finally {
    database.close();
  }
});

test('uses sentence context to prefer the adjectival sense of an English homograph', async () => {
  const database = new DatabaseService(':memory:');
  try {
    const service = new LocalGlossaryService({ database, llmEnabled: false });
    const result = await service.lookup({
      language: 'en',
      text: 'public',
      context: 'Add the team meeting to the public schedule.',
    });
    assert.equal(result.gloss.zhGloss, '公共的；公开的');
    assert.equal(result.gloss.partOfSpeech, 'adjective');
    assert.equal(result.gloss.matchReason, 'context');
    assert.equal(result.gloss.confidence, 'high');
    assert.ok(result.alternatives.some((entry) => entry.zhGloss === '公众；民众'));
  } finally {
    database.close();
  }
});

test('uses a pronunciation reading to distinguish Japanese homographs', async () => {
  const database = new DatabaseService(':memory:');
  try {
    const service = new LocalGlossaryService({ database, llmEnabled: false });
    const book = await service.lookup({ language: 'ja', text: '本', reading: 'ほん' });
    const origin = await service.lookup({ language: 'ja', text: '本', reading: 'もと' });
    assert.equal(book.gloss.zhGloss, '书；书本');
    assert.equal(book.gloss.matchReason, 'reading');
    assert.equal(origin.gloss.zhGloss, '根源；基础');
    assert.equal(origin.gloss.matchReason, 'reading');
    assert.ok(book.alternatives.some((entry) => entry.reading === 'もと'));
  } finally {
    database.close();
  }
});

test('keeps an alternative Japanese reading visible when one reading has many senses', async () => {
  const database = new DatabaseService(':memory:');
  try {
    const base = {
      language: 'ja',
      surfaceForm: '本',
      normalizedForm: '本',
      lemma: '本',
      partOfSpeech: '名词',
      sourceId: 'jmdict-simplified',
      sourceRefJson: JSON.stringify({ translationPath: 'jmdict-simplified-eng-to-ecdict-zh' }),
      dictionaryVersion: 'jmdict-test',
      createdAtUtc: '2026-08-09T00:00:00.000Z',
    };
    ['书籍', '卷册', '正本', '书本', '著作'].forEach((zhGloss, index) => {
      localDictionaryDomain.upsertEntry(database.db, {
        ...base,
        reading: 'ほん',
        zhGloss,
        senseKey: `hon-${index}`,
      });
    });
    const service = new LocalGlossaryService({ database, llmEnabled: false });
    const result = await service.lookup({ language: 'ja', text: '本', reading: 'ほん' });
    assert.equal(result.gloss.zhGloss, '书；书本');
    assert.equal(result.alternatives.length, 4);
    assert.ok(result.alternatives.some((entry) => entry.reading === 'もと'));
  } finally {
    database.close();
  }
});

test('retires prior open-dictionary versions and returns the exact upserted row', () => {
  const database = new DatabaseService(':memory:');
  try {
    const base = {
      language: 'en',
      surfaceForm: 'book',
      normalizedForm: 'book',
      lemma: 'book',
      reading: null,
      partOfSpeech: 'n.',
      zhGloss: '书',
      senseKey: 'default',
      sourceId: 'ecdict',
      sourceRefJson: '{}',
      createdAtUtc: '2026-08-09T00:00:00.000Z',
    };
    const first = localDictionaryDomain.upsertEntry(database.db, {
      ...base,
      dictionaryVersion: 'ecdict-v1',
    });
    const second = localDictionaryDomain.upsertEntry(database.db, {
      ...base,
      dictionaryVersion: 'ecdict-v2',
      zhGloss: '预订',
    });
    assert.equal(first.dictionaryVersion, 'ecdict-v1');
    assert.equal(second.dictionaryVersion, 'ecdict-v2');

    const retired = localDictionaryDomain.retirePreviousVersions(database.db, {
      sourceId: 'ecdict',
      dictionaryVersion: 'ecdict-v2',
      updatedAtUtc: '2026-08-09T00:01:00.000Z',
    });
    assert.equal(retired, 1);
    assert.equal(database.findLocalDictionaryEntry('en', ['book']).dictionaryVersion, 'ecdict-v2');
    assert.equal(database.db.prepare(
      "SELECT status FROM local_dictionary_entries WHERE dictionary_version = 'ecdict-v1'"
    ).get().status, 'retired');
  } finally {
    database.close();
  }
});

test('marks Japanese English-bridge dictionary glosses as low confidence', async () => {
  const database = new DatabaseService(':memory:');
  try {
    localDictionaryDomain.upsertEntry(database.db, {
      language: 'ja',
      surfaceForm: '手紙',
      normalizedForm: '手紙',
      lemma: '手紙',
      reading: 'てがみ',
      partOfSpeech: 'n',
      zhGloss: '信',
      senseKey: '100:0',
      sourceId: 'jmdict-simplified',
      dictionaryVersion: 'jmdict-test-ecdict-test',
      sourceRefJson: JSON.stringify({ translationPath: 'jmdict-simplified-eng-to-ecdict-zh' }),
      createdAtUtc: '2026-08-09T00:00:00.000Z',
    });
    const service = new LocalGlossaryService({ database, llmEnabled: false });
    const result = await service.lookup({ language: 'ja', text: '手紙' });
    assert.equal(result.gloss.confidence, 'low');
    assert.equal(result.gloss.zhGloss, '信');
    assert.equal(result.gloss.sourceDetail, 'JMdict · 英中桥接');
  } finally {
    database.close();
  }
});

test('prefers a direct Japanese-Chinese entry over the English bridge fallback', async () => {
  const database = new DatabaseService(':memory:');
  try {
    const base = {
      language: 'ja', surfaceForm: '手紙', normalizedForm: '手紙', lemma: '手紙',
      reading: 'てがみ', partOfSpeech: '名詞', createdAtUtc: '2026-08-09T00:00:00.000Z',
    };
    localDictionaryDomain.upsertEntry(database.db, {
      ...base,
      zhGloss: '信', senseKey: 'bridge', sourceId: 'jmdict-simplified',
      dictionaryVersion: 'jmdict-test',
      sourceRefJson: JSON.stringify({ translationPath: 'jmdict-simplified-eng-to-ecdict-zh' }),
    });
    localDictionaryDomain.upsertEntry(database.db, {
      ...base,
      zhGloss: '信，信件', senseKey: 'direct', sourceId: 'zhwiktionary-ja-direct',
      dictionaryVersion: 'zhwiktionary-test',
      sourceRefJson: JSON.stringify({ directTranslation: true }),
    });
    const service = new LocalGlossaryService({ database, llmEnabled: false });
    const result = await service.lookup({ language: 'ja', text: '手紙', reading: 'てがみ' });
    assert.equal(result.gloss.zhGloss, '信，信件');
    assert.equal(result.gloss.sourceDetail, '中文维基词典 · 直接日中');
    assert.equal(result.gloss.confidence, 'medium');
    assert.ok(result.alternatives.some((entry) => entry.sourceDetail === 'JMdict · 英中桥接'));
  } finally {
    database.close();
  }
});

test('reports active and retired dictionary source versions for the management page', () => {
  const database = new DatabaseService(':memory:');
  try {
    const stats = database.listLocalDictionarySourceStats();
    assert.ok(stats.some((entry) => entry.sourceId === 'three-lans-curated-starter'));
    assert.ok(stats.every((entry) => Number.isInteger(entry.entryCount) && entry.entryCount > 0));
  } finally {
    database.close();
  }
});
