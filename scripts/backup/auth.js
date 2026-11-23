'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { URL, URLSearchParams } = require('node:url');

const {
  DRIVE_FILE_SCOPE,
  GoogleDriveClient,
  TOKEN_SCHEMA,
  TOKEN_URL,
  validateFileId,
} = require('./driveClient');
const { generateRecoveryKeypair } = require('./envelope');
const {
  SHA256_HEX_RE,
  ensurePrivateDir,
  writePrivateFileAtomic,
  writePrivateJsonAtomic,
} = require('./fsGuards');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const APPROVED_AUTH_URIS = new Set([
  AUTH_URL,
  'https://accounts.google.com/o/oauth2/auth',
]);
const DRIVE_POLICY_SCHEMA = 'threelans.core-backup.drive.v1';
const DEFAULT_FOLDER_NAME = 'ThreeLANSBackups';
const DEFAULT_RETENTION_DAYS = 30;
const MIN_RETAINED_GENERATIONS = 3;
const DEFAULT_REMOTE_BACKUP_ROOT = '/Users/colin/ThreeLANS/backups/google-drive';
const DEFAULT_REMOTE_SECRETS_DIR = '/Users/colin/ThreeLANS/secrets/drive-backup';
const DEFAULT_LOCAL_OUTPUT_DIR = path.join(os.homedir(), '.threelans-core-recovery', 'drive-oauth');

function loadDesktopClientSecret(secretPath) {
  const raw = JSON.parse(fs.readFileSync(secretPath, 'utf8'));
  const installed = raw && typeof raw === 'object' ? raw.installed : null;
  if (!installed || typeof installed !== 'object') {
    throw new Error('desktop_oauth_client_json_required');
  }
  const clientId = installed.client_id;
  const clientSecret = installed.client_secret;
  const authUri = installed.auth_uri || AUTH_URL;
  const tokenUri = installed.token_uri || TOKEN_URL;
  if (
    typeof clientId !== 'string'
    || typeof clientSecret !== 'string'
    || !clientId.endsWith('.apps.googleusercontent.com')
    || clientSecret.length < 8
    || !APPROVED_AUTH_URIS.has(authUri)
    || tokenUri !== TOKEN_URL
  ) {
    throw new Error('invalid_desktop_client_secret');
  }
  return { clientId, clientSecret };
}

function buildPkcePair() {
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
  return { verifier, challenge };
}

function buildAuthorizationUrl({ clientId, redirectUri, state, codeChallenge }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: DRIVE_FILE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

function exchangeAuthorizationCode({ clientId, clientSecret, code, redirectUri, codeVerifier }) {
  const payload = Buffer.from(
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
    }).toString(),
    'ascii'
  );
  const parsed = new URL(TOKEN_URL);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: 443,
        path: parsed.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': String(payload.length),
        },
        timeout: 30_000,
      },
      (res) => {
        const chunks = [];
        let total = 0;
        res.on('data', (chunk) => {
          total += chunk.length;
          if (total <= 65536) chunks.push(chunk);
        });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`oauth_code_exchange_failed_${res.statusCode}`));
            return;
          }
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const refreshToken = data && data.refresh_token;
            const grantedScopes = new Set(String((data && data.scope) || '').trim().split(/\s+/).filter(Boolean));
            if (typeof refreshToken !== 'string' || refreshToken.length < 16) {
              reject(new Error('oauth_missing_refresh_token'));
              return;
            }
            if (grantedScopes.size !== 1 || !grantedScopes.has(DRIVE_FILE_SCOPE)) {
              reject(new Error('oauth_unexpected_granted_scope'));
              return;
            }
            resolve({
              schema: TOKEN_SCHEMA,
              scope: DRIVE_FILE_SCOPE,
              token_uri: TOKEN_URL,
              client_id: clientId,
              client_secret: clientSecret,
              refresh_token: refreshToken,
              authorized_at: new Date().toISOString(),
            });
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('oauth_code_exchange_timeout'));
    });
    req.on('error', () => reject(new Error('oauth_code_exchange_network_error')));
    req.write(payload);
    req.end();
  });
}

function startLoopbackCallback(expectedState, { timeoutMs = 300_000 } = {}) {
  return new Promise((resolveStart, rejectStart) => {
    let settleCallback;
    const callbackPromise = new Promise((resolve, reject) => {
      settleCallback = { resolve, reject };
    });

    let timer = null;
    const server = http.createServer((req, res) => {
      const parsed = new URL(req.url || '/', 'http://127.0.0.1');
      if (parsed.pathname !== '/callback') {
        res.writeHead(404);
        res.end();
        return;
      }
      const state = parsed.searchParams.get('state') || '';
      const error = parsed.searchParams.get('error');
      const code = parsed.searchParams.get('code');

      let status = 200;
      let message = 'Three LANS Google Drive authorization received. You may close this tab.';
      let outcome = { code, error: null };

      if (state !== expectedState) {
        status = 400;
        message = 'Authorization rejected: invalid state.';
        outcome = { code: null, error: 'oauth_state_mismatch' };
      } else if (error) {
        status = 400;
        message = 'Authorization was denied or cancelled. You may close this tab.';
        outcome = { code: null, error: `oauth_denied:${error}` };
      } else if (!code) {
        status = 400;
        message = 'Authorization failed: missing code.';
        outcome = { code: null, error: 'oauth_missing_code' };
      }

      const payload = Buffer.from(message, 'utf8');
      res.writeHead(status, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': String(payload.length),
      });
      res.end(payload);

      if (timer) clearTimeout(timer);
      server.close();
      if (outcome.error) {
        settleCallback.reject(new Error(outcome.error));
      } else {
        settleCallback.resolve(outcome.code);
      }
    });

    server.on('error', rejectStart);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      timer = setTimeout(() => {
        server.close();
        settleCallback.reject(new Error('oauth_callback_timeout'));
      }, timeoutMs);
      resolveStart({
        redirectUri: `http://127.0.0.1:${addr.port}/callback`,
        waitForCode: () => callbackPromise,
        close: () => {
          if (timer) clearTimeout(timer);
          server.close();
        },
      });
    });
  });
}

function promptHidden(promptText) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('tty_required_for_passphrase_prompt'));
      return;
    }
    process.stderr.write(promptText);
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let input = '';

    const cleanup = () => {
      process.stdin.setRawMode(Boolean(wasRaw));
      process.stdin.pause();
      process.stdin.removeListener('data', onData);
    };

    const onData = (chunk) => {
      const str = chunk.toString('utf8');
      for (const ch of str) {
        if (ch === '\r' || ch === '\n') {
          process.stderr.write('\n');
          cleanup();
          resolve(input);
          return;
        }
        if (ch === '\u0003') {
          process.stderr.write('\n');
          cleanup();
          reject(new Error('passphrase_prompt_cancelled'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          input = input.slice(0, -1);
        } else {
          input += ch;
        }
      }
    };

    process.stdin.on('data', onData);
  });
}

function openBrowserUrl(url) {
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
  try {
    const child = spawn(cmd, [url], { detached: true, stdio: 'ignore' });
    child.unref();
  } catch {}
}

function buildPolicyDoc({
  folderId,
  folderName,
  recipientSha256,
  tokenFile,
  publicKeyFile,
  retentionDays = DEFAULT_RETENTION_DAYS,
  minKeep = MIN_RETAINED_GENERATIONS,
  includeCardAudio = false,
  includeTextbooks = true,
  composeCommand = '/Users/colin/ThreeLANS/bin/compose',
  textbookSourcesDir = '/Users/colin/ThreeLANS/textbook_sources',
}) {
  return {
    schema: DRIVE_POLICY_SCHEMA,
    enabled: true,
    scope: DRIVE_FILE_SCOPE,
    folder_id: validateFileId(folderId),
    folder_name: folderName,
    token_file: tokenFile,
    public_key_file: publicKeyFile,
    recipient_sha256: recipientSha256,
    retention_days: retentionDays,
    min_keep: Math.max(MIN_RETAINED_GENERATIONS, minKeep),
    trash_expired: true,
    include_card_audio: Boolean(includeCardAudio),
    include_textbooks: Boolean(includeTextbooks),
    source_mode: 'docker-compose',
    compose_command: composeCommand,
    textbook_sources_dir: textbookSourcesDir,
    created_at: new Date().toISOString(),
  };
}

async function runOAuthSetup({
  clientSecretPath,
  recipientSha256,
  outputDir = DEFAULT_LOCAL_OUTPUT_DIR,
  folderName = DEFAULT_FOLDER_NAME,
  existingFolderId = null,
  retentionDays = DEFAULT_RETENTION_DAYS,
  minKeep = MIN_RETAINED_GENERATIONS,
  remoteTokenPath = path.join(DEFAULT_REMOTE_SECRETS_DIR, 'drive-token.json'),
  remotePublicKeyPath = path.join(DEFAULT_REMOTE_SECRETS_DIR, 'recovery-public.pem'),
  includeCardAudio = false,
  includeTextbooks = true,
  openBrowser = true,
}) {
  if (!SHA256_HEX_RE.test(recipientSha256)) {
    throw new Error('invalid_recipient_sha256');
  }
  const { clientId, clientSecret } = loadDesktopClientSecret(clientSecretPath);
  const { verifier, challenge } = buildPkcePair();
  const state = crypto.randomBytes(24).toString('base64url');
  const listener = await startLoopbackCallback(state);
  const authUrl = buildAuthorizationUrl({
    clientId,
    redirectUri: listener.redirectUri,
    state,
    codeChallenge: challenge,
  });

  let code;
  try {
    console.error('请在浏览器中完成 Google Drive (仅 drive.file 最小权限) 授权：');
    console.error(authUrl);
    if (openBrowser) openBrowserUrl(authUrl);
    code = await listener.waitForCode();
  } finally {
    listener.close();
  }

  const tokenDoc = await exchangeAuthorizationCode({
    clientId,
    clientSecret,
    code,
    redirectUri: listener.redirectUri,
    codeVerifier: verifier,
  });

  const drive = new GoogleDriveClient({
    clientId: tokenDoc.client_id,
    clientSecret: tokenDoc.client_secret,
    refreshToken: tokenDoc.refresh_token,
    scope: tokenDoc.scope,
  });

  const folder = existingFolderId
    ? await drive.verifyPrivateFolder(validateFileId(existingFolderId))
    : await drive.createPrivateFolder(folderName);

  ensurePrivateDir(outputDir);
  const tokenOut = path.join(outputDir, 'drive-token.json');
  const policyOut = path.join(outputDir, 'drive-policy.json');
  writePrivateJsonAtomic(tokenOut, tokenDoc);

  const policyDoc = buildPolicyDoc({
    folderId: folder.id,
    folderName: folder.name || folderName,
    recipientSha256,
    tokenFile: remoteTokenPath,
    publicKeyFile: remotePublicKeyPath,
    retentionDays,
    minKeep,
    includeCardAudio,
    includeTextbooks,
  });
  writePrivateJsonAtomic(policyOut, policyDoc);

  return {
    status: 'DRIVE_OAUTH_INITIALIZED',
    scope: DRIVE_FILE_SCOPE,
    folder_id: folder.id,
    folder_name: folder.name || folderName,
    folder_private: folder.shared === false,
    recipient_sha256: recipientSha256,
    local_token_file: tokenOut,
    local_policy_file: policyOut,
    remote_token_target: remoteTokenPath,
    remote_public_key_target: remotePublicKeyPath,
    remote_policy_target: path.join(DEFAULT_REMOTE_BACKUP_ROOT, 'drive-policy.json'),
  };
}

async function runInitKey({ outputDir, bits = 4096 }) {
  ensurePrivateDir(outputDir);
  const privPath = path.join(outputDir, 'recovery-private.pem');
  const pubPath = path.join(outputDir, 'recovery-public.pem');
  const metaPath = path.join(outputDir, 'recovery-recipient.json');
  if (fs.existsSync(privPath) || fs.existsSync(pubPath)) {
    throw new Error('recovery_key_already_exists_in_output_dir');
  }
  const pass1 = await promptHidden('设置离线恢复私钥口令（至少 12 位，不回显）：');
  if (pass1.length < 12) throw new Error('recovery_passphrase_min_12_chars');
  const pass2 = await promptHidden('再次输入恢复私钥口令确认（不回显）：');
  if (pass1 !== pass2) throw new Error('recovery_passphrase_mismatch');

  const pair = generateRecoveryKeypair({ bits, passphrase: pass1 });
  writePrivateFileAtomic(privPath, pair.privatePem);
  writePrivateFileAtomic(pubPath, pair.publicPem);
  writePrivateJsonAtomic(metaPath, {
    schema: 'threelans.core-backup-recipient.v1',
    key_type: 'RSA',
    bits: pair.bits,
    recipient_sha256: pair.recipientSha256,
    created_at: new Date().toISOString(),
  });

  return {
    status: 'RECOVERY_KEYPAIR_CREATED',
    bits: pair.bits,
    recipient_sha256: pair.recipientSha256,
    private_key_file: privPath,
    public_key_file: pubPath,
    warning: 'Keep recovery-private.pem offline only. Never upload it to x86_mac or Google Drive.',
  };
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
  if (action === 'init-key') {
    const outDir = path.resolve(
      flags['output-dir'] || path.join(os.homedir(), '.threelans-core-recovery', 'keys')
    );
    const bits = flags.bits ? Number(flags.bits) : 4096;
    const result = await runInitKey({ outputDir: outDir, bits });
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  if (action === 'oauth') {
    if (!flags['client-secret'] || !flags['recipient-sha256']) {
      throw new Error('usage: auth.js oauth --client-secret <path> --recipient-sha256 <64-hex>');
    }
    const result = await runOAuthSetup({
      clientSecretPath: path.resolve(flags['client-secret']),
      recipientSha256: String(flags['recipient-sha256']),
      outputDir: path.resolve(flags['output-dir'] || DEFAULT_LOCAL_OUTPUT_DIR),
      folderName: flags['folder-name'] || DEFAULT_FOLDER_NAME,
      existingFolderId: flags['folder-id'] || null,
      retentionDays: flags['retention-days'] ? Number(flags['retention-days']) : DEFAULT_RETENTION_DAYS,
      minKeep: flags['min-keep'] ? Number(flags['min-keep']) : MIN_RETAINED_GENERATIONS,
      remoteTokenPath: flags['remote-token-path'] || path.join(DEFAULT_REMOTE_SECRETS_DIR, 'drive-token.json'),
      remotePublicKeyPath: flags['remote-public-key-path'] || path.join(DEFAULT_REMOTE_SECRETS_DIR, 'recovery-public.pem'),
      includeCardAudio: Boolean(flags['include-card-audio']),
      includeTextbooks: flags['exclude-textbooks'] ? false : true,
      openBrowser: !flags['no-browser'],
    });
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  console.error('Usage:\n  node scripts/backup/auth.js init-key [--output-dir <dir>] [--bits 4096]\n  node scripts/backup/auth.js oauth --client-secret <json> --recipient-sha256 <hex> [options]');
  return 2;
}

module.exports = {
  AUTH_URL,
  APPROVED_AUTH_URIS,
  DRIVE_POLICY_SCHEMA,
  DEFAULT_FOLDER_NAME,
  DEFAULT_RETENTION_DAYS,
  MIN_RETAINED_GENERATIONS,
  DEFAULT_REMOTE_BACKUP_ROOT,
  DEFAULT_REMOTE_SECRETS_DIR,
  loadDesktopClientSecret,
  buildPkcePair,
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  buildPolicyDoc,
  promptHidden,
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
