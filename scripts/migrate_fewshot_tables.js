const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || './data/trilingual_records.db';
const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');

if (!fs.existsSync(schemaPath)) {
  console.error('[migrate] schema.sql not found:', schemaPath);
  process.exit(1);
}

const schema = fs.readFileSync(schemaPath, 'utf-8');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

try {
  db.exec(schema);
  console.log('[migrate] few_shot tables ensured.');
} catch (err) {
  console.error('[migrate] failed:', err.message);
  process.exit(1);
} finally {
  db.close();
}
