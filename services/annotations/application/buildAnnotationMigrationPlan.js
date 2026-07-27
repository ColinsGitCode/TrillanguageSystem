'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const { marked } = require('marked');
const { createLegacyAnnotationId } = require('../domain/annotationIdentity');

const PLAN_VERSION = 'ca-p3-card-annotation-migration-plan-v1';
const CONTEXT_LENGTH = 32;
const LEGACY_CONTEXT_FRAGMENT_LENGTH = 14;
const ROOT = path.resolve(__dirname, '..', '..', '..');

let sharedModulesPromise;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function moduleUrl(relativePath) {
  return pathToFileURL(path.join(ROOT, relativePath)).href;
}

function loadSharedModules() {
  if (!sharedModulesPromise) {
    sharedModulesPromise = Promise.all([
      import(moduleUrl('app/features/card-modal/card-render-transforms.mjs')),
      import(moduleUrl('app/features/card-modal/text-projection.mjs')),
      import(moduleUrl('app/features/card-modal/annotation-anchor.mjs')),
      import(moduleUrl('app/features/card-modal/annotation-render.mjs')),
    ]).then(([transforms, projection, anchor, annotationRender]) => ({
      transforms,
      projection,
      anchor,
      annotationRender,
    }));
  }
  return sharedModulesPromise;
}

function renderCardMarkdown(markdown, cardType, folder, transforms) {
  const parsed = String(marked.parse(
    transforms.normalizeLoanwordAnnotations(markdown || ''),
    { async: false }
  ));
  const withAudioButtons = transforms.adaptAudioToButtons(parsed, folder || '');
  const dom = new JSDOM('');
  try {
    const DOMPurify = createDOMPurify(dom.window);
    const safe = DOMPurify.sanitize(withAudioButtons, {
      USE_PROFILES: { html: true },
      ADD_TAGS: transforms.CARD_RENDER_ALLOWED_TAGS,
      ADD_ATTR: transforms.CARD_RENDER_ALLOWED_ATTR,
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
      FORBID_ATTR: ['style'],
    });
    return `<div class="react-card-renderer card-type-${cardType}" data-card-renderer-version="2" data-card-type="${cardType}">${safe}</div>`;
  } finally {
    dom.window.close();
  }
}

function extractInferredContinuousRuns(storedHtml, projection) {
  const dom = new JSDOM(`<div id="__root">${storedHtml || ''}</div>`);
  try {
    const root = dom.window.document.getElementById('__root');
    const pairs = projection.buildVisibleTextProjection(root).pairs;
    const text = pairs.map((pair) => pair.ch).join('');
    const utf16Offsets = [0];
    for (const pair of pairs) utf16Offsets.push(utf16Offsets.at(-1) + pair.ch.length);

    const runs = [];
    let pairStart = -1;
    for (let index = 0; index <= pairs.length; index += 1) {
      const markedPair = index < pairs.length && pairs[index].marked;
      if (markedPair && pairStart === -1) pairStart = index;
      if (!markedPair && pairStart !== -1) {
        let runStart = pairStart;
        let runEnd = index;
        while (runStart < runEnd && /\s/u.test(pairs[runStart].ch)) runStart += 1;
        while (runEnd > runStart && /\s/u.test(pairs[runEnd - 1].ch)) runEnd -= 1;
        if (runEnd > runStart) {
          const positionStart = utf16Offsets[runStart];
          const positionEnd = utf16Offsets[runEnd];
          runs.push({
            quote: text.slice(positionStart, positionEnd),
            prefix: text.slice(Math.max(0, positionStart - CONTEXT_LENGTH), positionStart),
            suffix: text.slice(positionEnd, positionEnd + CONTEXT_LENGTH),
            positionStart,
            positionEnd,
          });
        }
        pairStart = -1;
      }
    }
    return runs;
  } finally {
    dom.window.close();
  }
}

function targetFromRow(row) {
  if (!row.generation_id || !row.generation_content_hash) return null;
  if (row.card_type === 'textbook_track') {
    if (!row.track_id || !row.current_revision_id) return null;
    return {
      targetKind: 'textbook_track',
      targetId: Number(row.track_id),
      targetRevision: String(row.current_revision_id),
      sourceContentHash: row.track_content_hash || row.generation_content_hash,
    };
  }
  return {
    targetKind: 'generation',
    targetId: Number(row.generation_id),
    targetRevision: row.generation_content_hash,
    sourceContentHash: row.generation_content_hash,
  };
}

function legacySelector(run, projectionVersion) {
  return {
    projectionVersion,
    textQuote: {
      type: 'TextQuoteSelector',
      exact: run.quote,
      prefix: run.prefix,
      suffix: run.suffix,
    },
    textPosition: {
      type: 'TextPositionSelector',
      start: run.positionStart,
      end: run.positionEnd,
    },
  };
}

function allIndexes(text, exact) {
  const indexes = [];
  if (!exact) return indexes;
  let index = text.indexOf(exact);
  while (index !== -1) {
    indexes.push(index);
    index = text.indexOf(exact, index + 1);
  }
  return indexes;
}

function resolveLegacyAnchor(root, selector, anchor) {
  const strict = anchor.resolveAnchor(root, selector);
  if (strict.range) return strict;

  const map = anchor.buildCanonicalDomMap(root);
  const exact = selector.textQuote.exact;
  const prefixFragment = String(selector.textQuote.prefix || '')
    .slice(-LEGACY_CONTEXT_FRAGMENT_LENGTH);
  const suffixFragment = String(selector.textQuote.suffix || '')
    .slice(0, LEGACY_CONTEXT_FRAGMENT_LENGTH);
  const candidates = allIndexes(map.text, exact).filter((index) => {
    const before = map.text.slice(
      Math.max(0, index - CONTEXT_LENGTH * 2),
      index
    );
    const after = map.text.slice(
      index + exact.length,
      index + exact.length + CONTEXT_LENGTH * 2
    );
    return (!prefixFragment || before.includes(prefixFragment))
      && (!suffixFragment || after.includes(suffixFragment));
  });
  if (candidates.length !== 1) return strict;

  const start = candidates[0];
  const end = start + exact.length;
  const currentSelector = {
    projectionVersion: anchor.PROJECTION_VERSION,
    textQuote: {
      type: 'TextQuoteSelector',
      exact,
      prefix: map.text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
      suffix: map.text.slice(end, end + CONTEXT_LENGTH),
    },
    textPosition: {
      type: 'TextPositionSelector',
      start,
      end,
    },
  };
  const resolved = anchor.resolveAnchor(root, currentSelector);
  return resolved.range ? { ...resolved, status: 'legacy-context' } : strict;
}

function contentFreeItem(item) {
  return {
    legacyHighlightId: item.legacyHighlightId,
    legacyRunOrdinal: item.legacyRunOrdinal,
    annotationId: item.annotationId,
    targetKind: item.targetKind,
    targetId: item.targetId,
    targetRevision: item.targetRevision,
    outcome: item.outcome,
    reasonCode: item.reasonCode,
    sourceFingerprint: item.sourceFingerprint,
  };
}

async function buildAnnotationMigrationPlan({ db, now = new Date().toISOString() } = {}) {
  if (!db) throw new TypeError('buildAnnotationMigrationPlan requires db');
  const { transforms, projection, anchor } = await loadSharedModules();
  const rows = db.prepare(`
    SELECT highlight.id, highlight.generation_id, highlight.folder_name,
      highlight.base_filename, highlight.source_hash, highlight.version,
      highlight.html_content, generation.markdown_content, generation.card_type,
      generation.folder_name AS generation_folder_name,
      generation.content_hash AS generation_content_hash,
      track.id AS track_id, track.current_revision_id,
      track_revision.content_hash AS track_content_hash
    FROM card_highlights highlight
    LEFT JOIN generations generation ON generation.id = highlight.generation_id
    LEFT JOIN textbook_tracks track ON track.generation_id = generation.id
    LEFT JOIN textbook_track_revisions track_revision ON track_revision.id = track.current_revision_id
    ORDER BY highlight.id
  `).all();

  const items = [];
  let rawMarkElements = 0;

  for (const row of rows) {
    rawMarkElements += (String(row.html_content || '').match(/<mark\b[^>]*>/giu) || []).length;
    const runs = extractInferredContinuousRuns(row.html_content, projection);
    const target = targetFromRow(row);
    let currentDom = null;
    let currentRoot = null;
    if (target && row.markdown_content) {
      const rendered = renderCardMarkdown(
        row.markdown_content,
        row.card_type,
        row.generation_folder_name,
        transforms
      );
      currentDom = new JSDOM(`<div id="__root">${rendered}</div>`);
      currentRoot = currentDom.window.document.getElementById('__root');
    }

    try {
      runs.forEach((run, index) => {
        const legacyRunOrdinal = index + 1;
        const annotationId = createLegacyAnnotationId({
          highlightId: row.id,
          runOrdinal: legacyRunOrdinal,
          quote: run.quote,
          prefix: run.prefix,
          suffix: run.suffix,
        });
        const sourceFingerprint = sha256(stableJson({
          legacyHighlightId: Number(row.id),
          legacyRunOrdinal,
          generationId: row.generation_id == null ? null : Number(row.generation_id),
          sourceHash: row.source_hash,
          legacyVersion: Number(row.version),
          storedHtmlHash: sha256(row.html_content || ''),
          quote: run.quote,
          prefix: run.prefix,
          suffix: run.suffix,
        }));

        if (!target || !currentRoot) {
          items.push({
            legacyHighlightId: Number(row.id),
            legacyRunOrdinal,
            annotationId: null,
            targetKind: target?.targetKind || null,
            targetId: target?.targetId || null,
            targetRevision: target?.targetRevision || null,
            selector: null,
            annotationKind: 'highlight',
            color: 'red',
            status: null,
            outcome: 'skipped',
            reasonCode: target ? 'source-content-unavailable' : 'target-unresolved',
            sourceFingerprint,
          });
          return;
        }

        const resolved = resolveLegacyAnchor(
          currentRoot,
          legacySelector(run, anchor.PROJECTION_VERSION),
          anchor
        );
        const reanchored = Boolean(resolved.range);
        const selector = reanchored
          ? anchor.createAnchor(currentRoot, resolved.range, CONTEXT_LENGTH)
          : legacySelector(run, anchor.PROJECTION_VERSION);
        items.push({
          legacyHighlightId: Number(row.id),
          legacyRunOrdinal,
          annotationId,
          targetKind: target.targetKind,
          targetId: target.targetId,
          targetRevision: target.targetRevision,
          selector,
          annotationKind: 'highlight',
          color: 'red',
          status: reanchored ? 'active' : 'orphaned',
          outcome: reanchored ? 'migrated' : 'orphaned',
          reasonCode: reanchored ? resolved.status : 'quote-not-found-or-ambiguous',
          sourceContentHash: target.sourceContentHash,
          legacyPayload: {
            folderName: row.folder_name,
            baseFilename: row.base_filename,
            sourceHash: row.source_hash,
            legacyVersion: Number(row.version),
          },
          sourceFingerprint,
        });
      });
    } finally {
      currentDom?.window.close();
    }
  }

  const summary = {
    highlightRows: rows.length,
    rawMarkElements,
    inferredContinuousMarkedRuns: items.length,
    migrated: items.filter((item) => item.outcome === 'migrated').length,
    orphaned: items.filter((item) => item.outcome === 'orphaned').length,
    skipped: items.filter((item) => item.outcome === 'skipped').length,
  };
  const hashBody = {
    schemaVersion: PLAN_VERSION,
    mode: 'read-only-dry-run',
    projectionVersion: anchor.PROJECTION_VERSION,
    positionUnit: 'utf16',
    summary,
    items: items.map(contentFreeItem),
  };
  return {
    ...hashBody,
    createdAtUtc: now,
    items,
    planHash: sha256(stableJson(hashBody)),
  };
}

module.exports = {
  CONTEXT_LENGTH,
  LEGACY_CONTEXT_FRAGMENT_LENGTH,
  PLAN_VERSION,
  buildAnnotationMigrationPlan,
  extractInferredContinuousRuns,
  loadSharedModules,
  renderCardMarkdown,
  resolveLegacyAnchor,
  stableJson,
};
