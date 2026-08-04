'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { buildCandidates } = require('./buildPronunciationCompoundCandidates');

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_MINUTES_PER_CANDIDATE = 1;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function candidateId(candidate) {
  return `compound:${sha256(JSON.stringify({
    surface: candidate.surface,
    reading: candidate.reading,
    components: candidate.components,
  })).slice(0, 16)}`;
}

function normalizePositiveInteger(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function buildReviewBatches(candidateManifest, options = {}) {
  if (!candidateManifest || !Array.isArray(candidateManifest.candidates)) {
    throw new TypeError('Compound candidate manifest must contain candidates');
  }
  const batchSize = normalizePositiveInteger(options.batchSize, DEFAULT_BATCH_SIZE, 100);
  const minutesPerCandidate = normalizePositiveInteger(
    options.minutesPerCandidate,
    DEFAULT_MINUTES_PER_CANDIDATE,
    60,
  );
  const candidates = candidateManifest.candidates.map((candidate) => ({
    candidateId: candidateId(candidate),
    surface: candidate.surface,
    reading: candidate.reading,
    components: candidate.components,
    occurrenceCount: candidate.occurrenceCount,
    eligibleOccurrenceCount: candidate.eligibleOccurrenceCount,
    generationIds: candidate.generationIds,
    needsReviewGenerationIds: candidate.needsReviewGenerationIds,
    cardTypes: candidate.cardTypes,
    review: {
      status: 'unreviewed',
      acceptedSource: null,
      acceptedReadingRaw: null,
      acceptedReadingHiragana: null,
      reviewer: null,
      reviewedAt: null,
      reason: null,
      estimatedMinutes: minutesPerCandidate,
    },
  }));
  const batches = [];
  for (let index = 0; index < candidates.length; index += batchSize) {
    const items = candidates.slice(index, index + batchSize);
    batches.push({
      batchId: `compound-review-${String(batches.length + 1).padStart(3, '0')}`,
      status: 'unreviewed',
      candidateCount: items.length,
      occurrenceCount: items.reduce((sum, item) => sum + Number(item.occurrenceCount || 0), 0),
      estimatedMinutes: items.length * minutesPerCandidate,
      candidates: items,
    });
  }
  const result = {
    schemaVersion: 'pronunciation-compound-review-batches/v1',
    readOnly: true,
    source: {
      candidateManifestSchemaVersion: candidateManifest.schemaVersion || null,
      candidateManifestHash: candidateManifest.manifestHash || null,
    },
    policy: {
      acceptedSources: ['dictionary', 'textbook', 'manual'],
      analyzerOutputIsProposal: true,
      applyRequiresReviewedBatch: true,
      estimatedMinutesPerCandidate: minutesPerCandidate,
    },
    counts: {
      distinctCandidates: candidates.length,
      occurrences: candidates.reduce((sum, item) => sum + Number(item.occurrenceCount || 0), 0),
      eligibleOccurrences: candidates.reduce((sum, item) => sum + Number(item.eligibleOccurrenceCount || 0), 0),
      batches: batches.length,
      unreviewedCandidates: candidates.length,
      estimatedReviewMinutes: candidates.length * minutesPerCandidate,
    },
    batches,
  };
  return {
    ...result,
    manifestHash: sha256(JSON.stringify(result)),
  };
}

function parseArgs(argv) {
  const args = {
    db: process.env.DB_PATH || './data/trilingual_records.db',
    input: null,
    output: null,
    batchSize: DEFAULT_BATCH_SIZE,
    minutesPerCandidate: DEFAULT_MINUTES_PER_CANDIDATE,
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--db') args.db = argv[++index];
    if (argv[index] === '--input') args.input = argv[++index];
    if (argv[index] === '--output') args.output = argv[++index];
    if (argv[index] === '--batch-size') args.batchSize = argv[++index];
    if (argv[index] === '--minutes-per-candidate') args.minutesPerCandidate = argv[++index];
  }
  return args;
}

function readCandidateManifest(args) {
  if (!args.input) return buildCandidates(args.db);
  return JSON.parse(fs.readFileSync(path.resolve(args.input), 'utf8'));
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const result = buildReviewBatches(readCandidateManifest(args), args);
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (args.output) {
    fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
    fs.writeFileSync(path.resolve(args.output), serialized, 'utf8');
  } else {
    process.stdout.write(serialized);
  }
}

module.exports = { buildReviewBatches, candidateId };
