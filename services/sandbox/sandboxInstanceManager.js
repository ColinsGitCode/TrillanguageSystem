'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

function numberOption(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function isInside(rootPath, candidatePath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function waitForExit(child, timeoutMs = 5_000) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) return resolve({ stdout, stderr });
      const error = new Error(`Sandbox preparation exited with code ${code}`);
      error.code = 'SANDBOX_PREPARATION_FAILED';
      error.details = { stderr: stderr.slice(-2_000) };
      return reject(error);
    });
  });
}

function probeRuntime(port, timeoutMs = 1_000) {
  return new Promise((resolve, reject) => {
    const request = http.get({
      hostname: '127.0.0.1',
      port,
      path: '/api/runtime',
      timeout: timeoutMs,
      headers: { Accept: 'application/json' },
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          return reject(new Error(`Sandbox runtime returned ${response.statusCode}`));
        }
        try {
          return resolve(JSON.parse(body));
        } catch (error) {
          return reject(error);
        }
      });
    });
    request.once('timeout', () => request.destroy(new Error('Sandbox runtime probe timed out')));
    request.once('error', reject);
  });
}

class SandboxCapacityError extends Error {
  constructor(message = 'Public sandbox capacity is currently full') {
    super(message);
    this.name = 'SandboxCapacityError';
    this.code = 'SANDBOX_CAPACITY_FULL';
    this.status = 503;
  }
}

class SandboxInstanceManager {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.SANDBOX_STORAGE_ROOT || './data/public-sandboxes');
    this.appRoot = path.resolve(options.appRoot || path.join(__dirname, '../..'));
    this.retentionMs = numberOption(
      options.retentionMs ?? Number(process.env.PUBLIC_SANDBOX_RETENTION_MINUTES) * 60_000,
      60 * 60_000,
      { min: 60_000, max: 7 * 24 * 60 * 60_000 }
    );
    this.maxSessions = numberOption(
      options.maxSessions ?? process.env.PUBLIC_SANDBOX_MAX_SESSIONS,
      8,
      { min: 1, max: 100 }
    );
    this.portStart = numberOption(options.portStart ?? process.env.PUBLIC_SANDBOX_PORT_START, 4_100, {
      min: 1_024,
      max: 65_000,
    });
    this.portEnd = numberOption(options.portEnd ?? process.env.PUBLIC_SANDBOX_PORT_END, 4_199, {
      min: this.portStart,
      max: 65_535,
    });
    this.startupTimeoutMs = numberOption(options.startupTimeoutMs, 30_000, {
      min: 1_000,
      max: 120_000,
    });
    this.now = options.now || (() => Date.now());
    this.randomBytes = options.randomBytes || crypto.randomBytes;
    this.spawnProcess = options.spawnProcess || spawn;
    this.prepareInstance = options.prepareInstance || ((env) => runProcess(
      process.execPath,
      [path.join(this.appRoot, 'scripts/sandbox/createPublicSandboxSeed.js')],
      { cwd: this.appRoot, env }
    ));
    this.probe = options.probe || probeRuntime;
    this.sessions = new Map();
    this.allocatedPorts = new Set();
    fs.mkdirSync(this.rootDir, { recursive: true });
    this.lockPath = path.join(this.rootDir, '.sandbox-gateway.lock');
    this.exclusiveRoot = options.exclusiveRoot === true;
    if (this.exclusiveRoot) {
      this.acquireRootLock();
      if (options.cleanupOrphans !== false) this.cleanupOrphanedStorage();
    }
  }

  acquireRootLock() {
    const writeLock = () => {
      const descriptor = fs.openSync(this.lockPath, 'wx', 0o600);
      fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, createdAtUtc: new Date().toISOString() }));
      fs.closeSync(descriptor);
    };
    try {
      writeLock();
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    let activePid = null;
    try {
      activePid = Number(JSON.parse(fs.readFileSync(this.lockPath, 'utf8')).pid);
      if (Number.isInteger(activePid) && activePid > 0) process.kill(activePid, 0);
    } catch (error) {
      if (error.code !== 'ESRCH') {
        if (Number.isInteger(activePid) && activePid > 0) {
          const locked = new Error('Another public sandbox gateway owns this storage root');
          locked.code = 'SANDBOX_GATEWAY_STORAGE_LOCKED';
          throw locked;
        }
      }
      fs.rmSync(this.lockPath, { force: true });
      writeLock();
      return;
    }
    const locked = new Error('Another public sandbox gateway owns this storage root');
    locked.code = 'SANDBOX_GATEWAY_STORAGE_LOCKED';
    throw locked;
  }

  cleanupOrphanedStorage() {
    const entries = fs.readdirSync(this.rootDir, { withFileTypes: true });
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^sbx_[a-f0-9]{32}$/u.test(entry.name)) continue;
      fs.rmSync(path.join(this.rootDir, entry.name), { recursive: true, force: true });
      removed += 1;
    }
    return removed;
  }

  sessionPaths(id) {
    const instanceRoot = path.resolve(this.rootDir, id);
    if (!isInside(this.rootDir, instanceRoot) || instanceRoot === this.rootDir) {
      throw new Error('Invalid sandbox instance root');
    }
    return {
      instanceRoot,
      dbPath: path.join(instanceRoot, 'database', 'records.db'),
      recordsPath: path.join(instanceRoot, 'records'),
      textbookSourceRoot: path.join(instanceRoot, 'textbook-source'),
      textbookWorkPath: path.join(instanceRoot, 'textbook-work'),
      selectionTtsCachePath: path.join(instanceRoot, 'selection-tts'),
    };
  }

  allocatePort() {
    for (let port = this.portStart; port <= this.portEnd; port += 1) {
      if (!this.allocatedPorts.has(port)) {
        this.allocatedPorts.add(port);
        return port;
      }
    }
    throw new SandboxCapacityError('No sandbox process port is available');
  }

  releasePort(port) {
    this.allocatedPorts.delete(Number(port));
  }

  createEnvironment(session) {
    const env = {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(session.port),
      WORKSPACE_MODE: 'sandbox',
      DEPLOYMENT_EXPOSURE: 'public',
      SANDBOX_INSTANCE_ID: session.id,
      SANDBOX_STORAGE_ROOT: this.rootDir,
      SANDBOX_WRITE_ENABLED: String(process.env.PUBLIC_SANDBOX_WRITE_ENABLED || 'true'),
      SANDBOX_HIGH_COST_ENABLED: String(process.env.PUBLIC_SANDBOX_HIGH_COST_ENABLED || 'false'),
      SANDBOX_RETENTION_HOURS: String(Math.max(1, Math.ceil(this.retentionMs / 3_600_000))),
      SANDBOX_EXPIRES_AT_UTC: session.expiresAtUtc,
      SANDBOX_RESET_SUPPORTED: 'true',
      DB_PATH: session.paths.dbPath,
      RECORDS_PATH: session.paths.recordsPath,
      TEXTBOOK_SOURCE_ROOT: session.paths.textbookSourceRoot,
      TEXTBOOK_WORK_PATH: session.paths.textbookWorkPath,
      SELECTION_TTS_CACHE_PATH: session.paths.selectionTtsCachePath,
      LEARNING_TIMEZONE: process.env.LEARNING_TIMEZONE || 'Asia/Tokyo',
      RECORDS_TIMEZONE: process.env.RECORDS_TIMEZONE || 'Asia/Tokyo',
      KG_ENABLED: process.env.PUBLIC_SANDBOX_KG_ENABLED || '0',
      KG_PLANNING_ENABLED: '0',
      KG_LLM_ENRICHMENT_ENABLED: '0',
      KG_INCREMENTAL_SYNC_ENABLED: '0',
      SANDBOX_QUOTA_GENERATIONS: process.env.PUBLIC_SANDBOX_QUOTA_GENERATIONS || '2',
      SANDBOX_QUOTA_OCR: process.env.PUBLIC_SANDBOX_QUOTA_OCR || '5',
      SANDBOX_QUOTA_TTS: process.env.PUBLIC_SANDBOX_QUOTA_TTS || '20',
      SANDBOX_QUOTA_STORAGE_BYTES: process.env.PUBLIC_SANDBOX_QUOTA_STORAGE_BYTES || '67108864',
      UI_PERFORMANCE_ENABLED: process.env.PUBLIC_SANDBOX_UI_PERFORMANCE_ENABLED || '1',
      UI_PERFORMANCE_SAMPLE_RATE: process.env.PUBLIC_SANDBOX_UI_PERFORMANCE_SAMPLE_RATE || '0.1',
    };
    return env;
  }

  async waitUntilReady(session) {
    const deadline = this.now() + this.startupTimeoutMs;
    let lastError;
    while (this.now() < deadline) {
      if (session.process.exitCode !== null) {
        throw new Error(`Sandbox process exited with code ${session.process.exitCode}`);
      }
      try {
        const runtime = await this.probe(session.port);
        if (
          runtime?.workspace?.mode === 'sandbox'
          && runtime.workspace.workspaceId === session.id
        ) return runtime;
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw lastError || new Error('Sandbox process did not become ready');
  }

  async createSession() {
    await this.cleanupExpired();
    if (this.sessions.size >= this.maxSessions) throw new SandboxCapacityError();

    const id = `sbx_${this.randomBytes(16).toString('hex')}`;
    const port = this.allocatePort();
    const createdAtMs = this.now();
    const session = {
      id,
      port,
      createdAtMs,
      createdAtUtc: new Date(createdAtMs).toISOString(),
      expiresAtMs: createdAtMs + this.retentionMs,
      expiresAtUtc: new Date(createdAtMs + this.retentionMs).toISOString(),
      lastAccessAtMs: createdAtMs,
      paths: this.sessionPaths(id),
      process: null,
      state: 'preparing',
    };
    const env = this.createEnvironment(session);
    this.sessions.set(id, session);

    try {
      Object.values(session.paths).forEach((target) => {
        const directory = path.extname(target) ? path.dirname(target) : target;
        fs.mkdirSync(directory, { recursive: true });
      });
      await this.prepareInstance(env, session);
      session.process = this.spawnProcess(process.execPath, [path.join(this.appRoot, 'server.mjs')], {
        cwd: this.appRoot,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      session.process.stdout?.on('data', (chunk) => {
        if (process.env.LOG_LEVEL === 'debug') process.stdout.write(`[${id}] ${chunk}`);
      });
      session.process.stderr?.on('data', (chunk) => process.stderr.write(`[${id}] ${chunk}`));
      session.process.once('exit', () => {
        if (session.state === 'ready') session.state = 'stopped';
      });
      await this.waitUntilReady(session);
      session.state = 'ready';
      return this.publicSession(session);
    } catch (error) {
      this.sessions.delete(id);
      if (session.process && session.process.exitCode === null) session.process.kill('SIGTERM');
      this.releasePort(port);
      fs.rmSync(session.paths.instanceRoot, { recursive: true, force: true });
      throw error;
    }
  }

  publicSession(session) {
    return {
      id: session.id,
      port: session.port,
      state: session.state,
      createdAtUtc: session.createdAtUtc,
      expiresAtUtc: session.expiresAtUtc,
      retentionSeconds: Math.max(0, Math.ceil((session.expiresAtMs - this.now()) / 1_000)),
    };
  }

  getSession(id) {
    const session = this.sessions.get(String(id || ''));
    if (!session) return null;
    if (session.expiresAtMs <= this.now() || session.state !== 'ready') return null;
    session.lastAccessAtMs = this.now();
    return this.publicSession(session);
  }

  getInternalSession(id) {
    const session = this.sessions.get(String(id || ''));
    if (!session || session.expiresAtMs <= this.now() || session.state !== 'ready') return null;
    session.lastAccessAtMs = this.now();
    return session;
  }

  async destroySession(id, reason = 'expired') {
    const session = this.sessions.get(String(id || ''));
    if (!session) return false;
    this.sessions.delete(session.id);
    session.state = 'stopping';
    if (session.process && session.process.exitCode === null) {
      session.process.kill('SIGTERM');
      await waitForExit(session.process, 5_000);
      if (session.process.exitCode === null) session.process.kill('SIGKILL');
    }
    session.state = reason;
    this.releasePort(session.port);
    fs.rmSync(session.paths.instanceRoot, { recursive: true, force: true });
    return true;
  }

  async resetSession(id) {
    await this.destroySession(id, 'reset');
    return this.createSession();
  }

  async cleanupExpired() {
    const expired = [...this.sessions.values()]
      .filter((session) => session.expiresAtMs <= this.now() || session.state === 'stopped')
      .map((session) => session.id);
    await Promise.all(expired.map((id) => this.destroySession(id, 'expired')));
    return expired.length;
  }

  listSessions() {
    return [...this.sessions.values()].map((session) => this.publicSession(session));
  }

  async close() {
    await Promise.all([...this.sessions.keys()].map((id) => this.destroySession(id, 'shutdown')));
    if (this.exclusiveRoot) fs.rmSync(this.lockPath, { force: true });
  }
}

module.exports = {
  SandboxCapacityError,
  SandboxInstanceManager,
  isInside,
  numberOption,
  probeRuntime,
};
