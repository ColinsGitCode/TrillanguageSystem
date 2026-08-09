#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const localDictionaryDomain = require('../../services/storage/db/localDictionary');
const {
  buildEnglishGlossMap,
  buildSourceRef,
  readEcdictEntries,
  readJmdictEntries,
  sha256,
} = require('../../services/localGlossary/openDictionaryImport');

const sourceArg = process.argv.find((arg) => arg.startsWith('--source='));
const fileArg = process.argv.find((arg) => arg.startsWith('--file='));
const englishFileArg = process.argv.find((arg) => arg.startsWith('--ecdict-file='));
const dbArg = process.argv.find((arg) => arg.startsWith('--db='));
const scopeArg = process.argv.find((arg) => arg.startsWith('--scope='));
const maxArg = process.argv.find((arg) => arg.startsWith('--max-entries='));
const apply = process.argv.includes('--apply');
const source = sourceArg?.slice('--source='.length);
const filePath = fileArg ? path.resolve(fileArg.slice('--file='.length)) : null;
const englishFilePath = englishFileArg ? path.resolve(englishFileArg.slice('--ecdict-file='.length)) : null;
const dbPath = dbArg ? dbArg.slice('--db='.length) : undefined;
const scope = scopeArg?.slice('--scope='.length) || 'common';
const maxEntries = maxArg ? Math.max(Number(maxArg.slice('--max-entries='.length)) || 0, 0) : 0;

const SOURCES = {
  ecdict: {
    sourceId: 'ecdict',
    license: 'MIT (upstream repository; verify bundled notices before redistribution)',
    sourceUrl: 'https://github.com/skywind3000/ECDICT',
  },
  jmdict: {
    sourceId: 'jmdict-simplified',
    license: 'EDRDG JMdict license / CC BY-SA 4.0',
    sourceUrl: 'https://github.com/scriptin/jmdict-simplified',
  },
};

function usage(message) {
  if (message) console.error(message);
  console.error('用法: npm run dictionary:import:open -- --source=ecdict --file=/tmp/ecdict.csv [--scope=common|all] [--apply]');
  console.error('或:   npm run dictionary:import:open -- --source=jmdict --file=/tmp/jmdict.json --ecdict-file=/tmp/ecdict.csv [--apply]');
  process.exitCode = 1;
}

function readInput(file, optionName = '--file') {
  if (!file) throw new Error(`缺少 ${optionName}`);
  return fs.readFileSync(file);
}

function limitEntries(entries) {
  return maxEntries > 0 ? entries.slice(0, maxEntries) : entries;
}

function loadEntries() {
  if (!SOURCES[source]) throw new Error(`不支持的 source: ${source || '(empty)'}`);
  const input = readInput(filePath, '--file');
  const inputSha256 = sha256(input);
  const sourceInfo = { ...SOURCES[source], inputSha256 };
  if (source === 'ecdict') {
    return { entries: limitEntries(readEcdictEntries(input.toString('utf8'), { scope })), sourceInfo };
  }

  const englishInput = readInput(englishFilePath, '--ecdict-file');
  const englishInputSha256 = sha256(englishInput);
  const englishEntries = readEcdictEntries(englishInput.toString('utf8'), { scope: 'all' });
  const payload = JSON.parse(input.toString('utf8'));
  return {
    entries: limitEntries(readJmdictEntries(payload, {
      englishGlossMap: buildEnglishGlossMap(englishEntries),
      englishSource: {
        sourceId: SOURCES.ecdict.sourceId,
        sourceUrl: SOURCES.ecdict.sourceUrl,
        license: SOURCES.ecdict.license,
        inputSha256: englishInputSha256,
      },
    })),
    sourceInfo: { ...sourceInfo, englishInputSha256 },
  };
}

function main() {
  if (!source || !filePath) return usage('必须提供 --source 和 --file');
  const { entries, sourceInfo } = loadEntries();
  if (!entries.length) throw new Error('没有解析出可导入的词典条目，请检查文件、表头和中文释义覆盖范围');
  const version = source === 'ecdict'
    ? `ecdict-${sourceInfo.inputSha256.slice(0, 12)}`
    : `jmdict-${sourceInfo.inputSha256.slice(0, 12)}-ecdict-${sourceInfo.englishInputSha256.slice(0, 12)}`;
  const counts = entries.reduce((result, entry) => {
    result[entry.language] = (result[entry.language] || 0) + 1;
    return result;
  }, {});

  console.log(`词典来源: ${sourceInfo.sourceId}`);
  console.log(`词典版本: ${version}`);
  console.log(`许可: ${sourceInfo.license}`);
  console.log(`条目: ${entries.length} (en=${counts.en || 0}, ja=${counts.ja || 0})`);
  console.log(`模式: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  if (!apply) {
    console.log('提示: 加 --apply 才会写入 SQLite。外部词典原文件不会写入仓库。');
    return;
  }

  const { DatabaseService } = require('../../services/storage/databaseService');
  const database = new DatabaseService(dbPath);
  try {
    const now = new Date().toISOString();
    const insert = database.db.transaction(() => {
      localDictionaryDomain.retirePreviousVersions(database.db, {
        sourceId: sourceInfo.sourceId,
        dictionaryVersion: version,
        updatedAtUtc: now,
      });
      for (const entry of entries) {
        localDictionaryDomain.upsertEntry(database.db, {
          language: entry.language,
          surfaceForm: entry.surfaceForm,
          normalizedForm: entry.normalizedForm,
          lemma: entry.lemma || entry.surfaceForm,
          reading: entry.reading || null,
          partOfSpeech: entry.partOfSpeech || null,
          zhGloss: entry.zhGloss,
          senseKey: entry.senseKey || 'default',
          sourceId: sourceInfo.sourceId,
          dictionaryVersion: version,
          sourceRefJson: buildSourceRef(entry, sourceInfo),
          createdAtUtc: now,
        });
      }
    });
    insert();
    console.log('导入完成。');
  } finally {
    database.close();
  }
}

try {
  main();
} catch (error) {
  console.error(`导入失败: ${error.message}`);
  process.exitCode = 1;
}
