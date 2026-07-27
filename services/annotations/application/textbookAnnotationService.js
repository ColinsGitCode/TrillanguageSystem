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
  expressionFragmentsFromDocument,
  sanitizeHighlightDocument,
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
    sharedModulesLoader = loadTextbookSharedModules,
  } = {}) {
    if (!dbService) throw new TypeError('TextbookAnnotationService requires dbService');
    this.dbService = dbService;
    this.annotationService = annotationService || new AnnotationService({ dbService });
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

  buildAnnotationProjection(track, annotations, shared) {
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

  list(targetKind, targetId) {
    this.requireTrackTarget(targetKind, targetId);
    return this.annotationService.list(targetKind, targetId);
  }

  async expressionProjection(trackId, expressionRevisionId) {
    const track = this.requireTrackTarget('textbook_track', trackId);
    const expression = track.expressions.find(
      (candidate) => Number(candidate.id) === Number(expressionRevisionId)
    );
    if (!expression) {
      throw annotationError('ANNOTATION_TARGET_REVISION_UNAVAILABLE', 409, {
        expressionRevisionId: Number(expressionRevisionId),
      });
    }
    const shared = await this.sharedModulesLoader();
    const { target, annotations } = this.annotationService.list('textbook_track', track.id);
    const projection = this.buildAnnotationProjection(track, annotations, shared);
    const fragments = expressionFragmentsFromDocument(
      projection.htmlContent,
      expression.expression_id
    );
    if (!fragments) {
      throw annotationError('ANNOTATION_TARGET_REVISION_UNAVAILABLE', 409, {
        expressionRevisionId: Number(expressionRevisionId),
      });
    }
    return {
      target,
      fragments,
      diagnostics: projection.diagnostics,
    };
  }

  async create(payload = {}) {
    const track = this.requireTrackTarget(payload.targetKind, payload.targetId);
    const shared = await this.sharedModulesLoader();
    const normalizedSelector = await this.normalizeSelector(track, payload.selector, shared);
    const annotation = this.annotationService.create({
      ...payload,
      selector: selectorPayload(normalizedSelector),
    });
    return { annotation };
  }

  async update(id, payload = {}) {
    const current = this.annotationService.get(id);
    this.requireTrackTarget(current.targetKind, current.targetId);
    return { annotation: this.annotationService.update(id, payload) };
  }

  async remove(id, payload = {}) {
    const current = this.annotationService.get(id);
    this.requireTrackTarget(current.targetKind, current.targetId);
    return { annotation: this.annotationService.remove(id, payload) };
  }
}

module.exports = {
  TextbookAnnotationService,
  loadTextbookSharedModules,
};
