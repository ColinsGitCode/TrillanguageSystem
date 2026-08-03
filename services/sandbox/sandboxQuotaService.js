'use strict';

const fs = require('node:fs');
const path = require('node:path');

const QUOTA_ROUTES = [
  { category: 'generation', method: 'POST', pattern: /^\/api\/generate$/u },
  { category: 'generation', method: 'POST', pattern: /^\/api\/generation-jobs$/u },
  { category: 'generation', method: 'POST', pattern: /^\/api\/generation-jobs\/\d+\/retry$/u },
  { category: 'generation', method: 'POST', pattern: /^\/api\/textbooks\/expressions\/\d+\/derivations$/u },
  { category: 'ocr', method: 'POST', pattern: /^\/api\/ocr$/u },
  { category: 'tts', method: 'POST', pattern: /^\/api\/tts\/selection$/u },
  { category: 'tts', method: 'POST', pattern: /^\/api\/textbooks\/tracks\/\d+\/tts$/u },
  { category: 'tts', method: 'POST', pattern: /^\/api\/textbooks\/operations\/\d+\/retry$/u },
];

function nonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
}

function classifyQuotaRequest(method, requestPath) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  return QUOTA_ROUTES.find((route) => (
    route.method === normalizedMethod && route.pattern.test(String(requestPath || ''))
  ))?.category || null;
}

function directorySize(rootPath) {
  if (!rootPath || !fs.existsSync(rootPath)) return 0;
  let total = 0;
  const stack = [rootPath];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const candidate = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(candidate);
      } else if (entry.isFile()) {
        try { total += fs.statSync(candidate).size; } catch {}
      }
    }
  }
  return total;
}

class SandboxQuotaService {
  constructor(policy, options = {}) {
    this.policy = policy;
    this.enabled = policy?.mode === 'sandbox';
    this.statePath = this.enabled
      ? path.join(policy.instanceRoot, 'sandbox-quota.json')
      : null;
    this.limits = {
      generation: nonNegativeInteger(options.generation ?? process.env.SANDBOX_QUOTA_GENERATIONS, 2),
      ocr: nonNegativeInteger(options.ocr ?? process.env.SANDBOX_QUOTA_OCR, 5),
      tts: nonNegativeInteger(options.tts ?? process.env.SANDBOX_QUOTA_TTS, 20),
      storageBytes: nonNegativeInteger(
        options.storageBytes ?? process.env.SANDBOX_QUOTA_STORAGE_BYTES,
        64 * 1024 * 1024
      ),
    };
    this.expiresAtUtc = policy?.expiresAtUtc || null;
    this.state = {
      version: 1,
      used: { generation: 0, ocr: 0, tts: 0 },
      updatedAtUtc: new Date().toISOString(),
    };
    if (this.enabled) this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      if (parsed?.version === 1 && parsed.used) {
        this.state.used = {
          generation: nonNegativeInteger(parsed.used.generation, 0),
          ocr: nonNegativeInteger(parsed.used.ocr, 0),
          tts: nonNegativeInteger(parsed.used.tts, 0),
        };
        this.state.updatedAtUtc = String(parsed.updatedAtUtc || this.state.updatedAtUtc);
      }
    } catch {}
  }

  persist() {
    if (!this.enabled) return;
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    const temporary = `${this.statePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.state), { mode: 0o600 });
    fs.renameSync(temporary, this.statePath);
  }

  categorySnapshot(category) {
    const used = this.state.used[category] || 0;
    const limit = this.limits[category];
    return {
      used,
      limit,
      remaining: Math.max(0, limit - used),
    };
  }

  snapshot() {
    if (!this.enabled) return null;
    const storageUsed = directorySize(this.policy.instanceRoot);
    return {
      resetAtUtc: this.expiresAtUtc,
      categories: {
        generation: this.categorySnapshot('generation'),
        ocr: this.categorySnapshot('ocr'),
        tts: this.categorySnapshot('tts'),
      },
      storage: {
        usedBytes: storageUsed,
        limitBytes: this.limits.storageBytes,
        remainingBytes: Math.max(0, this.limits.storageBytes - storageUsed),
      },
    };
  }

  consume(category) {
    if (!this.enabled || !category) return { allowed: true, quota: null };
    const current = this.categorySnapshot(category);
    if (current.remaining <= 0) {
      return { allowed: false, quota: current };
    }
    this.state.used[category] = current.used + 1;
    this.state.updatedAtUtc = new Date().toISOString();
    this.persist();
    return { allowed: true, quota: this.categorySnapshot(category) };
  }

  createMiddleware() {
    return (req, res, next) => {
      if (!this.enabled || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
      const storage = this.snapshot()?.storage;
      if (storage && storage.remainingBytes <= 0) {
        return res.status(429).json({
          error: '当前体验沙箱的存储额度已用完。',
          code: 'SANDBOX_STORAGE_QUOTA_EXCEEDED',
          details: {
            quota: storage,
            resetAtUtc: this.expiresAtUtc,
            recovery: '重置体验数据，或等待当前沙箱到期。',
          },
        });
      }
      const category = classifyQuotaRequest(req.method, req.path);
      if (!category) return next();
      const result = this.consume(category);
      res.set('X-Sandbox-Quota-Limit', String(result.quota.limit));
      res.set('X-Sandbox-Quota-Remaining', String(result.quota.remaining));
      if (this.expiresAtUtc) res.set('X-Sandbox-Quota-Reset', this.expiresAtUtc);
      if (result.allowed) return next();
      return res.status(429).json({
        error: '当前体验沙箱的操作额度已用完。',
        code: 'SANDBOX_QUOTA_EXCEEDED',
        details: {
          category,
          quota: result.quota,
          resetAtUtc: this.expiresAtUtc,
          recovery: '重置体验数据，或等待当前沙箱到期。',
        },
      });
    };
  }
}

module.exports = {
  QUOTA_ROUTES,
  SandboxQuotaService,
  classifyQuotaRequest,
  directorySize,
  nonNegativeInteger,
};
