'use strict';

const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SandboxCapacityError,
  SandboxInstanceManager,
} = require('../../services/sandbox/sandboxInstanceManager');

function fakeChild() {
  const child = new EventEmitter();
  child.exitCode = null;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    child.exitCode = 0;
    queueMicrotask(() => child.emit('exit', 0));
    return true;
  };
  return child;
}

function managerFixture(overrides = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'three-lans-sessions-'));
  let now = Date.parse('2026-07-30T10:00:00.000Z');
  const environments = [];
  const manager = new SandboxInstanceManager({
    rootDir,
    retentionMs: 60_000,
    maxSessions: 2,
    portStart: 4300,
    portEnd: 4301,
    now: () => now,
    randomBytes: () => Buffer.from('0123456789abcdef0123456789abcdef', 'hex'),
    prepareInstance: async (env) => { environments.push(env); },
    spawnProcess: () => fakeChild(),
    probe: async (port) => ({
      workspace: {
        mode: 'sandbox',
        workspaceId: port === 4300
          ? 'sbx_0123456789abcdef0123456789abcdef'
          : 'sbx_0123456789abcdef0123456789abcdef',
      },
    }),
    ...overrides,
  });
  return {
    rootDir,
    environments,
    manager,
    advance: (milliseconds) => { now += milliseconds; },
  };
}

test.describe('public sandbox instance manager', () => {
  test.it('creates one isolated process environment without owner paths', async () => {
    const fixture = managerFixture();
    try {
      const session = await fixture.manager.createSession();
      const env = fixture.environments[0];
      assert.equal(session.port, 4300);
      assert.equal(env.WORKSPACE_MODE, 'sandbox');
      assert.equal(env.DEPLOYMENT_EXPOSURE, 'public');
      assert.match(env.DB_PATH, new RegExp(`${session.id}/database/records\\.db$`));
      assert.match(env.RECORDS_PATH, new RegExp(`${session.id}/records$`));
      assert.equal(env.SANDBOX_INSTANCE_ID, session.id);
      assert.equal(env.SANDBOX_RESET_SUPPORTED, 'true');
      assert.equal(env.LEARNING_TIMEZONE, 'Asia/Tokyo');
      assert.equal(JSON.stringify(env).includes('/data/trilingual_records'), false);
    } finally {
      await fixture.manager.close();
      fs.rmSync(fixture.rootDir, { recursive: true, force: true });
    }
  });

  test.it('removes an expired instance before allocating its port again', async () => {
    let counter = 0;
    const fixture = managerFixture({
      randomBytes: () => Buffer.from(String(++counter).padStart(32, '0'), 'hex'),
      probe: async (_port) => ({
        workspace: {
          mode: 'sandbox',
          workspaceId: `sbx_${String(counter).padStart(32, '0')}`,
        },
      }),
    });
    try {
      const first = await fixture.manager.createSession();
      fixture.advance(61_000);
      const second = await fixture.manager.createSession();
      assert.notEqual(second.id, first.id);
      assert.equal(second.port, first.port);
      assert.equal(fs.existsSync(path.join(fixture.rootDir, first.id)), false);
    } finally {
      await fixture.manager.close();
      fs.rmSync(fixture.rootDir, { recursive: true, force: true });
    }
  });

  test.it('rejects excess browsers instead of sharing an existing process', async () => {
    let counter = 0;
    const fixture = managerFixture({
      maxSessions: 1,
      randomBytes: () => Buffer.from(String(++counter).padStart(32, '0'), 'hex'),
      probe: async () => ({
        workspace: {
          mode: 'sandbox',
          workspaceId: `sbx_${String(counter).padStart(32, '0')}`,
        },
      }),
    });
    try {
      await fixture.manager.createSession();
      await assert.rejects(
        fixture.manager.createSession(),
        (error) => error instanceof SandboxCapacityError
      );
    } finally {
      await fixture.manager.close();
      fs.rmSync(fixture.rootDir, { recursive: true, force: true });
    }
  });

  test.it('counts a preparing sandbox against capacity during concurrent arrivals', async () => {
    let counter = 0;
    let releasePreparation;
    let markPreparationStarted;
    const preparationStarted = new Promise((resolve) => {
      markPreparationStarted = resolve;
    });
    const fixture = managerFixture({
      maxSessions: 1,
      randomBytes: () => Buffer.from(String(++counter).padStart(32, '0'), 'hex'),
      prepareInstance: async (env) => {
        fixture.environments.push(env);
        markPreparationStarted();
        await new Promise((resolve) => { releasePreparation = resolve; });
      },
      probe: async () => ({
        workspace: {
          mode: 'sandbox',
          workspaceId: `sbx_${String(counter).padStart(32, '0')}`,
        },
      }),
    });
    try {
      const first = fixture.manager.createSession();
      await preparationStarted;
      assert.equal(fixture.manager.listSessions()[0].state, 'preparing');
      await assert.rejects(
        fixture.manager.createSession(),
        (error) => error instanceof SandboxCapacityError
      );
      releasePreparation();
      assert.equal((await first).state, 'ready');
    } finally {
      releasePreparation?.();
      await fixture.manager.close();
      fs.rmSync(fixture.rootDir, { recursive: true, force: true });
    }
  });

  test.it('locks one gateway storage root and removes only orphan sandbox directories', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'three-lans-exclusive-sessions-'));
    fs.mkdirSync(path.join(rootDir, 'sbx_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
    fs.mkdirSync(path.join(rootDir, 'operator-files'));
    const manager = new SandboxInstanceManager({
      rootDir,
      exclusiveRoot: true,
      prepareInstance: async () => {},
      spawnProcess: () => fakeChild(),
      probe: async () => ({}),
    });
    try {
      assert.equal(fs.existsSync(path.join(rootDir, 'sbx_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')), false);
      assert.equal(fs.existsSync(path.join(rootDir, 'operator-files')), true);
      assert.throws(
        () => new SandboxInstanceManager({ rootDir, exclusiveRoot: true }),
        (error) => error.code === 'SANDBOX_GATEWAY_STORAGE_LOCKED'
      );
    } finally {
      await manager.close();
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
