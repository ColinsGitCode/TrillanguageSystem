'use strict';

const crypto = require('node:crypto');

const SESSION_COOKIE_NAME = 'three_lans_sandbox';

function signatureFor(sessionId, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(sessionId)
    .digest('base64url');
}

function createSessionToken(sessionId, secret) {
  if (!/^[a-z0-9][a-z0-9_-]{7,79}$/iu.test(String(sessionId || ''))) {
    throw new TypeError('Invalid sandbox session id');
  }
  if (String(secret || '').length < 32) {
    throw new TypeError('Sandbox cookie secret must contain at least 32 characters');
  }
  return `${sessionId}.${signatureFor(sessionId, secret)}`;
}

function verifySessionToken(token, secret) {
  const raw = String(token || '');
  const separator = raw.lastIndexOf('.');
  if (separator < 1) return null;
  const sessionId = raw.slice(0, separator);
  const supplied = raw.slice(separator + 1);
  if (!/^[a-z0-9][a-z0-9_-]{7,79}$/iu.test(sessionId) || !supplied) return null;
  let expected;
  try {
    expected = signatureFor(sessionId, secret);
  } catch {
    return null;
  }
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  return sessionId;
}

function readCookie(header, name = SESSION_COOKIE_NAME) {
  const target = `${name}=`;
  const pair = String(header || '')
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(target));
  if (!pair) return null;
  try {
    return decodeURIComponent(pair.slice(target.length));
  } catch {
    return null;
  }
}

function serializeSessionCookie(token, {
  maxAgeSeconds,
  secure = true,
  name = SESSION_COOKIE_NAME,
} = {}) {
  const parts = [
    `${name}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  if (Number.isFinite(maxAgeSeconds)) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`);
  }
  return parts.join('; ');
}

module.exports = {
  SESSION_COOKIE_NAME,
  createSessionToken,
  readCookie,
  serializeSessionCookie,
  verifySessionToken,
};
