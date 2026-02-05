const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.GEMINI_PROXY_PORT || 3210);
const GEMINI_BIN = process.env.GEMINI_PROXY_BIN || 'gemini';
const TIMEOUT_MS = Number(process.env.GEMINI_PROXY_TIMEOUT_MS || 90000);
const OUTPUT_DIR = process.env.GEMINI_PROXY_OUTPUT_DIR || '';

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

function runGemini(prompt, baseName = 'suggestion') {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn(GEMINI_BIN, ['-p', prompt], {
      shell: false,
      env: { ...process.env, NO_COLOR: '1' }
    });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('Gemini CLI timeout'));
    }, TIMEOUT_MS);

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(stderr || `Gemini CLI exit code ${code}`));
      }
      const cleaned = stripFence(stdout);
      if (OUTPUT_DIR) {
        ensureDir(OUTPUT_DIR);
        const safeBase = String(baseName || 'suggestion').replace(/[\\/:*?"<>|]/g, '_');
        const filename = `${Date.now()}_${safeBase}_suggestion.txt`;
        fs.writeFileSync(path.join(OUTPUT_DIR, filename), cleaned, 'utf8');
      }
      resolve({ markdown: cleaned, rawOutput: cleaned });
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
    return sendJson(res, 200, { status: 'ok' });
  }

  if (req.method === 'POST' && req.url === '/api/gemini') {
    try {
      const body = await collectBody(req);
      const data = body ? JSON.parse(body) : {};
      const prompt = data.prompt;
      if (!prompt) {
        return sendJson(res, 400, { error: 'Missing prompt' });
      }
      const result = await runGemini(prompt, data.baseName);
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
