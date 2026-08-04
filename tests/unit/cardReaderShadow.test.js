'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const SAMPLE = `# 勤务表

## 1. 英文:
- **解释**: a work schedule
- **例句1**: Check the schedule. <audio src="en.mp3"></audio>

## 2. 日本語:
- **翻訳**: <ruby>勤務表<rt>きんむひょう</rt></ruby>
- **例句1**: 勤務表を確認します。 <audio src="ja.wav"></audio>

## 3. 中文:
- 工作排班表

<script>globalThis.__unsafeCardReaderScript = true</script>`;

test('CardDocument keeps language sections and controlled nodes while dropping unsafe HTML', async () => {
  const { parseCardDocument } = await import('../../services/cardReader/cardDocument.mjs');
  const document = parseCardDocument(SAMPLE);

  assert.equal(document.version, 'card-document-v1');
  assert.equal(document.title, '勤务表');
  assert.deepEqual(document.sections.map((section) => section.language), ['en', 'ja', 'zh']);
  assert.ok(document.sections[1].blocks.some((block) => JSON.stringify(block).includes('legacy-ruby')));
  assert.deepEqual(document.diagnostics, [{ code: 'UNSAFE_NODE_DROPPED', tag: 'script' }]);
  assert.equal(globalThis.__unsafeCardReaderScript, undefined);
});

test('shadow report proves v2/v3 parity without returning card text', async () => {
  const { compareCardReaders } = await import('../../services/cardReader/cardReaderShadow.mjs');
  const report = compareCardReaders(SAMPLE, {
    generationId: 17,
    cardType: 'trilingual',
    sourceContentHash: 'a'.repeat(64),
  });

  assert.equal(report.parity, true);
  assert.deepEqual(report.matches, {
    visibleText: true,
    sectionLanguages: true,
    audioNodes: true,
  });
  assert.equal(report.counts.v2Sections, 3);
  assert.equal(report.counts.v3Sections, 3);
  assert.equal(report.counts.v2AudioNodes, 2);
  assert.equal(report.counts.v3AudioNodes, 2);
  assert.deepEqual(report.diagnosticCodes, ['UNSAFE_NODE_DROPPED']);
  assert.equal(report.hashes.v2VisibleText, report.hashes.v3VisibleText);
  assert.equal(JSON.stringify(report).includes('勤務表'), false);
  assert.equal(JSON.stringify(report).includes('work schedule'), false);
});

test('keeps visible loanword metadata in CardDocument but outside the selector projection', async () => {
  const { parseCardDocument } = await import('../../services/cardReader/cardDocument.mjs');
  const { compareCardReaders } = await import('../../services/cardReader/cardReaderShadow.mjs');
  const markdown = `${SAMPLE}\n\n<div class="loanword-block"><span class="loanword-label">外来语标注</span><span class="loanword-line"><span class="loanword-tag">interface → インターフェース</span></span></div>`;
  const document = parseCardDocument(markdown);
  const aside = document.sections.at(-1).blocks.at(-1);

  assert.equal(aside.kind, 'aside');
  assert.equal(aside.role, 'loanword');
  assert.equal(JSON.stringify(aside).includes('interface'), true);
  assert.equal(compareCardReaders(markdown).parity, true);
});

test('shadow service rejects invalid ids and oversized Markdown before parsing', async () => {
  const { createCardReaderShadowService } = require('../../services/cardReader/cardReaderShadowService');
  const service = createCardReaderShadowService({
    dbService: {
      getGenerationById: () => ({
        card_type: 'trilingual',
        content_hash: 'b'.repeat(64),
        markdown_content: 'x'.repeat(1001),
      }),
    },
    maxMarkdownChars: 1000,
    compare: async () => {
      throw new Error('comparator should not run');
    },
  });

  await assert.rejects(service.compareGeneration('not-an-id'), {
    code: 'CARD_READER_SHADOW_GENERATION_INVALID',
    status: 400,
  });
  await assert.rejects(service.compareGeneration(1), {
    code: 'CARD_READER_SHADOW_SOURCE_TOO_LARGE',
    status: 413,
  });
});
