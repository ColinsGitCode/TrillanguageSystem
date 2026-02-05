const fs = require('fs');
const { spawn } = require('child_process');

const AUTH_URL_RE = /https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?[^\s]+/;
const SETTINGS_PATH = process.env.GEMINI_SETTINGS_PATH || '/root/.gemini/settings.json';
const GEMINI_BIN = process.env.GEMINI_CLI_BIN || 'gemini';
const AUTH_TIMEOUT_MS = Number(process.env.GEMINI_AUTH_TIMEOUT_MS || 180000);

let session = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAuthenticated() {
  return fs.existsSync(SETTINGS_PATH);
}

function getStatus() {
  return {
    authenticated: isAuthenticated(),
    pending: !!session,
    url: session ? session.url : null,
    message: session ? session.message || null : null
  };
}

function cleanupSession() {
  if (session && session.proc && !session.proc.killed) {
    session.proc.kill('SIGKILL');
  }
  session = null;
}

function createSession() {
  const proc = spawn(GEMINI_BIN, ['--screen-reader'], {
    shell: false,
    env: {
      ...process.env,
      GOOGLE_GENAI_USE_GCA: 'true',
      NO_COLOR: '1',
      TERM: 'xterm'
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const state = {
    proc,
    url: null,
    buffer: '',
    lastError: null,
    closed: false,
    message: null,
    resolveReady: null,
    rejectReady: null
  };

  state.ready = new Promise((resolve, reject) => {
    state.resolveReady = resolve;
    state.rejectReady = reject;
  });

  const handleOutput = (chunk) => {
    const text = chunk.toString();
    state.buffer = (state.buffer + text).slice(-12000);
    const match = state.buffer.match(AUTH_URL_RE);
    if (match) {
      state.url = match[0];
      state.message = 'waiting_for_code';
      if (state.resolveReady) {
        state.resolveReady({ authenticated: false, pending: true, url: state.url });
        state.resolveReady = null;
      }
    }
    if (text.includes('Failed to authenticate')) {
      state.lastError = 'invalid_grant';
      state.message = 'invalid_grant';
    }
  };

  proc.stdout.on('data', handleOutput);
  proc.stderr.on('data', handleOutput);

  proc.on('close', (code) => {
    state.closed = true;
    if (!isAuthenticated() && state.rejectReady) {
      state.rejectReady(new Error(`Gemini auth exited with code ${code}`));
      state.rejectReady = null;
    }
  });

  return state;
}

async function startAuth() {
  if (isAuthenticated()) {
    return { authenticated: true, pending: false, url: null };
  }
  if (session && session.url) {
    return { authenticated: false, pending: true, url: session.url };
  }
  if (!session) {
    session = createSession();
  }
  return session.ready;
}

async function submitCode(code) {
  if (!session) {
    throw new Error('Auth session not started');
  }
  const currentUrl = session.url;
  session.lastError = null;
  session.message = 'submitting_code';

  session.proc.stdin.write(`${code}\n`);

  const startedAt = Date.now();
  while (Date.now() - startedAt < AUTH_TIMEOUT_MS) {
    if (isAuthenticated()) {
      session.message = 'authenticated';
      cleanupSession();
      return { status: 'success' };
    }
    if (session.lastError && session.url && session.url !== currentUrl) {
      return { status: 'retry', url: session.url, message: 'invalid_grant' };
    }
    if (session.closed) {
      break;
    }
    await sleep(500);
  }

  if (session && session.closed && !isAuthenticated()) {
    cleanupSession();
    return { status: 'failed', message: 'auth_process_closed' };
  }

  return { status: 'pending', url: session.url };
}

function cancelAuth() {
  cleanupSession();
  return { cancelled: true };
}

module.exports = {
  getStatus,
  startAuth,
  submitCode,
  cancelAuth
};
