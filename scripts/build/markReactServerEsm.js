'use strict';

const fs = require('node:fs');
const path = require('node:path');

const outputPath = path.resolve(__dirname, '../../build/server/package.json');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify({ type: 'module' }, null, 2) + '\n');
