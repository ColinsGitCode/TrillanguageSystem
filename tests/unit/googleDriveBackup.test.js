'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const auth = require('../../scripts/backup/auth');
const driveClient = require('../../scripts/backup/driveClient');
const envelope = require('../../scripts/backup/envelope');
const fsGuards = require('../../scripts/backup/fsGuards');
const launchd = require('../../scripts/backup/launchd');
const restore = require('../../scripts/backup/restore');
const snapshot = require('../../scripts/backup/snapshot');
const upload = require('../../scripts/backup/upload');

function makeTempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.chmodSync(dir, 0o700);
  return dir;
}

function createFakeDriveTransport({ folderId = 'folder_1234567890' } = {}) {
  const files = new Map();
  const uploads = new Map();
  const calls = [];
  let seq = 1;

  files.set(folderId, {
    id: folderId,
    name: 'ThreeLANSBackups',
    mimeType: driveClient.FOLDER_MIME,
    trashed: false,
    shared: false,
    createdTime: '2026-11-01T00:00:00.000Z',
  });

  async function transport({ method, url, headers, body }) {
    calls.push({ method, url, headers });
    const parsed = new URL(url);

    if (parsed.hostname === 'oauth2.googleapis.com' && parsed.pathname === '/token') {
      return {
        status: 200,
        headers: {},
        body: Buffer.from(JSON.stringify({
          access_token: 'mock-access-token',
          expires_in: 3600,
          scope: driveClient.DRIVE_FILE_SCOPE,
        })),
      };
    }

    if (parsed.pathname === '/upload/drive/v3/files' && method === 'POST') {
      const meta = JSON.parse(body.toString('utf8'));
      const sessionId = `sess_${seq++}`;
      const uploadUri = `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${sessionId}`;
      uploads.set(uploadUri, {
        meta,
        chunks: [],
        total: Number(headers['X-Upload-Content-Length']),
        received: 0,
      });
      return {
        status: 200,
        headers: { location: uploadUri },
        body: Buffer.alloc(0),
      };
    }

    if (parsed.pathname === '/upload/drive/v3/files' && method === 'PUT') {
      const sess = uploads.get(url);
      if (!sess) {
        throw new driveClient.DriveApiError('drive_http_404', { statusCode: 404 });
      }
      sess.chunks.push(Buffer.from(body));
      sess.received += body.length;
      if (sess.received < sess.total) {
        return {
          status: 308,
          headers: { range: `bytes=0-${sess.received - 1}` },
          body: Buffer.alloc(0),
        };
      }
      const fullBlob = Buffer.concat(sess.chunks);
      const id = `file_${String(seq++).padStart(10, '0')}`;
      const record = {
        id,
        name: sess.meta.name,
        mimeType: sess.meta.mimeType,
        parents: sess.meta.parents,
        size: String(fullBlob.length),
        sha256Checksum: crypto.createHash('sha256').update(fullBlob).digest('hex'),
        trashed: false,
        shared: false,
        createdTime: (sess.meta.appProperties && sess.meta.appProperties.created_at) || new Date().toISOString(),
        appProperties: sess.meta.appProperties || {},
        _blob: fullBlob,
      };
      files.set(id, record);
      uploads.delete(url);
      const { _blob, ...publicMeta } = record;
      return {
        status: 200,
        headers: {},
        body: Buffer.from(JSON.stringify(publicMeta)),
      };
    }

    if (parsed.pathname === '/drive/v3/files' && method === 'GET') {
      const list = [];
      for (const item of files.values()) {
        if (item.trashed === false && Array.isArray(item.parents) && item.parents.includes(folderId)) {
          const { _blob, ...publicMeta } = item;
          list.push(publicMeta);
        }
      }
      return {
        status: 200,
        headers: {},
        body: Buffer.from(JSON.stringify({ files: list })),
      };
    }

    const fileMatch = parsed.pathname.match(/^\/drive\/v3\/files\/([A-Za-z0-9_-]+)$/);
    if (fileMatch) {
      const fid = fileMatch[1];
      const item = files.get(fid);
      if (!item) {
        throw new driveClient.DriveApiError('drive_http_404', { statusCode: 404 });
      }
      if (method === 'GET' && parsed.searchParams.get('alt') === 'media') {
        return {
          status: 200,
          headers: {},
          body: Buffer.from(item._blob),
        };
      }
      if (method === 'GET') {
        const { _blob, ...publicMeta } = item;
        return {
          status: 200,
          headers: {},
          body: Buffer.from(JSON.stringify(publicMeta)),
        };
      }
      if (method === 'PATCH') {
        const patch = JSON.parse(body.toString('utf8'));
        if (patch.trashed === true) {
          item.trashed = true;
        }
        return {
          status: 200,
          headers: {},
          body: Buffer.from(JSON.stringify({ id: item.id, name: item.name, trashed: item.trashed })),
        };
      }
    }

    throw new Error(`unexpected_mock_drive_call:${method}:${url}`);
  }

  return { transport, files, calls, folderId };
}

function seedSampleWorkspace(baseDir) {
  const dbPath = path.join(baseDir, 'trilingual_records.db');
  const recordsDir = path.join(baseDir, 'records');
  const textbookWorkDir = path.join(baseDir, 'textbook_work');
  const textbookSourcesDir = path.join(baseDir, 'textbook_sources');

  fs.mkdirSync(path.join(recordsDir, '20261122'), { recursive: true });
  fs.mkdirSync(path.join(recordsDir, 'backups'), { recursive: true });
  fs.mkdirSync(path.join(textbookWorkDir, 'course-1'), { recursive: true });
  fs.mkdirSync(path.join(textbookSourcesDir, 'course-1'), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT);
    INSERT INTO schema_migrations (version, applied_at) VALUES ('017_sentence_practice', '2026-11-22T00:00:00Z');
    CREATE TABLE generations (id INTEGER PRIMARY KEY, phrase TEXT NOT NULL);
    INSERT INTO generations (phrase) VALUES ('hello'), ('こんにちは');
    CREATE TABLE card_annotations (id INTEGER PRIMARY KEY, note TEXT);
    INSERT INTO card_annotations (note) VALUES ('keep practicing');
    CREATE TABLE sentence_practice_attempts (id INTEGER PRIMARY KEY, response TEXT);
    INSERT INTO sentence_practice_attempts (response) VALUES ('sample attempt');
  `);
  db.close();

  fs.writeFileSync(path.join(recordsDir, '20261122', 'card-1.md'), '# Hello\n');
  fs.writeFileSync(path.join(recordsDir, '20261122', 'card-1.html'), '<h1>Hello</h1>\n');
  fs.writeFileSync(path.join(recordsDir, '20261122', '分割・リボ変更.md'.normalize('NFC')), '# 分割・リボ変更\n');
  fs.writeFileSync(path.join(recordsDir, '20261122', 'card-1.wav'), Buffer.alloc(128, 0x41));
  fs.writeFileSync(path.join(recordsDir, 'backups', 'stale.db'), Buffer.alloc(64, 0x42));
  fs.writeFileSync(path.join(recordsDir, 'old-copy.sqlite'), Buffer.alloc(64, 0x43));
  fs.writeFileSync(path.join(textbookWorkDir, 'course-1', 'expr-1.mp3'), Buffer.from('tts-audio'));
  fs.writeFileSync(path.join(textbookSourcesDir, 'course-1', 'manifest.json'), '{"track":1}\n');

  return { dbPath, recordsDir, textbookWorkDir, textbookSourcesDir };
}

test('envelope selfTest passes and rejects wrong key, tampering, and RSA-2048', () => {
  const res = envelope.selfTest();
  assert.equal(res.status, 'SYNTHETIC_CRYPTO_CHECK_PASSED');
  assert.equal(res.roundtrip, true);
  assert.equal(res.tamper_rejected, true);

  const weak = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const weakPem = weak.publicKey.export({ type: 'spki', format: 'pem' });
  assert.throws(() => envelope.loadValidatedPublicKey(weakPem), /rsa_3072_or_4096_public_key_required/);

  const workDir = makeTempDir('tlans-env-test-');
  try {
    const k1 = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
    const k2 = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
    const pub1 = k1.publicKey.export({ type: 'spki', format: 'pem' });

    const plainIn = path.join(workDir, 'in.bin');
    const sealed = path.join(workDir, 'out.tlans');
    const restored = path.join(workDir, 'restored.bin');
    fs.writeFileSync(plainIn, crypto.randomBytes(10_000), { mode: 0o600 });

    envelope.sealFile(plainIn, sealed, pub1, { chunkBytes: 4096 });
    assert.throws(() => envelope.unsealFile(sealed, restored, k2.privateKey), /recipient_private_key_required/);

    const withExtra = path.join(workDir, 'extra.tlans');
    fs.writeFileSync(withExtra, Buffer.concat([fs.readFileSync(sealed), Buffer.from([0x00])]), { mode: 0o600 });
    assert.throws(() => envelope.parseEnvelopeFile(withExtra), /encrypted_payload_length_mismatch/);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('auth validates Desktop OAuth JSON with both v1 and v2 auth_uri and builds minimal PKCE URL', () => {
  const workDir = makeTempDir('tlans-auth-test-');
  try {
    for (const authUri of ['https://accounts.google.com/o/oauth2/auth', 'https://accounts.google.com/o/oauth2/v2/auth']) {
      const secretPath = path.join(workDir, `secret-${authUri.includes('v2') ? 'v2' : 'v1'}.json`);
      fs.writeFileSync(secretPath, JSON.stringify({
        installed: {
          client_id: '123456-abc.apps.googleusercontent.com',
          client_secret: 'secret-value-1234',
          auth_uri: authUri,
          token_uri: driveClient.TOKEN_URL,
        },
      }), { mode: 0o600 });
      const parsed = auth.loadDesktopClientSecret(secretPath);
      assert.equal(parsed.clientId, '123456-abc.apps.googleusercontent.com');
    }

    const { verifier, challenge } = auth.buildPkcePair();
    assert.ok(verifier.length >= 43);
    assert.ok(challenge.length >= 43);
    const url = new URL(auth.buildAuthorizationUrl({
      clientId: '123456-abc.apps.googleusercontent.com',
      redirectUri: 'http://127.0.0.1:54321/callback',
      state: 'state-123',
      codeChallenge: challenge,
    }));
    assert.equal(url.searchParams.get('scope'), driveClient.DRIVE_FILE_SCOPE);
    assert.equal(url.searchParams.get('access_type'), 'offline');
    assert.equal(url.searchParams.get('prompt'), 'consent');
    assert.equal(url.searchParams.get('include_granted_scopes'), 'false');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('driveClient enforces host allowlist, drive.file scope, and never exposes DELETE', async () => {
  assert.throws(() => driveClient.ensureAllowedUrl('http://www.googleapis.com/drive/v3/files'), /unapproved_drive_endpoint/);
  assert.throws(() => driveClient.ensureAllowedUrl('https://evil.example.com/drive/v3/files'), /unapproved_drive_endpoint/);
  assert.throws(
    () => new driveClient.GoogleDriveClient({
      clientId: 'client-12345678',
      clientSecret: 'secret-12345678',
      refreshToken: 'refresh-12345678',
      scope: 'https://www.googleapis.com/auth/drive',
    }),
    /drive_file_scope_required/
  );

  const client = new driveClient.GoogleDriveClient({
    clientId: 'client-12345678',
    clientSecret: 'secret-12345678',
    refreshToken: 'refresh-12345678',
    transport: async () => ({
      status: 200,
      headers: {},
      body: Buffer.from(JSON.stringify({
        access_token: 'tok',
        expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
      })),
    }),
  });
  await assert.rejects(() => client.accessToken(), /oauth_unexpected_scope/);
  assert.equal(typeof client.deleteFile, 'undefined');
});

test('full end-to-end backup, chunked upload, reverse verification, trash-only retention, and two-step offline restore', async () => {
  const workDir = makeTempDir('tlans-e2e-backup-');
  try {
    const sample = seedSampleWorkspace(path.join(workDir, 'source'));
    const backupRoot = path.join(workDir, 'backup-root');
    const secretsDir = path.join(workDir, 'secrets');
    fsGuards.ensurePrivateDir(backupRoot);
    fsGuards.ensurePrivateDir(secretsDir);

    const passphrase = 'correct-horse-battery-staple-2026';
    const pair = envelope.generateRecoveryKeypair({ bits: 3072, passphrase });
    const pubPath = path.join(secretsDir, 'recovery-public.pem');
    const tokenPath = path.join(secretsDir, 'drive-token.json');
    fsGuards.writePrivateFileAtomic(pubPath, pair.publicPem);
    fsGuards.writePrivateJsonAtomic(tokenPath, {
      schema: driveClient.TOKEN_SCHEMA,
      scope: driveClient.DRIVE_FILE_SCOPE,
      token_uri: driveClient.TOKEN_URL,
      client_id: 'client-12345678.apps.googleusercontent.com',
      client_secret: 'secret-12345678',
      refresh_token: 'refresh-1234567890abcdef',
    });

    const fake = createFakeDriveTransport();
    // Seed 3 old managed generations + 1 unmanaged user file to verify trash-only retention
    const oldDates = [
      '2026-09-01T04:15:00.000Z',
      '2026-09-02T04:15:00.000Z',
      '2026-09-03T04:15:00.000Z',
    ];
    oldDates.forEach((iso, idx) => {
      const runId = `${iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-0000000${idx + 1}`;
      fake.files.set(`old_file_000${idx + 1}`, {
        id: `old_file_000${idx + 1}`,
        name: snapshot.archiveNameForRunId(runId),
        mimeType: driveClient.OCTET_MIME,
        parents: [fake.folderId],
        size: '1024',
        sha256Checksum: 'a'.repeat(64),
        trashed: false,
        shared: false,
        createdTime: iso,
        appProperties: {
          schema: snapshot.BACKUP_SCHEMA,
          run_id: runId,
          recipient_sha256: pair.recipientSha256,
          created_at: iso,
          local_sha256: 'a'.repeat(64),
        },
        _blob: Buffer.alloc(1024, 1),
      });
    });
    // Unmanaged file in same folder must never be trashed
    fake.files.set('user_note_0001', {
      id: 'user_note_0001',
      name: 'personal-notes.txt',
      mimeType: 'text/plain',
      parents: [fake.folderId],
      size: '12',
      sha256Checksum: 'b'.repeat(64),
      trashed: false,
      shared: false,
      createdTime: '2025-01-01T00:00:00.000Z',
      appProperties: {},
      _blob: Buffer.from('do not touch'),
    });

    const policy = {
      schema: auth.DRIVE_POLICY_SCHEMA,
      enabled: true,
      scope: driveClient.DRIVE_FILE_SCOPE,
      folder_id: fake.folderId,
      folder_name: 'ThreeLANSBackups',
      token_file: tokenPath,
      public_key_file: pubPath,
      recipient_sha256: pair.recipientSha256,
      retention_days: 30,
      min_keep: 3,
      trash_expired: true,
      include_card_audio: false,
      include_textbooks: true,
      source_mode: 'local',
      db_path: sample.dbPath,
      records_dir: sample.recordsDir,
      textbook_work_dir: sample.textbookWorkDir,
      textbook_sources_dir: sample.textbookSourcesDir,
    };
    fsGuards.writePrivateJsonAtomic(path.join(backupRoot, 'drive-policy.json'), policy);

    const client = driveClient.GoogleDriveClient.fromTokenFile(tokenPath, {
      transport: fake.transport,
      sleepFn: async () => {},
    });

    const now = new Date('2026-11-23T04:15:00.000Z');
    const runRes = await upload.runBackupAndUpload({
      origin: 'scheduled',
      rootDir: backupRoot,
      client,
      now,
      uploadChunkBytes: 256 * 1024,
    });

    assert.equal(runRes.status, 'OK');
    assert.equal(runRes.uploaded, 1);
    assert.equal(runRes.trashed_expired, 1); // 4 total managed, keep >= 3 => oldest 1 trashed
    assert.equal(runRes.off_host_decryption_verified, false);
    assert.equal(runRes.private_key_accessed, false);
    assert.equal(fake.files.get('old_file_0001').trashed, true);
    assert.equal(fake.files.get('old_file_0002').trashed, false);
    assert.equal(fake.files.get('old_file_0003').trashed, false);
    assert.equal(fake.files.get('user_note_0001').trashed, false);
    assert.equal(fake.calls.some((c) => c.method === 'DELETE'), false);

    // Step 1: Online download & ciphertext verification (no private key)
    const dlRes = await restore.downloadFromDrive({
      tokenFile: tokenPath,
      folderId: fake.folderId,
      expectedRecipient: pair.recipientSha256,
      outputRoot: path.join(workDir, 'downloads'),
      client,
      now: new Date('2026-11-23T05:00:00.000Z'),
    });
    assert.equal(dlRes.status, 'READY_FOR_OFFLINE_VERIFY');
    assert.equal(dlRes.private_key_accessed, false);
    assert.equal(dlRes.archive_sha256, runRes.latest_sha256);

    // Step 2: Pure offline decrypt & SQLite/file verification
    const privateKey = crypto.createPrivateKey({
      key: pair.privatePem,
      format: 'pem',
      passphrase,
    });
    const verifyRes = restore.verifyArchiveOffline(dlRes.archive_path, privateKey, {
      planPath: dlRes.plan_path,
      expectedSha256: dlRes.archive_sha256,
    });

    assert.equal(verifyRes.status, 'DRIVE_OFFLINE_RESTORE_VERIFIED');
    assert.equal(verifyRes.manifest_verified, true);
    assert.equal(verifyRes.network_accessed, false);
    assert.equal(verifyRes.plaintext_retained, false);
    assert.equal(verifyRes.sqlite.integrity, 'ok');
    assert.equal(verifyRes.sqlite.schema_version, '017_sentence_practice');
    assert.equal(verifyRes.sqlite.table_counts.generations, 2);
    assert.equal(verifyRes.sqlite.table_counts.card_annotations, 1);
    assert.equal(verifyRes.sqlite.table_counts.sentence_practice_attempts, 1);
    // Excluded stale DBs & .wav audio; included db + 2 md (incl. Japanese dakuten) + html + textbook_work + textbook_sources = 6 files
    assert.equal(verifyRes.file_count, 6);

    // Conflict fail-closed: if remote file with same name has altered checksum, upload-only must FAIL
    const remoteUploaded = fake.files.get(runRes.latest_drive_file_id);
    remoteUploaded.sha256Checksum = 'f'.repeat(64);
    await assert.rejects(
      () => upload.runBackupAndUpload({
        origin: 'manual',
        rootDir: backupRoot,
        createSnapshot: false,
        client,
        now,
      }),
      /drive_remote_sha256_mismatch/
    );
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('launchd renders daily LaunchAgent plist with RunAtLoad=false and Umask=0o077', () => {
  const xml = launchd.renderLaunchAgentPlist({ hour: 4, minute: 15 });
  assert.match(xml, /<key>Label<\/key>\s*<string>com\.threelans\.core-backup\.daily<\/string>/);
  assert.match(xml, /<key>RunAtLoad<\/key>\s*<false\/>/);
  assert.match(xml, /<key>Umask<\/key>\s*<integer>63<\/integer>/);
  assert.match(xml, /<key>Hour<\/key>\s*<integer>4<\/integer>/);
  assert.match(xml, /<key>Minute<\/key>\s*<integer>15<\/integer>/);
  assert.match(xml, /<string>scheduled<\/string>/);
});
