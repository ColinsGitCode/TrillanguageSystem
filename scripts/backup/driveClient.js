'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const { URL, URLSearchParams } = require('node:url');
const {
  SHA256_HEX_RE,
  ensurePrivateDir,
  readPrivateJson,
} = require('./fsGuards');

const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const ALLOWED_HOSTS = new Set(['oauth2.googleapis.com', 'www.googleapis.com']);
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const OCTET_MIME = 'application/octet-stream';
const FILE_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const FOLDER_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
const TOKEN_SCHEMA = 'threelans.core-backup.drive-oauth.v1';
const FILE_FIELDS = 'id,name,mimeType,size,sha256Checksum,parents,trashed,shared,createdTime,appProperties';
const LIST_FIELDS = `nextPageToken,files(${FILE_FIELDS})`;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const DEFAULT_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024; // multiple of 256 KiB per Drive API spec
const CHUNK_ALIGN_BYTES = 256 * 1024;

class DriveApiError extends Error {
  constructor(code, { statusCode = null } = {}) {
    super(code);
    this.name = 'DriveApiError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function validateFileId(fileId) {
  if (typeof fileId !== 'string' || !FILE_ID_RE.test(fileId)) {
    throw new Error('invalid_drive_file_id');
  }
  return fileId;
}

function ensureAllowedUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error('unapproved_drive_endpoint');
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error('unapproved_drive_endpoint');
  }
  return parsed;
}

function validateOAuthTokenDoc(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || doc.schema !== TOKEN_SCHEMA) {
    throw new Error('invalid_drive_token_schema');
  }
  if (doc.scope !== DRIVE_FILE_SCOPE) {
    throw new Error('drive_file_scope_required');
  }
  for (const field of ['client_id', 'client_secret', 'refresh_token']) {
    const val = doc[field];
    if (typeof val !== 'string' || val.length < 8 || val.length > 4096 || /\s/.test(val)) {
      throw new Error(`invalid_drive_token_${field}`);
    }
  }
  const tokenUri = doc.token_uri || TOKEN_URL;
  if (tokenUri !== TOKEN_URL) {
    throw new Error('unapproved_oauth_token_uri');
  }
  return doc;
}

function loadOAuthTokenFile(tokenPath) {
  return validateOAuthTokenDoc(readPrivateJson(tokenPath));
}

function parseDriveTimestamp(value) {
  if (typeof value !== 'string' || !value) {
    throw new Error('missing_timestamp');
  }
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error('naive_timestamp');
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new Error('invalid_timestamp');
  }
  return new Date(ms);
}

function sanitizeHttpErrorCode(statusCode, rawBody) {
  let errCode = `drive_http_${statusCode}`;
  try {
    const parsed = JSON.parse(rawBody.toString('utf8'));
    const oauthErr = parsed && parsed.error;
    if (typeof oauthErr === 'string' && /^[a-z_]{2,40}$/.test(oauthErr)) {
      errCode = `oauth_${oauthErr}`;
    } else if (oauthErr && typeof oauthErr === 'object' && Array.isArray(oauthErr.errors)) {
      const reason = oauthErr.errors[0] && oauthErr.errors[0].reason;
      if (typeof reason === 'string' && /^[A-Za-z0-9_]{2,48}$/.test(reason)) {
        errCode = `drive_${statusCode}_${reason}`;
      }
    }
  } catch {}
  return errCode;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultHttpsTransport({
  method,
  url,
  headers,
  body = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxResponseBytes = MAX_JSON_BYTES,
  responseFilePath = null,
}) {
  const parsed = ensureAllowedUrl(url);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method,
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        const status = Number(res.statusCode || 0);
        const respHeaders = {};
        for (const [k, v] of Object.entries(res.headers || {})) {
          respHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
        }

        if (responseFilePath && status === 200) {
          ensurePrivateDir(path.dirname(responseFilePath));
          const tempPath = `${responseFilePath}.${crypto.randomBytes(6).toString('hex')}.part`;
          const flags = fs.constants.O_WRONLY
            | fs.constants.O_CREAT
            | fs.constants.O_EXCL
            | (fs.constants.O_NOFOLLOW || 0);
          let fd;
          try {
            fd = fs.openSync(tempPath, flags, 0o600);
          } catch (err) {
            res.resume();
            reject(err);
            return;
          }
          const hash = crypto.createHash('sha256');
          let received = 0;
          let failed = false;

          const failDownload = (err) => {
            if (failed) return;
            failed = true;
            res.destroy();
            try { fs.closeSync(fd); } catch {}
            try { fs.unlinkSync(tempPath); } catch {}
            reject(err);
          };

          res.on('data', (chunk) => {
            if (failed) return;
            received += chunk.length;
            if (received > maxResponseBytes) {
              failDownload(new DriveApiError('drive_response_size_limit'));
              return;
            }
            try {
              let off = 0;
              while (off < chunk.length) {
                off += fs.writeSync(fd, chunk, off, chunk.length - off);
              }
              hash.update(chunk);
            } catch (err) {
              failDownload(err);
            }
          });
          res.on('error', () => failDownload(new DriveApiError('drive_network_error')));
          res.on('end', () => {
            if (failed) return;
            try {
              fs.fsyncSync(fd);
              fs.closeSync(fd);
              fs.renameSync(tempPath, responseFilePath);
              resolve({
                status,
                headers: respHeaders,
                body: Buffer.alloc(0),
                downloadedBytes: received,
                downloadedSha256: hash.digest('hex'),
              });
            } catch (err) {
              try { fs.unlinkSync(tempPath); } catch {}
              reject(err);
            }
          });
          return;
        }

        const chunks = [];
        let total = 0;
        const limit = status >= 400 ? Math.min(maxResponseBytes, 8192) : maxResponseBytes;

        res.on('data', (chunk) => {
          total += chunk.length;
          if (total > limit) {
            if (status >= 400) {
              res.destroy();
              return;
            }
            res.destroy();
            reject(new DriveApiError('drive_response_size_limit'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('error', () => reject(new DriveApiError('drive_network_error')));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          if (status >= 400) {
            reject(new DriveApiError(sanitizeHttpErrorCode(status, raw), { statusCode: status }));
            return;
          }
          resolve({ status, headers: respHeaders, body: raw });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new DriveApiError('drive_network_error'));
    });
    req.on('error', () => {
      reject(new DriveApiError('drive_network_error'));
    });

    if (body !== null && body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

class GoogleDriveClient {
  constructor({
    clientId,
    clientSecret,
    refreshToken,
    scope = DRIVE_FILE_SCOPE,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    transport = null,
    sleepFn = sleep,
  }) {
    if (scope !== DRIVE_FILE_SCOPE) {
      throw new Error('drive_file_scope_required');
    }
    this._clientId = clientId;
    this._clientSecret = clientSecret;
    this._refreshToken = refreshToken;
    this._timeoutMs = timeoutMs;
    this._transport = transport || defaultHttpsTransport;
    this._sleep = sleepFn;
    this._accessToken = null;
    this._expiresAtMs = 0;
  }

  static fromTokenFile(tokenPath, options = {}) {
    const doc = loadOAuthTokenFile(tokenPath);
    return new GoogleDriveClient({
      clientId: doc.client_id,
      clientSecret: doc.client_secret,
      refreshToken: doc.refresh_token,
      scope: doc.scope,
      ...options,
    });
  }

  async _request(method, url, {
    headers = {},
    body = null,
    auth = true,
    maxResponseBytes = MAX_JSON_BYTES,
    retries = 2,
    responseFilePath = null,
  } = {}) {
    ensureAllowedUrl(url);
    let attempt = 0;
    let refreshedAfter401 = false;

    while (true) {
      const reqHeaders = { ...headers };
      if (auth) {
        reqHeaders.Authorization = `Bearer ${await this.accessToken()}`;
      }
      try {
        return await this._transport({
          method,
          url,
          headers: reqHeaders,
          body,
          timeoutMs: this._timeoutMs,
          maxResponseBytes,
          responseFilePath,
        });
      } catch (err) {
        if (err instanceof DriveApiError) {
          if (auth && err.statusCode === 401 && !refreshedAfter401) {
            this._accessToken = null;
            this._expiresAtMs = 0;
            refreshedAfter401 = true;
            continue;
          }
          if ([429, 500, 502, 503, 504].includes(err.statusCode) && attempt < retries) {
            attempt += 1;
            await this._sleep(Math.min(2000 * attempt, 5000));
            continue;
          }
        }
        throw err;
      }
    }
  }

  async accessToken() {
    const now = Date.now();
    if (this._accessToken && now < this._expiresAtMs - 60_000) {
      return this._accessToken;
    }
    const payload = new URLSearchParams({
      client_id: this._clientId,
      client_secret: this._clientSecret,
      refresh_token: this._refreshToken,
      grant_type: 'refresh_token',
    }).toString();

    const resp = await this._request('POST', TOKEN_URL, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: Buffer.from(payload, 'ascii'),
      auth: false,
      retries: 1,
    });
    if (resp.status !== 200) {
      throw new DriveApiError('oauth_refresh_failed', { statusCode: resp.status });
    }
    const data = JSON.parse(resp.body.toString('utf8'));
    const token = data && data.access_token;
    const expiresIn = Number(data && data.expires_in) || 3600;
    const grantedScope = data && data.scope;

    if (typeof token !== 'string' || !token) {
      throw new DriveApiError('oauth_missing_access_token');
    }
    if (grantedScope !== undefined && grantedScope !== null) {
      const scopes = new Set(String(grantedScope).trim().split(/\s+/).filter(Boolean));
      if (scopes.size !== 1 || !scopes.has(DRIVE_FILE_SCOPE)) {
        throw new DriveApiError('oauth_unexpected_scope');
      }
    }
    this._accessToken = token;
    this._expiresAtMs = now + Math.max(120, Math.min(Math.floor(expiresIn), 7200)) * 1000;
    return token;
  }

  async getFileMetadata(fileId) {
    const fid = validateFileId(fileId);
    const qs = new URLSearchParams({ fields: FILE_FIELDS }).toString();
    const resp = await this._request('GET', `${FILES_URL}/${fid}?${qs}`);
    if (resp.status !== 200) {
      throw new DriveApiError('drive_get_metadata_failed', { statusCode: resp.status });
    }
    const meta = JSON.parse(resp.body.toString('utf8'));
    if (!meta || typeof meta !== 'object' || meta.id !== fid) {
      throw new DriveApiError('drive_metadata_id_mismatch');
    }
    return meta;
  }

  async verifyPrivateFolder(folderId) {
    const meta = await this.getFileMetadata(folderId);
    if (meta.mimeType !== FOLDER_MIME) {
      throw new Error('drive_target_not_folder');
    }
    if (meta.trashed !== false) {
      throw new Error('drive_target_folder_trashed');
    }
    if (meta.shared !== false) {
      throw new Error('drive_target_folder_must_be_private');
    }
    return meta;
  }

  async createPrivateFolder(name) {
    if (typeof name !== 'string' || !FOLDER_NAME_RE.test(name)) {
      throw new Error('invalid_drive_folder_name');
    }
    const qs = new URLSearchParams({ fields: FILE_FIELDS }).toString();
    const body = Buffer.from(JSON.stringify({ name, mimeType: FOLDER_MIME }), 'utf8');
    const resp = await this._request('POST', `${FILES_URL}?${qs}`, {
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'Content-Length': String(body.length),
      },
      body,
    });
    if (resp.status !== 200 && resp.status !== 201) {
      throw new DriveApiError('drive_create_folder_failed', { statusCode: resp.status });
    }
    const meta = JSON.parse(resp.body.toString('utf8'));
    validateFileId(meta && meta.id);
    if (meta.mimeType !== FOLDER_MIME || meta.shared !== false) {
      throw new DriveApiError('drive_created_folder_invalid');
    }
    return meta;
  }

  async listFolderFiles(folderId, { pageLimit = 20 } = {}) {
    const fid = validateFileId(folderId);
    const results = [];
    let pageToken = null;
    for (let page = 0; page < pageLimit; page += 1) {
      const params = new URLSearchParams({
        q: `'${fid}' in parents and trashed = false`,
        fields: LIST_FIELDS,
        pageSize: '100',
        orderBy: 'createdTime asc',
        spaces: 'drive',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const resp = await this._request('GET', `${FILES_URL}?${params.toString()}`);
      if (resp.status !== 200) {
        throw new DriveApiError('drive_list_failed', { statusCode: resp.status });
      }
      const data = JSON.parse(resp.body.toString('utf8'));
      if (!data || !Array.isArray(data.files)) {
        throw new DriveApiError('drive_list_invalid_payload');
      }
      for (const item of data.files) {
        if (item && typeof item === 'object') results.push(item);
      }
      pageToken = data.nextPageToken || null;
      if (!pageToken) return results;
    }
    throw new DriveApiError('drive_list_page_limit_exceeded');
  }

  async uploadResumableFile(folderId, name, filePath, {
    appProperties = {},
    chunkBytes = DEFAULT_UPLOAD_CHUNK_BYTES,
  } = {}) {
    const fid = validateFileId(folderId);
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile() || st.size <= 0) {
      throw new Error('nonempty_ciphertext_required');
    }
    const totalSize = st.size;
    const effectiveChunk = Math.max(
      CHUNK_ALIGN_BYTES,
      Math.floor(chunkBytes / CHUNK_ALIGN_BYTES) * CHUNK_ALIGN_BYTES
    );

    const initQs = new URLSearchParams({
      uploadType: 'resumable',
      fields: FILE_FIELDS,
    }).toString();
    const metadata = {
      name,
      parents: [fid],
      mimeType: OCTET_MIME,
      appProperties: Object.fromEntries(
        Object.entries(appProperties).map(([k, v]) => [String(k), String(v)])
      ),
    };
    const metaBytes = Buffer.from(JSON.stringify(metadata), 'utf8');
    const initResp = await this._request('POST', `${UPLOAD_URL}?${initQs}`, {
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'Content-Length': String(metaBytes.length),
        'X-Upload-Content-Type': OCTET_MIME,
        'X-Upload-Content-Length': String(totalSize),
      },
      body: metaBytes,
    });
    if (initResp.status !== 200) {
      throw new DriveApiError('drive_upload_init_failed', { statusCode: initResp.status });
    }
    const uploadUri = initResp.headers.location;
    if (!uploadUri) {
      throw new DriveApiError('drive_upload_missing_location');
    }
    ensureAllowedUrl(uploadUri);

    const fd = fs.openSync(filePath, 'r');
    try {
      let offset = 0;
      let created = null;
      while (offset < totalSize) {
        const len = Math.min(effectiveChunk, totalSize - offset);
        const chunkBuf = Buffer.allocUnsafe(len);
        let readTotal = 0;
        while (readTotal < len) {
          const n = fs.readSync(fd, chunkBuf, readTotal, len - readTotal, offset + readTotal);
          if (n <= 0) throw new Error('unexpected_upload_file_eof');
          readTotal += n;
        }
        const endByte = offset + len - 1;
        const headers = {
          'Content-Type': OCTET_MIME,
          'Content-Length': String(len),
          'Content-Range': `bytes ${offset}-${endByte}/${totalSize}`,
        };
        const resp = await this._request('PUT', uploadUri, {
          headers,
          body: chunkBuf,
          retries: 1,
        });
        if (offset + len < totalSize) {
          if (resp.status !== 308) {
            throw new DriveApiError('drive_upload_chunk_failed', { statusCode: resp.status });
          }
          offset += len;
        } else {
          if (resp.status !== 200 && resp.status !== 201) {
            throw new DriveApiError('drive_upload_transfer_failed', { statusCode: resp.status });
          }
          created = JSON.parse(resp.body.toString('utf8'));
          offset += len;
        }
      }
      validateFileId(created && created.id);
      return created;
    } finally {
      fs.closeSync(fd);
    }
  }

  async downloadFileToPath(fileId, destPath, { maxBytes }) {
    const fid = validateFileId(fileId);
    const qs = new URLSearchParams({ alt: 'media' }).toString();
    const resp = await this._request('GET', `${FILES_URL}/${fid}?${qs}`, {
      maxResponseBytes: maxBytes,
      responseFilePath: destPath,
    });
    if (resp.status !== 200) {
      throw new DriveApiError('drive_download_failed', { statusCode: resp.status });
    }
    if (resp.downloadedSha256) {
      return {
        size: resp.downloadedBytes,
        sha256: resp.downloadedSha256,
      };
    }
    // Fallback for mocked transports that return body buffer in memory.
    const raw = resp.body || Buffer.alloc(0);
    if (raw.length > maxBytes) {
      throw new DriveApiError('drive_response_size_limit');
    }
    ensurePrivateDir(path.dirname(destPath));
    const flags = fs.constants.O_WRONLY
      | fs.constants.O_CREAT
      | fs.constants.O_EXCL
      | (fs.constants.O_NOFOLLOW || 0);
    const fd = fs.openSync(destPath, flags, 0o600);
    try {
      let off = 0;
      while (off < raw.length) {
        off += fs.writeSync(fd, raw, off, raw.length - off);
      }
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    return {
      size: raw.length,
      sha256: crypto.createHash('sha256').update(raw).digest('hex'),
    };
  }

  // Reversible 30-day safety window only — permanent DELETE is intentionally not implemented.
  async trashFile(fileId) {
    const fid = validateFileId(fileId);
    const qs = new URLSearchParams({ fields: 'id,name,trashed' }).toString();
    const body = Buffer.from(JSON.stringify({ trashed: true }), 'utf8');
    const resp = await this._request('PATCH', `${FILES_URL}/${fid}?${qs}`, {
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'Content-Length': String(body.length),
      },
      body,
    });
    if (resp.status !== 200) {
      throw new DriveApiError('drive_trash_failed', { statusCode: resp.status });
    }
    const updated = JSON.parse(resp.body.toString('utf8'));
    if (!updated || updated.id !== fid || updated.trashed !== true) {
      throw new DriveApiError('drive_trash_not_confirmed');
    }
    return updated;
  }
}

module.exports = {
  DRIVE_FILE_SCOPE,
  TOKEN_URL,
  FILES_URL,
  UPLOAD_URL,
  ALLOWED_HOSTS,
  FOLDER_MIME,
  OCTET_MIME,
  FILE_ID_RE,
  SHA256_HEX_RE,
  TOKEN_SCHEMA,
  FILE_FIELDS,
  LIST_FIELDS,
  DriveApiError,
  GoogleDriveClient,
  validateFileId,
  ensureAllowedUrl,
  validateOAuthTokenDoc,
  loadOAuthTokenFile,
  parseDriveTimestamp,
};
