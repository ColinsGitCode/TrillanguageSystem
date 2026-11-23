'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  SHA256_HEX_RE,
  canonicalJsonBytes,
  sha256FileSync,
} = require('./fsGuards');

const MAGIC = Buffer.from('TLANSPK1\0', 'ascii');
const ENVELOPE_SCHEMA = 'threelans.core-backup-envelope.v1';
const WRAPPING = 'RSA-OAEP-SHA256';
const CIPHER = 'AES-256-GCM-CHUNKED';
const HEADER_LIMIT = 4096;
const DEFAULT_CHUNK_BYTES = 1024 * 1024; // 1 MiB
const MIN_CHUNK_BYTES = 4096;
const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
const AUTH_TAG_BYTES = 16;
const DATA_KEY_BYTES = 32;
const NONCE_PREFIX_BYTES = 8;
const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB hard safety ceiling

const REQUIRED_HEADER_FIELDS = Object.freeze([
  'chunk_bytes',
  'cipher',
  'plaintext_bytes',
  'plaintext_sha256',
  'recipient_sha256',
  'schema',
  'wrapped_key',
  'wrapping',
]);

function loadValidatedPublicKey(publicPem) {
  const pemBuf = Buffer.isBuffer(publicPem) ? publicPem : Buffer.from(String(publicPem || ''), 'utf8');
  if (pemBuf.length === 0 || pemBuf.length > 16384) {
    throw new Error('bounded_public_pem_required');
  }
  const key = crypto.createPublicKey(pemBuf);
  if (key.asymmetricKeyType !== 'rsa') {
    throw new Error('rsa_3072_or_4096_public_key_required');
  }
  const details = key.asymmetricKeyDetails || {};
  if (![3072, 4096].includes(details.modulusLength) || details.publicExponent !== 65537n) {
    throw new Error('rsa_3072_or_4096_public_key_required');
  }
  return key;
}

function validatePrivateKey(privateKey) {
  if (!privateKey || privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'rsa') {
    throw new Error('recipient_private_key_required');
  }
  const details = privateKey.asymmetricKeyDetails || {};
  if (![3072, 4096].includes(details.modulusLength)) {
    throw new Error('recipient_private_key_required');
  }
  return privateKey;
}

function publicKeyFingerprint(keyOrPem) {
  const key = keyOrPem && typeof keyOrPem.export === 'function'
    ? (keyOrPem.type === 'private' ? crypto.createPublicKey(keyOrPem) : keyOrPem)
    : loadValidatedPublicKey(keyOrPem);
  const der = key.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex');
}

function generateRecoveryKeypair({ bits = 4096, passphrase }) {
  if (![3072, 4096].includes(bits)) {
    throw new Error('rsa_3072_or_4096_public_key_required');
  }
  if (typeof passphrase !== 'string' || passphrase.length < 12) {
    throw new Error('recovery_passphrase_min_12_chars');
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: bits,
    publicExponent: 0x10001,
  });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privatePem = privateKey.export({
    type: 'pkcs8',
    format: 'pem',
    cipher: 'aes-256-cbc',
    passphrase,
  });
  return {
    publicPem,
    privatePem,
    recipientSha256: publicKeyFingerprint(publicKey),
    bits,
  };
}

function buildOaepLabel(headerWithoutWrappedKey) {
  const bound = {};
  for (const [k, v] of Object.entries(headerWithoutWrappedKey)) {
    if (k !== 'wrapped_key') bound[k] = v;
  }
  return canonicalJsonBytes(bound);
}

function buildChunkNonce(noncePrefix, chunkIndex) {
  const nonce = Buffer.allocUnsafe(12);
  noncePrefix.copy(nonce, 0, 0, NONCE_PREFIX_BYTES);
  nonce.writeUInt32BE(chunkIndex, NONCE_PREFIX_BYTES);
  return nonce;
}

function buildChunkAad(headerHashBuf, chunkIndex, isFinal) {
  const aad = Buffer.allocUnsafe(37);
  headerHashBuf.copy(aad, 0, 0, 32);
  aad.writeUInt32BE(chunkIndex, 32);
  aad.writeUInt8(isFinal ? 1 : 0, 36);
  return aad;
}

function expectedChunkCount(plaintextBytes, chunkBytes) {
  if (plaintextBytes === 0) return 1;
  return Math.ceil(plaintextBytes / chunkBytes);
}

function expectedPayloadLength(plaintextBytes, chunkBytes) {
  const chunks = expectedChunkCount(plaintextBytes, chunkBytes);
  return plaintextBytes + chunks * (4 + AUTH_TAG_BYTES);
}

function sealFile(inputPath, outputPath, publicPem, { chunkBytes = DEFAULT_CHUNK_BYTES } = {}) {
  if (!Number.isInteger(chunkBytes) || chunkBytes < MIN_CHUNK_BYTES || chunkBytes > MAX_CHUNK_BYTES) {
    throw new Error('invalid_chunk_bytes');
  }
  const pubKey = loadValidatedPublicKey(publicPem);
  const recipientSha256 = publicKeyFingerprint(pubKey);
  const { sha256: plaintextSha256, size: plaintextBytes } = sha256FileSync(inputPath);
  if (plaintextBytes < 0 || plaintextBytes > MAX_ARCHIVE_BYTES) {
    throw new Error('encrypted_archive_size_limit');
  }

  const keyMaterial = crypto.randomBytes(DATA_KEY_BYTES + NONCE_PREFIX_BYTES);
  const dataKey = keyMaterial.subarray(0, DATA_KEY_BYTES);
  const noncePrefix = keyMaterial.subarray(DATA_KEY_BYTES, DATA_KEY_BYTES + NONCE_PREFIX_BYTES);

  const baseHeader = {
    schema: ENVELOPE_SCHEMA,
    wrapping: WRAPPING,
    cipher: CIPHER,
    chunk_bytes: chunkBytes,
    recipient_sha256: recipientSha256,
    plaintext_bytes: plaintextBytes,
    plaintext_sha256: plaintextSha256,
  };
  const oaepLabel = buildOaepLabel(baseHeader);
  const wrapped = crypto.publicEncrypt(
    {
      key: pubKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
      oaepLabel,
    },
    keyMaterial
  );
  const header = {
    ...baseHeader,
    wrapped_key: wrapped.toString('base64'),
  };
  const headerBytes = canonicalJsonBytes(header);
  if (headerBytes.length === 0 || headerBytes.length > HEADER_LIMIT) {
    throw new Error('invalid_envelope_header_size');
  }
  const headerHash = crypto.createHash('sha256').update(headerBytes).digest();

  const headerLenBuf = Buffer.allocUnsafe(4);
  headerLenBuf.writeUInt32BE(headerBytes.length, 0);

  const inFd = fs.openSync(inputPath, 'r');
  const outFlags = fs.constants.O_WRONLY
    | fs.constants.O_CREAT
    | fs.constants.O_EXCL
    | (fs.constants.O_NOFOLLOW || 0);
  const outFd = fs.openSync(outputPath, outFlags, 0o600);
  const outHash = crypto.createHash('sha256');
  let totalWritten = 0;

  function writeAll(buf) {
    let offset = 0;
    while (offset < buf.length) {
      offset += fs.writeSync(outFd, buf, offset, buf.length - offset);
    }
    outHash.update(buf);
    totalWritten += buf.length;
  }

  try {
    writeAll(MAGIC);
    writeAll(headerLenBuf);
    writeAll(headerBytes);

    const readBuf = Buffer.allocUnsafe(chunkBytes);
    let remaining = plaintextBytes;
    let chunkIndex = 0;
    const totalChunks = expectedChunkCount(plaintextBytes, chunkBytes);

    while (chunkIndex < totalChunks) {
      const toRead = Math.min(chunkBytes, remaining);
      let readTotal = 0;
      while (readTotal < toRead) {
        const n = fs.readSync(inFd, readBuf, readTotal, toRead - readTotal, null);
        if (n <= 0) {
          throw new Error('unexpected_plaintext_eof');
        }
        readTotal += n;
      }
      remaining -= readTotal;
      const isFinal = chunkIndex === totalChunks - 1;
      const plainChunk = readBuf.subarray(0, readTotal);
      const nonce = buildChunkNonce(noncePrefix, chunkIndex);
      const aad = buildChunkAad(headerHash, chunkIndex, isFinal);
      const cipher = crypto.createCipheriv('aes-256-gcm', dataKey, nonce);
      cipher.setAAD(aad);
      const enc1 = cipher.update(plainChunk);
      const enc2 = cipher.final();
      const tag = cipher.getAuthTag();
      const lenPrefix = Buffer.allocUnsafe(4);
      lenPrefix.writeUInt32BE(readTotal, 0);

      writeAll(lenPrefix);
      if (enc1.length) writeAll(enc1);
      if (enc2.length) writeAll(enc2);
      writeAll(tag);
      chunkIndex += 1;
    }

    // Ensure no extra plaintext bytes appeared while sealing.
    const extraProbe = Buffer.allocUnsafe(1);
    if (fs.readSync(inFd, extraProbe, 0, 1, null) > 0) {
      throw new Error('plaintext_changed_during_seal');
    }

    fs.fsyncSync(outFd);
  } catch (err) {
    try { fs.closeSync(outFd); } catch {}
    try { fs.unlinkSync(outputPath); } catch {}
    try { fs.closeSync(inFd); } catch {}
    throw err;
  } finally {
    keyMaterial.fill(0);
  }

  fs.closeSync(outFd);
  fs.closeSync(inFd);

  return {
    header,
    size: totalWritten,
    sha256: outHash.digest('hex'),
  };
}

function readExactSync(fd, size, position) {
  const buf = Buffer.allocUnsafe(size);
  let readTotal = 0;
  while (readTotal < size) {
    const n = fs.readSync(fd, buf, readTotal, size - readTotal, position + readTotal);
    if (n <= 0) {
      throw new Error('invalid_envelope_truncated');
    }
    readTotal += n;
  }
  return buf;
}

function parseEnvelopeFile(envelopePath) {
  const st = fs.lstatSync(envelopePath);
  if (st.isSymbolicLink() || !st.isFile()) {
    throw new Error('invalid_envelope');
  }
  if (st.size < MAGIC.length + 4 || st.size > MAX_ARCHIVE_BYTES + HEADER_LIMIT + 64 * 1024 * 1024) {
    throw new Error('invalid_envelope');
  }
  const fd = fs.openSync(envelopePath, 'r');
  try {
    const prefix = readExactSync(fd, MAGIC.length + 4, 0);
    if (!prefix.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error('invalid_envelope');
    }
    const headerLen = prefix.readUInt32BE(MAGIC.length);
    if (headerLen < 1 || headerLen > HEADER_LIMIT || st.size <= MAGIC.length + 4 + headerLen) {
      throw new Error('invalid_envelope_header_size');
    }
    const rawHeader = readExactSync(fd, headerLen, MAGIC.length + 4);
    let header;
    try {
      header = JSON.parse(rawHeader.toString('utf8'));
    } catch {
      throw new Error('invalid_envelope_contract');
    }
    if (!header || typeof header !== 'object' || Array.isArray(header)) {
      throw new Error('invalid_envelope_contract');
    }
    const actualKeys = Object.keys(header).sort();
    if (
      actualKeys.length !== REQUIRED_HEADER_FIELDS.length
      || actualKeys.some((k, idx) => k !== REQUIRED_HEADER_FIELDS[idx])
      || !canonicalJsonBytes(header).equals(rawHeader)
      || header.schema !== ENVELOPE_SCHEMA
      || header.wrapping !== WRAPPING
      || header.cipher !== CIPHER
    ) {
      throw new Error('invalid_envelope_contract');
    }
    if (
      !Number.isInteger(header.chunk_bytes)
      || header.chunk_bytes < MIN_CHUNK_BYTES
      || header.chunk_bytes > MAX_CHUNK_BYTES
      || !Number.isInteger(header.plaintext_bytes)
      || header.plaintext_bytes < 0
      || header.plaintext_bytes > MAX_ARCHIVE_BYTES
    ) {
      throw new Error('invalid_envelope_bounds');
    }
    if (
      typeof header.recipient_sha256 !== 'string'
      || !SHA256_HEX_RE.test(header.recipient_sha256)
      || typeof header.plaintext_sha256 !== 'string'
      || !SHA256_HEX_RE.test(header.plaintext_sha256)
    ) {
      throw new Error('invalid_envelope_digest');
    }
    if (typeof header.wrapped_key !== 'string' || header.wrapped_key.length > 1024) {
      throw new Error('invalid_wrapped_key');
    }
    const wrappedKey = Buffer.from(header.wrapped_key, 'base64');
    if (
      wrappedKey.toString('base64') !== header.wrapped_key
      || ![384, 512].includes(wrappedKey.length)
    ) {
      throw new Error('invalid_wrapped_key');
    }
    const payloadOffset = MAGIC.length + 4 + headerLen;
    const expectedLen = expectedPayloadLength(header.plaintext_bytes, header.chunk_bytes);
    if (st.size - payloadOffset !== expectedLen) {
      throw new Error('encrypted_payload_length_mismatch');
    }
    const headerHash = crypto.createHash('sha256').update(rawHeader).digest();
    return {
      header,
      headerHash,
      wrappedKey,
      payloadOffset,
      fileSize: st.size,
    };
  } finally {
    fs.closeSync(fd);
  }
}

function unsealFile(envelopePath, outputPath, privateKey) {
  const validPrivateKey = validatePrivateKey(privateKey);
  const parsed = parseEnvelopeFile(envelopePath);
  const { header, headerHash, wrappedKey, payloadOffset, fileSize } = parsed;

  if (publicKeyFingerprint(validPrivateKey) !== header.recipient_sha256) {
    throw new Error('recipient_private_key_required');
  }

  let keyMaterial;
  try {
    keyMaterial = crypto.privateDecrypt(
      {
        key: validPrivateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
        oaepLabel: buildOaepLabel(header),
      },
      wrappedKey
    );
  } catch {
    throw new Error('envelope_key_unwrap_failed');
  }

  if (keyMaterial.length !== DATA_KEY_BYTES + NONCE_PREFIX_BYTES) {
    keyMaterial.fill(0);
    throw new Error('invalid_data_key');
  }

  const dataKey = keyMaterial.subarray(0, DATA_KEY_BYTES);
  const noncePrefix = keyMaterial.subarray(DATA_KEY_BYTES, DATA_KEY_BYTES + NONCE_PREFIX_BYTES);

  const inFd = fs.openSync(envelopePath, 'r');
  const outFlags = fs.constants.O_WRONLY
    | fs.constants.O_CREAT
    | fs.constants.O_EXCL
    | (fs.constants.O_NOFOLLOW || 0);
  const outFd = fs.openSync(outputPath, outFlags, 0o600);
  const plainHash = crypto.createHash('sha256');
  let plainWritten = 0;

  try {
    let pos = payloadOffset;
    const totalChunks = expectedChunkCount(header.plaintext_bytes, header.chunk_bytes);

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
      const isFinal = chunkIndex === totalChunks - 1;
      const lenBuf = readExactSync(inFd, 4, pos);
      pos += 4;
      const chunkLen = lenBuf.readUInt32BE(0);
      if (chunkLen > header.chunk_bytes || (!isFinal && chunkLen !== header.chunk_bytes)) {
        throw new Error('invalid_chunk_length');
      }
      const cipherChunk = chunkLen > 0 ? readExactSync(inFd, chunkLen, pos) : Buffer.alloc(0);
      pos += chunkLen;
      const tag = readExactSync(inFd, AUTH_TAG_BYTES, pos);
      pos += AUTH_TAG_BYTES;

      const nonce = buildChunkNonce(noncePrefix, chunkIndex);
      const aad = buildChunkAad(headerHash, chunkIndex, isFinal);
      const decipher = crypto.createDecipheriv('aes-256-gcm', dataKey, nonce);
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);

      let plain1;
      let plain2;
      try {
        plain1 = decipher.update(cipherChunk);
        plain2 = decipher.final();
      } catch {
        throw new Error('envelope_authentication_failed');
      }
      const plain = plain2.length ? Buffer.concat([plain1, plain2]) : plain1;
      if (plain.length !== chunkLen) {
        throw new Error('envelope_authentication_failed');
      }
      if (plain.length > 0) {
        let off = 0;
        while (off < plain.length) {
          off += fs.writeSync(outFd, plain, off, plain.length - off);
        }
        plainHash.update(plain);
        plainWritten += plain.length;
      }
    }

    if (pos !== fileSize) {
      throw new Error('envelope_trailing_bytes');
    }
    const actualSha = plainHash.digest('hex');
    if (plainWritten !== header.plaintext_bytes || actualSha !== header.plaintext_sha256) {
      throw new Error('envelope_plaintext_integrity_mismatch');
    }
    fs.fsyncSync(outFd);
  } catch (err) {
    try { fs.closeSync(outFd); } catch {}
    try { fs.unlinkSync(outputPath); } catch {}
    try { fs.closeSync(inFd); } catch {}
    throw err;
  } finally {
    keyMaterial.fill(0);
  }

  fs.closeSync(outFd);
  fs.closeSync(inFd);

  return {
    header,
    plaintextBytes: plainWritten,
    plaintextSha256: header.plaintext_sha256,
  };
}

function selfTest() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tlans-env-selftest-'));
  fs.chmodSync(workDir, 0o700);
  try {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 3072,
      publicExponent: 0x10001,
    });
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
    const plainIn = path.join(workDir, 'plain.bin');
    const sealed = path.join(workDir, 'sealed.tlans');
    const plainOut = path.join(workDir, 'restored.bin');
    const tampered = path.join(workDir, 'tampered.tlans');
    const tamperedOut = path.join(workDir, 'tampered-out.bin');

    const sample = Buffer.concat([
      Buffer.from('Three LANS synthetic crypto self-test.\n'),
      crypto.randomBytes(12000),
    ]);
    fs.writeFileSync(plainIn, sample, { mode: 0o600 });

    sealFile(plainIn, sealed, publicPem, { chunkBytes: 4096 });
    unsealFile(sealed, plainOut, privateKey);
    if (!fs.readFileSync(plainOut).equals(sample)) {
      throw new Error('synthetic_roundtrip_failed');
    }

    const blob = fs.readFileSync(sealed);
    blob[blob.length - 1] ^= 0x01;
    fs.writeFileSync(tampered, blob, { mode: 0o600 });

    let tamperRejected = false;
    try {
      unsealFile(tampered, tamperedOut, privateKey);
    } catch {
      tamperRejected = true;
    }
    if (!tamperRejected) {
      throw new Error('tampered_archive_accepted');
    }

    return {
      status: 'SYNTHETIC_CRYPTO_CHECK_PASSED',
      schema: ENVELOPE_SCHEMA,
      roundtrip: true,
      tamper_rejected: true,
      private_key_persisted: false,
      production_data_accessed: false,
      off_host_restore_verified: false,
    };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

module.exports = {
  MAGIC,
  ENVELOPE_SCHEMA,
  WRAPPING,
  CIPHER,
  DEFAULT_CHUNK_BYTES,
  MAX_ARCHIVE_BYTES,
  loadValidatedPublicKey,
  validatePrivateKey,
  publicKeyFingerprint,
  generateRecoveryKeypair,
  sealFile,
  parseEnvelopeFile,
  unsealFile,
  selfTest,
};

if (require.main === module) {
  process.umask(0o077);
  console.log(JSON.stringify(selfTest()));
}
