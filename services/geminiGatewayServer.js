const http = require('http');

const PORT = Number(process.env.GEMINI_GATEWAY_PORT || 18888);
const EXECUTOR_BASE_URL = String(process.env.GEMINI_EXECUTOR_BASE_URL || 'http://host.docker.internal:3210').replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = Number(process.env.GEMINI_GATEWAY_TIMEOUT_MS || 130000);

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
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

async function forwardJson(pathname, payload, method = 'POST') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
      const result = await forwardJson('/api/gemini', payload, 'POST');
      return sendJson(res, result.status, result.json);
    }

    return sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    return sendJson(res, 500, { error: err.message || 'gateway error' });
  }
});

server.listen(PORT, () => {
  console.log(`[project-gemini-gateway] listening on http://0.0.0.0:${PORT}`);
  console.log(`[project-gemini-gateway] forwarding to ${EXECUTOR_BASE_URL}`);
});

process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
