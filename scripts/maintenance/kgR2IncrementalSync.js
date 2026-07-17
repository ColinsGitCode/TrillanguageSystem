'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { buildKnowledgeSyncPlan } = require('../../services/kg/application/buildKnowledgeSyncPlan');
const { runKnowledgeSyncMaintenance } = require('../../services/kg/application/runKnowledgeSyncMaintenance');

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || null;
}

function requiredArgument(name) {
  const value = argument(name);
  if (!value) throw new Error(`--${name}=... is required`);
  return value;
}

function unusedPath(value, label) {
  const target = path.resolve(value);
  if (fs.existsSync(target)) throw new Error(`${label} already exists: ${target}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  return target;
}

function outsideWorkspace(target) {
  const root = path.resolve(__dirname, '../..');
  if (target === root || target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`KG-R2 artifacts must stay outside the Git workspace: ${target}`);
  }
}

async function run() {
  const apply = process.argv.includes('--apply');
  const dbPath = path.resolve(argument('db') || process.env.DB_PATH || './data/trilingual_records.db');
  const outputPath = unusedPath(requiredArgument(apply ? 'report' : 'output'), apply ? 'Report path' : 'Output path');
  outsideWorkspace(outputPath);

  if (!apply) {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      db.pragma('query_only = ON');
      const plan = buildKnowledgeSyncPlan({ db });
      fs.writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx' });
      process.stdout.write(`${JSON.stringify({ output: outputPath, summary: plan.summary, planHash: plan.planHash }, null, 2)}\n`);
    } finally {
      db.close();
    }
    return;
  }

  const backupPath = unusedPath(requiredArgument('backup'), 'Backup path');
  outsideWorkspace(backupPath);
  if (new Set([dbPath, outputPath, backupPath]).size !== 3) {
    throw new Error('Database, backup, and report paths must be distinct');
  }
  const db = new Database(dbPath, { fileMustExist: true });
  try {
    await db.backup(backupPath);
    const report = await runKnowledgeSyncMaintenance({
      db,
      expectedPlanHash: requiredArgument('expected-plan-hash'),
    });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`${JSON.stringify({
      backup: backupPath,
      report: outputPath,
      planHash: report.planHash,
      reportHash: report.reportHash,
      queued: report.queued,
      after: report.after,
      overallPass: report.overallPass,
    }, null, 2)}\n`);
    if (!report.overallPass) process.exitCode = 2;
  } finally {
    db.close();
  }
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
