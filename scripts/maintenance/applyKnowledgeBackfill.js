'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { applyKnowledgeBackfill } = require('../../services/kg/application/applyKnowledgeBackfill');

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || null;
}

function requiredArgument(name) {
  const value = argument(name);
  if (!value) throw new Error(`--${name}=... is required`);
  return value;
}

function unusedOutputPath(value, label) {
  const target = path.resolve(value);
  if (fs.existsSync(target)) throw new Error(`${label} already exists: ${target}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  return target;
}

async function run() {
  if (!process.argv.includes('--apply')) {
    throw new Error('Refusing to mutate data without --apply');
  }
  const dbPath = path.resolve(argument('db') || process.env.DB_PATH || './data/trilingual_records.db');
  const expectedManifestHash = requiredArgument('expected-manifest-hash');
  const backupPath = unusedOutputPath(requiredArgument('backup'), 'Backup path');
  const reportPath = unusedOutputPath(requiredArgument('report'), 'Report path');
  if (backupPath === dbPath || reportPath === dbPath || backupPath === reportPath) {
    throw new Error('Database, backup, and report paths must be distinct');
  }

  const db = new Database(dbPath, { fileMustExist: true });
  try {
    await db.backup(backupPath);
    const report = await applyKnowledgeBackfill({ db, expectedManifestHash });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`${JSON.stringify({
      backupPath,
      reportPath,
      manifestHash: report.manifestHash,
      reportHash: report.reportHash,
      inserted: report.inserted,
      unresolved: report.unresolved,
      projection: report.projection,
    }, null, 2)}\n`);
  } finally {
    db.close();
  }
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
