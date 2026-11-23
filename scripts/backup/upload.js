'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  DRIVE_POLICY_SCHEMA,
  DEFAULT_REMOTE_BACKUP_ROOT,
  DEFAULT_RETENTION_DAYS,
  MIN_RETAINED_GENERATIONS,
} = require('./auth');
const {
  DRIVE_FILE_SCOPE,
  DriveApiError,
  GoogleDriveClient,
  parseDriveTimestamp,
  validateFileId,
} = require('./driveClient');
const {
  loadValidatedPublicKey,
  parseEnvelopeFile,
  publicKeyFingerprint,
} = require('./envelope');
const {
  RUN_ID_RE,
  SHA256_HEX_RE,
  acquireNonBlockingLock,
  assertPrivateFile,
  ensurePrivateDir,
  readPrivateJson,
  sha256FileSync,
  writePrivateJsonAtomic,
} = require('./fsGuards');
const {
  ARCHIVE_NAME_RE,
  BACKUP_SCHEMA,
  archiveNameForRunId,
  createEncryptedSnapshot,
} = require('./snapshot');

const TARGET_NAME = 'google_drive';
const DEFAULT_LOCAL_OUTBOX_KEEP = 2;
const DEFAULT_DEADLINE_SECONDS = 900;

function loadDrivePolicy(rootDir = DEFAULT_REMOTE_BACKUP_ROOT) {
  const policyPath = path.join(rootDir, 'drive-policy.json');
  const policy = readPrivateJson(policyPath);
  if (policy.schema !== DRIVE_POLICY_SCHEMA || policy.enabled !== true) {
    throw new Error('drive_backup_not_enabled');
  }
  if (policy.scope !== DRIVE_FILE_SCOPE) {
    throw new Error('drive_file_scope_required');
  }
  validateFileId(policy.folder_id);
  if (typeof policy.recipient_sha256 !== 'string' || !SHA256_HEX_RE.test(policy.recipient_sha256)) {
    throw new Error('invalid_recipient_sha256');
  }
  if (typeof policy.token_file !== 'string' || !path.isAbsolute(policy.token_file)) {
    throw new Error('absolute_token_file_required');
  }
  if (typeof policy.public_key_file !== 'string' || !path.isAbsolute(policy.public_key_file)) {
    throw new Error('absolute_public_key_file_required');
  }
  const retentionDays = Number(policy.retention_days ?? DEFAULT_RETENTION_DAYS);
  const minKeep = Number(policy.min_keep ?? MIN_RETAINED_GENERATIONS);
  if (
    !Number.isInteger(retentionDays)
    || retentionDays < 7
    || retentionDays > 3650
    || !Number.isInteger(minKeep)
    || minKeep < MIN_RETAINED_GENERATIONS
  ) {
    throw new Error('invalid_drive_retention_policy');
  }
  return {
    ...policy,
    retention_days: retentionDays,
    min_keep: minKeep,
    trash_expired: policy.trash_expired !== false,
    include_card_audio: policy.include_card_audio === true,
    include_textbooks: policy.include_textbooks !== false,
    local_outbox_keep: Math.max(1, Number(policy.local_outbox_keep ?? DEFAULT_LOCAL_OUTBOX_KEEP)),
    source_mode: policy.source_mode || 'docker-compose',
    compose_command: policy.compose_command || '/Users/colin/ThreeLANS/bin/compose',
    viewer_service: policy.viewer_service || 'viewer',
  };
}

function loadOutboxEntries(outboxDir, expectedRecipient) {
  if (!fs.existsSync(outboxDir)) return [];
  const entries = [];
  const names = fs.readdirSync(outboxDir).sort();
  for (const filename of names) {
    if (!filename.endsWith('.json')) continue;
    const stem = filename.slice(0, -5);
    if (!RUN_ID_RE.test(stem)) continue;

    const metaPath = path.join(outboxDir, filename);
    const entry = readPrivateJson(metaPath);
    const runId = entry.run_id;
    const archiveName = entry.name;
    if (
      entry.schema !== BACKUP_SCHEMA
      || runId !== stem
      || archiveName !== archiveNameForRunId(runId)
      || !ARCHIVE_NAME_RE.test(archiveName)
      || entry.recipient_sha256 !== expectedRecipient
      || typeof entry.sha256 !== 'string'
      || !SHA256_HEX_RE.test(entry.sha256)
      || !Number.isInteger(entry.size)
      || entry.size <= 0
    ) {
      throw new Error('invalid_outbox_entry');
    }
    parseDriveTimestamp(entry.created_at);
    const archivePath = path.join(outboxDir, archiveName);
    assertPrivateFile(archivePath);
    const actual = sha256FileSync(archivePath);
    if (actual.size !== entry.size || actual.sha256 !== entry.sha256) {
      throw new Error('outbox_ciphertext_integrity_mismatch');
    }
    const parsed = parseEnvelopeFile(archivePath);
    if (parsed.header.recipient_sha256 !== expectedRecipient) {
      throw new Error('outbox_envelope_recipient_mismatch');
    }
    entries.push({ entry, archivePath, metaPath });
  }
  entries.sort(
    (a, b) => parseDriveTimestamp(a.entry.created_at).getTime()
      - parseDriveTimestamp(b.entry.created_at).getTime()
  );
  return entries;
}

function verifyRemoteMetadata(meta, { folderId, entry, expectedRecipient }) {
  validateFileId(meta && meta.id);
  if (meta.name !== entry.name) {
    throw new Error('drive_remote_name_mismatch');
  }
  if (meta.trashed !== false) {
    throw new Error('drive_remote_file_trashed');
  }
  if (meta.shared !== false) {
    throw new Error('drive_remote_file_must_be_private');
  }
  if (!Array.isArray(meta.parents) || !meta.parents.includes(folderId)) {
    throw new Error('drive_remote_parent_mismatch');
  }
  const remoteSize = Number(meta.size);
  if (!Number.isInteger(remoteSize) || remoteSize <= 0) {
    throw new Error('drive_remote_size_missing');
  }
  if (remoteSize !== entry.size) {
    throw new Error('drive_remote_size_mismatch');
  }
  const remoteSha = String(meta.sha256Checksum || '').toLowerCase();
  if (!SHA256_HEX_RE.test(remoteSha) || remoteSha !== entry.sha256) {
    throw new Error('drive_remote_sha256_mismatch');
  }
  const props = meta.appProperties || {};
  if (
    props.schema !== BACKUP_SCHEMA
    || props.run_id !== entry.run_id
    || props.recipient_sha256 !== expectedRecipient
    || props.local_sha256 !== entry.sha256
  ) {
    throw new Error('drive_remote_app_properties_mismatch');
  }
}

function buildReceiptPayload({ entry, remoteMeta, folderId, receivedAt }) {
  return {
    schema: BACKUP_SCHEMA,
    status: 'OK',
    target: TARGET_NAME,
    run_id: entry.run_id,
    archive_name: entry.name,
    sha256: entry.sha256,
    size: entry.size,
    recipient_sha256: entry.recipient_sha256,
    run_origin: entry.run_origin || 'unknown',
    backup_created_at: parseDriveTimestamp(entry.created_at).toISOString(),
    received_at: receivedAt.toISOString(),
    ciphertext_verified: true,
    off_host_decryption_verified: false,
    drive_file_id: remoteMeta.id,
    drive_folder_id: folderId,
    drive_sha256: String(remoteMeta.sha256Checksum).toLowerCase(),
    drive_private_verified: remoteMeta.shared === false,
  };
}

function existingReceiptMatches(receiptPath, entry, folderId) {
  if (!fs.existsSync(receiptPath)) return null;
  const receipt = readPrivateJson(receiptPath);
  if (
    receipt.schema === BACKUP_SCHEMA
    && receipt.status === 'OK'
    && receipt.target === TARGET_NAME
    && receipt.run_id === entry.run_id
    && receipt.sha256 === entry.sha256
    && receipt.drive_folder_id === folderId
    && receipt.ciphertext_verified === true
    && typeof receipt.drive_file_id === 'string'
  ) {
    return receipt;
  }
  return null;
}

async function pruneDriveArchives(client, {
  remoteFiles,
  folderId,
  expectedRecipient,
  retentionDays,
  minKeep,
  now,
}) {
  const candidates = [];
  for (const item of remoteFiles) {
    const name = item && item.name;
    const props = (item && item.appProperties) || {};
    if (
      item.trashed !== false
      || typeof name !== 'string'
      || !ARCHIVE_NAME_RE.test(name)
      || props.schema !== BACKUP_SCHEMA
      || props.recipient_sha256 !== expectedRecipient
      || !Array.isArray(item.parents)
      || !item.parents.includes(folderId)
    ) {
      continue;
    }
    const created = parseDriveTimestamp(props.created_at || item.createdTime);
    candidates.push({ created, item });
  }
  candidates.sort((a, b) => a.created.getTime() - b.created.getTime());
  const keep = Math.max(MIN_RETAINED_GENERATIONS, minKeep);
  if (candidates.length <= keep) return [];

  const trashedIds = [];
  const cutoffMs = retentionDays * 86400 * 1000;
  for (const { created, item } of candidates.slice(0, candidates.length - keep)) {
    if (now.getTime() - created.getTime() <= cutoffMs) continue;
    const fid = validateFileId(item.id);
    await client.trashFile(fid);
    trashedIds.push(fid);
  }
  return trashedIds;
}

function pruneLocalOutbox(outboxEntries, receiptsDir, folderId, { keepCount = DEFAULT_LOCAL_OUTBOX_KEEP } = {}) {
  if (outboxEntries.length <= keepCount) return 0;
  let removed = 0;
  for (const { entry, archivePath, metaPath } of outboxEntries.slice(0, outboxEntries.length - keepCount)) {
    const receiptPath = path.join(receiptsDir, `${entry.run_id}.json`);
    if (!existingReceiptMatches(receiptPath, entry, folderId)) continue;
    try { fs.unlinkSync(archivePath); } catch {}
    try { fs.unlinkSync(metaPath); } catch {}
    removed += 1;
  }
  return removed;
}

function sanitizeErrorCode(err) {
  const raw = err instanceof DriveApiError ? err.code : String((err && err.message) || err || 'unknown');
  if (/^[A-Za-z0-9_.:-]{1,80}$/.test(raw)) return raw;
  return (err && err.name) || 'Error';
}

async function runBackupAndUpload({
  origin = 'manual',
  rootDir = DEFAULT_REMOTE_BACKUP_ROOT,
  createSnapshot = true,
  client = null,
  now = null,
  uploadChunkBytes = undefined,
} = {}) {
  const startedAt = now || new Date();
  ensurePrivateDir(rootDir);
  const statusDir = path.join(rootDir, 'status');
  ensurePrivateDir(statusDir);
  const driveStatusPath = path.join(statusDir, 'drive.json');

  const lock = acquireNonBlockingLock(path.join(rootDir, '.backup.lock'), { origin });
  if (!lock) {
    return {
      schema: DRIVE_POLICY_SCHEMA,
      status: 'BUSY',
      target: TARGET_NAME,
      run_origin: origin,
    };
  }

  try {
    const policy = loadDrivePolicy(rootDir);
    assertPrivateFile(policy.public_key_file, { maxBytes: 16384 });
    const pubFingerprint = publicKeyFingerprint(loadValidatedPublicKey(fs.readFileSync(policy.public_key_file)));
    if (pubFingerprint !== policy.recipient_sha256) {
      throw new Error('public_key_recipient_fingerprint_mismatch');
    }

    const outboxDir = path.join(rootDir, 'outbox');
    const receiptsDir = path.join(rootDir, 'receipts');
    ensurePrivateDir(outboxDir);
    ensurePrivateDir(receiptsDir);

    if (createSnapshot) {
      await createEncryptedSnapshot({
        outboxDir,
        publicKeyPath: policy.public_key_file,
        expectedRecipientSha256: policy.recipient_sha256,
        origin,
        sourceMode: policy.source_mode,
        composeCommand: policy.compose_command,
        viewerService: policy.viewer_service,
        dbPath: policy.db_path || null,
        recordsDir: policy.records_dir || null,
        textbookWorkDir: policy.textbook_work_dir || null,
        textbookSourcesDir: policy.textbook_sources_dir || null,
        includeCardAudio: policy.include_card_audio,
        includeTextbooks: policy.include_textbooks,
        now: startedAt,
      });
    }

    const outboxEntries = loadOutboxEntries(outboxDir, policy.recipient_sha256);
    if (outboxEntries.length === 0) {
      throw new Error('outbox_empty');
    }

    const drive = client || GoogleDriveClient.fromTokenFile(policy.token_file);
    const folderId = policy.folder_id;
    const expectedRecipient = policy.recipient_sha256;
    await drive.verifyPrivateFolder(folderId);

    const remoteFiles = await drive.listFolderFiles(folderId);
    const byName = new Map();
    for (const item of remoteFiles) {
      if (item && typeof item.name === 'string') {
        const list = byName.get(item.name) || [];
        list.push(item);
        byName.set(item.name, list);
      }
    }

    let uploaded = 0;
    let verifiedExisting = 0;
    let latestReceipt = null;

    for (const { entry, archivePath } of outboxEntries) {
      const matches = byName.get(entry.name) || [];
      if (matches.length > 1) {
        throw new Error('drive_duplicate_archive_name');
      }

      let remoteMeta;
      if (matches.length === 1) {
        remoteMeta = await drive.getFileMetadata(matches[0].id);
        // Fail closed if an existing file with the same name does not match checksum/metadata.
        verifyRemoteMetadata(remoteMeta, { folderId, entry, expectedRecipient });
        verifiedExisting += 1;
      } else {
        const createdMeta = await drive.uploadResumableFile(folderId, entry.name, archivePath, {
          appProperties: {
            schema: BACKUP_SCHEMA,
            run_id: entry.run_id,
            recipient_sha256: expectedRecipient,
            created_at: parseDriveTimestamp(entry.created_at).toISOString(),
            run_origin: String(entry.run_origin || 'unknown'),
            local_sha256: entry.sha256,
          },
          ...(uploadChunkBytes ? { chunkBytes: uploadChunkBytes } : {}),
        });
        remoteMeta = await drive.getFileMetadata(createdMeta.id);
        verifyRemoteMetadata(remoteMeta, { folderId, entry, expectedRecipient });
        remoteFiles.push(remoteMeta);
        byName.set(entry.name, [remoteMeta]);
        uploaded += 1;
      }

      const receiptPath = path.join(receiptsDir, `${entry.run_id}.json`);
      const existing = existingReceiptMatches(receiptPath, entry, folderId);
      const receipt = existing || buildReceiptPayload({
        entry,
        remoteMeta,
        folderId,
        receivedAt: now || new Date(),
      });
      if (!existing) {
        writePrivateJsonAtomic(receiptPath, receipt);
      }

      if (
        !latestReceipt
        || parseDriveTimestamp(receipt.backup_created_at).getTime()
          >= parseDriveTimestamp(latestReceipt.backup_created_at).getTime()
      ) {
        latestReceipt = receipt;
      }
    }

    if (!latestReceipt) {
      throw new Error('no_verified_drive_receipt');
    }

    writePrivateJsonAtomic(path.join(statusDir, 'receipt.json'), latestReceipt);

    let trashedIds = [];
    if (policy.trash_expired) {
      trashedIds = await pruneDriveArchives(drive, {
        remoteFiles,
        folderId,
        expectedRecipient,
        retentionDays: policy.retention_days,
        minKeep: policy.min_keep,
        now: now || new Date(),
      });
    }

    const prunedLocal = pruneLocalOutbox(outboxEntries, receiptsDir, folderId, {
      keepCount: policy.local_outbox_keep,
    });

    const completedAt = now || new Date();
    const result = {
      schema: DRIVE_POLICY_SCHEMA,
      status: 'OK',
      target: TARGET_NAME,
      run_origin: origin,
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      folder_id: folderId,
      uploaded,
      verified_existing: verifiedExisting,
      trashed_expired: trashedIds.length,
      pruned_local_outbox: prunedLocal,
      latest_run_id: latestReceipt.run_id,
      latest_backup_created_at: latestReceipt.backup_created_at,
      latest_drive_file_id: latestReceipt.drive_file_id,
      latest_sha256: latestReceipt.sha256,
      latest_size: latestReceipt.size,
      off_host_decryption_verified: false,
      private_key_accessed: false,
    };
    writePrivateJsonAtomic(driveStatusPath, result);
    return result;
  } catch (err) {
    const failure = {
      schema: DRIVE_POLICY_SCHEMA,
      status: 'FAIL',
      target: TARGET_NAME,
      run_origin: origin,
      started_at: startedAt.toISOString(),
      completed_at: (now || new Date()).toISOString(),
      error_type: (err && err.name) || 'Error',
      error_code: sanitizeErrorCode(err),
      off_host_decryption_verified: false,
      private_key_accessed: false,
    };
    try {
      writePrivateJsonAtomic(driveStatusPath, failure);
    } catch {}
    throw err;
  } finally {
    lock.release();
  }
}

function parseArgs(argv) {
  const action = argv[0];
  const flags = {};
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i += 1;
    }
  }
  return { action, flags };
}

async function main() {
  process.umask(0o077);
  const { action, flags } = parseArgs(process.argv.slice(2));
  const rootDir = path.resolve(flags.root || DEFAULT_REMOTE_BACKUP_ROOT);

  if (action === 'status') {
    const statusPath = path.join(rootDir, 'status', 'drive.json');
    if (!fs.existsSync(statusPath)) {
      console.log(JSON.stringify({ status: 'NEVER_RUN', root: rootDir }));
      return 0;
    }
    console.log(JSON.stringify(readPrivateJson(statusPath), null, 2));
    return 0;
  }

  if (action !== 'run' && action !== 'upload-only') {
    console.error('Usage: node scripts/backup/upload.js <run|upload-only|status> [--origin manual|scheduled] [--root <dir>] [--deadline-seconds 900]');
    return 2;
  }

  const origin = flags.origin || 'manual';
  if (origin !== 'manual' && origin !== 'scheduled') {
    throw new Error('invalid_run_origin');
  }
  const deadlineSeconds = Number(flags['deadline-seconds'] || DEFAULT_DEADLINE_SECONDS);
  const timer = setTimeout(() => {
    console.error(JSON.stringify({ status: 'FAIL', error_type: 'TimeoutError', error_code: 'drive_backup_deadline' }));
    process.exit(124);
  }, Math.max(30, deadlineSeconds) * 1000);
  timer.unref();

  try {
    const result = await runBackupAndUpload({
      origin,
      rootDir,
      createSnapshot: action === 'run',
    });
    console.log(JSON.stringify(result));
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  TARGET_NAME,
  loadDrivePolicy,
  loadOutboxEntries,
  verifyRemoteMetadata,
  pruneDriveArchives,
  runBackupAndUpload,
};

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(JSON.stringify({
        status: 'FAIL',
        error_type: (err && err.name) || 'Error',
        error_code: sanitizeErrorCode(err),
      }));
      process.exit(1);
    }
  );
}
