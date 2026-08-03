'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SandboxQuotaService,
  classifyQuotaRequest,
  directorySize,
} = require('../../services/sandbox/sandboxQuotaService');

function fixture() {
  const instanceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'three-lans-quota-'));
  return {
    instanceRoot,
    policy: {
      mode: 'sandbox',
      instanceRoot,
      expiresAtUtc: '2026-07-31T00:00:00.000Z',
    },
  };
}

test.describe('public sandbox quota', () => {
  test.it('classifies only high-cost public operations', () => {
    assert.equal(classifyQuotaRequest('POST', '/api/generation-jobs'), 'generation');
    assert.equal(classifyQuotaRequest('POST', '/api/ocr'), 'ocr');
    assert.equal(classifyQuotaRequest('POST', '/api/tts/selection'), 'tts');
    assert.equal(classifyQuotaRequest('GET', '/api/history'), null);
    assert.equal(classifyQuotaRequest('POST', '/api/learning/queues/today'), null);
  });

  test.it('persists usage and fails closed at the configured limit', () => {
    const { instanceRoot, policy } = fixture();
    try {
      const service = new SandboxQuotaService(policy, {
        generation: 1,
        ocr: 2,
        tts: 3,
        storageBytes: 1_000_000,
      });
      assert.deepEqual(service.consume('generation'), {
        allowed: true,
        quota: { used: 1, limit: 1, remaining: 0 },
      });
      assert.deepEqual(service.consume('generation'), {
        allowed: false,
        quota: { used: 1, limit: 1, remaining: 0 },
      });
      const reloaded = new SandboxQuotaService(policy, {
        generation: 1,
        ocr: 2,
        tts: 3,
        storageBytes: 1_000_000,
      });
      assert.equal(reloaded.snapshot().categories.generation.used, 1);
      assert.equal(reloaded.snapshot().resetAtUtc, policy.expiresAtUtc);
    } finally {
      fs.rmSync(instanceRoot, { recursive: true, force: true });
    }
  });

  test.it('measures files without following symbolic links', () => {
    const { instanceRoot } = fixture();
    try {
      fs.writeFileSync(path.join(instanceRoot, 'data.bin'), Buffer.alloc(12));
      fs.symlinkSync('/etc', path.join(instanceRoot, 'outside'));
      assert.equal(directorySize(instanceRoot), 12);
    } finally {
      fs.rmSync(instanceRoot, { recursive: true, force: true });
    }
  });
});
