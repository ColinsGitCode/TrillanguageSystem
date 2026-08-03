'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

async function backupDatabase(sourcePath, destinationPath) {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  const db = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    await db.backup(destinationPath);
  } finally {
    db.close();
  }
  const verify = new Database(destinationPath, { readonly: true, fileMustExist: true });
  try {
    const integrity = verify.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`Backup integrity check failed: ${integrity}`);
  } finally {
    verify.close();
  }
  return { path: destinationPath, bytes: fs.statSync(destinationPath).size, sha256: sha256File(destinationPath), integrity: 'ok' };
}

function parseArgs(argv) {
  const args = { db: process.env.DB_PATH || './data/trilingual_records.db', outputDir: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--db') args.db = argv[++i];
    if (argv[i] === '--output-dir') args.outputDir = argv[++i];
  }
  return args;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.outputDir) {
    process.stderr.write('Refusing to write a backup without --output-dir\n');
    process.exitCode = 2;
  } else {
    const destination = path.join(path.resolve(args.outputDir), `trilingual_records-${new Date().toISOString().replace(/[:.]/gu, '-')}.db`);
    backupDatabase(path.resolve(args.db), destination)
      .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
      .catch((error) => {
        process.stderr.write(`${error.stack || error}\n`);
        process.exitCode = 1;
      });
  }
}

module.exports = { backupDatabase };
