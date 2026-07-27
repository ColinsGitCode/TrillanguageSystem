'use strict';

const path = require('node:path');
const Database = require('better-sqlite3');
const {
  buildAnnotationMigrationPlan,
} = require('../../services/annotations/application/buildAnnotationMigrationPlan');

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || null;
}

async function run() {
  const dbPath = path.resolve(argument('db') || process.env.DB_PATH || './data/trilingual_records.db');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const plan = await buildAnnotationMigrationPlan({ db });
    process.stdout.write(`${JSON.stringify({
      schemaVersion: plan.schemaVersion,
      mode: plan.mode,
      projectionVersion: plan.projectionVersion,
      positionUnit: plan.positionUnit,
      summary: plan.summary,
      planHash: plan.planHash,
    }, null, 2)}\n`);
  } finally {
    db.close();
  }
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
