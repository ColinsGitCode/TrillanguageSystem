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
  test.it('uses the Hermes-yellow tokens and stays distinct from grammar teal', () => {
    const tokens = cssText('app/styles/tokens.css');
    const factory = cssText('app/styles/factory.css');

    assert.match(tokens, /--color-card-scenario-surface:\s*#fff4dc/);
    assert.match(tokens, /--color-card-scenario-border:\s*#eeb34f/);
    assert.match(tokens, /--color-card-scenario-strong:\s*#c96f0b/);
    assert.match(tokens, /--color-card-grammar-surface:\s*#e8f8f6/);
    assert.match(factory, /\.file-card\.type-scenario_phrase\s*\{[^}]*var\(--color-card-scenario-border\)[^}]*var\(--color-card-scenario-surface\)/s);
    assert.match(factory, /\.file-card\.type-grammar_ja\s*\{[^}]*var\(--color-card-grammar-border\)[^}]*var\(--color-card-grammar-surface\)/s);
  });
});
