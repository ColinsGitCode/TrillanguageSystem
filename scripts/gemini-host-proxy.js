const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MAX_EXECUTION_BUDGET_MS } = require('../services/geminiTimeouts');
const { stripFence, signalProcessTree } = require('../services/geminiProcessUtils');
const { CODES, statusForCode, codedError } = require('../services/geminiErrors');

const PORT = Number(process.env.GEMINI_PROXY_PORT || 13210);
const GEMINI_BIN_CANDIDATES = [
  process.env.GEMINI_PROXY_BIN || '',
  'gemini',
  '/opt/homebrew/bin/gemini',
  '/usr/local/bin/gemini'
].filter(Boolean);
// Hard ceiling on any single CLI run. Per-request budgets can be shorter but
// never longer than this — see services/geminiTimeouts.js.
const TIMEOUT_MS = MAX_EXECUTION_BUDGET_MS;
const OUTPUT_DIR = process.env.GEMINI_PROXY_OUTPUT_DIR || '';
const DEFAULT_MODEL = process.env.GEMINI_PROXY_MODEL || '';
const MODEL_ARG = process.env.GEMINI_PROXY_MODEL_ARG || '--model';
const PROMPT_ARG = process.env.GEMINI_PROXY_PROMPT_ARG || '-p';
const ACTIVE_PROCS = new Set();
const PROCESS_FORCE_KILL_MS = Number(process.env.GEMINI_PROXY_FORCE_KILL_MS || 1000);
// Backpressure: the host runs a single gemini CLI install. Cap how many run
// at once so concurrent callers (interactive + job queues) can't thrash it.
const MAX_CONCURRENT = Math.max(1, Number(process.env.GEMINI_MAX_CONCURRENT || 2));
// How long a request waits for a free slot before giving up with 429.
const QUEUE_WAIT_MS = Math.max(0, Number(process.env.GEMINI_QUEUE_WAIT_MS || 30000));
let inflight = 0;
const slotWaiters = [];

// Acquire a concurrency slot, waiting up to QUEUE_WAIT_MS. Resolves false if
// no slot frees up in time — the caller should then return EXECUTOR_BUSY.
function acquireSlot() {
  if (inflight < MAX_CONCURRENT) {
    inflight += 1;
    return Promise.resolve(true);
  }
  if (QUEUE_WAIT_MS <= 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    const waiter = () => {
      clearTimeout(timer);
      inflight += 1;
      resolve(true);
    };
    const timer = setTimeout(() => {
      const idx = slotWaiters.indexOf(waiter);
      if (idx >= 0) slotWaiters.splice(idx, 1);
      resolve(false);
    }, QUEUE_WAIT_MS);
    slotWaiters.push(waiter);
  });
}

function releaseSlot() {
  inflight = Math.max(0, inflight - 1);
  const next = slotWaiters.shift();
  if (next) next();
}
const PROJECT_ROOT = path.join(__dirname, '..');
const USER_HOME = os.homedir();
const USER_GEMINI_DIR = path.join(USER_HOME, '.gemini');
const PROJECT_RUNTIME_ROOT = path.join(PROJECT_ROOT, '.runtime');
const PROJECT_GEMINI_DIR = path.join(PROJECT_RUNTIME_ROOT, '.gemini');

function fileExists(target) {
  try {
    return fs.existsSync(target);
  } catch (_) {
    return false;
  }
}

function dirHasAuthFiles(dir) {
  if (!dir) return false;
  return ['oauth_creds.json', 'settings.json'].every((name) => fileExists(path.join(dir, name)));
}

function resolveGeminiDir() {
  const explicitDir = String(process.env.GEMINI_PROXY_HOME || '').trim();
  if (explicitDir) {
    return {
      dir: explicitDir,
      source: 'explicit',
      authReady: dirHasAuthFiles(explicitDir)
    };
  }

  if (dirHasAuthFiles(PROJECT_GEMINI_DIR)) {
    return {
      dir: PROJECT_GEMINI_DIR,
      source: 'project-runtime',
      authReady: true
    };
  }

  return {
    dir: USER_GEMINI_DIR,
    source: 'host-home',
    authReady: dirHasAuthFiles(USER_GEMINI_DIR)
  };
}

const GEMINI_DIR_INFO = resolveGeminiDir();
const GEMINI_CONFIG_DIR = GEMINI_DIR_INFO.dir;
const GEMINI_HOME = path.dirname(GEMINI_CONFIG_DIR);
const PROJECT_GEMINI_SETTINGS = process.env.GEMINI_SETTINGS_PATH || path.join(GEMINI_CONFIG_DIR, 'settings.json');

function ensureDir(dir) {
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
}

function resolveExecutable(candidates = []) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate.includes(path.sep)) {
      if (fs.existsSync(candidate)) return candidate;
      continue;
    }
    const pathDirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
    for (const dir of pathDirs) {
      const fullPath = path.join(dir, candidate);
      if (fs.existsSync(fullPath)) return fullPath;
    }
  }
  return candidates[0] || '';
}

const GEMINI_BIN = resolveExecutable(GEMINI_BIN_CANDIDATES);

function buildGeminiEnv() {
  ensureDir(GEMINI_HOME);
  ensureDir(GEMINI_CONFIG_DIR);
  const env = {
    PATH: process.env.PATH || '',
    HOME: GEMINI_HOME,
    GEMINI_SETTINGS_PATH: PROJECT_GEMINI_SETTINGS,
    NO_COLOR: '1',
    TERM: process.env.TERM || 'xterm'
  };

  [
    'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
    'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
    'SSL_CERT_FILE', 'SSL_CERT_DIR',
    'LANG', 'LC_ALL'
  ].forEach((key) => {
    if (process.env[key]) env[key] = process.env[key];
  });

  return env;
}

function parsePositiveNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function resetRunningProcesses(reason = 'manual_reset') {
  let killed = 0;
  for (const proc of Array.from(ACTIVE_PROCS)) {
    if (!proc || proc.killed || proc.exitCode !== null) {
      ACTIVE_PROCS.delete(proc);
      continue;
    }
    try {
      killed += signalProcessTree(proc, 'SIGKILL');
    } catch (err) {
      try {
        proc.kill('SIGKILL');
        killed += 1;
      } catch (_) {
        // ignore
      }
    }
    ACTIVE_PROCS.delete(proc);
  }
  return { reason, killed, activeAfter: ACTIVE_PROCS.size };
}

function runGemini(prompt, baseName = 'suggestion', modelOverride = '', runtimeOptions = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    const promptText = String(prompt || '');
    const requestTimeoutMs = parsePositiveNumber(runtimeOptions.timeoutMs, TIMEOUT_MS);
    const requestedExecutionTimeoutMs = parsePositiveNumber(runtimeOptions.executionTimeoutMs, 0);
    // The executor's own ceiling always wins, regardless of what the caller asks.
    const timeoutMs = Math.min(
      requestedExecutionTimeoutMs > 0
        ? Math.min(requestedExecutionTimeoutMs, requestTimeoutMs)
        : requestTimeoutMs,
      TIMEOUT_MS
    );
    const selectedModel = String(modelOverride || DEFAULT_MODEL || '').trim();
    const args = [];
    if (selectedModel) {
      args.push(MODEL_ARG, selectedModel);
    }
    args.push(PROMPT_ARG, promptText);
    const proc = spawn(GEMINI_BIN, args, {
      shell: false,
      detached: process.platform !== 'win32',
      env: buildGeminiEnv()
    });
    ACTIVE_PROCS.add(proc);

    const finish = (ok, value) => {
      if (settled) return;
      settled = true;
      if (ok) resolve(value);
      else reject(value);
    };

    const cleanup = () => {
      ACTIVE_PROCS.delete(proc);
    };

    const terminate = (signal = 'SIGTERM') => signalProcessTree(proc, signal);

    const timer = setTimeout(() => {
      try {
        terminate('SIGTERM');
        setTimeout(() => terminate('SIGKILL'), PROCESS_FORCE_KILL_MS).unref();
      } catch (err) {
        // ignore
      } finally {
        // Guard against stale entries when close/error callback does not arrive in time.
        setTimeout(() => cleanup(), PROCESS_FORCE_KILL_MS);
      }
      const modelLabel = selectedModel || 'default';
      finish(false, codedError(
        CODES.EXECUTOR_TIMEOUT,
        `Gemini CLI timeout (${timeoutMs}ms, model=${modelLabel}, promptChars=${promptText.length})`
      ));
    }, timeoutMs);

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => {
      clearTimeout(timer);
      cleanup();
      finish(false, codedError(CODES.EXECUTOR_SPAWN_ERROR, err.message || 'gemini spawn failed'));
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      cleanup();
      if (code !== 0) {
        const detail = stderr.trim() || `Gemini CLI exit code ${code}`;
        // Rate limits surface as a non-zero exit; classify so callers back off.
        const rateLimited = /rate limit|RESOURCE_EXHAUSTED|capacity|quota/i.test(detail);
        return finish(false, codedError(
          rateLimited ? CODES.RATE_LIMITED : CODES.EXECUTOR_CLI_ERROR,
          detail
        ));
      }
      const cleaned = stripFence(stdout);
      if (OUTPUT_DIR) {
        ensureDir(OUTPUT_DIR);
        const safeBase = String(baseName || 'suggestion').replace(/[\\/:*?"<>|]/g, '_');
        const filename = `${Date.now()}_${safeBase}_suggestion.txt`;
        fs.writeFileSync(path.join(OUTPUT_DIR, filename), cleaned, 'utf8');
      }
      finish(true, { markdown: cleaned, rawOutput: cleaned, model: selectedModel || null });
    });
  });
}

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
      if (data.length > 2 * 1024 * 1024) {
        req.destroy();
        reject(codedError(CODES.EXECUTOR_BAD_REQUEST, 'Request body too large'));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Send a structured { error, code } body with the code's matching HTTP status.
function sendCodedError(res, err) {
  const code = (err && err.code) || CODES.EXECUTOR_ERROR;
  const status = (err && err.status) || statusForCode(code);
  sendJson(res, status, { error: (err && err.message) || 'executor error', code });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return sendJson(res, 200, {
      status: 'ok',
      timeoutMs: TIMEOUT_MS,
      geminiBin: GEMINI_BIN,
      defaultModel: DEFAULT_MODEL || null,
      activeProcesses: ACTIVE_PROCS.size,
      inflight,
      maxConcurrent: MAX_CONCURRENT,
      geminiHome: GEMINI_HOME,
      geminiConfigDir: GEMINI_CONFIG_DIR,
      settingsPath: PROJECT_GEMINI_SETTINGS,
      authReady: GEMINI_DIR_INFO.authReady,
      authSource: GEMINI_DIR_INFO.source
    });
  }

  if (req.method === 'POST' && req.url === '/admin/reset') {
    const result = resetRunningProcesses('admin_reset');
    return sendJson(res, 200, {
      status: 'ok',
      ...result
    });
  }

  if (req.method === 'POST' && req.url === '/api/gemini') {
    let acquired = false;
    try {
      const body = await collectBody(req);
      let data;
      try {
        data = body ? JSON.parse(body) : {};
      } catch (_) {
        throw codedError(CODES.EXECUTOR_BAD_REQUEST, 'Invalid JSON body');
      }
      const prompt = data.prompt;
      if (!prompt) {
        throw codedError(CODES.EXECUTOR_BAD_REQUEST, 'Missing prompt');
      }
      acquired = await acquireSlot();
      if (!acquired) {
        throw codedError(CODES.EXECUTOR_BUSY, `Executor busy (max ${MAX_CONCURRENT} concurrent, waited ${QUEUE_WAIT_MS}ms)`);
      }
      const result = await runGemini(prompt, data.baseName, data.model, {
        timeoutMs: data.timeoutMs,
        executionTimeoutMs: data.executionTimeoutMs
      });
      return sendJson(res, 200, result);
    } catch (err) {
      return sendCodedError(res, err);
    } finally {
      if (acquired) releaseSlot();
    }
  }

  sendJson(res, 404, { error: 'Not found', code: CODES.EXECUTOR_BAD_REQUEST });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[gemini-proxy] listening on http://0.0.0.0:${PORT}`);
});

process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
