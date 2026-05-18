'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.LOG_SILENT = '1';

const {
  TRAINING_SCHEMA_VERSION,
  validateTrainingPack,
  fallbackHeuristicPack,
} = require('../../services/trainingPackService');

// Build a structurally valid training pack — 4 enCollocations, 4 jaChunks,
// 4 quizzes whose answers can be validated by question text. Used by tests
// that need the validator to pass under strictMin=true.
function buildValidPack(overrides = {}) {
  const enCollocations = ['take', 'make', 'get', 'set'].map((verb, idx) => ({
    id: `en-${idx + 1}`,
    pattern: `${verb} something`,
    meaningZh: `做某事 ${idx + 1}`,
    exampleEn: `Please ${verb} something today.`,
    exampleZh: `请今天 ${verb} 一些事情。`,
    distractors: ['placeholder1', 'placeholder2'],
    difficulty: 2
  }));
  const jaChunks = ['について', 'において', 'として', 'に対して'].map((chunk, idx) => ({
    id: `ja-${idx + 1}`,
    chunk,
    reading: chunk,
    meaningZh: `语块说明 ${idx + 1}`,
    exampleJa: `この件${chunk}話す。`,
    exampleZh: `就这件事 ${chunk} 说话。`,
    distractors: [],
    difficulty: 3
  }));
  const quizzes = enCollocations.slice(0, 2).map((item, idx) => ({
    id: `q-en-${idx + 1}`,
    lang: 'en',
    type: 'cloze',
    question: `Please ${item.pattern} today.`,
    answer: item.pattern,
    choices: [item.pattern, 'distractor1', 'distractor2'],
    explanationZh: `该题考查搭配：${item.pattern}`,
    relatedUnitIds: [item.id]
  })).concat(jaChunks.slice(0, 2).map((item, idx) => ({
    id: `q-ja-${idx + 1}`,
    lang: 'ja',
    type: 'cloze',
    question: `この件${item.chunk}話す。`,
    answer: item.chunk,
    choices: [item.chunk, 'distractorA'],
    explanationZh: `该题考查语块：${item.chunk}`,
    relatedUnitIds: [item.id]
  })));

  return {
    schemaVersion: TRAINING_SCHEMA_VERSION,
    phrase: 'integration phrase',
    cardType: 'trilingual',
    enCollocations,
    jaChunks,
    quizzes,
    quality: { selfConfidence: 0.8, coverageScore: 0.9 },
    ...overrides,
  };
}

test.describe('validateTrainingPack', () => {
  test.it('passes a fully-formed payload (ok=true, no errors)', () => {
    const res = validateTrainingPack(buildValidPack(), { phrase: 'integration phrase' });
    assert.equal(res.ok, true, `expected ok, got errors: ${res.errors.join(', ')}`);
    assert.deepEqual(res.errors, []);
    assert.equal(res.payload.schemaVersion, TRAINING_SCHEMA_VERSION);
    assert.equal(res.payload.cardType, 'trilingual');
    assert.ok(res.qualityScore > 0 && res.qualityScore <= 100);
  });

  test.it('reports missing phrase when neither payload nor options provides it', () => {
    const payload = buildValidPack();
    delete payload.phrase;
    const res = validateTrainingPack(payload);
    assert.equal(res.ok, false);
    assert.ok(res.errors.includes('phrase is required'));
  });

  test.it('strictMin=true flags insufficient counts', () => {
    const pack = buildValidPack();
    pack.enCollocations = pack.enCollocations.slice(0, 2);
    pack.jaChunks = pack.jaChunks.slice(0, 2);
    pack.quizzes = pack.quizzes.slice(0, 2);
    const res = validateTrainingPack(pack, { phrase: 'integration phrase' });
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.includes('enCollocations must be >= 4')));
    assert.ok(res.errors.some((e) => e.includes('jaChunks must be >= 4')));
    assert.ok(res.errors.some((e) => e.includes('quizzes must be >= 4')));
  });

  test.it('strictMin=false tolerates short lists', () => {
    const pack = buildValidPack();
    pack.enCollocations = pack.enCollocations.slice(0, 1);
    pack.jaChunks = pack.jaChunks.slice(0, 1);
    pack.quizzes = pack.quizzes.slice(0, 1);
    const res = validateTrainingPack(pack, { phrase: 'integration phrase', strictMin: false });
    assert.equal(res.ok, true, `expected ok, got: ${res.errors.join(', ')}`);
  });

  test.it('flags choice quiz with fewer than 2 choices', () => {
    const pack = buildValidPack();
    pack.quizzes[0] = {
      ...pack.quizzes[0],
      type: 'choice',
      choices: [pack.quizzes[0].answer]
    };
    const res = validateTrainingPack(pack, { phrase: 'integration phrase' });
    assert.ok(res.errors.some((e) => /choices must be >= 2/.test(e)));
  });

  test.it('flags quiz answers not derivable from question or choices', () => {
    const pack = buildValidPack();
    pack.quizzes[0] = {
      ...pack.quizzes[0],
      question: 'orphan question without answer',
      answer: 'never-seen',
      choices: ['unrelated1', 'unrelated2']
    };
    const res = validateTrainingPack(pack, { phrase: 'integration phrase' });
    assert.ok(res.errors.some((e) => /cannot be validated by question\/choices/.test(e)));
  });

  test.it('flags quiz relatedUnitId pointing to a non-existent unit', () => {
    const pack = buildValidPack();
    pack.quizzes[0].relatedUnitIds = ['en-999'];
    const res = validateTrainingPack(pack, { phrase: 'integration phrase' });
    assert.ok(res.errors.some((e) => /relatedUnitId not found/.test(e)));
  });

  test.it('clamps quality.selfConfidence / coverageScore into [0,1]', () => {
    const pack = buildValidPack({ quality: { selfConfidence: 2.5, coverageScore: -1 } });
    const res = validateTrainingPack(pack, { phrase: 'integration phrase' });
    assert.equal(res.selfConfidence, 1);
    // coverageScore was 0 → falls back to computed; computed value depends on counts.
    assert.ok(res.coverageScore >= 0);
  });
});

test.describe('fallbackHeuristicPack', () => {
  test.it('returns a structurally-valid payload even from empty markdown', () => {
    const res = fallbackHeuristicPack({ phrase: 'core idea', cardType: 'trilingual', markdown: '' });
    assert.equal(res.payload.phrase, 'core idea');
    assert.equal(res.payload.cardType, 'trilingual');
    assert.equal(res.payload.enCollocations.length, 4);
    assert.equal(res.payload.jaChunks.length, 4);
    assert.ok(res.payload.quizzes.length >= 4);
    // Heuristic packs are tagged with the fallback note.
    assert.equal(res.payload.quality.notes, 'heuristic fallback');
  });

  test.it('grammar_ja path normalizes cardType + still meets min counts', () => {
    const res = fallbackHeuristicPack({ phrase: '〜要するに', cardType: 'grammar_ja', markdown: '' });
    assert.equal(res.payload.cardType, 'grammar_ja');
    assert.equal(res.payload.enCollocations.length, 4);
    assert.equal(res.payload.jaChunks.length, 4);
  });

  test.it('picks up example sentences from a real trilingual markdown', () => {
    const markdown = [
      '# persistent state',
      '## 1. 英文',
      '- **例句1**: Persistent state survives restarts and reloads.',
      '- **例句1翻译**: 持续状态在重启和刷新后仍然保留。',
      '## 2. 日本語',
      '- **例句1**: 永続状態はリロード後も残る。',
      '- **例句1翻译**: 持续状态在刷新后仍然保留。',
      '## 3. 中文',
      '- **翻译**: 持续状态',
    ].join('\n');
    const res = fallbackHeuristicPack({ phrase: 'persistent state', cardType: 'trilingual', markdown });
    // Should have absorbed the example text into the first quizzes/collocations.
    const text = JSON.stringify(res.payload);
    assert.ok(/restarts and reloads|永続状態/.test(text), 'example sentences should be present');
  });
});
