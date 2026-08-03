'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  evaluateFrontendBudgets,
} = require('../../scripts/tests/frontendAssetBudget');

function writeAsset(clientDir, url, size) {
  const target = path.join(clientDir, url.replace(/^\/+/u, ''));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.alloc(size, 'a'));
}

function fixtureManifest(routeImports = ['/assets/DeferredCardModal-1.js']) {
  return {
    entry: {
      module: '/assets/entry.js',
      imports: ['/assets/runtime.js'],
      css: [],
    },
    routes: {
      root: {
        module: '/assets/root.js',
        imports: [],
        css: ['/assets/root.css'],
      },
      'routes/_index': {
        module: '/assets/factory.js',
        imports: routeImports,
        css: ['/assets/factory.css'],
      },
    },
  };
}

function withFixture(callback) {
  const clientDir = fs.mkdtempSync(path.join(os.tmpdir(), 'three-lans-assets-'));
  const assets = {
    '/assets/entry.js': 20,
    '/assets/runtime.js': 30,
    '/assets/root.js': 10,
    '/assets/root.css': 15,
    '/assets/factory.js': 25,
    '/assets/factory.css': 20,
    '/assets/DeferredCardModal-1.js': 5,
    '/assets/CardModal-1.js': 50,
    '/assets/IntelPanel-1.js': 20,
    '/assets/SelectionKnowledgePanel-1.js': 20,
    '/assets/SelectionTtsControls-1.js': 20,
  };
  for (const [url, size] of Object.entries(assets)) writeAsset(clientDir, url, size);
  try {
    callback(clientDir);
  } finally {
    fs.rmSync(clientDir, { recursive: true, force: true });
  }
}

const budget = {
  rootCssRawBytes: 20,
  routes: {
    'routes/_index': {
      label: 'Cards Factory',
      maxInitialRawBytes: 200,
      maxInitialGzipBytes: 200,
    },
  },
  deferredModules: {
    'routes/_index': 'CardModal',
  },
  chunkBudgets: {
    CardModal: { maxRawBytes: 60, maxGzipBytes: 60 },
    IntelPanel: { maxRawBytes: 30, maxGzipBytes: 30 },
    SelectionKnowledgePanel: { maxRawBytes: 30, maxGzipBytes: 30 },
    SelectionTtsControls: { maxRawBytes: 30, maxGzipBytes: 30 },
  },
};

test('frontend budget accepts route CSS and a deferred card modal wrapper', () => {
  withFixture((clientDir) => {
    const result = evaluateFrontendBudgets({
      clientDir,
      budgetConfig: budget,
      manifest: fixtureManifest(),
    });
    assert.deepEqual(result.failures, []);
    assert.equal(result.rootCssRawBytes, 15);
    assert.equal(result.routeResults[0].rawBytes, 125);
    assert.equal(result.chunkResults.length, 4);
  });
});

test('frontend budget rejects global CSS growth and eager CardModal imports', () => {
  withFixture((clientDir) => {
    const result = evaluateFrontendBudgets({
      clientDir,
      budgetConfig: { ...budget, rootCssRawBytes: 10 },
      manifest: fixtureManifest(['/assets/CardModal-1.js']),
    });
    assert.equal(result.failures.length, 2);
    assert.match(result.failures[0], /Global CSS/u);
    assert.match(result.failures[1], /eagerly imports deferred module CardModal/u);
  });
});
