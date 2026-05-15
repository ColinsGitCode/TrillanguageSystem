'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { runGeminiProxy, _internal: I } = require('../../services/geminiProxyService');
const { CODES } = require('../../services/geminiErrors');

// -- pure helpers ------------------------------------------------------------

test.describe('geminiProxyService._internal: pure helpers', () => {
  test.it('buildResetUrl derives /admin/reset for any valid URL', () => {
    assert.equal(I.buildResetUrl('http://gw:18888/api/gemini'), 'http://gw:18888/admin/reset');
    assert.equal(I.buildResetUrl('http://h:13210/api/gemini?x=1'), 'http://h:13210/admin/reset');
  });

  test.it('buildResetUrl returns empty for invalid URL', () => {
    assert.equal(I.buildResetUrl(''), '');
    assert.equal(I.buildResetUrl('not a url'), '');
  });

  test.it('isTimeoutLikeError matches timeout-ish messages', () => {
    assert.equal(I.isTimeoutLikeError('Gemini CLI timeout'), true);
    assert.equal(I.isTimeoutLikeError('Operation timed out'), true);
    assert.equal(I.isTimeoutLikeError('AbortError'), true);
    assert.equal(I.isTimeoutLikeError('random'), false);
    assert.equal(I.isTimeoutLikeError(''), false);
  });

  test.it('isMcpDiagnosticError matches MCP patterns', () => {
    assert.equal(I.isMcpDiagnosticError('MCP issues detected'), true);
    assert.equal(I.isMcpDiagnosticError('Run /mcp list for status'), true);
    assert.equal(I.isMcpDiagnosticError('hello world'), false);
  });

  test.it('isRetriableError considers the structured code first', () => {
    assert.equal(I.isRetriableError({ code: CODES.EXECUTOR_TIMEOUT }), true);
    assert.equal(I.isRetriableError({ code: CODES.EXECUTOR_BUSY }), true);
    assert.equal(I.isRetriableError({ code: CODES.RATE_LIMITED }), true);
    assert.equal(I.isRetriableError({ code: CODES.EXECUTOR_BAD_REQUEST }), false);
    assert.equal(I.isRetriableError({ code: CODES.EXECUTOR_SPAWN_ERROR }), false);
  });

  test.it('isRetriableError falls back to message text for codeless errors', () => {
    assert.equal(I.isRetriableError({ message: 'fetch failed' }), true);
    assert.equal(I.isRetriableError({ message: 'ECONNREFUSED 1.2.3.4:18888' }), true);
    assert.equal(I.isRetriableError({ message: 'Gemini proxy error (502): boom' }), true);
    assert.equal(I.isRetriableError({ message: 'random' }), false);
  });

  test.it('sanitizeMcpDiagnosticText strips MCP prefix lines', () => {
    assert.equal(I.sanitizeMcpDiagnosticText('plain'), 'plain');
    assert.equal(
      I.sanitizeMcpDiagnosticText('MCP issues detected. Run /mcp list for status. real output'),
      'real output'
    );
    assert.equal(I.sanitizeMcpDiagnosticText('a\nRun /mcp list for status\nb'), 'a\nb');
  });

  test.it('sanitizeMcpDiagnosticsInResponse cleans the markdown field and flags modified', () => {
    const r = { markdown: 'MCP issues detected. Run /mcp list for status. Real output' };
    const { response, modified } = I.sanitizeMcpDiagnosticsInResponse(r);
    assert.equal(modified, true);
    assert.equal(response.markdown, 'Real output');
  });

  test.it('sanitizeMcpDiagnosticsInResponse leaves a clean response untouched', () => {
    const { response, modified } = I.sanitizeMcpDiagnosticsInResponse({ markdown: 'clean' });
    assert.equal(modified, false);
    assert.equal(response.markdown, 'clean');
  });

  test.it('assertNoMcpDiagnosticInResponse throws on dirty / passes on clean', () => {
    assert.throws(() => I.assertNoMcpDiagnosticInResponse({ markdown: 'MCP issues detected blah' }));
    assert.doesNotThrow(() => I.assertNoMcpDiagnosticInResponse({ markdown: 'plain' }));
  });

  test.it('looksLikeGateway18888 keys on port 18888', () => {
    assert.equal(I.looksLikeGateway18888('http://gateway:18888/api/gemini'), true);
    assert.equal(I.looksLikeGateway18888('http://gateway:13210/api/gemini'), false);
    assert.equal(I.looksLikeGateway18888('invalid url'), false);
  });

  test.it('buildUrlCandidates adds an IPv4 fallback for host.docker.internal', () => {
    const c = I.buildUrlCandidates('http://host.docker.internal:18888/api/gemini', {
      preferIpv4: true,
      ipv4FallbackHost: '192.168.65.254',
    });
    assert.equal(c.length, 2);
    assert.ok(c[0].includes('host.docker.internal'));
    assert.ok(c[1].includes('192.168.65.254'));
  });

  test.it('buildUrlCandidates passes through unrelated hosts unchanged', () => {
    const c = I.buildUrlCandidates('http://example.com/api/gemini', { preferIpv4: true });
    assert.deepEqual(c, ['http://example.com/api/gemini']);
  });

  test.it('buildAuthHeaders apikey mode sets X-API-Key', () => {
    const h = I.buildAuthHeaders({ authMode: 'apikey', apiKey: 'secret' });
    assert.equal(h['X-API-Key'], 'secret');
    assert.equal(h.Authorization, undefined);
  });

  test.it('buildAuthHeaders bearer mode sets Authorization', () => {
    const h = I.buildAuthHeaders({ authMode: 'bearer', bearerToken: 'tok' });
    assert.equal(h.Authorization, 'Bearer tok');
    assert.equal(h['X-API-Key'], undefined);
  });
});

// -- runGeminiProxy integration ---------------------------------------------

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

function mockFetch(handler) {
  const calls = [];
  const orig = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    const out = handler({ url: String(url), opts, callIndex: calls.length - 1 });
    if (out instanceof Error) throw out;
    return await out;
  };
  return { calls, restore: () => { global.fetch = orig; } };
}

const baseOptions = {
  url: 'http://localhost:18888/api/gemini',
  enforceGateway: false,
  requireGatewayAuth: false,
  resetOnTimeout: false,
  retryDelayMs: 1,
};

test.describe('runGeminiProxy: integration with mocked fetch', () => {
  test.it('returns the sanitized response on a 200', async (t) => {
    const m = mockFetch(() => jsonResponse(200, { markdown: 'hello' }));
    t.after(() => m.restore());
    const result = await runGeminiProxy('prompt', { ...baseOptions, retries: 0 });
    assert.equal(result.markdown, 'hello');
    assert.equal(m.calls.length, 1);
  });

  test.it('propagates status/code/payload on a non-2xx with structured body', async (t) => {
    const body = { error: 'rate limited', code: CODES.RATE_LIMITED };
    const m = mockFetch(() => jsonResponse(429, body));
    t.after(() => m.restore());
    let caught;
    try {
      await runGeminiProxy('p', { ...baseOptions, retries: 0 });
    } catch (err) { caught = err; }
    assert.ok(caught, 'expected an error');
    assert.equal(caught.status, 429);
    assert.equal(caught.code, CODES.RATE_LIMITED);
    assert.deepEqual(caught.payload, body);
  });

  test.it('retries on EXECUTOR_TIMEOUT, then succeeds', async (t) => {
    const m = mockFetch(({ callIndex }) => callIndex === 0
      ? jsonResponse(504, { error: 'timeout', code: CODES.EXECUTOR_TIMEOUT })
      : jsonResponse(200, { markdown: 'after-retry' }));
    t.after(() => m.restore());
    const result = await runGeminiProxy('p', { ...baseOptions, retries: 1 });
    assert.equal(result.markdown, 'after-retry');
    assert.equal(m.calls.length, 2);
  });

  test.it('does not retry on a non-retriable code (EXECUTOR_BAD_REQUEST)', async (t) => {
    const m = mockFetch(() => jsonResponse(400, { error: 'bad', code: CODES.EXECUTOR_BAD_REQUEST }));
    t.after(() => m.restore());
    let caught;
    try {
      await runGeminiProxy('p', { ...baseOptions, retries: 5 });
    } catch (err) { caught = err; }
    assert.ok(caught);
    assert.equal(m.calls.length, 1, 'non-retriable error should not retry');
    assert.equal(caught.code, CODES.EXECUTOR_BAD_REQUEST);
  });

  test.it('final error after retries exhausted preserves status/code/payload', async (t) => {
    const payload = { error: 'timeout', code: CODES.EXECUTOR_TIMEOUT };
    const m = mockFetch(() => jsonResponse(504, payload));
    t.after(() => m.restore());
    let caught;
    try {
      await runGeminiProxy('p', { ...baseOptions, retries: 1 });
    } catch (err) { caught = err; }
    assert.ok(caught);
    assert.equal(m.calls.length, 2);
    // Regression for the bug we fixed: the final wrapped error must carry
    // through enough metadata for the job queue to classify.
    assert.equal(caught.status, 504);
    assert.equal(caught.code, CODES.EXECUTOR_TIMEOUT);
    assert.deepEqual(caught.payload, payload);
  });

  test.it('strips MCP diagnostic chatter when the caller-supplied validator accepts the cleaned output', async (t) => {
    const m = mockFetch(() => jsonResponse(200, {
      markdown: 'MCP issues detected. Run /mcp list for status. Real card content here',
    }));
    t.after(() => m.restore());
    const result = await runGeminiProxy('p', {
      ...baseOptions,
      retries: 0,
      // The proxy will only TRUST a sanitized response if a caller-supplied
      // validator confirms the cleaned content still looks well-formed.
      validateSanitizedResponse: (resp) => Boolean(resp.markdown && resp.markdown.length > 0),
    });
    assert.equal(result.markdown, 'Real card content here');
  });

  test.it('rejects MCP-tainted responses when no validator is supplied', async (t) => {
    const m = mockFetch(() => jsonResponse(200, {
      markdown: 'MCP issues detected. Run /mcp list for status. content',
    }));
    t.after(() => m.restore());
    await assert.rejects(
      runGeminiProxy('p', { ...baseOptions, retries: 0 }),
      /MCP diagnostic detected/i
    );
  });
});
