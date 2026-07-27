'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { JSDOM } = require('jsdom');
const { AnnotationService } = require('../annotationService');
const { annotationError } = require('../annotationErrors');
const {
  loadSharedModules,
} = require('./buildAnnotationMigrationPlan');
const {
  sanitizeHighlightDocument,
  trackIdentity,
} = require('../../textbooks/textbookHighlightService');
const { selectorPayload } = require('./cardsFactoryAnnotationService');

const ROOT = path.resolve(__dirname, '..', '..', '..');
let textbookRenderPromise;

function loadTextbookSharedModules() {
  if (!textbookRenderPromise) {
    textbookRenderPromise = Promise.all([
      loadSharedModules(),
      import(pathToFileURL(path.join(
        ROOT,
        'app/features/textbooks/textbook-render.mjs'
      )).href),
    ]).then(([shared, textbookRender]) => ({ ...shared, textbookRender }));
  }
  return textbookRenderPromise;
}

class TextbookAnnotationService {
  constructor({
    dbService,
    annotationService = null,
    compatWriteEnabled = true,
    sharedModulesLoader = loadTextbookSharedModules,
  } = {}) {
    if (!dbService) throw new TypeError('TextbookAnnotationService requires dbService');
    this.dbService = dbService;
    this.annotationService = annotationService || new AnnotationService({ dbService });
    this.compatWriteEnabled = Boolean(compatWriteEnabled);
    this.sharedModulesLoader = sharedModulesLoader;
  }

  requireTrackTarget(targetKind, targetId) {
    if (targetKind !== 'textbook_track') {
      throw annotationError('ANNOTATION_CONSUMER_NOT_ENABLED', 409, {
        enabledConsumer: 'textbook',
      });
    }
    const track = this.dbService.getTextbookTrack(targetId);
    if (!track) throw annotationError('ANNOTATION_TARGET_NOT_FOUND', 404);
    if (track.status !== 'published' || !track.current_revision_id || !track.generation_id) {
      throw annotationError('ANNOTATION_TARGET_REVISION_UNAVAILABLE', 409);
    }
    return track;
  }

  canonicalDocument(track, shared) {
    return sanitizeHighlightDocument(
      shared.textbookRender.buildTextbookTrackDocument(track),
      track
    );
  }

  async normalizeSelector(track, selector, shared) {
    const dom = new JSDOM(`<body>${this.canonicalDocument(track, shared)}</body>`);
    try {
      const root = dom.window.document.body.firstElementChild;
      const resolved = shared.anchor.resolveAnchor(root, selector);
      if (!resolved.range) {
        throw annotationError('ANNOTATION_SELECTOR_ORPHANED', 409, {
          resolution: resolved.status,
        });
      }
      return shared.anchor.createAnchor(root, resolved.range);
    } finally {
      dom.window.close();
    }
  }

  buildCompatibilityProjection(track, annotations, shared) {
    const dom = new JSDOM(`<body>${this.canonicalDocument(track, shared)}</body>`);
    try {
      const root = dom.window.document.body.firstElementChild;
      const diagnostics = shared.annotationRender.applyAnnotations(root, annotations);
      return {
        htmlContent: sanitizeHighlightDocument(root.outerHTML, track),
        diagnostics,
      };
    } finally {
      dom.window.close();
    }
  }

  writeCompatibilityProjection(track, shared) {
    if (!this.compatWriteEnabled) return { written: false };
    const annotations = this.dbService.listCardAnnotations(
      'textbook_track',
      track.id,
      { statuses: ['active', 'orphaned'] }
    );
    const projection = this.buildCompatibilityProjection(track, annotations, shared);
    const identity = trackIdentity(track);
    const previous = this.dbService.getCardHighlightByFile(
      identity.folderName,
      identity.baseFilename,
      identity.sourceHash
    );
    const highlight = this.dbService.upsertCardHighlight({
      ...identity,
      generationId: Number(track.generation_id),
      htmlContent: projection.htmlContent,
      version: Math.max(2, Number(previous?.version || 1) + 1),
      updatedBy: 'annotation-compat:textbook',
    });
    return {
      written: true,
      highlightId: highlight.id,
      version: highlight.version,
      rendered: projection.diagnostics.filter((item) => item.status === 'rendered').length,
      orphaned: projection.diagnostics.filter((item) => item.status === 'orphaned').length,
    };
  }

  list(targetKind, targetId) {
    this.requireTrackTarget(targetKind, targetId);
    return this.annotationService.list(targetKind, targetId);
  }

  async create(payload = {}) {
    const track = this.requireTrackTarget(payload.targetKind, payload.targetId);
    const shared = await this.sharedModulesLoader();
    const normalizedSelector = await this.normalizeSelector(track, payload.selector, shared);
    const execute = this.dbService.db.transaction(() => {
      const annotation = this.annotationService.create({
        ...payload,
        selector: selectorPayload(normalizedSelector),
      });
      const compatibility = this.writeCompatibilityProjection(track, shared);
      return { annotation, compatibility };
    });
    return this.dbService.withBusyRetry(() => execute());
  }

  async update(id, payload = {}) {
    const current = this.annotationService.get(id);
    const track = this.requireTrackTarget(current.targetKind, current.targetId);
    const shared = await this.sharedModulesLoader();
    const execute = this.dbService.db.transaction(() => {
      const annotation = this.annotationService.update(id, payload);
      const compatibility = this.writeCompatibilityProjection(track, shared);
      return { annotation, compatibility };
    });
    return this.dbService.withBusyRetry(() => execute());
  }

  async remove(id, payload = {}) {
    const current = this.annotationService.get(id);
    const track = this.requireTrackTarget(current.targetKind, current.targetId);
    const shared = await this.sharedModulesLoader();
    const execute = this.dbService.db.transaction(() => {
      const annotation = this.annotationService.remove(id, payload);
      const compatibility = this.writeCompatibilityProjection(track, shared);
      return { annotation, compatibility };
    });
    return this.dbService.withBusyRetry(() => execute());
  }
}

module.exports = {
  TextbookAnnotationService,
  loadTextbookSharedModules,
};
