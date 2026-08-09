'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseService } = require('../../services/storage/databaseService');
const { readCatalog } = require('../../services/localGlossary/localDictionaryCatalog');
const { LocalGlossaryService } = require('../../services/localGlossary/localGlossaryService');

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
