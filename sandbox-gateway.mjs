import 'dotenv/config';
import http from 'node:http';
import express from 'express';
import sessionManagerModule from './services/sandbox/sandboxInstanceManager.js';
import tokenModule from './lib/sandboxSessionToken.js';
import uiPerformanceModule from './services/observability/uiPerformanceService.js';
import gatewayErrorModule from './services/sandbox/gatewayErrorPage.js';

const { SandboxCapacityError, SandboxInstanceManager } = sessionManagerModule;
const {
  createSessionToken,
  readCookie,
  serializeSessionCookie,
  verifySessionToken,
} = tokenModule;
const {
  recordUiPerformance,
  UiPerformanceValidationError,
} = uiPerformanceModule;
const {
  gatewayErrorDescriptor,
  renderGatewayErrorPage,
} = gatewayErrorModule;

const port = Number(process.env.PORT || process.env.PUBLIC_SANDBOX_GATEWAY_PORT || 3010);
const cookieSecret = String(process.env.PUBLIC_SANDBOX_COOKIE_SECRET || '');
const secureCookie = !/^(0|false|no|off)$/iu.test(
  String(process.env.PUBLIC_SANDBOX_COOKIE_SECURE ?? 'true')
);

if (cookieSecret.length < 32) {
  throw new Error('PUBLIC_SANDBOX_COOKIE_SECRET must contain at least 32 characters');
}

const manager = new SandboxInstanceManager({
  exclusiveRoot: true,
  cleanupOrphans: true,
});
const app = express();

function setSessionCookie(res, session) {
  const token = createSessionToken(session.id, cookieSecret);
  res.setHeader('Set-Cookie', serializeSessionCookie(token, {
    maxAgeSeconds: session.retentionSeconds,
    secure: secureCookie,
  }));
}

async function resolveSession(req, res) {
  const token = readCookie(req.headers.cookie);
  const sessionId = verifySessionToken(token, cookieSecret);
  let session = sessionId ? manager.getSession(sessionId) : null;
  if (!session) {
    session = await manager.createSession();
    setSessionCookie(res, session);
  }
  return manager.getInternalSession(session.id);
}

function sendGatewayError(req, res, error) {
  const descriptor = gatewayErrorDescriptor(error);
  res.set('Cache-Control', 'no-store');
  res.set('Retry-After', String(descriptor.retryAfterSeconds));
  if (req.path.startsWith('/api/')) {
    return res.status(descriptor.status).json({
      error: descriptor.description,
      code: descriptor.code,
      details: {
        recovery: descriptor.recovery,
        retryAfterSeconds: descriptor.retryAfterSeconds,
      },
    });
  }
  return res.status(descriptor.status).type('html').send(renderGatewayErrorPage(error, {
    feedbackUrl: process.env.PUBLIC_FEEDBACK_URL,
  }));
}

function proxyRequest(req, res, session) {
  return new Promise((resolve) => {
    const headers = { ...req.headers };
    delete headers.cookie;
    headers.host = `127.0.0.1:${session.port}`;
    headers['x-forwarded-host'] = req.headers.host || '';
    headers['x-forwarded-proto'] = req.secure ? 'https' : 'http';
    headers['x-sandbox-gateway'] = '1';

    const proxy = http.request({
      hostname: '127.0.0.1',
      port: session.port,
      method: req.method,
      path: req.originalUrl,
      headers,
    }, (upstream) => {
      const responseHeaders = { ...upstream.headers };
      delete responseHeaders['set-cookie'];
      res.writeHead(upstream.statusCode || 502, responseHeaders);
      upstream.pipe(res);
      upstream.once('end', resolve);
    });
    proxy.once('error', (error) => {
      if (!res.headersSent) {
        error.status = 502;
        error.code = 'SANDBOX_UPSTREAM_UNAVAILABLE';
        sendGatewayError(req, res, error);
      } else {
        res.end();
      }
      resolve(error);
    });
    req.once('aborted', () => proxy.destroy());
    req.pipe(proxy);
  });
}

app.get('/__gateway/health', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    status: 'ok',
    activeSandboxes: manager.listSessions().length,
    capacity: manager.maxSessions,
  });
});

app.post('/api/ui-performance', express.json({ limit: '16kb' }), (req, res) => {
  const sessionId = verifySessionToken(readCookie(req.headers.cookie), cookieSecret);
  if (!sessionId || !manager.getSession(sessionId)) return res.status(204).end();
  try {
    const accepted = recordUiPerformance(req.body, {
      workspaceMode: 'sandbox',
      deploymentExposure: 'public',
    });
    res.set('Cache-Control', 'no-store');
    return res.status(202).json({ success: true, accepted: accepted.metrics.length });
  } catch (error) {
    if (error instanceof UiPerformanceValidationError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    return res.status(500).json({
      error: '性能数据暂时无法接收。',
      code: 'UI_PERFORMANCE_INGEST_FAILED',
    });
  }
});

app.all('*', async (req, res) => {
  try {
    const currentToken = readCookie(req.headers.cookie);
    const currentId = verifySessionToken(currentToken, cookieSecret);

    if (req.path === '/api/sandbox/reset') {
      if (req.method !== 'POST' || req.get('X-Sandbox-Action') !== 'reset') {
        return res.status(400).json({
          error: '重置请求无效。',
          code: 'SANDBOX_RESET_INVALID',
        });
      }
      if (!currentId || !manager.getSession(currentId)) {
        const session = await manager.createSession();
        setSessionCookie(res, session);
        return res.json({ success: true, reset: false, reload: '/' });
      }
      const replacement = await manager.resetSession(currentId);
      setSessionCookie(res, replacement);
      return res.json({ success: true, reset: true, reload: '/' });
    }

    const session = await resolveSession(req, res);
    if (req.path === '/api/sandbox/session' && req.method === 'GET') {
      return res.json({ success: true, session: manager.publicSession(session) });
    }
    return proxyRequest(req, res, session);
  } catch (error) {
    if (!(error instanceof SandboxCapacityError)) {
      process.stderr.write(`[sandbox-gateway] ${error?.stack || error}\n`);
    }
    return sendGatewayError(req, res, error);
  }
});

const server = app.listen(port, () => {
  process.stdout.write(JSON.stringify({
    level: 'info',
    module: 'sandbox-gateway',
    message: 'public sandbox gateway listening',
    port,
    maxSessions: manager.maxSessions,
  }) + '\n');
});

const cleanupTimer = setInterval(() => {
  void manager.cleanupExpired();
}, 30_000);
cleanupTimer.unref();

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(cleanupTimer);
  await new Promise((resolve) => server.close(resolve));
  await manager.close();
  process.stdout.write(JSON.stringify({
    level: 'info',
    module: 'sandbox-gateway',
    message: 'public sandbox gateway stopped',
    signal,
  }) + '\n');
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

export { app, manager, server };
