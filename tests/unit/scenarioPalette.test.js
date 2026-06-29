'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

function cssText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test.describe('scenario card palette', () => {
  test.it('uses a Hermes-yellow palette distinct from grammar teal in the main file list', () => {
    const css = cssText('public/styles.css');

    assert.match(css, /\.file-list \.list-item-btn\.card-type-scenario\s*\{[^}]*#f2b84b/s);
    assert.match(css, /\.file-list \.list-item-btn\.card-type-scenario\.active\s*\{[^}]*#f37021/s);
    assert.match(css, /\.file-item-corner\.corner-scenario\s*\{[^}]*#9a4f00/s);
    assert.doesNotMatch(
      css,
      /\.file-list \.list-item-btn\.card-type-scenario\s*\{[^}]*#86efac/s
    );
  });

  test.it('uses the same scenario palette in Knowledge Hub pills', () => {
    const css = cssText('public/css/dashboard.css');

    assert.match(css, /\.kh-pill\.card-scenario\s*\{[^}]*#fff0c2/s);
    assert.match(css, /\.kh-pill\.card-scenario\s*\{[^}]*#9a4f00/s);
  });
});
