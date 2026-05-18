const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { stripFence, signalProcessTree } = require('./geminiProcessUtils');
const { CODES, codedError } = require('./geminiErrors');

const FORCE_KILL_MS = Number(process.env.GEMINI_CLI_FORCE_KILL_MS || 1000);

function ensureDir(dir) {
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
}

// In-process gemini CLI transport (GEMINI_MODE=cli, or knowledge synonym
// transport=cli). Shares its spawn/cleanup primitives with the host executor
// via geminiProcessUtils so the two cannot drift apart.
function runGeminiCli(prompt, options = {}) {
  const {
    bin = process.env.GEMINI_CLI_BIN || 'gemini',
    model = options.model || process.env.GEMINI_CLI_MODEL || '',
    modelArg = process.env.GEMINI_CLI_MODEL_ARG || '--model',
    promptArg = process.env.GEMINI_CLI_PROMPT_ARG || '-p',
    extraArgs = [],
    timeoutMs = Number(process.env.GEMINI_CLI_TIMEOUT_MS || 90000),
    outputDir = process.env.GEMINI_CLI_OUTPUT_DIR || '',
    baseName = 'suggestion'
  } = options;

  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = '';
    let stderr = '';

    const args = [];
    if (model) {
      args.push(modelArg, model);
    }
    if (Array.isArray(extraArgs) && extraArgs.length) {
      args.push(...extraArgs.map((item) => String(item)));
    }
    args.push(promptArg, prompt);

    // `detached` lets signalProcessTree kill the whole CLI subtree on timeout.
    const proc = spawn(bin, args, {
      shell: false,
      detached: process.platform !== 'win32',
      env: { ...process.env, NO_COLOR: '1' }
    });

    const finish = (ok, value) => {
      if (settled) return;
      settled = true;
      if (ok) resolve(value);
      else reject(value);
    };

    const timer = setTimeout(() => {
      try {
        signalProcessTree(proc, 'SIGTERM');
        setTimeout(() => signalProcessTree(proc, 'SIGKILL'), FORCE_KILL_MS).unref();
      } catch (_) {
        // ignore
      }
      finish(false, codedError(CODES.EXECUTOR_TIMEOUT, `Gemini CLI timeout (${timeoutMs}ms)`));
    }, timeoutMs);

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('error', (err) => {
      clearTimeout(timer);
      finish(false, codedError(CODES.EXECUTOR_SPAWN_ERROR, err.message || 'gemini spawn failed'));
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const detail = stderr.trim() || `Gemini CLI exit code ${code}`;
        const rateLimited = /rate limit|RESOURCE_EXHAUSTED|capacity|quota/i.test(detail);
        return finish(false, codedError(
          rateLimited ? CODES.RATE_LIMITED : CODES.EXECUTOR_CLI_ERROR,
          detail
        ));
      }

      const cleaned = stripFence(stdout);

      if (outputDir) {
        ensureDir(outputDir);
        const safeBase = String(baseName || 'suggestion').replace(/[\\/:*?"<>|]/g, '_');
        const filename = `${Date.now()}_${safeBase}_suggestion.txt`;
        fs.writeFileSync(path.join(outputDir, filename), cleaned, 'utf8');
      }

      finish(true, { markdown: cleaned, rawOutput: cleaned, model: model || null });
    });
  });
}

module.exports = { runGeminiCli };
