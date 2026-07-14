'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createDeleteCardUseCase } = require('../../services/application/deleteCard');

test.describe('deleteCard application use case', () => {
  test.it('commits the database transition before best-effort file cleanup', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'three-lans-delete-'));
    const markdown = path.join(tempDir, 'card.md');
    const audio = path.join(tempDir, 'card_en_1.mp3');
    fs.writeFileSync(markdown, '# card');
    fs.writeFileSync(audio, 'audio');
    let databaseCommitted = false;
    try {
      const execute = createDeleteCardUseCase({
        getGenerationById: () => ({
          id: 7,
          folder_name: '20260714',
          base_filename: 'card',
          md_file_path: markdown,
          html_file_path: null,
          meta_file_path: null,
          audioFiles: [{ file_path: audio }],
        }),
        deleteGenerationWithLearningState: () => {
          databaseCommitted = true;
          return { deleted: 1, archivedStudyItems: 2 };
        },
        deleteCardHighlightByFile: () => 1,
        deleteRecordFiles: () => {
          assert.equal(databaseCommitted, true);
          return [];
        },
      });
      const result = execute(7);
      assert.equal(databaseCommitted, true);
      assert.equal(fs.existsSync(markdown), false);
      assert.equal(fs.existsSync(audio), false);
      assert.equal(result.deletedFiles, 2);
      assert.equal(result.database.archivedStudyItems, 2);
      assert.equal(result.highlightDeleted, 1);
      assert.deepEqual(result.cleanupErrors, []);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test.it('returns null without mutating anything when the record is absent', () => {
    let deleted = false;
    const execute = createDeleteCardUseCase({
      getGenerationById: () => null,
      deleteGenerationWithLearningState: () => {
        deleted = true;
      },
      deleteCardHighlightByFile: () => 0,
      deleteRecordFiles: () => [],
    });
    assert.equal(execute(999), null);
    assert.equal(deleted, false);
  });
});
