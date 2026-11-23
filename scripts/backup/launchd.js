'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_REMOTE_BACKUP_ROOT } = require('./auth');
const { writePrivateFileAtomic } = require('./fsGuards');

const DEFAULT_LABEL = 'com.threelans.core-backup.daily';
const DEFAULT_NODE_BIN = '/usr/local/bin/node';
const DEFAULT_REPO_ROOT = '/Users/colin/ThreeLANS/source-repository';

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function renderPlistValue(value, indent = 2) {
  const pad = ' '.repeat(indent);
  if (typeof value === 'boolean') {
    return `${pad}<${value ? 'true' : 'false'}/>`;
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    return `${pad}<integer>${value}</integer>`;
  }
  if (typeof value === 'string') {
    return `${pad}<string>${escapeXml(value)}</string>`;
  }
  if (Array.isArray(value)) {
    const inner = value.map((item) => renderPlistValue(item, indent + 2)).join('\n');
    return `${pad}<array>\n${inner}\n${pad}</array>`;
  }
  if (value && typeof value === 'object') {
    const inner = Object.keys(value).map((key) => (
      `${pad}  <key>${escapeXml(key)}</key>\n${renderPlistValue(value[key], indent + 2)}`
    )).join('\n');
    return `${pad}<dict>\n${inner}\n${pad}</dict>`;
  }
  throw new Error('unsupported_plist_value');
}

function buildLaunchAgentConfig({
  label = DEFAULT_LABEL,
  nodeBin = DEFAULT_NODE_BIN,
  repoRoot = DEFAULT_REPO_ROOT,
  backupRoot = DEFAULT_REMOTE_BACKUP_ROOT,
  hour = 4,
  minute = 15,
  timezone = 'Asia/Tokyo',
  deadlineSeconds = 900,
} = {}) {
  if (!/^[A-Za-z0-9._-]{3,120}$/.test(label)) {
    throw new Error('invalid_launchd_label');
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error('invalid_schedule_hour');
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error('invalid_schedule_minute');
  }
  if (!Number.isInteger(deadlineSeconds) || deadlineSeconds < 60 || deadlineSeconds > 7200) {
    throw new Error('invalid_deadline_seconds');
  }

  const scriptPath = path.join(repoRoot, 'scripts', 'backup', 'upload.js');
  const logsDir = path.join(backupRoot, 'logs');

  return {
    Label: label,
    ProgramArguments: [
      nodeBin,
      scriptPath,
      'run',
      '--origin',
      'scheduled',
      '--root',
      backupRoot,
      '--deadline-seconds',
      String(deadlineSeconds),
    ],
    WorkingDirectory: repoRoot,
    StartCalendarInterval: {
      Hour: hour,
      Minute: minute,
    },
    EnvironmentVariables: {
      PATH: '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      TZ: timezone,
    },
    RunAtLoad: false,
    KeepAlive: false,
    ProcessType: 'Background',
    Umask: 0o077,
    StandardOutPath: path.join(logsDir, 'daily.log'),
    StandardErrorPath: path.join(logsDir, 'daily.error.log'),
  };
}

function renderLaunchAgentPlist(options = {}) {
  const cfg = buildLaunchAgentConfig(options);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    renderPlistValue(cfg, 0),
    '</plist>',
    '',
  ].join('\n');
}

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i += 1;
    }
  }
  return flags;
}

function main() {
  process.umask(0o077);
  const flags = parseArgs(process.argv.slice(2));
  const plistXml = renderLaunchAgentPlist({
    label: flags.label || DEFAULT_LABEL,
    nodeBin: flags['node-bin'] || DEFAULT_NODE_BIN,
    repoRoot: flags['repo-root'] || DEFAULT_REPO_ROOT,
    backupRoot: flags['backup-root'] || DEFAULT_REMOTE_BACKUP_ROOT,
    hour: flags.hour !== undefined ? Number(flags.hour) : 4,
    minute: flags.minute !== undefined ? Number(flags.minute) : 15,
    timezone: flags.tz || 'Asia/Tokyo',
    deadlineSeconds: flags['deadline-seconds'] !== undefined ? Number(flags['deadline-seconds']) : 900,
  });

  if (flags.output) {
    const outPath = path.resolve(flags.output);
    if (fs.existsSync(outPath) && !flags.force) {
      throw new Error('output_plist_already_exists_use_force_to_overwrite');
    }
    writePrivateFileAtomic(outPath, plistXml);
    console.log(JSON.stringify({ status: 'PLIST_WRITTEN', output: outPath }));
    return 0;
  }
  process.stdout.write(plistXml);
  return 0;
}

module.exports = {
  DEFAULT_LABEL,
  DEFAULT_NODE_BIN,
  DEFAULT_REPO_ROOT,
  buildLaunchAgentConfig,
  renderLaunchAgentPlist,
};

if (require.main === module) {
  try {
    process.exit(main());
  } catch (err) {
    console.error(JSON.stringify({ status: 'FAIL', error: err.message || String(err) }));
    process.exit(1);
  }
}
