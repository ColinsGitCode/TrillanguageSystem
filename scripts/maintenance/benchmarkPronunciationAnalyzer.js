'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildCandidates } = require('./buildPronunciationCompoundCandidates');
const {
  ANALYZER_VERSION,
  buildTokens,
} = require('../../services/pronunciation/pronunciationService');
const { createDictionaryReader } = require('../../services/pronunciation/pronunciationPorts');

const JAPANESE_RE = /[ぁ-ゖァ-ヺー一-龯々〆ヵヶ]/u;

function codePointLength(value) {
  return Array.from(String(value || '')).length;
}

function isWholeToken(token, surface) {
  return token.status === 'accepted'
    && token.startCodePoint === 0
    && token.endCodePoint === codePointLength(surface)
    && token.surface === surface;
}

async function benchmarkDatabase(dbPath, { sampleLimit = 12 } = {}) {
  const candidatesManifest = buildCandidates(dbPath);
  const dictionaryReader = createDictionaryReader();
  const rows = [];
  for (const candidate of candidatesManifest.candidates) {
    const surface = String(candidate.surface || '');
    const isJapanese = JAPANESE_RE.test(surface);
    if (!isJapanese) {
      rows.push({
        surface,
        reading: candidate.reading,
        status: 'non-japanese-input',
        tokenCount: 0,
        wholeWord: false,
        source: null,
        occurrenceCount: candidate.occurrenceCount,
        eligibleOccurrenceCount: candidate.eligibleOccurrenceCount,
      });
      continue;
    }
    const built = await buildTokens(surface, { dictionaryReader });
    const whole = built.tokens.find((token) => isWholeToken(token, surface));
    rows.push({
      surface,
      reading: candidate.reading,
      status: whole ? 'whole-word' : built.status === 'partial' ? 'partial' : 'component-only',
      tokenCount: built.tokens.length,
      unresolvedCount: built.tokens.filter((token) => token.status === 'unresolved').length,
      wholeWord: Boolean(whole),
      source: whole?.source || null,
      readingHiragana: whole?.readingHiragana || null,
      occurrenceCount: candidate.occurrenceCount,
      eligibleOccurrenceCount: candidate.eligibleOccurrenceCount,
    });
  }
  const count = (status) => rows.filter((row) => row.status === status).length;
  const wholeRows = rows.filter((row) => row.wholeWord);
  return {
    schemaVersion: 'pronunciation-analyzer-benchmark/v1',
    readOnly: true,
    source: { dbPath: path.basename(dbPath) },
    analyzerVersion: ANALYZER_VERSION,
    dictionaryVersion: dictionaryReader.version(),
    candidateCounts: candidatesManifest.counts,
    resultCounts: {
      distinctCandidates: rows.length,
      wholeWordAccepted: wholeRows.length,
      analyzerWholeWordAccepted: wholeRows.filter((row) => row.source === 'analyzer').length,
      dictionaryWholeWordAccepted: wholeRows.filter((row) => row.source === 'dictionary').length,
      componentOnly: count('component-only'),
      partial: count('partial'),
      nonJapaneseInput: count('non-japanese-input'),
    },
    occurrenceCounts: {
      wholeWordAccepted: rows.filter((row) => row.wholeWord)
        .reduce((sum, row) => sum + row.occurrenceCount, 0),
      eligibleWholeWordAccepted: rows.filter((row) => row.wholeWord)
        .reduce((sum, row) => sum + row.eligibleOccurrenceCount, 0),
    },
    samples: {
      componentOnly: rows.filter((row) => row.status === 'component-only').slice(0, sampleLimit),
      partial: rows.filter((row) => row.status === 'partial').slice(0, sampleLimit),
      nonJapaneseInput: rows.filter((row) => row.status === 'non-japanese-input').slice(0, sampleLimit),
    },
    rows,
  };
}

function parseArgs(argv) {
  const args = {
    db: process.env.DB_PATH || './data/trilingual_records.db',
    output: null,
    sampleLimit: 12,
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--db') args.db = argv[index + 1];
    if (argv[index] === '--output') args.output = argv[index + 1];
    if (argv[index] === '--sample-limit') args.sampleLimit = Number(argv[index + 1]);
  }
  return args;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  benchmarkDatabase(args.db, {
    sampleLimit: Number.isSafeInteger(args.sampleLimit) && args.sampleLimit >= 0 ? args.sampleLimit : 12,
  }).then((result) => {
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (args.output) {
      fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
      fs.writeFileSync(args.output, serialized, 'utf8');
    } else process.stdout.write(serialized);
  }).catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = { benchmarkDatabase };
