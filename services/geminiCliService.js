const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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

    const proc = spawn(bin, args, {
      shell: false,
      env: { ...process.env, NO_COLOR: '1' }
    });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('Gemini CLI timeout'));
    }, timeoutMs);

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(stderr || `Gemini CLI exit code ${code}`));
      }

      const cleaned = stripFence(stdout);

      if (outputDir) {
        ensureDir(outputDir);
        const safeBase = baseName.replace(/[\\/:*?"<>|]/g, '_');
        const filename = `${Date.now()}_${safeBase}_suggestion.txt`;
        fs.writeFileSync(path.join(outputDir, filename), cleaned, 'utf8');
      }

      resolve({ markdown: cleaned, rawOutput: cleaned, model: model || null });
    });
  });
}

module.exports = { runGeminiCli };
