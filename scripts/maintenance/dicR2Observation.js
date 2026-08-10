#!/usr/bin/env node
'use strict';

// DIC-R2 observation: measures disambiguation accuracy before and after the
// DIC-R2 context ranking, over a fixed labelled case set.
//
// Read-only. Opens SQLite with readonly:true and never writes, so it is safe to
// point at a live records database.
//
//   node scripts/maintenance/dicR2Observation.js --db=/path/to/records.db
//   node scripts/maintenance/dicR2Observation.js --db=... --report=/tmp/dic-r2.json

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const localDictionaryDomain = require('../../services/storage/db/localDictionary');
const { rankDictionaryEntries } = require('../../services/localGlossary/localGlossaryService');
const { compare, scoreCase, summarize } = require('../../services/localGlossary/dictionaryEvaluation');

const DEFAULT_CASES = path.join(__dirname, 'fixtures/dicR2EvaluationCases.json');

function argValue(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

// The pre-DIC-R2 behaviour, kept here rather than in the service so the shipped
// code carries only one ranking path. This is the baseline the report compares
// against: English-only context inference, and a tag regex that could not match
// "adj-i" or any traditional-Chinese part-of-speech label.
function legacyRank(entries, options) {
  const legacyEntries = entries.map((entry) => ({
    ...entry,
    partOfSpeech: legacyVisiblePartOfSpeech(entry.partOfSpeech),
  }));
  return rankDictionaryEntries(legacyEntries, {
    ...options,
    context: options.language === 'en' ? legacyEnglishContext(options) : '',
  });
}

function legacyVisiblePartOfSpeech(partOfSpeech) {
  const value = String(partOfSpeech || '');
  const matchedNoun = /(^|[\s,])(?:n\.?|noun)(?=$|[\s,])|名词/u.test(value.toLocaleLowerCase('en-US'));
  const matchedAdjective = /(^|[\s,])(?:adj\.?|adjective)(?=$|[\s,])|形容词/u.test(value.toLocaleLowerCase('en-US'));
  if (matchedNoun) return 'n';
  if (matchedAdjective) return 'adj';
  return 'unmatched-legacy-tag';
}

function legacyEnglishContext(options) {
  const context = String(options.context || '').normalize('NFKC').toLocaleLowerCase('en-US');
  const surface = String(options.text || '').normalize('NFKC').toLocaleLowerCase('en-US');
  if (!context || !surface || surface.includes(' ')) return '';
  const index = context.indexOf(surface);
  if (index < 0) return '';
  const after = context.slice(index + surface.length);
  const next = /^\W*([a-z][a-z'-]*)/u.exec(after)?.[1] || '';
  const functionWords = new Set([
    'am', 'are', 'be', 'been', 'being', 'can', 'could', 'did', 'do', 'does', 'had', 'has',
    'have', 'is', 'may', 'might', 'must', 'shall', 'should', 'was', 'were', 'will', 'would',
  ]);
  // Legacy returned "adjective" for nearly every word followed by a content word.
  return next && !functionWords.has(next) ? `${surface} legacyadjective` : context;
}

function runVariant(db, cases, ranker) {
  return cases.map((testCase) => {
    const forms = [testCase.language === 'en' ? testCase.text.toLocaleLowerCase('en-US') : testCase.text];
    const entries = localDictionaryDomain.findEntries(db, testCase.language, forms, { limit: 40 });
    const ranked = ranker(entries, {
      language: testCase.language,
      text: testCase.text,
      forms,
      reading: '',
      context: testCase.context,
    });
    return scoreCase(testCase, ranked);
  });
}

function percent(value) {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function main() {
  const dbPath = argValue('db');
  if (!dbPath) {
    console.error('用法: node scripts/maintenance/dicR2Observation.js --db=<records.db> [--cases=<file>] [--report=<file>]');
    process.exitCode = 1;
    return;
  }
  const casesPath = argValue('cases') || DEFAULT_CASES;
  const fixture = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
  const cases = fixture.cases || [];

  const db = new Database(dbPath, { readonly: true });
  try {
    const baseline = runVariant(db, cases, legacyRank);
    const current = runVariant(db, cases, rankDictionaryEntries);
    const baselineSummary = summarize(baseline);
    const currentSummary = summarize(current);
    const delta = compare(baseline, current);

    console.log(`用例集: ${fixture.version} (${cases.length} 条)`);
    console.log(`数据库: ${dbPath} (只读)`);
    console.log('');
    console.log('词性判定正确率  DIC-R1 基线 -> DIC-R2');
    console.log(`  ${percent(baselineSummary.partOfSpeechAccuracy)} (${baselineSummary.partOfSpeechCorrect}/${baselineSummary.resolved})`
      + ` -> ${percent(currentSummary.partOfSpeechAccuracy)} (${currentSummary.partOfSpeechCorrect}/${currentSummary.resolved})`);
    console.log('可信度标注正确率');
    console.log(`  ${percent(baselineSummary.confidenceCalibrationRate)} -> ${percent(currentSummary.confidenceCalibrationRate)}`);
    console.log('');
    console.log(`改善: ${delta.improved.length} 条  ${delta.improved.join(', ') || '-'}`);
    console.log(`回退: ${delta.regressed.length} 条  ${delta.regressed.join(', ') || '-'}`);
    if (currentSummary.unresolved) console.log(`词典中查不到: ${currentSummary.unresolved} 条`);
    console.log('');
    for (const result of current) {
      const before = baseline.find((item) => item.id === result.id);
      const mark = result.partOfSpeechCorrect ? 'ok  ' : 'MISS';
      const moved = before && before.partOfSpeechCorrect !== result.partOfSpeechCorrect
        ? (result.partOfSpeechCorrect ? '  <= 改善' : '  <= 回退')
        : '';
      console.log(`  ${mark} ${result.id.padEnd(12)} ${String(result.text).padEnd(6)} `
        + `期望=${String(result.expectedPartOfSpeech).padEnd(6)} `
        + `实得=${String(result.topPartOfSpeech || '-').padEnd(14)} `
        + `${String(result.topGloss || '-').slice(0, 16)}${moved}`);
    }

    const reportPath = argValue('report');
    if (reportPath) {
      fs.writeFileSync(reportPath, `${JSON.stringify({
        version: fixture.version,
        generatedAtUtc: new Date().toISOString(),
        baseline: baselineSummary,
        current: currentSummary,
        delta,
        results: { baseline, current },
      }, null, 2)}\n`);
      console.log(`\n报告已写入 ${reportPath}`);
    }
  } finally {
    db.close();
  }
}

main();
