#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseService } = require('../../services/storage/databaseService');

const apply = process.argv.includes('--apply');
const fileArg = process.argv.find((arg) => arg.startsWith('--file='));
const dbArg = process.argv.find((arg) => arg.startsWith('--db='));
const filePath = fileArg ? path.resolve(fileArg.slice('--file='.length)) : null;
const dbPath = dbArg ? dbArg.slice('--db='.length) : undefined;

function readCatalog() {
  if (!filePath) throw new Error('用法: npm run dictionary:import -- --file=/path/catalog.json [--db=path] [--apply]');
  const catalog = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!catalog.version || !catalog.sourceId || !Array.isArray(catalog.entries) || !catalog.entries.length) {
    throw new Error('词典文件必须包含 version、sourceId 和非空 entries');
  }
  return catalog;
}

function validateEntry(entry, index) {
  for (const field of ['language', 'surfaceForm', 'normalizedForm', 'zhGloss']) {
    if (!String(entry[field] || '').trim()) throw new Error(`第 ${index + 1} 条缺少 ${field}`);
  }
  if (!['en', 'ja'].includes(entry.language)) throw new Error(`第 ${index + 1} 条 language 必须是 en 或 ja`);
}

function main() {
  const catalog = readCatalog();
  catalog.entries.forEach(validateEntry);
  const counts = catalog.entries.reduce((result, entry) => {
    result[entry.language] = (result[entry.language] || 0) + 1;
    return result;
  }, {});
  console.log(`词典版本: ${catalog.version}`);
  console.log(`来源: ${catalog.sourceId}`);
  console.log(`条目: ${catalog.entries.length} (en=${counts.en || 0}, ja=${counts.ja || 0})`);
  console.log(`模式: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  if (!apply) {
    console.log('提示: 加 --apply 才会写入 SQLite。');
    return;
  }

  const database = new DatabaseService(dbPath);
  try {
    const now = new Date().toISOString();
    const upsert = database.db.transaction(() => {
      for (const entry of catalog.entries) {
        database.upsertLocalDictionaryEntry({
          language: entry.language,
          surfaceForm: entry.surfaceForm,
          normalizedForm: entry.normalizedForm,
          lemma: entry.lemma || entry.surfaceForm,
          reading: entry.reading || null,
          partOfSpeech: entry.partOfSpeech || null,
          zhGloss: entry.zhGloss,
          senseKey: entry.senseKey || 'default',
          sourceId: catalog.sourceId,
          dictionaryVersion: catalog.version,
          sourceRefJson: JSON.stringify({ license: catalog.license || 'unspecified', catalog: catalog.version }),
          createdAtUtc: now,
        });
      }
    });
    upsert();
    console.log('导入完成。');
  } finally {
    database.close();
  }
}

main();
