'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CATALOG_PATH = path.join(__dirname, 'dictionaries/local-en-ja-zh-v1.json');

function readCatalog(filePath = CATALOG_PATH) {
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!payload || typeof payload !== 'object' || !payload.version || !Array.isArray(payload.entries)) {
    throw new Error(`Invalid local dictionary catalog: ${filePath}`);
  }
  return payload;
}

module.exports = {
  CATALOG_PATH,
  readCatalog,
};
