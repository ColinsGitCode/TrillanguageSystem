'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const fileManagerPath = '../../services/storage/fileManager';

function loadFileManager(recordsPath) {
  const savedRecordsPath = process.env.RECORDS_PATH;
  process.env.RECORDS_PATH = recordsPath;
  delete require.cache[require.resolve(fileManagerPath)];
  const mod = require(fileManagerPath);
  return {
    mod,
    restore() {
      delete require.cache[require.resolve(fileManagerPath)];
      if (savedRecordsPath === undefined) delete process.env.RECORDS_PATH;
      else process.env.RECORDS_PATH = savedRecordsPath;
    }
  };
}

test.describe('fileManager list display metadata', () => {
  test.it('uses scenario markdown H1 as the file-list title instead of the long original phrase', () => {
    const recordsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-records-'));
    const folderName = '20260618';
    const folderPath = path.join(recordsPath, folderName);
    fs.mkdirSync(folderPath, { recursive: true });

    const baseName = '我家的空调使用1小时以上时间后室内的空调出风口会有很多漏水';
    fs.writeFileSync(path.join(folderPath, `${baseName}.html`), '<article>card</article>', 'utf-8');
    fs.writeFileSync(path.join(folderPath, `${baseName}.md`), '# 空调维修预约\n\n## 1. 场景说明\n', 'utf-8');
    fs.writeFileSync(
      path.join(folderPath, `${baseName}.meta.json`),
      JSON.stringify({
        phrase: baseName,
        card_type: 'scenario_phrase',
        created_at: '2026-06-18T00:00:00.000Z'
      }),
      'utf-8'
    );

    const { mod, restore } = loadFileManager(recordsPath);
    try {
      const files = mod.listHtmlFilesInFolder(folderName);
      assert.equal(files.length, 1);
      assert.equal(files[0].cardType, 'scenario_phrase');
      assert.equal(files[0].title, '空调维修预约');
    } finally {
      restore();
      fs.rmSync(recordsPath, { recursive: true, force: true });
    }
  });
});
