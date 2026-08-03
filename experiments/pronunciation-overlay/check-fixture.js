'use strict';

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, 'fixtures/plain-card.md');
const content = fs.readFileSync(file, 'utf8');
if (/<(?:ruby|rt|rp)(?:\s|>)/iu.test(content)) {
  throw new Error('Synthetic POC fixture must not contain Ruby markup');
}
if (!content.includes('勤務表') || !content.includes('一人')) {
  throw new Error('Synthetic POC fixture is missing compound and irregular-reading samples');
}
process.stdout.write('fixture ok: plain Japanese text with compound and irregular samples\n');
