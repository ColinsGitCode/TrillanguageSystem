'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { textbookError } = require('./textbookErrors');

let contractPromise;

async function getContract() {
  if (!contractPromise) contractPromise = import('./manifestContract.mjs');
  return contractPromise;
}

function parseRangeHeader(rangeHeader, size) {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(String(rangeHeader).trim());
  if (!match) throw textbookError('TEXTBOOK_AUDIO_RANGE_INVALID', 416, { size });
  let start = match[1] === '' ? null : Number(match[1]);
  let end = match[2] === '' ? null : Number(match[2]);
  if (start === null && end === null) throw textbookError('TEXTBOOK_AUDIO_RANGE_INVALID', 416, { size });
  if (start === null) {
    const suffixLength = end;
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      throw textbookError('TEXTBOOK_AUDIO_RANGE_INVALID', 416, { size });
    }
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    if (!Number.isInteger(start) || start < 0) throw textbookError('TEXTBOOK_AUDIO_RANGE_INVALID', 416, { size });
    if (end === null) end = size - 1;
  }
  if (!Number.isInteger(end) || end < start || start >= size) {
    throw textbookError('TEXTBOOK_AUDIO_RANGE_INVALID', 416, { size });
  }
  return { start, end: Math.min(end, size - 1) };
}

async function resolveOfficialAudio({ dbService, sourceRoot, assetId }) {
  const asset = dbService.getTextbookAsset(assetId);
  if (!asset) throw textbookError('TEXTBOOK_AUDIO_NOT_FOUND', 404);
  if (asset.kind !== 'official_audio') throw textbookError('TEXTBOOK_AUDIO_NOT_FOUND', 404);
  if (asset.availability !== 'available') throw textbookError('TEXTBOOK_AUDIO_UNAVAILABLE', 409);
  const contract = await getContract();
  let filePath;
  try {
    filePath = contract.resolveAssetPath(sourceRoot, asset.relative_path);
  } catch (error) {
    dbService.markTextbookAssetAvailability(asset.id, 'missing');
    const code = String(error.message || '').startsWith('TEXTBOOK_') ? error.message : 'TEXTBOOK_AUDIO_NOT_FOUND';
    throw textbookError(code, 404);
  }
  const actualHash = contract.sha256File(filePath);
  if (actualHash !== asset.sha256) {
    dbService.markTextbookAssetAvailability(asset.id, 'hash-mismatch');
    throw textbookError('TEXTBOOK_AUDIO_HASH_MISMATCH', 409);
  }
  const stat = fs.statSync(filePath);
  return {
    asset,
    filePath,
    size: stat.size,
    etag: `"sha256-${asset.sha256}"`,
    lastModified: stat.mtime.toUTCString(),
  };
}

async function streamOfficialAudio({ dbService, sourceRoot, req, res, assetId }) {
  const resolved = await resolveOfficialAudio({ dbService, sourceRoot, assetId });
  const headers = {
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=0, must-revalidate',
    'Content-Type': resolved.asset.mime_type,
    ETag: resolved.etag,
    'Last-Modified': resolved.lastModified,
  };
  if (req.headers['if-none-match'] === resolved.etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  const shouldIgnoreRange = req.headers['if-range'] && req.headers['if-range'] !== resolved.etag;
  const range = shouldIgnoreRange ? null : parseRangeHeader(req.headers.range, resolved.size);
  if (!range) {
    res.writeHead(200, { ...headers, 'Content-Length': resolved.size });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(resolved.filePath).pipe(res);
  }
  const contentLength = range.end - range.start + 1;
  res.writeHead(206, {
    ...headers,
    'Content-Length': contentLength,
    'Content-Range': `bytes ${range.start}-${range.end}/${resolved.size}`,
  });
  if (req.method === 'HEAD') return res.end();
  return fs.createReadStream(resolved.filePath, { start: range.start, end: range.end }).pipe(res);
}

function generatedAudioContentType(audio) {
  const format = String(audio.format || path.extname(audio.file_path).slice(1)).toLowerCase();
  if (format === 'mp3' || format === 'mpeg') return 'audio/mpeg';
  if (format === 'ogg') return 'audio/ogg';
  return 'audio/wav';
}

function resolveGeneratedAudio({ dbService, workRoot, audioFileId }) {
  const audio = dbService.getTextbookAudioFile(audioFileId);
  if (!audio || !['generated', 'fallback_generated'].includes(audio.status)) {
    throw textbookError('TEXTBOOK_AUDIO_NOT_FOUND', 404);
  }
  let rootRealPath;
  let fileRealPath;
  try {
    const rootResolvedPath = path.resolve(workRoot);
    rootRealPath = fs.realpathSync(workRoot);
    const candidate = path.resolve(String(audio.file_path || ''));
    const relative = path.relative(rootResolvedPath, candidate);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw textbookError('TEXTBOOK_MEDIA_PATH_REJECTED', 403);
    }
    if (fs.lstatSync(candidate).isSymbolicLink()) throw textbookError('TEXTBOOK_MEDIA_PATH_REJECTED', 403);
    fileRealPath = fs.realpathSync(candidate);
    const realRelative = path.relative(rootRealPath, fileRealPath);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      throw textbookError('TEXTBOOK_MEDIA_PATH_REJECTED', 403);
    }
  } catch (error) {
    if (error instanceof Error && String(error.message).startsWith('TEXTBOOK_')) throw error;
    throw textbookError('TEXTBOOK_AUDIO_NOT_FOUND', 404);
  }
  const stat = fs.statSync(fileRealPath);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(fileRealPath)).digest('hex');
  return {
    asset: { mime_type: generatedAudioContentType(audio) },
    filePath: fileRealPath,
    size: stat.size,
    etag: `"sha256-${hash}"`,
    lastModified: stat.mtime.toUTCString(),
  };
}

async function streamGeneratedAudio({ dbService, workRoot, req, res, audioFileId }) {
  const resolved = resolveGeneratedAudio({ dbService, workRoot, audioFileId });
  const headers = {
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=0, must-revalidate',
    'Content-Type': resolved.asset.mime_type,
    ETag: resolved.etag,
    'Last-Modified': resolved.lastModified,
  };
  if (req.headers['if-none-match'] === resolved.etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  const shouldIgnoreRange = req.headers['if-range'] && req.headers['if-range'] !== resolved.etag;
  const range = shouldIgnoreRange ? null : parseRangeHeader(req.headers.range, resolved.size);
  if (!range) {
    res.writeHead(200, { ...headers, 'Content-Length': resolved.size });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(resolved.filePath).pipe(res);
  }
  const contentLength = range.end - range.start + 1;
  res.writeHead(206, {
    ...headers,
    'Content-Length': contentLength,
    'Content-Range': `bytes ${range.start}-${range.end}/${resolved.size}`,
  });
  if (req.method === 'HEAD') return res.end();
  return fs.createReadStream(resolved.filePath, { start: range.start, end: range.end }).pipe(res);
}

function invalidRangeResponse(res, size) {
  res.status(416).set('Content-Range', `bytes */${size || 0}`).json({
    error: 'TEXTBOOK_AUDIO_RANGE_INVALID',
    code: 'TEXTBOOK_AUDIO_RANGE_INVALID',
  });
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

module.exports = {
  parseRangeHeader,
  resolveOfficialAudio,
  resolveGeneratedAudio,
  streamGeneratedAudio,
  streamOfficialAudio,
  invalidRangeResponse,
  sha256Buffer,
};
