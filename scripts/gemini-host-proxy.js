const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.GEMINI_PROXY_PORT || 3210);
const GEMINI_BIN = process.env.GEMINI_PROXY_BIN || 'gemini';
const TIMEOUT_MS = Number(process.env.GEMINI_PROXY_TIMEOUT_MS || 90000);
const OUTPUT_DIR = process.env.GEMINI_PROXY_OUTPUT_DIR || '';
const DEFAULT_MODEL = process.env.GEMINI_PROXY_MODEL || '';
const MODEL_ARG = process.env.GEMINI_PROXY_MODEL_ARG || '--model';
const PROMPT_ARG = process.env.GEMINI_PROXY_PROMPT_ARG || '-p';
const ACTIVE_PROCS = new Set();
const PROCESS_FORCE_KILL_MS = Number(process.env.GEMINI_PROXY_FORCE_KILL_MS || 1000);

function ensureDir(dir) {
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
}

function stripFence(text) {
  if (!text) return '';
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
  }
  return cleaned;
}

function resetRunningProcesses(reason = 'manual_reset') {
  let killed = 0;
  for (const proc of Array.from(ACTIVE_PROCS)) {
    if (!proc || proc.killed || proc.exitCode !== null) {
      ACTIVE_PROCS.delete(proc);
      continue;
    }
    try {
      if (proc.pid) {
        // Kill the whole process group first, then fallback to direct kill.
        process.kill(-proc.pid, 'SIGKILL');
      } else {
        proc.kill('SIGKILL');
      }
      killed += 1;
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
    const timeoutMs = Number(runtimeOptions.timeoutMs || TIMEOUT_MS);
    const selectedModel = String(modelOverride || DEFAULT_MODEL || '').trim();
    const args = [];
    if (selectedModel) {
      args.push(MODEL_ARG, selectedModel);
    }
    args.push(PROMPT_ARG, promptText);
    const proc = spawn(GEMINI_BIN, args, {
      shell: false,
      detached: process.platform !== 'win32',
      env: { ...process.env, NO_COLOR: '1' }
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

    const timer = setTimeout(() => {
      try {
        if (proc.pid && process.platform !== 'win32') {
          process.kill(-proc.pid, 'SIGKILL');
        } else {
          proc.kill('SIGKILL');
        }
      } catch (err) {
        // ignore
      } finally {
        // Guard against stale entries when close/error callback does not arrive in time.
        setTimeout(() => cleanup(), PROCESS_FORCE_KILL_MS);
      }
      const modelLabel = selectedModel || 'default';
      finish(false, new Error(`Gemini CLI timeout (${timeoutMs}ms, model=${modelLabel}, promptChars=${promptText.length})`));
    }, timeoutMs);

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => {
      clearTimeout(timer);
      cleanup();
      finish(false, err);
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      cleanup();
      if (code !== 0) {
        return finish(false, new Error(stderr || `Gemini CLI exit code ${code}`));
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
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return sendJson(res, 200, {
      status: 'ok',
      timeoutMs: TIMEOUT_MS,
      defaultModel: DEFAULT_MODEL || null,
      activeProcesses: ACTIVE_PROCS.size
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
    try {
      const body = await collectBody(req);
      const data = body ? JSON.parse(body) : {};
      const prompt = data.prompt;
      if (!prompt) {
        return sendJson(res, 400, { error: 'Missing prompt' });
      }
      const result = await runGemini(prompt, data.baseName, data.model, {
        timeoutMs: data.timeoutMs
      });
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`[gemini-proxy] listening on http://localhost:${PORT}`);
});

process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
