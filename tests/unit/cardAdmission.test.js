'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  CardAdmissionError,
  assertDuplicatePolicy,
  findNormalizedDuplicates,
  validateAudioCompletion,
  validateCardAdmission,
  validatePersistedAdmission,
} = require('../../services/application/cardAdmission');
const { buildAdmissionTags } = require('../../services/dataPreparation/cardTagging');
const { buildFixtureContent } = require('../../services/fixtures/e2eFixtureService');

const COMPLETE_CARD = `# card
## 1. 英文:
- **例句1**: One
- **例句2**: Two
## 2. 日本語:
- **例句1**: 一
- **例句2**: 二
## 3. 中文:
- **翻译**: 卡片`;

test.describe('online card admission', () => {
  test.it('blocks historical duplicates unless a new version is explicit', () => {
    const records = [{ id: 7, phrase: ' ＡＰＩ ', card_type: 'trilingual', content_hash: 'a'.repeat(64) }];
    const duplicates = findNormalizedDuplicates(records, 'api', 'trilingual');
    assert.equal(duplicates.length, 1);
    assert.throws(
      () => assertDuplicatePolicy({ cardType: 'trilingual', duplicates, duplicatePolicy: 'reject' }),
      (error) => error instanceof CardAdmissionError && error.code === 'CARD_DUPLICATE_EXISTS' && error.status === 409
    );
    assert.equal(assertDuplicatePolicy({
      cardType: 'trilingual',
      duplicates,
      duplicatePolicy: 'create-version',
    }).policy, 'create-version');
  });

  test.it('requires every audio task to have a non-empty generated file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'card-admission-audio-'));
    const audioPath = path.join(root, 'card_en_1.mp3');
    fs.writeFileSync(audioPath, 'audio');
    try {
      assert.deepEqual(validateAudioCompletion({
        audioTasks: [{ lang: 'en' }],
        audio: { results: [{ index: 0, filePath: audioPath }], errors: [] },
        ttsConfigured: true,
      }), { policy: 'required', expected: 1, generated: 1 });
      assert.throws(
        () => validateAudioCompletion({
          audioTasks: [{ lang: 'en' }, { lang: 'ja' }],
          audio: { results: [{ index: 0, filePath: audioPath }], errors: [{ index: 1, message: 'failed' }] },
          ttsConfigured: true,
        }),
        (error) => error.code === 'CARD_AUDIO_INCOMPLETE'
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test.it('validates canonical structure and creates mandatory online tags', () => {
    const admission = validateCardAdmission({
      generation: {
        phrase: 'API design',
        cardType: 'trilingual',
        sourceMode: 'input',
        markdownContent: COMPLETE_CARD,
      },
      audioTasks: [],
      audio: null,
      e2eTestMode: true,
      ttsConfigured: false,
    });
    assert.equal(admission.status, 'eligible');
    assert.equal(admission.contentHash.length, 64);

    const tags = buildAdmissionTags({
      phrase: 'API design',
      cardType: 'trilingual',
      sourceMode: 'input',
      markdownContent: COMPLETE_CARD,
    });
    assert.equal(tags.filter((tag) => tag.namespace === 'lang').length, 1);
    assert.equal(tags.filter((tag) => tag.namespace === 'src').length, 1);
    assert.ok(tags.some((tag) => tag.namespace === 'topic' && tag.value === 'software-eng'));
  });

  test.it('keeps every deterministic E2E card type aligned with production admission', () => {
    for (const cardType of ['trilingual', 'grammar_ja', 'scenario_phrase']) {
      const phrase = cardType === 'grammar_ja' ? '〜なくなった' : `${cardType} fixture`;
      const content = buildFixtureContent({ phrase, cardType });
      assert.doesNotThrow(() => validateCardAdmission({
        generation: {
          phrase,
          cardType,
          sourceMode: 'input',
          markdownContent: content.markdown_content,
        },
        audioTasks: content.audio_tasks,
        e2eTestMode: true,
        ttsConfigured: false,
      }), cardType);
    }
  });

  test.it('rejects incomplete structure and invalid persistence readback', () => {
    assert.throws(
      () => validateCardAdmission({
        generation: { phrase: 'bad', cardType: 'trilingual', markdownContent: '# bad' },
        audioTasks: [],
        e2eTestMode: true,
      }),
      (error) => error.code === 'CARD_STRUCTURE_INCOMPLETE'
    );
    assert.throws(
      () => validatePersistedAdmission({
        generation: { content_hash: 'b'.repeat(64), audioFiles: [] },
        tags: [{ namespace: 'lang', status: 'active' }],
        expectedHash: 'a'.repeat(64),
        expectedAudioRows: 1,
      }),
      (error) => error.code === 'CARD_ADMISSION_READBACK_FAILED'
    );
  });
});
