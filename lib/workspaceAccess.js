'use strict';

const path = require('node:path');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const WORKSPACE_MODES = new Set(['owner', 'sandbox']);
const DEPLOYMENT_EXPOSURES = new Set(['local', 'private', 'public']);
const HIGH_COST_ROUTES = [
  { method: 'POST', pattern: /^\/api\/generate$/u },
  { method: 'POST', pattern: /^\/api\/generation-jobs$/u },
  { method: 'POST', pattern: /^\/api\/generation-jobs\/\d+\/retry$/u },
  { method: 'POST', pattern: /^\/api\/ocr$/u },
  { method: 'POST', pattern: /^\/api\/tts\/selection$/u },
  { method: 'POST', pattern: /^\/api\/textbooks\/tracks\/\d+\/operations$/u },
  { method: 'POST', pattern: /^\/api\/textbooks\/tracks\/\d+\/tts$/u },
  { method: 'POST', pattern: /^\/api\/textbooks\/operations\/\d+\/retry$/u },
  { method: 'POST', pattern: /^\/api\/textbooks\/expressions\/\d+\/derivations$/u },
];

class WorkspaceConfigurationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'WorkspaceConfigurationError';
    this.code = code;
    this.details = details;
  }
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return /^(1|true|yes|on)$/iu.test(String(value).trim());
}

function normalizeEnum(value, allowed, fallback, code) {
  const normalized = String(value || fallback).trim().toLowerCase();
  if (!allowed.has(normalized)) {
    throw new WorkspaceConfigurationError(code, `Unsupported value: ${normalized}`);
  }
  return normalized;
}

function isInside(rootPath, candidatePath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function assertSandboxStorage(policy, env) {
  if (!/^[a-z0-9][a-z0-9_-]{7,79}$/iu.test(policy.workspaceId)) {
    throw new WorkspaceConfigurationError(
      'SANDBOX_INSTANCE_ID_REQUIRED',
      'Sandbox mode requires an opaque SANDBOX_INSTANCE_ID (8-80 safe characters).'
    );
  }

  const instanceRoot = path.resolve(policy.sandboxStorageRoot, policy.workspaceId);
  const paths = {
    DB_PATH: env.DB_PATH || './data/trilingual_records.db',
    RECORDS_PATH: env.RECORDS_PATH || '/data/trilingual_records',
    TEXTBOOK_SOURCE_ROOT: env.TEXTBOOK_SOURCE_ROOT || '/media/textbooks',
    TEXTBOOK_WORK_PATH: env.TEXTBOOK_WORK_PATH || '/data/textbooks',
    SELECTION_TTS_CACHE_PATH: env.SELECTION_TTS_CACHE_PATH || '/data/selection_tts_cache',
  };

  for (const [name, candidate] of Object.entries(paths)) {
    if (candidate === ':memory:' || !isInside(instanceRoot, candidate)) {
      throw new WorkspaceConfigurationError(
        'SANDBOX_STORAGE_NOT_ISOLATED',
        `${name} must be inside the dedicated sandbox instance root.`,
        { variable: name }
      );
    }
  }

  return instanceRoot;
}

function resolveWorkspacePolicy(env = process.env) {
  const mode = normalizeEnum(
    env.WORKSPACE_MODE,
    WORKSPACE_MODES,
    'owner',
    'WORKSPACE_MODE_INVALID'
  );
  const exposure = normalizeEnum(
    env.DEPLOYMENT_EXPOSURE,
    DEPLOYMENT_EXPOSURES,
    'local',
    'DEPLOYMENT_EXPOSURE_INVALID'
  );
  const ownerGatewayProtected = parseBoolean(env.OWNER_GATEWAY_PROTECTED, false);
  const workspaceId = String(env.SANDBOX_INSTANCE_ID || '').trim();
  const sandboxStorageRoot = path.resolve(env.SANDBOX_STORAGE_ROOT || '/data/sandboxes');
  const sandboxWriteEnabled = parseBoolean(env.SANDBOX_WRITE_ENABLED, false);
  const sandboxHighCostEnabled = parseBoolean(env.SANDBOX_HIGH_COST_ENABLED, false);
  const parsedRetentionHours = Number(env.SANDBOX_RETENTION_HOURS);
  const retentionHours = Number.isFinite(parsedRetentionHours)
    ? Math.max(1, parsedRetentionHours)
    : 24;
  const expiresAt = new Date(String(env.SANDBOX_EXPIRES_AT_UTC || ''));
  const expiresAtUtc = mode === 'sandbox' && !Number.isNaN(expiresAt.getTime())
    ? expiresAt.toISOString()
    : null;
  const resetSupported = mode === 'sandbox' && parseBoolean(env.SANDBOX_RESET_SUPPORTED, false);

  if (mode === 'owner' && exposure === 'public' && !ownerGatewayProtected) {
    throw new WorkspaceConfigurationError(
      'PUBLIC_OWNER_WORKSPACE_UNPROTECTED',
      'A public owner workspace requires gateway, VPN, or reverse-proxy protection.'
    );
  }

  const policy = {
    version: 1,
    mode,
    exposure,
    ownerGatewayProtected,
    workspaceId: mode === 'sandbox' ? workspaceId : 'owner',
    sandboxStorageRoot,
    sandboxWriteEnabled: mode === 'sandbox' && sandboxWriteEnabled,
    sandboxHighCostEnabled: mode === 'sandbox' && sandboxWriteEnabled && sandboxHighCostEnabled,
    retentionHours: mode === 'sandbox' ? retentionHours : null,
    expiresAtUtc,
    resetSupported,
    instanceRoot: null,
  };

  if (mode === 'sandbox') {
    policy.instanceRoot = assertSandboxStorage(policy, env);
  }

  return Object.freeze(policy);
}

function isHighCostRequest(method, requestPath) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  return HIGH_COST_ROUTES.some((route) => (
    route.method === normalizedMethod && route.pattern.test(String(requestPath || ''))
  ));
}

function authorizeWorkspaceRequest(policy, { method, path: requestPath }) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  if (SAFE_METHODS.has(normalizedMethod) || policy.mode === 'owner') return null;

  if (!policy.sandboxWriteEnabled) {
    return {
      status: 403,
      code: 'WORKSPACE_READ_ONLY',
      error: '当前体验沙箱为只读模式，不能执行会修改数据的操作。',
      recovery: '使用独立可写沙箱，或返回受保护的个人工作区。',
    };
  }

  if (isHighCostRequest(normalizedMethod, requestPath) && !policy.sandboxHighCostEnabled) {
    return {
      status: 403,
      code: 'WORKSPACE_HIGH_COST_DISABLED',
      error: '当前体验沙箱未开放生成、OCR 或即时语音等高成本操作。',
      recovery: '继续浏览现有示例，或使用开放了额度的独立沙箱。',
    };
  }

  return null;
}

function createWorkspaceAccessMiddleware(policy) {
  return function workspaceAccessMiddleware(req, res, next) {
    const denial = authorizeWorkspaceRequest(policy, {
      method: req.method,
      path: req.path,
    });
    if (!denial) return next();
    return res.status(denial.status).json({
      error: denial.error,
      code: denial.code,
      details: {
        workspaceMode: policy.mode,
        access: policy.sandboxWriteEnabled ? 'read-write' : 'read-only',
        recovery: denial.recovery,
      },
    });
  };
}

function publicWorkspaceDescriptor(policy) {
  const writable = policy.mode === 'owner' || policy.sandboxWriteEnabled;
  return {
    version: policy.version,
    mode: policy.mode,
    label: policy.mode === 'owner' ? '个人工作区' : '体验沙箱',
    access: writable ? 'read-write' : 'read-only',
    exposure: policy.exposure,
    protection: policy.mode === 'owner'
      ? (policy.ownerGatewayProtected ? 'external-gateway' : 'local-only')
      : 'dedicated-process-storage',
    workspaceId: policy.mode === 'sandbox' ? policy.workspaceId : null,
    retentionHours: policy.retentionHours,
    expiresAtUtc: policy.expiresAtUtc,
    resetSupported: policy.resetSupported,
    capabilities: {
      read: true,
      write: writable,
      highCostOperations: policy.mode === 'owner' || policy.sandboxHighCostEnabled,
      durableHistory: policy.mode === 'owner',
      ownerData: policy.mode === 'owner',
    },
  };
}

module.exports = {
  DEPLOYMENT_EXPOSURES,
  HIGH_COST_ROUTES,
  SAFE_METHODS,
  WORKSPACE_MODES,
  WorkspaceConfigurationError,
  authorizeWorkspaceRequest,
  createWorkspaceAccessMiddleware,
  isHighCostRequest,
  parseBoolean,
  publicWorkspaceDescriptor,
  resolveWorkspacePolicy,
};
