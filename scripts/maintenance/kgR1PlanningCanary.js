'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
  DEFAULT_DAILY_ACTION_GOAL,
  DEFAULT_DAILY_NEW_LIMIT,
  DEFAULT_ITERATIONS,
  runPlanningCanary,
} = require('../../services/kg/application/runPlanningCanary');

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || null;
}

function integerArgument(name, fallback) {
  const value = argument(name);
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`--${name}=... must be a positive integer`);
  return parsed;
}

function requiredOutputPath() {
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

function run() {
  const dbPath = path.resolve(argument('db') || process.env.DB_PATH || './data/trilingual_records.db');
  const outputPath = requiredOutputPath();
  if (dbPath === outputPath) throw new Error('Database and report paths must be distinct');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const report = runPlanningCanary({
      db,
      nowUtc: argument('now-utc') || undefined,
      dailyActionGoal: integerArgument('daily-action-goal', DEFAULT_DAILY_ACTION_GOAL),
      dailyNewLimit: integerArgument('daily-new-limit', DEFAULT_DAILY_NEW_LIMIT),
      iterations: integerArgument('iterations', DEFAULT_ITERATIONS),
    });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`${JSON.stringify({
      output: outputPath,
      reportHash: report.reportHash,
      overallPass: report.overallPass,
      gates: report.gates,
      candidateRowCount: report.canary.candidateRowCount,
      selectedCount: report.canary.enabled.ids.length,
      graphEntries: report.canary.graphEntries,
      readerPerformance: report.readerPerformance,
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
