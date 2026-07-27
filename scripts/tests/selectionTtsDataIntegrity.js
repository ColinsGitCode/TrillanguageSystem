#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const DEFAULT_TABLE_PREFIXES = ['card_annotation', 'kg_', 'learning_', 'study_items'];
const SQLITE_FILE = /\.(?:db|sqlite)(?:-(?:shm|wal))?$/iu;

function stableValue(value) {
  if (Buffer.isBuffer(value)) return { bufferSha256: crypto.createHash('sha256').update(value).digest('hex') };
  return value;
}

function snapshotDatabase(dbPath) {
  const database = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const available = database.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
      ORDER BY name
    `).all().map((row) => row.name);
    const tables = available.filter((name) => (
      DEFAULT_TABLE_PREFIXES.some((prefix) => name === prefix || name.startsWith(prefix))
    ));
    const hashes = {};
    for (const table of tables) {
      const escaped = table.replace(/"/g, '""');
      const rows = database.prepare(`SELECT * FROM "${escaped}" ORDER BY rowid`).all();
      const serialized = JSON.stringify(rows, (_key, value) => stableValue(value));
      hashes[table] = {
        rows: rows.length,
        sha256: crypto.createHash('sha256').update(serialized).digest('hex'),
      };
    }
    return {
      dbPath: path.resolve(dbPath),
      generatedAtUtc: new Date().toISOString(),
      tables: hashes,
      aggregateSha256: crypto.createHash('sha256')
        .update(JSON.stringify(hashes))
        .digest('hex'),
    };
  } finally {
    database.close();
  }
}

function snapshotRecords(recordsPath) {
  const rootPath = path.resolve(recordsPath);
  const entries = [];
  const visit = (directory) => {
    const children = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const absolute = path.join(directory, child.name);
      const relative = path.relative(rootPath, absolute);
      if (child.isDirectory()) {
        visit(absolute);
      } else if (child.isSymbolicLink()) {
        entries.push({
          path: relative,
          kind: 'symlink',
          target: fs.readlinkSync(absolute),
        });
      } else if (child.isFile() && !SQLITE_FILE.test(child.name)) {
        const stat = fs.statSync(absolute);
        entries.push({
          path: relative,
          kind: 'file',
          bytes: stat.size,
          sha256: crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'),
        });
      }
    }
  };
  visit(rootPath);
  return {
    rootPath,
    files: entries.length,
    bytes: entries.reduce((sum, entry) => sum + Number(entry.bytes || 0), 0),
    aggregateSha256: crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex'),
  };
}

function parseArgs(argv) {
  const args = { db: process.env.DB_PATH || './data/trilingual_records.db' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--db') args.db = argv[++index];
    else if (argv[index] === '--records') args.records = argv[++index];
    else if (argv[index] === '--output') args.output = argv[++index];
    else if (argv[index] === '--compare') args.compare = argv[++index];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const database = snapshotDatabase(args.db);
  const records = args.records ? snapshotRecords(args.records) : null;
  const snapshot = {
    database,
    records,
    aggregateSha256: crypto.createHash('sha256').update(JSON.stringify({
      database: database.aggregateSha256,
      records: records?.aggregateSha256 || null,
    })).digest('hex'),
  };
  if (args.compare) {
    const expected = JSON.parse(fs.readFileSync(args.compare, 'utf8'));
    if (expected.aggregateSha256 !== snapshot.aggregateSha256) {
      console.error(JSON.stringify({ success: false, expected, actual: snapshot }, null, 2));
      process.exitCode = 1;
      return;
    }
    snapshot.matches = true;
  }
  const output = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (args.output) fs.writeFileSync(args.output, output);
  else process.stdout.write(output);
}

if (require.main === module) main();

module.exports = { snapshotDatabase, snapshotRecords };
