'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { promptHidden } = require('./auth');
const {
  GoogleDriveClient,
  parseDriveTimestamp,
  validateFileId,
} = require('./driveClient');
const {
  MAX_ARCHIVE_BYTES,
  parseEnvelopeFile,
  publicKeyFingerprint,
  unsealFile,
} = require('./envelope');
const {
  RUN_ID_RE,
  SHA256_HEX_RE,
  assertPrivateFile,
  assertSafeRelativePath,
  ensurePrivateDir,
  readPrivateJson,
  sha256FileSync,
  stableStringify,
  writePrivateJsonAtomic,
} = require('./fsGuards');
const {
  ARCHIVE_NAME_RE,
  BACKUP_SCHEMA,
  MANIFEST_SCHEMA,
  archiveNameForRunId,
  inspectSqliteFile,
} = require('./snapshot');

const PLAN_SCHEMA = 'threelans.core-backup.drive-download.v1';
const DEFAULT_MAX_AGE_HOURS = 36;
const DEFAULT_WORK_ROOT = path.join(os.homedir(), '.threelans-core-recovery', 'drive-verification');

function selectLatestArchive(files, {
  folderId,
  expectedRecipient = null,
  runId = null,
  fileId = null,
}) {
  const candidates = [];
  for (const item of files) {
    const name = item && item.name;
    const props = (item && item.appProperties) || {};
    if (
      item.trashed !== false
      || item.shared !== false
      || !Array.isArray(item.parents)
      || !item.parents.includes(folderId)
      || typeof name !== 'string'
      || !ARCHIVE_NAME_RE.test(name)
    ) {
      continue;
    }
    if (fileId && item.id !== fileId) continue;
    if (runId && name !== archiveNameForRunId(runId)) continue;
    if (expectedRecipient && props.recipient_sha256 !== expectedRecipient) continue;
    if (props.schema && props.schema !== BACKUP_SCHEMA) continue;
    const created = parseDriveTimestamp(props.created_at || item.createdTime);
    candidates.push({ created, item });
  }
  if (candidates.length === 0) {
    throw new Error('no_matching_drive_archive_found');
  }
  candidates.sort((a, b) => a.created.getTime() - b.created.getTime());
  return candidates[candidates.length - 1].item;
}

async function downloadFromDrive({
  tokenFile,
  folderId,
  expectedRecipient = null,
  runId = null,
  fileId = null,
  maxAgeHours = DEFAULT_MAX_AGE_HOURS,
  outputRoot = DEFAULT_WORK_ROOT,
  client = null,
  now = null,
}) {
  const fid = validateFileId(folderId);
  if (expectedRecipient !== null && !SHA256_HEX_RE.test(expectedRecipient)) {
    throw new Error('invalid_recipient_sha256');
  }
  if (runId !== null && !RUN_ID_RE.test(runId)) {
    throw new Error('invalid_run_id');
  }
  if (fileId !== null) {
    validateFileId(fileId);
  }

  const drive = client || GoogleDriveClient.fromTokenFile(tokenFile);
  await drive.verifyPrivateFolder(fid);
  const files = await drive.listFolderFiles(fid);
  const chosen = selectLatestArchive(files, {
    folderId: fid,
    expectedRecipient,
    runId,
    fileId,
  });
  const meta = await drive.getFileMetadata(chosen.id);
  if (meta.trashed !== false || meta.shared !== false) {
    throw new Error('drive_archive_must_be_active_private');
  }
  if (!Array.isArray(meta.parents) || !meta.parents.includes(fid)) {
    throw new Error('drive_archive_parent_mismatch');
  }
  const props = meta.appProperties || {};
  const created = parseDriveTimestamp(props.created_at || meta.createdTime);
  const current = now || new Date();
  const ageHours = Math.max(0, (current.getTime() - created.getTime()) / 3_600_000);
  if (maxAgeHours !== null && ageHours > maxAgeHours) {
    throw new Error('drive_archive_stale_use_allow_stale_for_older_recovery');
  }

  const expectedSize = Number(meta.size);
  if (!Number.isInteger(expectedSize) || expectedSize <= 0 || expectedSize > MAX_ARCHIVE_BYTES + 64 * 1024 * 1024) {
    throw new Error('drive_archive_size_out_of_bounds');
  }
  const expectedSha = String(meta.sha256Checksum || '').toLowerCase();
  if (!SHA256_HEX_RE.test(expectedSha)) {
    throw new Error('drive_archive_sha256_missing');
  }

  ensurePrivateDir(outputRoot);
  const attemptId = `${current.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${crypto.randomBytes(4).toString('hex')}`;
  const attemptDir = path.join(outputRoot, attemptId);
  ensurePrivateDir(attemptDir);
  const archivePath = path.join(attemptDir, meta.name);

  const dl = await drive.downloadFileToPath(meta.id, archivePath, {
    maxBytes: MAX_ARCHIVE_BYTES + 64 * 1024 * 1024,
  });
  if (dl.size !== expectedSize || dl.sha256 !== expectedSha) {
    try { fs.unlinkSync(archivePath); } catch {}
    throw new Error('drive_download_integrity_mismatch');
  }

  const parsed = parseEnvelopeFile(archivePath);
  if (expectedRecipient && parsed.header.recipient_sha256 !== expectedRecipient) {
    try { fs.unlinkSync(archivePath); } catch {}
    throw new Error('drive_download_recipient_mismatch');
  }

  const derivedRunId = props.run_id || meta.name.slice('threelans-core-'.length, -'.tlans'.length);
  const plan = {
    schema: PLAN_SCHEMA,
    status: 'READY_FOR_OFFLINE_VERIFY',
    attempt_id: attemptId,
    downloaded_at: current.toISOString(),
    drive_folder_id: fid,
    drive_file_id: meta.id,
    archive_name: meta.name,
    archive_path: archivePath,
    archive_size: dl.size,
    archive_sha256: expectedSha,
    recipient_sha256: parsed.header.recipient_sha256,
    backup_created_at: created.toISOString(),
    age_hours: Math.round(ageHours * 100) / 100,
    run_id: derivedRunId,
    run_origin: props.run_origin || 'unknown',
    private_key_accessed: false,
    off_host_decryption_verified: false,
  };
  const planPath = path.join(attemptDir, 'download-plan.json');
  writePrivateJsonAtomic(planPath, plan);
  return { ...plan, plan_path: planPath };
}

function validateTarEntriesSafe(tarGzPath) {
  const listRes = spawnSync('tar', ['-tzvf', tarGzPath], {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (listRes.status !== 0) {
    throw new Error('offline_tar_list_failed');
  }
  const lines = listRes.stdout.split('\n').filter(Boolean);
  for (const line of lines) {
    const typeChar = line[0];
    // Allow only regular files ('-') and directories ('d'). Reject symlinks/hardlinks/devices.
    if (typeChar !== '-' && typeChar !== 'd') {
      throw new Error('unsafe_tar_entry_type');
    }
    if (line.includes(' -> ') || line.includes(' link to ')) {
      throw new Error('unsafe_tar_link_entry');
    }
  }

  const namesRes = spawnSync('tar', ['-tzf', tarGzPath], {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (namesRes.status !== 0) {
    throw new Error('offline_tar_names_failed');
  }
  for (const rawName of namesRes.stdout.split('\n').filter(Boolean)) {
    const cleaned = rawName.replace(/^\.\//, '').replace(/\/$/, '');
    if (!cleaned || cleaned === '.') continue;
    assertSafeRelativePath(cleaned);
  }
}

function walkExtractedFiles(rootDir) {
  const found = {};
  function walk(curDir, relPrefix) {
    const entries = fs.readdirSync(curDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        throw new Error('unsafe_symlink_in_extracted_archive');
      }
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const fullPath = path.join(curDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, rel);
      } else if (entry.isFile()) {
        // macOS BSD tar normalizes Japanese dakuten filenames between NFC and NFD.
        const safeRel = assertSafeRelativePath(rel).normalize('NFC');
        if (Object.prototype.hasOwnProperty.call(found, safeRel)) {
          throw new Error('duplicate_nfc_filename_in_extracted_archive');
        }
        found[safeRel] = sha256FileSync(fullPath);
      } else {
        throw new Error('unsafe_nonregular_file_in_extracted_archive');
      }
    }
  }
  walk(rootDir, '');
  return found;
}

function verifyArchiveOffline(archivePath, privateKey, {
  expectedSha256 = null,
  planPath = null,
  extractTo = null,
} = {}) {
  assertPrivateFile(archivePath, { maxBytes: MAX_ARCHIVE_BYTES + 64 * 1024 * 1024 });
  const actual = sha256FileSync(archivePath);

  let plan = null;
  if (planPath) {
    plan = readPrivateJson(planPath);
    if (
      plan.schema !== PLAN_SCHEMA
      || plan.archive_sha256 !== actual.sha256
      || plan.archive_size !== actual.size
    ) {
      throw new Error('download_plan_mismatch');
    }
  }
  if (expectedSha256 && actual.sha256 !== String(expectedSha256).toLowerCase()) {
    throw new Error('archive_sha256_mismatch');
  }

  const parsed = parseEnvelopeFile(archivePath);
  if (plan && parsed.header.recipient_sha256 !== plan.recipient_sha256) {
    throw new Error('plan_recipient_mismatch');
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tlans-offline-verify-'));
  fs.chmodSync(workDir, 0o700);
  const tarGzPath = path.join(workDir, 'payload.tar.gz');
  const extractDir = extractTo ? path.resolve(extractTo) : path.join(workDir, 'extracted');

  try {
    if (extractTo) {
      if (fs.existsSync(extractDir) && fs.readdirSync(extractDir).length > 0) {
        throw new Error('extract_target_must_be_empty');
      }
    }
    ensurePrivateDir(extractDir);

    unsealFile(archivePath, tarGzPath, privateKey);
    validateTarEntriesSafe(tarGzPath);

    const extractRes = spawnSync('tar', ['-xzf', tarGzPath, '-C', extractDir], {
      timeout: 300_000,
      stdio: 'pipe',
      env: { ...process.env, COPYFILE_DISABLE: '1' },
    });
    if (extractRes.status !== 0) {
      throw new Error('offline_tar_extract_failed');
    }

    const extracted = walkExtractedFiles(extractDir);
    if (!extracted['manifest.json']) {
      throw new Error('manifest_missing_in_archive');
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(extractDir, 'manifest.json'), 'utf8'));
    if (!manifest || manifest.schema !== MANIFEST_SCHEMA || !manifest.files || typeof manifest.files !== 'object') {
      throw new Error('invalid_recovery_manifest');
    }

    const manifestByNfc = {};
    for (const [rawKey, val] of Object.entries(manifest.files)) {
      const normKey = assertSafeRelativePath(rawKey).normalize('NFC');
      if (Object.prototype.hasOwnProperty.call(manifestByNfc, normKey)) {
        throw new Error('duplicate_nfc_filename_in_manifest');
      }
      manifestByNfc[normKey] = val;
    }

    const extractedKeys = Object.keys(extracted).filter((k) => k !== 'manifest.json').sort();
    const manifestKeys = Object.keys(manifestByNfc).sort();
    if (
      extractedKeys.length !== manifestKeys.length
      || extractedKeys.some((k, idx) => k !== manifestKeys[idx])
    ) {
      throw new Error('manifest_file_set_mismatch');
    }
    for (const rel of manifestKeys) {
      const expectedEntry = manifestByNfc[rel];
      const actualEntry = extracted[rel];
      if (!expectedEntry || actualEntry.size !== expectedEntry.size || actualEntry.sha256 !== expectedEntry.sha256) {
        throw new Error(`manifest_file_checksum_mismatch:${rel}`);
      }
    }

    const dbPath = path.join(extractDir, 'db', 'trilingual_records.db');
    if (!fs.existsSync(dbPath)) {
      throw new Error('sqlite_db_missing_in_archive');
    }
    const restoredSqlite = inspectSqliteFile(dbPath);
    const expectedSqlite = manifest.sqlite || {};
    if (
      expectedSqlite.integrity !== 'ok'
      || restoredSqlite.integrity !== 'ok'
      || restoredSqlite.schema_version !== expectedSqlite.schema_version
      || stableStringify(restoredSqlite.table_counts) !== stableStringify(expectedSqlite.table_counts)
    ) {
      throw new Error('offline_sqlite_verification_mismatch');
    }

    return {
      status: 'DRIVE_OFFLINE_RESTORE_VERIFIED',
      checked_at: new Date().toISOString(),
      run_id: manifest.run_id,
      run_origin: manifest.run_origin || 'unknown',
      backup_created_at: manifest.created_at,
      archive_sha256: actual.sha256,
      archive_size: actual.size,
      recipient_sha256: parsed.header.recipient_sha256,
      manifest_verified: true,
      file_count: manifestKeys.length,
      sqlite: restoredSqlite,
      network_accessed: false,
      private_key_uploaded: false,
      plaintext_retained: Boolean(extractTo),
      extracted_to: extractTo ? extractDir : null,
      production_writes_enabled: false,
    };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

async function loadPrivateKeyInteractive(keyPath, expectedRecipientSha256) {
  assertPrivateFile(keyPath, { maxBytes: 32768 });
  const pem = fs.readFileSync(keyPath);
  const passphrase = await promptHidden(
    `输入加密恢复私钥口令（公钥指纹 ${expectedRecipientSha256.slice(0, 12)}…，输入不回显）：`
  );
  const key = crypto.createPrivateKey({
    key: pem,
    format: 'pem',
    passphrase: passphrase || undefined,
  });
  if (publicKeyFingerprint(key) !== expectedRecipientSha256) {
    throw new Error('private_key_fingerprint_mismatch');
  }
  return key;
}

function parseArgs(argv) {
  const action = argv[0];
  const positional = [];
  const flags = {};
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i += 1;
    }
  }
  return { action, positional, flags };
}

async function main() {
  process.umask(0o077);
  const { action, positional, flags } = parseArgs(process.argv.slice(2));

  if (action === 'download') {
    if (!flags['token-file'] || !flags['folder-id']) {
      throw new Error('usage: restore.js download --token-file <path> --folder-id <id> [--recipient-sha256 <hex>] [--allow-stale]');
    }
    const result = await downloadFromDrive({
      tokenFile: path.resolve(flags['token-file']),
      folderId: String(flags['folder-id']),
      expectedRecipient: flags['recipient-sha256'] ? String(flags['recipient-sha256']) : null,
      runId: flags['run-id'] ? String(flags['run-id']) : null,
      fileId: flags['file-id'] ? String(flags['file-id']) : null,
      maxAgeHours: flags['allow-stale']
        ? null
        : (flags['max-age-hours'] ? Number(flags['max-age-hours']) : DEFAULT_MAX_AGE_HOURS),
      outputRoot: path.resolve(flags['output-root'] || DEFAULT_WORK_ROOT),
    });
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  if (action === 'verify') {
    const archiveArg = positional[0] || flags.archive;
    if (!archiveArg || !flags['private-key']) {
      throw new Error('usage: restore.js verify <archive.tlans> --private-key <recovery-private.pem> [--plan <download-plan.json>] [--extract-to <empty-dir>]');
    }
    const archivePath = path.resolve(archiveArg);
    const parsed = parseEnvelopeFile(archivePath);
    const privateKey = await loadPrivateKeyInteractive(
      path.resolve(flags['private-key']),
      parsed.header.recipient_sha256
    );
    const result = verifyArchiveOffline(archivePath, privateKey, {
      expectedSha256: flags['expected-sha256'] ? String(flags['expected-sha256']) : null,
      planPath: flags.plan ? path.resolve(flags.plan) : null,
      extractTo: flags['extract-to'] ? path.resolve(flags['extract-to']) : null,
    });
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  console.error('Usage:\n  node scripts/backup/restore.js download --token-file <path> --folder-id <id> [options]\n  node scripts/backup/restore.js verify <archive.tlans> --private-key <pem> [options]');
  return 2;
}

module.exports = {
  PLAN_SCHEMA,
  DEFAULT_MAX_AGE_HOURS,
  selectLatestArchive,
  downloadFromDrive,
  verifyArchiveOffline,
};

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(JSON.stringify({ status: 'FAIL', error: err.message || String(err) }));
      process.exit(1);
    }
  );
}
