#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const baseUrlArg = process.argv.find((arg) => arg.startsWith('--base-url='));
const sampleArg = process.argv.find((arg) => arg.startsWith('--samples='));
const baseUrl = (baseUrlArg?.slice('--base-url='.length) || 'http://127.0.0.1:3010').replace(/\/$/u, '');
const samplePath = path.resolve(sampleArg?.slice('--samples='.length) || path.join(
  __dirname, '../../tests/fixtures/local-glossary-r1-samples.json'
));

function matchesExpected(gloss, expected = []) {
  const normalized = String(gloss || '').normalize('NFKC').toLocaleLowerCase('zh-CN');
  return expected.some((keyword) => normalized.includes(String(keyword).normalize('NFKC').toLocaleLowerCase('zh-CN')));
}

async function lookup(sample) {
  const params = new URLSearchParams({ language: sample.language, text: sample.text });
  if (sample.reading) params.set('reading', sample.reading);
  if (sample.context) params.set('context', sample.context);
  const started = performance.now();
  const response = await fetch(`${baseUrl}/api/local-glossary/lookup?${params}`);
  const latencyMs = Math.round((performance.now() - started) * 10) / 10;
  const payload = await response.json();
  const gloss = response.ok ? payload.lookup?.gloss : null;
  return {
    ...sample,
    statusCode: response.status,
    lookupStatus: payload.lookup?.status || 'error',
    zhGloss: gloss?.zhGloss || '',
    source: gloss?.sourceDetail || gloss?.sourceKind || '',
    confidence: gloss?.confidence || '',
    alternativeCount: payload.lookup?.alternatives?.length || 0,
    latencyMs,
    expectedMatched: response.ok && matchesExpected(gloss?.zhGloss, sample.expectedAny),
  };
}

function summarize(results, language) {
  const rows = results.filter((result) => result.language === language);
  const successful = rows.filter((result) => result.statusCode === 200 && result.zhGloss);
  const direct = successful.filter((result) => result.source.includes('直接日中'));
  const bridge = successful.filter((result) => result.source.includes('桥接'));
  const matched = rows.filter((result) => result.expectedMatched);
  const latencies = successful.map((result) => result.latencyMs).sort((a, b) => a - b);
  return {
    sampleCount: rows.length,
    hitCount: successful.length,
    hitRate: successful.length / rows.length,
    expectedMatchCount: matched.length,
    expectedMatchRate: matched.length / rows.length,
    directCount: direct.length,
    bridgeCount: bridge.length,
    medianLatencyMs: latencies[Math.floor(latencies.length / 2)] || null,
    maxLatencyMs: latencies.at(-1) || null,
  };
}

async function main() {
  const samplePayload = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  const catalogResponse = await fetch(`${baseUrl}/api/local-glossary/catalog`);
  if (!catalogResponse.ok) throw new Error(`catalog request failed (${catalogResponse.status})`);
  const catalog = (await catalogResponse.json()).catalog;
  const results = [];
  for (const sample of samplePayload.samples) results.push(await lookup(sample));
  const report = {
    observedAt: new Date().toISOString(),
    baseUrl,
    sampleVersion: samplePayload.version,
    catalog,
    summary: { en: summarize(results, 'en'), ja: summarize(results, 'ja') },
    failures: results.filter((result) => !result.expectedMatched),
    results,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.summary.en.hitRate < 0.9 || report.summary.ja.hitRate < 0.9) process.exitCode = 2;
}

main().catch((error) => {
  console.error(`DIC-R1 observation failed: ${error.message}`);
  process.exitCode = 1;
});
