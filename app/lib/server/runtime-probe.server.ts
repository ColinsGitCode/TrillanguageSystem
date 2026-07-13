import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const databaseService = require(path.resolve(process.cwd(), 'services/storage/databaseService.js'));

export function readRuntimeProbe() {
  return {
    database: 'better-sqlite3',
    generationCount: databaseService.getTotalCount(),
    moduleBoundary: 'React ESM -> CJS service',
    runtime: process.version
  };
}
