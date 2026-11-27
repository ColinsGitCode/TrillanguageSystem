'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const {
  loadValidatedPublicKey,
  parseEnvelopeFile,
  publicKeyFingerprint,
  sealFile,
} = require('./envelope');
const {
  RUN_ID_RE,
  assertPrivateFile,
  assertSafeRelativePath,
  tarEnv,
  ensurePrivateDir,
  sha256FileSync,
  writePrivateJsonAtomic,
} = require('./fsGuards');

const BACKUP_SCHEMA = 'threelans.core-backup.v1';
const MANIFEST_SCHEMA = 'threelans.core-backup-manifest.v1';
const ARCHIVE_NAME_RE = /^threelans-core-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}\.tlans$/;

const CORE_TABLES = Object.freeze([
  'generations',
  'audio_files',
  'card_annotations',
  'study_items',
  'learning_review_events',
  'learning_plans',
  'textbook_courses',
  'textbook_tracks',
  'textbook_expressions',
  'kg_points',
  'local_glossary_entries',
  'local_dictionary_entries',
  'sentence_practice_attempts',
]);

const EXCLUDED_TOP_LEVEL_RECORD_DIRS = new Set([
  'backups',
  'kg-r0',
  'kg-r1',
  'kg-r2',
]);

const EXCLUDED_RECORD_EXTS = new Set(['.db', '.db-wal', '.db-shm', '.sqlite', '.bak']);
const CARD_AUDIO_EXTS = new Set(['.mp3', '.wav']);

function generateRunId(now = new Date()) {
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `${iso}-${crypto.randomBytes(4).toString('hex')}`;
}

function archiveNameForRunId(runId) {
  if (!RUN_ID_RE.test(runId)) throw new Error('invalid_run_id');
  return `threelans-core-${runId}.tlans`;
}

function inspectSqliteFile(dbPath) {
  let Database = null;
  try {
    Database = require('better-sqlite3');
  } catch {}

  if (Database) {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const integrityRows = db.pragma('integrity_check');
      const integrityOk = Array.isArray(integrityRows)
        && integrityRows.length === 1
        && integrityRows[0].integrity_check === 'ok';
      if (!integrityOk) {
        throw new Error('sqlite_integrity_check_failed');
      }
      const fkRows = db.pragma('foreign_key_check');
      let schemaVersion = null;
      try {
        const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
        schemaVersion = row && row.v ? String(row.v) : null;
      } catch {}
      const tableCounts = {};
      for (const table of CORE_TABLES) {
        try {
          const row = db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get();
          tableCounts[table] = Number(row.c);
        } catch {
          tableCounts[table] = null;
        }
      }
      return {
        integrity: 'ok',
        foreign_key_violations: Array.isArray(fkRows) ? fkRows.length : 0,
        schema_version: schemaVersion,
        table_counts: tableCounts,
      };
    } finally {
      db.close();
    }
  }

  // Fallback to system sqlite3 CLI (e.g., on minimal recovery machines without node_modules).
  const integrityOut = execFileSync(
    'sqlite3',
    ['-readonly', dbPath, 'PRAGMA integrity_check;'],
    { encoding: 'utf8', timeout: 120_000 }
  ).trim();
  if (integrityOut !== 'ok') {
    throw new Error('sqlite_integrity_check_failed');
  }
  const fkOut = execFileSync(
    'sqlite3',
    ['-readonly', dbPath, 'PRAGMA foreign_key_check;'],
    { encoding: 'utf8', timeout: 120_000 }
  ).trim();
  const fkViolations = fkOut ? fkOut.split('\n').filter(Boolean).length : 0;

  let schemaVersion = null;
  try {
    const v = execFileSync(
      'sqlite3',
      ['-readonly', dbPath, 'SELECT MAX(version) FROM schema_migrations;'],
      { encoding: 'utf8', timeout: 30_000 }
    ).trim();
    if (v) schemaVersion = v;
  } catch {}

  const tableCounts = {};
  for (const table of CORE_TABLES) {
    try {
      const c = execFileSync(
        'sqlite3',
        ['-readonly', dbPath, `SELECT COUNT(*) FROM "${table}";`],
        { encoding: 'utf8', timeout: 30_000 }
      ).trim();
      tableCounts[table] = c === '' ? null : Number(c);
    } catch {
      tableCounts[table] = null;
    }
  }
  return {
    integrity: 'ok',
    foreign_key_violations: fkViolations,
    schema_version: schemaVersion,
    table_counts: tableCounts,
  };
}

function finalizeStandaloneSqliteSnapshot(destDbPath) {
  let Database = null;
  try {
    Database = require('better-sqlite3');
  } catch {}

  if (Database) {
    const snapDb = new Database(destDbPath, { fileMustExist: true });
    try {
      snapDb.pragma('journal_mode = DELETE');
    } finally {
      snapDb.close();
    }
  } else {
    execFileSync('sqlite3', [destDbPath, 'PRAGMA journal_mode=DELETE;'], {
      timeout: 60_000,
      stdio: 'pipe',
    });
  }
  for (const suffix of ['-wal', '-shm']) {
    try { fs.unlinkSync(`${destDbPath}${suffix}`); } catch {}
  }
}

async function backupLocalSqlite(sourceDbPath, destDbPath) {
  ensurePrivateDir(path.dirname(destDbPath));
  let Database = null;
  try {
    Database = require('better-sqlite3');
  } catch {}

  if (Database) {
    const db = new Database(sourceDbPath, { fileMustExist: true });
    try {
      await db.backup(destDbPath);
    } finally {
      db.close();
    }
    finalizeStandaloneSqliteSnapshot(destDbPath);
    fs.chmodSync(destDbPath, 0o600);
    return inspectSqliteFile(destDbPath);
  }

  const escapedDest = destDbPath.replace(/'/g, "''");
  execFileSync('sqlite3', [sourceDbPath, `.backup '${escapedDest}'`], {
    timeout: 300_000,
    stdio: 'pipe',
  });
  finalizeStandaloneSqliteSnapshot(destDbPath);
  fs.chmodSync(destDbPath, 0o600);
  return inspectSqliteFile(destDbPath);
}

function shouldIncludeRecordFile(relPath, { includeCardAudio = false } = {}) {
  const safe = assertSafeRelativePath(relPath);
  const parts = safe.split('/');
  if (EXCLUDED_TOP_LEVEL_RECORD_DIRS.has(parts[0])) return false;
  const base = parts[parts.length - 1];
  if (base.startsWith('._') || base === '.DS_Store') return false;
  if (
    base === 'app.db'
    || base === 'trilingual_records.db'
    || base === 'trilingual_records.db-wal'
    || base === 'trilingual_records.db-shm'
  ) {
    return false;
  }
  const ext = path.extname(base).toLowerCase();
  if (EXCLUDED_RECORD_EXTS.has(ext)) return false;
  if (!includeCardAudio && CARD_AUDIO_EXTS.has(ext)) return false;
  return true;
}

function copyFilteredTree(sourceRoot, destRoot, filterFn) {
  if (!sourceRoot || !fs.existsSync(sourceRoot)) return 0;
  let copied = 0;
  function walk(curDir, relPrefix) {
    const entries = fs.readdirSync(curDir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const srcPath = path.join(curDir, entry.name);
      if (entry.isDirectory()) {
        if (filterFn && !filterFn(rel, { isDir: true })) continue;
        walk(srcPath, rel);
      } else if (entry.isFile()) {
        if (filterFn && !filterFn(rel, { isDir: false })) continue;
        const safeRel = assertSafeRelativePath(rel);
        const destPath = path.join(destRoot, safeRel);
        ensurePrivateDir(path.dirname(destPath));
        fs.copyFileSync(srcPath, destPath);
        fs.chmodSync(destPath, 0o600);
        copied += 1;
      }
    }
  }
  walk(sourceRoot, '');
  return copied;
}

function streamCommandToFile(command, args, destPath, { timeout = 300_000 } = {}) {
  ensurePrivateDir(path.dirname(destPath));
  const flags = fs.constants.O_WRONLY
    | fs.constants.O_CREAT
    | fs.constants.O_TRUNC
    | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(destPath, flags, 0o600);
  let res;
  try {
    res = spawnSync(command, args, {
      stdio: ['ignore', fd, 'pipe'],
      timeout,
    });
  } finally {
    fs.closeSync(fd);
  }
  if (res.status !== 0) {
    const stderr = (res.stderr || '').toString('utf8').slice(0, 200);
    throw new Error(`command_stream_failed:${stderr || res.status}`);
  }
  return fs.statSync(destPath).size;
}

function extractTarFileToDir(tarFilePath, destDir) {
  ensurePrivateDir(destDir);
  if (!fs.existsSync(tarFilePath) || fs.statSync(tarFilePath).size === 0) return;
  const res = spawnSync('tar', ['-xf', tarFilePath, '-C', destDir], {
    timeout: 300_000,
    env: tarEnv({ COPYFILE_DISABLE: '1' }),
    stdio: 'pipe',
  });
  if (res.status !== 0) {
    throw new Error(`tar_extract_failed:${(res.stderr || '').toString('utf8').slice(0, 160)}`);
  }
}

function collectFromDockerCompose({
  composeCommand,
  viewerService = 'viewer',
  stagingDir,
  workDir,
  includeCardAudio = false,
  includeTextbooks = true,
  textbookSourcesDir = null,
}) {
  const dbDest = path.join(stagingDir, 'db', 'trilingual_records.db');
  ensurePrivateDir(path.dirname(dbDest));

  // 1. Online consistent SQLite snapshot inside viewer container via better-sqlite3 .backup()
  const snapName = `/tmp/tlans-backup-${crypto.randomBytes(6).toString('hex')}.db`;
  const containerBackupScript = [
    'const fs = require("fs");',
    'const Database = require("better-sqlite3");',
    `const snap = ${JSON.stringify(snapName)};`,
    '(async () => {',
    '  const db = new Database("/data/trilingual_records/trilingual_records.db", { fileMustExist: true });',
    '  try { await db.backup(snap); } finally { db.close(); }',
    '  const snapDb = new Database(snap, { fileMustExist: true });',
    '  try { snapDb.pragma("journal_mode = DELETE"); } finally { snapDb.close(); }',
    '  for (const s of ["-wal", "-shm"]) { try { fs.unlinkSync(snap + s); } catch {} }',
    '  fs.chmodSync(snap, 0o600);',
    '})().catch((err) => { console.error(err.message || err); process.exit(1); });',
  ].join('\n');

  try {
    execFileSync(composeCommand, ['exec', '-T', viewerService, 'node', '-e', containerBackupScript], {
      timeout: 300_000,
      stdio: 'pipe',
    });
    const dbBytes = streamCommandToFile(
      composeCommand,
      ['exec', '-T', viewerService, 'cat', snapName],
      dbDest
    );
    if (dbBytes === 0) {
      throw new Error('docker_sqlite_snapshot_empty');
    }
  } finally {
    try {
      execFileSync(composeCommand, ['exec', '-T', viewerService, 'rm', '-f', snapName], {
        timeout: 30_000,
        stdio: 'ignore',
      });
    } catch {}
  }

  const sqliteInfo = inspectSqliteFile(dbDest);

  // 2. Active card files from /data/trilingual_records (BusyBox tar compatible newline -T list)
  const listFile = `/tmp/tlans-list-${crypto.randomBytes(6).toString('hex')}.txt`;
  const tarListScript = [
    'const fs = require("fs");',
    'const path = require("path");',
    `const includeAudio = ${JSON.stringify(Boolean(includeCardAudio))};`,
    `const listOut = ${JSON.stringify(listFile)};`,
    'const skipDirs = new Set(["backups", "kg-r0", "kg-r1", "kg-r2"]);',
    'const skipExts = new Set([".db", ".db-wal", ".db-shm", ".sqlite", ".bak"]);',
    'const audioExts = new Set([".mp3", ".wav"]);',
    'const out = [];',
    'function walk(dir, rel) {',
    '  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {',
    '    if (e.isSymbolicLink() || e.name.includes("\\n")) continue;',
    '    const r = rel ? rel + "/" + e.name : e.name;',
    '    if (e.isDirectory()) {',
    '      if (!rel && skipDirs.has(e.name)) continue;',
    '      walk(path.join(dir, e.name), r);',
    '    } else if (e.isFile()) {',
    '      if (e.name === "app.db" || e.name.startsWith("trilingual_records.db") || e.name.startsWith("._") || e.name === ".DS_Store") continue;',
    '      const ext = path.extname(e.name).toLowerCase();',
    '      if (skipExts.has(ext)) continue;',
    '      if (!includeAudio && audioExts.has(ext)) continue;',
    '      out.push(r);',
    '    }',
    '  }',
    '}',
    'walk("/data/trilingual_records", "");',
    'out.sort();',
    'fs.writeFileSync(listOut, out.length ? out.join("\\n") + "\\n" : "", { mode: 0o600 });',
  ].join('\n');

  const recordsTarPath = path.join(workDir, 'records.tar');
  try {
    execFileSync(composeCommand, ['exec', '-T', viewerService, 'node', '-e', tarListScript], {
      timeout: 120_000,
      stdio: 'pipe',
    });
    streamCommandToFile(
      composeCommand,
      [
        'exec', '-T', viewerService, 'sh', '-c',
        `if [ -s "${listFile}" ]; then tar -C /data/trilingual_records -T "${listFile}" -cf -; fi`,
      ],
      recordsTarPath
    );
    extractTarFileToDir(recordsTarPath, path.join(stagingDir, 'records'));
  } finally {
    try {
      execFileSync(composeCommand, ['exec', '-T', viewerService, 'rm', '-f', listFile], {
        timeout: 30_000,
        stdio: 'ignore',
      });
    } catch {}
    try { fs.unlinkSync(recordsTarPath); } catch {}
  }

  // 3. Textbook assets (work volume + host source dir)
  if (includeTextbooks) {
    const tbWorkTarPath = path.join(workDir, 'textbook_work.tar');
    try {
      streamCommandToFile(
        composeCommand,
        [
          'exec', '-T', viewerService, 'sh', '-c',
          'if [ -d /data/textbooks ] && [ "$(ls -A /data/textbooks 2>/dev/null)" ]; then tar -C /data/textbooks -cf - .; fi',
        ],
        tbWorkTarPath
      );
      extractTarFileToDir(tbWorkTarPath, path.join(stagingDir, 'textbook_work'));
    } finally {
      try { fs.unlinkSync(tbWorkTarPath); } catch {}
    }

    if (textbookSourcesDir && fs.existsSync(textbookSourcesDir)) {
      copyFilteredTree(
        textbookSourcesDir,
        path.join(stagingDir, 'textbook_sources'),
        (rel, { isDir }) => {
          const base = path.basename(rel);
          if (base.startsWith('._') || base === '.DS_Store') return false;
          return isDir || true;
        }
      );
    }
  }

  return sqliteInfo;
}

async function collectFromLocalDirs({
  dbPath,
  recordsDir = null,
  textbookWorkDir = null,
  textbookSourcesDir = null,
  stagingDir,
  includeCardAudio = false,
  includeTextbooks = true,
}) {
  const dbDest = path.join(stagingDir, 'db', 'trilingual_records.db');
  const sqliteInfo = await backupLocalSqlite(dbPath, dbDest);

  if (recordsDir && fs.existsSync(recordsDir)) {
    copyFilteredTree(
      recordsDir,
      path.join(stagingDir, 'records'),
      (rel, { isDir }) => {
        const parts = rel.split('/');
        if (EXCLUDED_TOP_LEVEL_RECORD_DIRS.has(parts[0])) return false;
        if (isDir) return true;
        return shouldIncludeRecordFile(rel, { includeCardAudio });
      }
    );
  }

  if (includeTextbooks) {
    if (textbookWorkDir && fs.existsSync(textbookWorkDir)) {
      copyFilteredTree(
        textbookWorkDir,
        path.join(stagingDir, 'textbook_work'),
        (rel) => {
          const base = path.basename(rel);
          return !base.startsWith('._') && base !== '.DS_Store';
        }
      );
    }
    if (textbookSourcesDir && fs.existsSync(textbookSourcesDir)) {
      copyFilteredTree(
        textbookSourcesDir,
        path.join(stagingDir, 'textbook_sources'),
        (rel) => {
          const base = path.basename(rel);
          return !base.startsWith('._') && base !== '.DS_Store';
        }
      );
    }
  }

  return sqliteInfo;
}

function indexStagedFiles(stagingDir) {
  const files = {};
  function walk(curDir, relPrefix) {
    const entries = fs.readdirSync(curDir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        throw new Error('symlink_forbidden_in_backup_staging');
      }
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const fullPath = path.join(curDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, rel);
      } else if (entry.isFile()) {
        const safeRel = assertSafeRelativePath(rel).normalize('NFC');
        if (Object.prototype.hasOwnProperty.call(files, safeRel)) {
          throw new Error('duplicate_nfc_filename_in_backup_staging');
        }
        const { sha256, size } = sha256FileSync(fullPath);
        files[safeRel] = { size, sha256 };
      }
    }
  }
  walk(stagingDir, '');
  return files;
}

async function createEncryptedSnapshot({
  outboxDir,
  publicKeyPath,
  expectedRecipientSha256,
  origin = 'manual',
  sourceMode = 'docker-compose',
  composeCommand = '/Users/colin/ThreeLANS/bin/compose',
  viewerService = 'viewer',
  dbPath = null,
  recordsDir = null,
  textbookWorkDir = null,
  textbookSourcesDir = null,
  includeCardAudio = false,
  includeTextbooks = true,
  now = new Date(),
  runId = null,
}) {
  assertPrivateFile(publicKeyPath, { maxBytes: 16384 });
  const publicPem = fs.readFileSync(publicKeyPath);
  const pubKey = loadValidatedPublicKey(publicPem);
  const actualRecipient = publicKeyFingerprint(pubKey);
  if (actualRecipient !== expectedRecipientSha256) {
    throw new Error('public_key_recipient_fingerprint_mismatch');
  }

  const effectiveRunId = runId || generateRunId(now);
  const archiveName = archiveNameForRunId(effectiveRunId);
  ensurePrivateDir(outboxDir);
  const archivePath = path.join(outboxDir, archiveName);
  const metaPath = path.join(outboxDir, `${effectiveRunId}.json`);
  if (fs.existsSync(archivePath) || fs.existsSync(metaPath)) {
    throw new Error('backup_run_id_already_exists');
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tlans-backup-stage-'));
  fs.chmodSync(workDir, 0o700);
  const stagingDir = path.join(workDir, 'payload');
  ensurePrivateDir(stagingDir);

  try {
    let sqliteInfo;
    if (sourceMode === 'docker-compose') {
      sqliteInfo = collectFromDockerCompose({
        composeCommand,
        viewerService,
        stagingDir,
        workDir,
        includeCardAudio,
        includeTextbooks,
        textbookSourcesDir,
      });
    } else if (sourceMode === 'local') {
      if (!dbPath) throw new Error('local_db_path_required');
      sqliteInfo = await collectFromLocalDirs({
        dbPath,
        recordsDir,
        textbookWorkDir,
        textbookSourcesDir,
        stagingDir,
        includeCardAudio,
        includeTextbooks,
      });
    } else {
      throw new Error('unsupported_backup_source_mode');
    }

    const fileIndex = indexStagedFiles(stagingDir);
    if (!fileIndex['db/trilingual_records.db']) {
      throw new Error('sqlite_snapshot_missing_in_staging');
    }

    const manifest = {
      schema: MANIFEST_SCHEMA,
      backup_schema: BACKUP_SCHEMA,
      run_id: effectiveRunId,
      run_origin: origin,
      created_at: now.toISOString(),
      host: os.hostname(),
      source_mode: sourceMode,
      include_card_audio: Boolean(includeCardAudio),
      include_textbooks: Boolean(includeTextbooks),
      sqlite: sqliteInfo,
      file_count: Object.keys(fileIndex).length,
      files: fileIndex,
    };
    writePrivateJsonAtomic(path.join(stagingDir, 'manifest.json'), manifest);

    const tarPath = path.join(workDir, 'payload.tar.gz');
    const tarRes = spawnSync(
      'tar',
      ['-czf', tarPath, '-C', stagingDir, '.'],
      {
        timeout: 300_000,
        env: tarEnv({ COPYFILE_DISABLE: '1' }),
      }
    );
    if (tarRes.status !== 0) {
      throw new Error(`snapshot_tar_failed:${(tarRes.stderr || '').toString('utf8').slice(0, 160)}`);
    }
    fs.chmodSync(tarPath, 0o600);

    const sealed = sealFile(tarPath, archivePath, publicPem);
    const parsed = parseEnvelopeFile(archivePath);
    if (parsed.header.recipient_sha256 !== expectedRecipientSha256) {
      throw new Error('sealed_envelope_recipient_mismatch');
    }

    const entry = {
      schema: BACKUP_SCHEMA,
      run_id: effectiveRunId,
      name: archiveName,
      created_at: now.toISOString(),
      run_origin: origin,
      recipient_sha256: expectedRecipientSha256,
      size: sealed.size,
      sha256: sealed.sha256,
      plaintext_tar_bytes: sealed.header.plaintext_bytes,
      file_count: manifest.file_count,
      sqlite_schema_version: sqliteInfo.schema_version,
      include_card_audio: Boolean(includeCardAudio),
      include_textbooks: Boolean(includeTextbooks),
    };
    writePrivateJsonAtomic(metaPath, entry);
    return { entry, archivePath, metaPath, manifest };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

module.exports = {
  BACKUP_SCHEMA,
  MANIFEST_SCHEMA,
  ARCHIVE_NAME_RE,
  CORE_TABLES,
  generateRunId,
  archiveNameForRunId,
  inspectSqliteFile,
  backupLocalSqlite,
  shouldIncludeRecordFile,
  createEncryptedSnapshot,
};
