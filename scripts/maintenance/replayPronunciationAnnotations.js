#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { JSDOM } = require('jsdom');
const {
  loadSharedModules,
  renderCardMarkdown,
} = require('../../services/annotations/application/buildAnnotationMigrationPlan');

const ROOT = path.resolve(__dirname, '../..');
const VERSION = 'pronunciation-annotation-shadow-replay-v1';

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function stripLegacyRuby(root) {
  root.querySelectorAll('ruby').forEach((ruby) => {
    const base = Array.from(ruby.childNodes)
      .filter((node) => !(node.nodeType === 1 && ['RT', 'RP'].includes(node.tagName)))
      .map((node) => node.textContent || '')
      .join('');
    ruby.replaceWith(root.ownerDocument.createTextNode(base));
  });
  return root;
}

function renderPair(row, transforms) {
  const html = renderCardMarkdown(row.markdown_content, row.card_type, row.folder_name, transforms);
  const legacyDom = new JSDOM(`<div id="__root">${html}</div>`);
  const plainDom = new JSDOM(`<div id="__root">${html}</div>`);
  return {
    legacyDom,
    plainDom,
    legacyRoot: legacyDom.window.document.getElementById('__root'),
    plainRoot: stripLegacyRuby(plainDom.window.document.getElementById('__root')),
  };
}

function contentFreeRow(row) {
  return {
    annotationId: row.id,
    targetKind: row.target_kind,
    targetId: Number(row.target_id),
    status: row.status,
    sourceContentHash: row.source_content_hash,
    projectionVersion: row.projection_version,
    positionStart: Number(row.position_start),
    positionEnd: Number(row.position_end),
  };
}

async function buildShadowReplay({ db, observedAtUtc = new Date().toISOString() } = {}) {
  if (!db) throw new TypeError('buildShadowReplay requires db');
  db.pragma('query_only = ON');
  const { transforms, anchor } = await loadSharedModules();
  const rows = db.prepare(`
    SELECT annotation.id, annotation.target_kind, annotation.target_id, annotation.target_revision,
      annotation.projection_version, annotation.quote_exact, annotation.quote_prefix, annotation.quote_suffix,
      annotation.position_start, annotation.position_end,
      annotation.status, annotation.source_content_hash, generation.markdown_content,
      generation.card_type, generation.folder_name
    FROM card_annotations annotation
    LEFT JOIN generations generation
      ON annotation.target_kind = 'generation' AND generation.id = annotation.target_id
    WHERE annotation.status IN ('active', 'orphaned')
    ORDER BY annotation.id
  `).all();
  const items = [];
  const unsupported = [];
  const projectionHashes = new Set();

  for (const row of rows) {
    if (row.target_kind !== 'generation' || !row.markdown_content) {
      unsupported.push(contentFreeRow(row));
      continue;
    }
    const pair = renderPair(row, transforms);
    try {
      const legacyMap = anchor.buildCanonicalDomMap(pair.legacyRoot);
      const plainMap = anchor.buildCanonicalDomMap(pair.plainRoot);
      projectionHashes.add(sha256(legacyMap.text));
      projectionHashes.add(sha256(plainMap.text));
      const selector = {
        projectionVersion: row.projection_version,
        textQuote: {
          type: 'TextQuoteSelector',
          exact: row.quote_exact || '',
          prefix: row.quote_prefix || '',
          suffix: row.quote_suffix || '',
        },
        textPosition: {
          type: 'TextPositionSelector',
          start: Number(row.position_start),
          end: Number(row.position_end),
        },
      };
      const legacy = anchor.resolveAnchor(pair.legacyRoot, selector);
      const plain = anchor.resolveAnchor(pair.plainRoot, selector);
      items.push({
        annotationId: row.id,
        targetId: Number(row.target_id),
        originalStatus: row.status,
        projectionEqual: legacyMap.text === plainMap.text,
        legacyProjectionHash: sha256(legacyMap.text),
        plainProjectionHash: sha256(plainMap.text),
        legacyResolution: legacy.status,
        plainResolution: plain.status,
        legacyResolved: Boolean(legacy.range),
        plainResolved: Boolean(plain.range),
        legacyStart: legacy.start == null ? null : legacy.start,
        plainStart: plain.start == null ? null : plain.start,
        legacyEnd: legacy.end == null ? null : legacy.end,
        plainEnd: plain.end == null ? null : plain.end,
      });
    } finally {
      pair.legacyDom.window.close();
      pair.plainDom.window.close();
    }
  }

  const summary = {
    annotations: rows.length,
    generationAnnotations: items.length,
    unsupportedAnnotations: unsupported.length,
    projectionEqual: items.filter((item) => item.projectionEqual).length,
    projectionChanged: items.filter((item) => !item.projectionEqual).length,
    legacyResolved: items.filter((item) => item.legacyResolved).length,
    plainResolved: items.filter((item) => item.plainResolved).length,
    newlyOrphaned: items.filter((item) => item.legacyResolved && !item.plainResolved).length,
    existingOrphaned: items.filter((item) => !item.legacyResolved && !item.plainResolved).length,
    distinctProjectionHashes: projectionHashes.size,
  };
  const hashBody = {
    version: VERSION,
    mode: 'read-only-shadow-replay',
    summary,
    items,
    unsupported,
  };
  return {
    ...hashBody,
    observedAtUtc,
    reportHash: sha256(stableJson(hashBody)),
  };
}

function outputPath() {
  const value = argument('output');
  if (!value) throw new Error('--output=... is required');
  const target = path.resolve(value);
  if (target === ROOT || target.startsWith(`${ROOT}${path.sep}`)) {
    throw new Error(`Output must stay outside the Git workspace: ${target}`);
  }
  if (fs.existsSync(target)) throw new Error(`Output already exists: ${target}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  return target;
}

async function run() {
  const dbPath = path.resolve(argument('db') || process.env.DB_PATH || './data/trilingual_records.db');
  const output = outputPath();
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const report = await buildShadowReplay({ db });
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`${JSON.stringify({ output, reportHash: report.reportHash, summary: report.summary }, null, 2)}\n`);
  } finally {
    db.close();
  }
}

if (require.main === module) {
  run().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = { VERSION, buildShadowReplay, stripLegacyRuby, stableJson };
