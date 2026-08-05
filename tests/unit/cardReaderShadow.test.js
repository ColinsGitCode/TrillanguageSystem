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

// Regression: the H1 used a flattening text helper that did not drop rt/rp, so a
// ruby title injected its reading into visible text and produced zero
// pronunciation nodes — with empty diagnostics, which the Canary gate accepts.
test('CardDocument keeps ruby in the card title structured instead of flattening the reading', async () => {
  const { parseCardDocument } = await import('../../services/cardReader/cardDocument.mjs');
  const { compareCardReaders } = await import('../../services/cardReader/cardReaderShadow.mjs');
  const markdown = [
    '# <ruby>鼻水<rt>はなみず</rt></ruby>の<ruby>症状<rt>しょうじょう</rt></ruby>があります',
    '',
    '## 2. 日本語:',
    '- **翻訳**: <ruby>鼻水<rt>はなみず</rt></ruby>が出ます',
  ].join('\n');

  const document = parseCardDocument(markdown);
  const titleText = JSON.stringify(document.title);
  assert.equal(titleText.includes('はなみず'), true, 'reading is kept as structured data');
  assert.equal(
    document.title.filter((node) => node.kind === 'pronunciation').length,
    2,
    'both title ruby tokens become pronunciation nodes'
  );

  const report = compareCardReaders(markdown, { generationId: 1, cardType: 'trilingual' });
  assert.equal(report.counts.sourceRubyNodes, 3);
  assert.equal(report.counts.v3PronunciationNodes, 3);
  assert.equal(report.matches.pronunciationNodes, true);
  assert.equal(report.mismatchCodes.includes('PRONUNCIATION_NODE_MISMATCH'), false);
});

test('pronunciation count invariant ignores ruby that is not projectable', async () => {
  const { compareCardReaders } = await import('../../services/cardReader/cardReaderShadow.mjs');
  const markdown = [
    '# manifest',
    '',
    '## 2. 日本語:',
    '- **翻訳**: <ruby>明白<rt>めいはく</rt></ruby>な',
    '  <div class="loanword-block"><span class="loanword-tag">manifest → <ruby>表<rt>あらわ</rt></ruby>れる</span></div>',
    '- **辨析**: 区别于 `<ruby>暗<rt>くら</rt></ruby>い`。',
  ].join('\n');

  const report = compareCardReaders(markdown, { generationId: 2, cardType: 'trilingual' });
  assert.equal(report.counts.sourceRubyNodes, 1, 'loanword and code-span ruby are not projectable');
  assert.equal(report.counts.v3PronunciationNodes, 1);
  assert.equal(report.matches.pronunciationNodes, true);
});

test('CardDocument keeps language sections and controlled nodes while dropping unsafe HTML', async () => {
  const { parseCardDocument } = await import('../../services/cardReader/cardDocument.mjs');
  const document = parseCardDocument(SAMPLE);

  assert.equal(document.version, 'card-document-v1');
  assert.deepEqual(document.title, [{ kind: 'text', value: '勤务表' }]);
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
    pronunciationNodes: true,
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

test('keeps controlled inline roles and drops unsafe or protocol-relative links', async () => {
  const { parseCardDocument } = await import('../../services/cardReader/cardDocument.mjs');
  const document = parseCardDocument(`${SAMPLE}\n\n<span class="explanation-text">compact explanation</span> [unsafe](javascript:alert(1)) [external](//example.com/x)`);
  const serialized = JSON.stringify(document);

  assert.equal(serialized.includes('"role":"explanation"'), true);
  assert.equal(serialized.includes('javascript:'), false);
  assert.equal(serialized.includes('//example.com'), false);
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

test('Canary service requires allowlist, trilingual type, parity and zero diagnostics', async () => {
  const generations = new Map([
    [1, { card_type: 'trilingual', content_hash: 'a'.repeat(64), markdown_content: SAMPLE }],
    [2, { card_type: 'grammar_ja', content_hash: 'b'.repeat(64), markdown_content: SAMPLE }],
    [3, { card_type: 'trilingual', content_hash: 'c'.repeat(64), markdown_content: SAMPLE }],
  ]);
  const { createCardReaderShadowService } = require('../../services/cardReader/cardReaderShadowService');
  const service = createCardReaderShadowService({
    dbService: { getGenerationById: (id) => generations.get(id) || null },
    canaryGenerationIds: [1, 2],
    compare: async (_markdown, metadata) => ({ parity: true, generationId: metadata.generationId }),
    project: async () => ({
      version: 'card-document-v1',
      title: [{ kind: 'text', value: 'fixture' }],
      sections: [],
      diagnostics: [],
    }),
  });

  const canary = await service.readCanaryGeneration(1);
  assert.equal(canary.rendererVersion, 3);
  assert.equal(canary.document.version, 'card-document-v1');
  await assert.rejects(service.readCanaryGeneration(2), { code: 'CARD_READER_V3_CANARY_CARD_TYPE_UNSUPPORTED' });
  await assert.rejects(service.readCanaryGeneration(3), { code: 'CARD_READER_V3_CANARY_NOT_ALLOWLISTED' });
  await assert.rejects(service.readCanaryGeneration(4), { code: 'CARD_READER_SHADOW_GENERATION_NOT_FOUND' });
});
