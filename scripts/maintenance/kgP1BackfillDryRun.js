'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { buildKnowledgeBackfillManifest } = require('../../services/kg/application/buildKnowledgeBackfillManifest');

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || null;
}

async function run() {
  const dbPath = path.resolve(argument('db') || process.env.DB_PATH || './data/trilingual_records.db');
  const outputPath = argument('output');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const manifest = await buildKnowledgeBackfillManifest({ db });
    const output = `${JSON.stringify(manifest, null, 2)}\n`;
    if (outputPath) {
      const target = path.resolve(outputPath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, output, { flag: 'wx' });
      process.stdout.write(`${JSON.stringify({ output: target, summary: manifest.summary, manifestHash: manifest.manifestHash }, null, 2)}\n`);
    } else {
      process.stdout.write(output);
    }
  } finally {
    db.close();
  }
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
