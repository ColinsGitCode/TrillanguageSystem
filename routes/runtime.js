'use strict';

const express = require('express');
const packageJson = require('../package.json');
const { publicWorkspaceDescriptor } = require('../lib/workspaceAccess');
const { readBuildInfo, sanitizeCommit, sanitizeBuildTime } = require('../lib/buildInfo');

function sanitizePublicUrl(value) {
  const input = String(value || '').trim();
  if (!input) return null;
  try {
    const url = new URL(input);
    return ['https:', 'mailto:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return /^(1|true|yes|on)$/iu.test(String(value));
}

function sanitizeSampleRate(value, fallback = 0.1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

function uiPerformanceDescriptor(policy, env = process.env) {
  const enabled = parseBoolean(
    env.UI_PERFORMANCE_ENABLED,
    policy.exposure === 'public'
  );
  return {
    enabled,
    sampleRate: enabled
      ? sanitizeSampleRate(env.UI_PERFORMANCE_SAMPLE_RATE, 0.1)
      : 0,
  };
}

function createRuntimeRouter(policy, options = {}) {
  const { quotaService = null } = options;
  const buildInfo = readBuildInfo();
  const router = express.Router();
  router.get('/api/runtime', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    return res.json({
      success: true,
      workspace: publicWorkspaceDescriptor(policy),
      sandbox: policy.mode === 'sandbox' ? {
        expiresAtUtc: policy.expiresAtUtc,
        resetSupported: policy.resetSupported,
        quota: quotaService?.snapshot() || null,
      } : null,
      build: {
        version: String(packageJson.version || '0.0.0'),
        ...buildInfo,
      },
      support: {
        feedbackUrl: sanitizePublicUrl(process.env.PUBLIC_FEEDBACK_URL),
      },
      observability: {
        uiPerformance: uiPerformanceDescriptor(policy),
      },
      serverTimeUtc: new Date().toISOString(),
    });
  });
  return router;
}

module.exports = {
  createRuntimeRouter,
  sanitizeBuildTime,
  sanitizeCommit,
  sanitizePublicUrl,
  sanitizeSampleRate,
  uiPerformanceDescriptor,
};
