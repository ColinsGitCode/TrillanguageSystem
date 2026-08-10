'use strict';

const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const test = require('node:test');

const { postProcessGeneratedContent } = require('../../services/generation/contentPostProcessor');
const { prepareGenerationData } = require('../../services/storage/databaseHelpers');

test('JLM-A2 hashes the persisted Markdown after inline metadata is removed', () => {
  const content = {
    markdown_content: [
      '# public schedule',
      '## 2. 日本語:',
      '- **例句1**: パブリックスケジュールを確認します。',
      '  - 请确认公共日程。',
      '  - 外来语标注: 公共日程 = public schedule = パブリックスケジュール',
    ].join('\n'),
    audio_tasks: [],
  };

  postProcessGeneratedContent(content, { removeInlineLoanwordAnnotations: true });
  const generation = prepareGenerationData({
    phrase: 'public schedule',
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    folderName: '20260811',
    baseName: 'public-schedule',
    filePaths: { md: '/tmp/card.md', html: '/tmp/card.html', meta: '/tmp/card.meta.json' },
    content,
    cardType: 'trilingual',
    sourceMode: 'input',
  });
  const expectedHash = crypto.createHash('sha256').update(content.markdown_content).digest('hex');

  assert.doesNotMatch(content.markdown_content, /外来语标注|loanword-block/u);
  assert.equal(generation.markdownContent, content.markdown_content);
  assert.equal(generation.contentHash, expectedHash);
});
