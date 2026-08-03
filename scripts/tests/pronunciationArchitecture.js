'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assertPlainJapaneseContent(markdown, label = 'generated Markdown') {
  assert.doesNotMatch(String(markdown || ''), /<\/?(?:ruby|rt|rp)(?:\s|>)/iu, `${label} must not contain Ruby markup`);
  assert.doesNotMatch(String(markdown || ''), /[\u3400-\u9fff々〆ヵヶ]+[（(][ぁ-ゖァ-ヺー\s]+[）)]/u, `${label} must not contain inline Japanese readings`);
}

function main() {
  const generationService = read('services/generation/cardGenerationService.js');
  const application = read('services/application/executeCardGeneration.js');
  const prompts = [
    read('prompts/phrase_3LANS_markdown.md'),
    read('prompts/phrase_ja_grammar_markdown.md'),
    read('prompts/phrase_scenario_expressions_markdown.md'),
  ];
  const cardModal = read('app/features/card-modal/CardModal.tsx');
  const pronunciationCardContent = read('app/features/card-modal/PronunciationCardContent.tsx');
  assert.match(generationService, /legacyRuby:\s*false/u);
  assert.match(application, /legacyRuby:\s*false/u);
  prompts.forEach((prompt) => {
    assert.match(prompt, /读音由系统独立生成/u);
    assert.match(prompt, /<ruby>/u);
  });
  assert.match(
    `${cardModal}\n${pronunciationCardContent}`,
    /enhancePronunciationHtml/u,
    'CardModal and its lazy pronunciation enhancement must retain the overlay contract'
  );
  assert.doesNotMatch(cardModal, /normalizeJapaneseRuby|toRuby/u);
  assertPlainJapaneseContent('# sample\n## 2. 日本語:\n- **例句1**: 勤務表を確認します。');
  assert.throws(() => assertPlainJapaneseContent('<ruby>勤務表<rt>きんむひょう</rt></ruby>'), /must not contain Ruby markup/u);
  process.stdout.write('Pronunciation plain-content architecture gates OK\n');
}

if (require.main === module) main();

module.exports = { assertPlainJapaneseContent };
