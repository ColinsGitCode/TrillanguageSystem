'use strict';

const path = require('node:path');

const DICTIONARY_PATH = path.join(__dirname, 'dictionaries/ja-pronunciation-v2.json');

function createDictionaryReader({ filePath = DICTIONARY_PATH, fs = require('node:fs') } = {}) {
  let cached = null;
  return {
    version() {
      const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return String(payload.version || 'unknown');
    },
    entries() {
      if (!cached) {
        const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        cached = Array.isArray(payload.entries) ? payload.entries : [];
      }
      return cached.map((entry) => ({ ...entry }));
    },
  };
}

module.exports = { DICTIONARY_PATH, createDictionaryReader };
