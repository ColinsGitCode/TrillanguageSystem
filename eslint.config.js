'use strict';

// Flat-config ESLint setup. Scoped to backend code (server.js, services/,
// lib/, routes/, scripts/, tests/unit/) — public/ runs in browsers and
// tests/e2e/ is already exercised by Playwright. Conservative ruleset:
// `eslint:recommended` (catches real bugs like no-undef and no-unreachable)
// plus a handful of project-specific tweaks. Style-only checks are kept as
// warnings so they don't block CI.

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'build/**',
      '.react-router/**',
      'public/**',         // browser code, different globals
      'tests/e2e/**',      // covered by Playwright
      'Docs/**',           // archived diagrams + visualization mjs
      'output/**',
      'data/**',
      '.runtime/**',
      '.tmp/**',
      '.playwright-mcp/**',
      'codex_prompt/**',
      'database/**',       // raw SQL only
      'prompts/**',
      'experiments/**',   // isolated POCs have their own build contract
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Catch real bugs; downgrade noisy stylistic checks to warnings so they
      // surface in `npm run lint` without failing CI on day one.
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-constant-condition': ['warn', { checkLoops: false }],
      'no-inner-declarations': 'off',
      'no-prototype-builtins': 'off',
      'no-control-regex': 'off',
      'no-useless-escape': 'warn',
      'no-async-promise-executor': 'warn',
      // ESLint 10 added these to `recommended`. Keep the established v9
      // baseline here; adopt them later in a dedicated code-quality change.
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // Node:test files use top-level test / describe via the imported `test`
    // namespace — nothing browser-specific.
    files: ['tests/unit/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
