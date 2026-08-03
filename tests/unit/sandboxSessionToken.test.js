'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SESSION_COOKIE_NAME,
  createSessionToken,
  readCookie,
  serializeSessionCookie,
  verifySessionToken,
} = require('../../lib/sandboxSessionToken');

test.describe('public sandbox session token', () => {
  const secret = 'test-secret-with-at-least-thirty-two-characters';
  const id = 'sbx_0123456789abcdef';

  test.it('signs and verifies one opaque sandbox id', () => {
    const token = createSessionToken(id, secret);
    assert.equal(verifySessionToken(token, secret), id);
    assert.equal(verifySessionToken(token, `${secret}-wrong`), null);
  });

  test.it('rejects a modified id or signature', () => {
    const token = createSessionToken(id, secret);
    assert.equal(verifySessionToken(token.replace('0123', '9999'), secret), null);
    assert.equal(verifySessionToken(`${token}x`, secret), null);
    assert.equal(verifySessionToken('not-a-token', secret), null);
  });

  test.it('uses a host-safe, HTTP-only, same-site cookie', () => {
    const token = createSessionToken(id, secret);
    const cookie = serializeSessionCookie(token, { maxAgeSeconds: 3600, secure: true });
    assert.match(cookie, new RegExp(`^${SESSION_COOKIE_NAME}=`));
    assert.match(cookie, /HttpOnly/u);
    assert.match(cookie, /SameSite=Lax/u);
    assert.match(cookie, /Secure/u);
    assert.match(cookie, /Max-Age=3600/u);
    assert.equal(readCookie(`other=1; ${cookie}`), token);
  });
});
