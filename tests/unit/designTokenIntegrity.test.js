'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const STYLE_DIR = path.join(__dirname, '..', '..', 'app', 'styles');
const TOKENS_FILE = 'tokens.css';

/**
 * Custom properties that a component sets at runtime through an inline style
 * rather than the shared token layer. They are layout inputs, not theme values,
 * so tokens.css must not define them.
 */
const RUNTIME_PROPERTIES = new Map([
  ['--action-level', 'app/features/learning/LearningHistoryPage.tsx'],
  ['--backlog-level', 'app/features/learning/LearningHistoryPage.tsx'],
  ['--workflow-rail-width', 'app/components/workflow/TaskWorkbench.tsx'],
  ['--workflow-tools-width', 'app/components/workflow/TaskWorkbench.tsx'],
]);

function styleSheets() {
  return fs.readdirSync(STYLE_DIR)
    .filter((name) => name.endsWith('.css'))
    .map((name) => ({ name, text: fs.readFileSync(path.join(STYLE_DIR, name), 'utf8') }));
}

function definedTokens() {
  const text = fs.readFileSync(path.join(STYLE_DIR, TOKENS_FILE), 'utf8');
  return new Set([...text.matchAll(/(--[\w-]+)\s*:/gu)].map((match) => match[1]));
}

test('every custom property a stylesheet reads is defined by the token layer', () => {
  // An undefined custom property does not fail loudly: the declaration is simply
  // dropped at computed-value time. `color: var(--color-action)` silently became
  // the inherited body colour, and one invalid part of a `font:` shorthand threw
  // the whole shorthand away, taking its font-size with it. Nothing about the
  // page looked broken enough to notice, which is why this needs a test.
  const tokens = definedTokens();
  const missing = [];
  for (const { name, text } of styleSheets()) {
    if (name === TOKENS_FILE) continue;
    for (const match of text.matchAll(/var\(\s*(--[\w-]+)/gu)) {
      const used = match[1];
      if (tokens.has(used) || RUNTIME_PROPERTIES.has(used)) continue;
      missing.push(`${name} reads ${used}`);
    }
  }
  assert.deepEqual([...new Set(missing)], [], 'undefined custom properties');
});

test('a var() fallback never stands in for a missing token', () => {
  // A fallback makes a missing token invisible: the swatch renders, so nobody
  // learns the token was never added, and it stops following the theme.
  const offenders = [];
  for (const { name, text } of styleSheets()) {
    if (name === TOKENS_FILE) continue;
    for (const match of text.matchAll(/var\(\s*(--[\w-]+)\s*,([^)]*)\)/gu)) {
      if (RUNTIME_PROPERTIES.has(match[1])) continue;
      offenders.push(`${name}: var(${match[1]},${match[2]})`);
    }
  }
  assert.deepEqual(offenders, [], 'var() fallbacks outside runtime properties');
});

test('colour literals stay inside the token layer', () => {
  // Every theme value belongs to tokens.css so that dark mode is one edit.
  const literal = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(\s*[\d.]/gu;
  const offenders = [];
  for (const { name, text } of styleSheets()) {
    if (name === TOKENS_FILE) continue;
    for (const match of text.matchAll(literal)) offenders.push(`${name}: ${match[0]}`);
  }
  assert.deepEqual(offenders, [], 'hardcoded colours outside tokens.css');
});

test('both themes define the same token names', () => {
  // A token defined only in light silently keeps its light value on a dark
  // canvas, which is how an invisible shadow and two off-theme swatches shipped.
  const text = fs.readFileSync(path.join(STYLE_DIR, TOKENS_FILE), 'utf8');
  const block = (selector) => {
    const start = text.indexOf(selector);
    assert.ok(start >= 0, `${selector} block is missing`);
    const open = text.indexOf('{', start);
    return text.slice(open, text.indexOf('\n}', open));
  };
  const names = (chunk) => new Set([...chunk.matchAll(/(--[\w-]+)\s*:/gu)].map((m) => m[1]));
  const light = names(block(':root {'));
  const dark = names(block(':root[data-theme="dark"]'));

  // Light is the complete catalogue; dark overrides only what must change, so
  // the check is one-directional on purpose.
  const darkOnly = [...dark].filter((token) => !light.has(token));
  assert.deepEqual(darkOnly, [], 'tokens defined only in the dark theme');

  // Anything colour-like must be answered in both themes.
  const colourish = [...light].filter((token) => /^--(color|shadow)-/u.test(token));
  const unanswered = colourish.filter((token) => !dark.has(token));
  assert.deepEqual(unanswered, [], 'colour or shadow tokens with no dark value');
});
