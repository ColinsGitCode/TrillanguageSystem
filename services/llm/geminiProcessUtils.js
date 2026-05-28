'use strict';

const { spawnSync } = require('child_process');

// Shared spawn/cleanup primitives for the two places that run the gemini CLI:
// the host executor (scripts/gemini-host-proxy.js) and the in-process CLI
// transport (services/geminiCliService.js). Keeping them here stops the two
// from drifting apart — notably the process-tree kill, which prevents the
// CLI's forked helpers from being orphaned on timeout.

// Strip a leading/trailing ``` fence from CLI stdout.
function stripFence(text) {
  if (!text) return '';
  let cleaned = String(text).trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
  }
  return cleaned;
}

// Walk the process tree under rootPid via pgrep.
function collectDescendantPids(rootPid, seen = new Set()) {
  const pid = Number(rootPid);
  if (!Number.isFinite(pid) || pid <= 0 || seen.has(pid)) return [];
  seen.add(pid);
  let stdout = '';
  try {
    const result = spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' });
    stdout = result.stdout || '';
  } catch (_) {
    return [];
  }
  const children = stdout
    .split(/\s+/)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0 && !seen.has(value));
  const all = [...children];
  for (const child of children) {
    all.push(...collectDescendantPids(child, seen));
  }
  return all;
}

// Signal a process and all of its descendants. Returns the count signalled.
// Relies on the child being spawned `detached` so the negative-pid group
// kill works; falls back to per-pid signalling otherwise.
function signalProcessTree(proc, signal = 'SIGTERM') {
  if (!proc || !proc.pid) return 0;
  const targets = [...collectDescendantPids(proc.pid), proc.pid];
  const uniqueTargets = [...new Set(targets)].filter((pid) => Number.isFinite(pid) && pid > 0);
  let signalled = 0;

  if (process.platform !== 'win32') {
    try {
      process.kill(-proc.pid, signal);
      signalled += 1;
    } catch (_) {
      // Fall back to per-pid signalling below.
    }
  }

  for (const pid of uniqueTargets) {
    try {
      process.kill(pid, signal);
      signalled += 1;
    } catch (_) {
      // ignore stale pids
    }
  }
  return signalled;
}

module.exports = { stripFence, collectDescendantPids, signalProcessTree };
