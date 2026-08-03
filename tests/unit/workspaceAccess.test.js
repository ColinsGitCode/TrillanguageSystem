'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  authorizeWorkspaceRequest,
  publicWorkspaceDescriptor,
  resolveWorkspacePolicy,
  WorkspaceConfigurationError,
} = require('../../lib/workspaceAccess');

function sandboxEnv(overrides = {}) {
  const root = '/tmp/three-lans-sandboxes';
  const workspaceId = 'sandbox_12345678';
  const instanceRoot = path.join(root, workspaceId);
  return {
    WORKSPACE_MODE: 'sandbox',
    DEPLOYMENT_EXPOSURE: 'public',
    SANDBOX_INSTANCE_ID: workspaceId,
    SANDBOX_STORAGE_ROOT: root,
    DB_PATH: path.join(instanceRoot, 'records', 'records.db'),
    RECORDS_PATH: path.join(instanceRoot, 'records'),
    TEXTBOOK_SOURCE_ROOT: path.join(instanceRoot, 'textbook-source'),
    TEXTBOOK_WORK_PATH: path.join(instanceRoot, 'textbook-work'),
    SELECTION_TTS_CACHE_PATH: path.join(instanceRoot, 'selection-tts'),
    ...overrides,
  };
}

test.describe('workspace access policy', () => {
  test.it('keeps the existing local owner workspace as the safe default', () => {
    const policy = resolveWorkspacePolicy({});
    assert.equal(policy.mode, 'owner');
    assert.equal(policy.exposure, 'local');
    assert.equal(publicWorkspaceDescriptor(policy).capabilities.write, true);
  });

  test.it('refuses a publicly exposed owner workspace without external protection', () => {
    assert.throws(
      () => resolveWorkspacePolicy({
        WORKSPACE_MODE: 'owner',
        DEPLOYMENT_EXPOSURE: 'public',
      }),
      (error) => error instanceof WorkspaceConfigurationError
        && error.code === 'PUBLIC_OWNER_WORKSPACE_UNPROTECTED'
    );
  });

  test.it('requires every sandbox data path to stay in its dedicated instance root', () => {
    assert.throws(
      () => resolveWorkspacePolicy(sandboxEnv({ DB_PATH: '/data/owner.db' })),
      (error) => error instanceof WorkspaceConfigurationError
        && error.code === 'SANDBOX_STORAGE_NOT_ISOLATED'
        && error.details.variable === 'DB_PATH'
    );
  });

  test.it('exposes only public workspace capabilities for an isolated sandbox', () => {
    const policy = resolveWorkspacePolicy(sandboxEnv({
      SANDBOX_EXPIRES_AT_UTC: '2026-07-31T10:00:00.000Z',
      SANDBOX_RESET_SUPPORTED: 'true',
    }));
    const descriptor = publicWorkspaceDescriptor(policy);
    assert.equal(descriptor.mode, 'sandbox');
    assert.equal(descriptor.access, 'read-only');
    assert.equal(descriptor.protection, 'dedicated-process-storage');
    assert.equal(descriptor.capabilities.ownerData, false);
    assert.equal(descriptor.capabilities.durableHistory, false);
    assert.equal(descriptor.expiresAtUtc, '2026-07-31T10:00:00.000Z');
    assert.equal(descriptor.resetSupported, true);
    assert.equal('instanceRoot' in descriptor, false);
    assert.equal('sandboxStorageRoot' in descriptor, false);
  });

  test.it('blocks mutations in a read-only sandbox but keeps reads available', () => {
    const policy = resolveWorkspacePolicy(sandboxEnv());
    assert.equal(authorizeWorkspaceRequest(policy, {
      method: 'GET',
      path: '/api/history',
    }), null);
    assert.equal(
      authorizeWorkspaceRequest(policy, {
        method: 'POST',
        path: '/api/learning/queues/today',
      }).code,
      'WORKSPACE_READ_ONLY'
    );
  });

  test.it('allows ordinary isolated writes while high-cost operations stay explicitly disabled', () => {
    const policy = resolveWorkspacePolicy(sandboxEnv({ SANDBOX_WRITE_ENABLED: 'true' }));
    assert.equal(authorizeWorkspaceRequest(policy, {
      method: 'POST',
      path: '/api/learning/queues/today',
    }), null);
    assert.equal(
      authorizeWorkspaceRequest(policy, {
        method: 'POST',
        path: '/api/generation-jobs',
      }).code,
      'WORKSPACE_HIGH_COST_DISABLED'
    );
    assert.equal(
      authorizeWorkspaceRequest(policy, {
        method: 'POST',
        path: '/api/textbooks/expressions/7/derivations',
      }).code,
      'WORKSPACE_HIGH_COST_DISABLED'
    );
    assert.equal(
      authorizeWorkspaceRequest(policy, {
        method: 'POST',
        path: '/api/textbooks/tracks/2/operations',
      }).code,
      'WORKSPACE_HIGH_COST_DISABLED'
    );
  });

  test.it('enables high-cost operations only through an explicit second gate', () => {
    const policy = resolveWorkspacePolicy(sandboxEnv({
      SANDBOX_WRITE_ENABLED: 'true',
      SANDBOX_HIGH_COST_ENABLED: 'true',
    }));
    assert.equal(authorizeWorkspaceRequest(policy, {
      method: 'POST',
      path: '/api/generation-jobs',
    }), null);
  });
});
