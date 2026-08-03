'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '../..');

function readReactRouterManifest(clientDir) {
  const assetsDir = path.join(clientDir, 'assets');
  const manifestFiles = fs.readdirSync(assetsDir)
    .filter((name) => /^manifest-.*\.js$/u.test(name));
  assert.equal(manifestFiles.length, 1, `Expected one React Router manifest asset, found ${manifestFiles.length}`);
  const source = fs.readFileSync(path.join(assetsDir, manifestFiles[0]), 'utf8');
  const prefix = 'window.__reactRouterManifest=';
  assert.ok(source.startsWith(prefix), 'React Router manifest has an unexpected format');
  return JSON.parse(source.slice(prefix.length, source.lastIndexOf(';')));
}

function assetStats(clientDir, assetUrl) {
  const relativePath = assetUrl.replace(/^\/+/u, '');
  const bytes = fs.readFileSync(path.join(clientDir, relativePath));
  return {
    url: assetUrl,
    rawBytes: bytes.length,
    gzipBytes: zlib.gzipSync(bytes, { level: 9 }).length,
  };
}

function initialRouteAssets(manifest, routeId) {
  const route = manifest.routes[routeId];
  assert.ok(route, `Missing route in React Router manifest: ${routeId}`);
  const rootRoute = manifest.routes.root;
  const urls = [
    manifest.entry.module,
    ...(manifest.entry.imports || []),
    ...(manifest.entry.css || []),
    rootRoute.module,
    ...(rootRoute.imports || []),
    ...(rootRoute.css || []),
    route.module,
    ...(route.imports || []),
    ...(route.css || []),
  ];
  return [...new Set(urls)];
}

function evaluateFrontendBudgets({
  clientDir,
  budgetConfig,
  manifest = readReactRouterManifest(clientDir),
}) {
  const failures = [];
  const routeResults = [];
  const chunkResults = [];
  const rootCss = (manifest.routes.root.css || []).map((url) => assetStats(clientDir, url));
  const rootCssRawBytes = rootCss.reduce((sum, asset) => sum + asset.rawBytes, 0);

  if (rootCssRawBytes > budgetConfig.rootCssRawBytes) {
    failures.push(
      `Global CSS is ${rootCssRawBytes} bytes; budget is ${budgetConfig.rootCssRawBytes}. `
      + 'Keep feature styles on their routes.'
    );
  }

  for (const [routeId, routeBudget] of Object.entries(budgetConfig.routes)) {
    const urls = initialRouteAssets(manifest, routeId);
    const assets = urls.map((url) => assetStats(clientDir, url));
    const rawBytes = assets.reduce((sum, asset) => sum + asset.rawBytes, 0);
    const gzipBytes = assets.reduce((sum, asset) => sum + asset.gzipBytes, 0);
    routeResults.push({
      routeId,
      label: routeBudget.label,
      rawBytes,
      gzipBytes,
      assetCount: assets.length,
    });

    if (rawBytes > routeBudget.maxInitialRawBytes) {
      failures.push(
        `${routeBudget.label} initial assets are ${rawBytes} raw bytes; `
        + `budget is ${routeBudget.maxInitialRawBytes}.`
      );
    }
    if (gzipBytes > routeBudget.maxInitialGzipBytes) {
      failures.push(
        `${routeBudget.label} initial assets are ${gzipBytes} gzip bytes; `
        + `budget is ${routeBudget.maxInitialGzipBytes}.`
      );
    }
  }

  for (const [routeId, moduleName] of Object.entries(budgetConfig.deferredModules || {})) {
    const route = manifest.routes[routeId];
    assert.ok(route, `Missing deferred-module route: ${routeId}`);
    const eagerMatch = (route.imports || []).find((url) => (
      new RegExp(`/assets/${moduleName}-`, 'u').test(url)
    ));
    if (eagerMatch) {
      failures.push(`${routeId} eagerly imports deferred module ${moduleName}: ${eagerMatch}`);
    }
  }

  const assetsDir = path.join(clientDir, 'assets');
  const assetNames = fs.readdirSync(assetsDir);
  for (const [chunkName, chunkBudget] of Object.entries(budgetConfig.chunkBudgets || {})) {
    const pattern = new RegExp(`^${chunkName}-[A-Za-z0-9_-]+\\.js$`, 'u');
    const matches = assetNames.filter((name) => pattern.test(name));
    if (matches.length !== 1) {
      failures.push(`Expected one ${chunkName} JavaScript chunk, found ${matches.length}.`);
      continue;
    }
    const asset = assetStats(clientDir, `/assets/${matches[0]}`);
    chunkResults.push({
      name: chunkName,
      ...asset,
    });
    if (asset.rawBytes > chunkBudget.maxRawBytes) {
      failures.push(
        `${chunkName} is ${asset.rawBytes} raw bytes; budget is ${chunkBudget.maxRawBytes}.`
      );
    }
    if (asset.gzipBytes > chunkBudget.maxGzipBytes) {
      failures.push(
        `${chunkName} is ${asset.gzipBytes} gzip bytes; budget is ${chunkBudget.maxGzipBytes}.`
      );
    }
  }

  return { failures, rootCssRawBytes, routeResults, chunkResults };
}

function formatKilobytes(bytes) {
  return `${(bytes / 1000).toFixed(1)} kB`;
}

function main() {
  const clientDir = path.join(root, 'build/client');
  const budgetConfig = JSON.parse(
    fs.readFileSync(path.join(root, 'config/frontend-asset-budgets.json'), 'utf8')
  );
  const result = evaluateFrontendBudgets({ clientDir, budgetConfig });

  process.stdout.write(`Global CSS: ${formatKilobytes(result.rootCssRawBytes)} raw\n`);
  for (const route of result.routeResults) {
    process.stdout.write(
      `${route.label}: ${formatKilobytes(route.rawBytes)} raw / `
      + `${formatKilobytes(route.gzipBytes)} gzip (${route.assetCount} initial assets)\n`
    );
  }
  for (const chunk of result.chunkResults) {
    process.stdout.write(
      `${chunk.name}: ${formatKilobytes(chunk.rawBytes)} raw / `
      + `${formatKilobytes(chunk.gzipBytes)} gzip (deferred)\n`
    );
  }

  if (result.failures.length) {
    process.stderr.write(`Frontend asset budget failed:\n- ${result.failures.join('\n- ')}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('Frontend asset budgets OK\n');
}

if (require.main === module) main();

module.exports = {
  evaluateFrontendBudgets,
  initialRouteAssets,
  readReactRouterManifest,
};
