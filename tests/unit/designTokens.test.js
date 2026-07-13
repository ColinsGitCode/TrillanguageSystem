'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const files = {
  css: [
    'public/styles.css',
    'public/modern-card.css'
  ],
  html: [
    'public/index.html'
  ],
  js: [
    'public/js/modules/app.js'
  ]
};

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function count(pattern, relativePaths) {
  return relativePaths.reduce((total, relativePath) => {
    const matches = read(relativePath).match(pattern);
    return total + (matches ? matches.length : 0);
  }, 0);
}

function inventory() {
  const allStyleSources = [...files.css, ...files.html, ...files.js];
  return {
    rootBlocks: count(/(^|\n)\s*:root\s*\{/g, files.css),
    htmlStyleAttributes: count(/\sstyle\s*=\s*["']/g, files.html),
    jsTemplateStyleAttributes: count(/\sstyle\s*=\s*["']/g, files.js),
    legacyTokenReferences: count(/--(?:sci-|neon-|glass-blur|glow-shadow|font-display\b)/g, allStyleSources)
  };
}

test.describe('UI design-system migration inventory', () => {
  test.it('reports the current migration surface without hiding it', (t) => {
    const values = inventory();
    t.diagnostic(JSON.stringify(values));
    assert.ok(values.rootBlocks >= 0);
    assert.ok(values.htmlStyleAttributes >= 0);
    assert.ok(values.jsTemplateStyleAttributes >= 0);
    assert.ok(values.legacyTokenReferences >= 0);
  });

  test.it('enforces the final static gate', () => {
    const values = inventory();
    assert.deepEqual(values, {
      rootBlocks: 0,
      htmlStyleAttributes: 0,
      jsTemplateStyleAttributes: 0,
      legacyTokenReferences: 0
    });

    const tokens = read('public/css/tokens.css');
    assert.match(tokens, /(^|\n)\s*:root\s*\{/);
    assert.match(tokens, /:root\[data-theme=["']dark["']\]/);
  });
});
