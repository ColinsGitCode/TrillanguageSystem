#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
  buildAnnotationObservation,
} = require('../../services/annotations/application/runAnnotationObservation');

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || null;
}

function outputPath() {
  const value = argument('output');
  if (!value) throw new Error('--output=... is required');
  const target = path.resolve(value);
  const repositoryRoot = path.resolve(__dirname, '../..');
  if (target === repositoryRoot || target.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error(`Output must stay outside the Git workspace: ${target}`);
  }
  if (fs.existsSync(target)) throw new Error(`Output already exists: ${target}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  return target;
}

function readBaseline() {
  const value = argument('baseline');
  if (!value) return null;
  return JSON.parse(fs.readFileSync(path.resolve(value), 'utf8'));
}

function flagEnabled(value) {
  return !/^(0|false|no|off)$/iu.test(String(value ?? 'true').trim());
}

function run() {
  const dbPath = path.resolve(argument('db') || process.env.DB_PATH || './data/trilingual_records.db');
  const target = outputPath();
  const repositoryRoot = path.resolve(argument('repository') || path.join(__dirname, '../..'));
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const report = buildAnnotationObservation({
      db,
      repositoryRoot,
      annotationsEnabled: flagEnabled(process.env.CARD_ANNOTATIONS_ENABLED),
      baseline: readBaseline(),
    });
    fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`${JSON.stringify({
      output: target,
      reportHash: report.reportHash,
      overallPass: report.overallPass,
      gates: report.gates,
      summary: report.summary,
    }, null, 2)}\n`);
    if (!report.overallPass) process.exitCode = 2;
  } finally {
    db.close();
  }
}

try {
  run();
} catch (error) {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
}
