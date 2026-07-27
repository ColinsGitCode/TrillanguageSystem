'use strict';

const {
  buildAnnotationMigrationPlan,
} = require('../../services/annotations/application/buildAnnotationMigrationPlan');
const {
  applyAnnotationMigrationPlan,
} = require('../../services/annotations/application/applyAnnotationMigrationPlan');
const dbService = require('../../services/storage/databaseService');

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || null;
}

async function run() {
  if (!process.argv.includes('--apply')) {
    throw new Error('Refusing to write without --apply');
  }
  const expectedPlanHash = argument('expected-plan-hash');
  if (!expectedPlanHash) {
    throw new Error('--expected-plan-hash=<sha256> is required');
  }
  const plan = await buildAnnotationMigrationPlan({ db: dbService.db });
  const result = applyAnnotationMigrationPlan({
    dbService,
    plan,
    expectedPlanHash,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
}).finally(() => {
  dbService.close();
});
