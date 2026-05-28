const http = require('http');
const { gatewayTimeoutFor } = require('./geminiTimeouts');
const { CODES, statusForCode, codedError } = require('./geminiErrors');
const log = require('../../lib/logger').child({ module: 'gemini-gateway' });

const PORT = Number(process.env.GEMINI_GATEWAY_PORT || 18888);
const EXECUTOR_BASE_URL = String(process.env.GEMINI_EXECUTOR_BASE_URL || 'http://host.docker.internal:13210').replace(/\/$/, '');
// Admin calls (reset/health) are quick; only /api/gemini gets the long budget.
const ADMIN_TIMEOUT_MS = 8000;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

// Send a structured { error, code } body with the code's matching HTTP status.
function sendCodedError(res, err) {
  const code = (err && err.code) || CODES.GATEWAY_ERROR;
  const status = (err && err.status) || statusForCode(code);
  sendJson(res, status, { error: (err && err.message) || 'gateway error', code });
}

// Classify a failure talking to the executor into a structured gateway error.
function classifyForwardError(err) {
  if (err && err.code) return err;
  if (err && err.name === 'AbortError') {
    return codedError(CODES.GATEWAY_TIMEOUT, 'Gateway timed out waiting for executor');
  }
  const text = String((err && err.message) || err || '');
  if (/fetch failed|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ENOTFOUND/i.test(text)) {
    return codedError(CODES.GATEWAY_UPSTREAM_UNREACHABLE, `Executor unreachable: ${text}`);
  }
  return codedError(CODES.GATEWAY_ERROR, text || 'gateway error');
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk.toString();
      if (data.length > 4 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function forwardJson(pathname, payload, method = 'POST', timeoutMs = ADMIN_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${EXECUTOR_BASE_URL}${pathname}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(payload || {}),
      signal: controller.signal
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : {};
    return { status: response.status, ok: response.ok, json };
  } finally {
    clearTimeout(timer);
  }
}

async function forwardGet(pathname) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${EXECUTOR_BASE_URL}${pathname}`, {
      method: 'GET',
      signal: controller.signal
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : {};
    return { status: response.status, ok: response.ok, json };
  } finally {
    clearTimeout(timer);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      const upstream = await forwardGet('/health').catch((err) => ({
        ok: false,
        status: 503,
        json: { status: 'down', error: err.message }
      }));
      return sendJson(res, upstream.ok ? 200 : 503, {
        status: upstream.ok ? 'ok' : 'degraded',
        mode: 'project-internal-gateway',
        executorBaseUrl: EXECUTOR_BASE_URL,
        executor: upstream.json || null
      });
    }

    if (req.method === 'POST' && req.url === '/admin/reset') {
      const result = await forwardJson('/admin/reset', {}, 'POST');
      return sendJson(res, result.status, result.json);
    }

    if (req.method === 'POST' && req.url === '/api/gemini') {
      const body = await collectBody(req);
      const payload = body ? JSON.parse(body) : {};
      // Wait one hop longer than the executor's budget so its clean timeout
      // error propagates instead of the gateway aborting first.
      const timeoutMs = gatewayTimeoutFor(payload.executionTimeoutMs || payload.timeoutMs);
      try {
        const result = await forwardJson('/api/gemini', payload, 'POST', timeoutMs);
        return sendJson(res, result.status, result.json);
      } catch (err) {
        return sendCodedError(res, classifyForwardError(err));
      }
    }

    return sendJson(res, 404, { error: 'Not found', code: CODES.GATEWAY_ERROR });
  } catch (err) {
    return sendCodedError(res, classifyForwardError(err));
  }
});

server.listen(PORT, () => {
  log.info({ port: PORT, executorBaseUrl: EXECUTOR_BASE_URL }, 'gateway listening');
});

process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
