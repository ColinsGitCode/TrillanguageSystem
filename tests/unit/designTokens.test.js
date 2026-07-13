'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test.describe('React design-system ownership', () => {
  test.it('keeps theme values in the single React token source', () => {
    const tokens = read('app/styles/tokens.css');
    const componentCss = [read('app/styles/factory.css'), read('app/styles/card-modal.css')].join('\n');
    const root = read('app/root.tsx');

    assert.match(tokens, /(^|\n)\s*:root\s*\{/);
    assert.match(tokens, /:root\[data-theme=["']dark["']\]/);
    assert.match(tokens, /@media \(prefers-reduced-motion: reduce\)/);
    assert.doesNotMatch(componentCss, /(^|\n)\s*:root\s*\{/);
    assert.doesNotMatch(componentCss, /#[0-9a-f]{3,8}\b/i);
    assert.doesNotMatch(componentCss, /--(?:sci-|neon-|glass-blur|glow-shadow|font-display\b)/);
    assert.match(root, /import ['"]\.\/styles\/tokens\.css['"]/);
  });

  test.it('has no legacy browser frontend entry', () => {
    for (const relativePath of [
      'public/index.html',
      'public/styles.css',
      'public/modern-card.css',
      'public/js/modules/app.js',
      'public/vendor/marked.min.js',
    ]) {
      assert.equal(fs.existsSync(path.join(repoRoot, relativePath)), false, relativePath);
    }
    assert.equal(fs.existsSync(path.join(repoRoot, 'public/favicon-lan.svg')), true);
  });
});
