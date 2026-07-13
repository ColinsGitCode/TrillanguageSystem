'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const recordsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'card-staging-'));
process.env.RECORDS_PATH = recordsRoot;
const {
  cleanupGenerationArtifacts,
  createGenerationStagingArea,
  publishStagedGeneration,
  saveGeneratedFiles,
} = require('../../services/storage/fileManager');

test.after(() => fs.rmSync(recordsRoot, { recursive: true, force: true }));

test.describe('generation staging publication', () => {
  test.it('publishes only the staged files and supports exact compensation', () => {
    const targetDir = path.join(recordsRoot, '20260713');
    fs.mkdirSync(targetDir, { recursive: true });
    const stage = createGenerationStagingArea({ targetDir, folderName: '20260713', baseName: 'card' });
    saveGeneratedFiles('card', { markdown_content: '# card', html_content: '<article>card</article>' }, {
      targetDir: stage.stagingDir,
      folderName: '20260713',
      baseName: 'card',
      cardType: 'trilingual',
      sourceMode: 'input',
    });
    fs.writeFileSync(path.join(stage.stagingDir, 'card_en_1.mp3'), 'audio');

    const published = publishStagedGeneration(stage);
    assert.equal(published.publishedPaths.length, 4);
    published.publishedPaths.forEach((filePath) => assert.equal(fs.existsSync(filePath), true));
    assert.equal(fs.existsSync(stage.stagingDir), false);

    cleanupGenerationArtifacts({ publishedPaths: published.publishedPaths });
    published.publishedPaths.forEach((filePath) => assert.equal(fs.existsSync(filePath), false));
  });
});
