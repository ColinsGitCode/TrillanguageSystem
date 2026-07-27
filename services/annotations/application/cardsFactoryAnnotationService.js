'use strict';

const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const { AnnotationService } = require('../annotationService');
const { annotationError } = require('../annotationErrors');
const {
  loadSharedModules,
  renderCardMarkdown,
} = require('./buildAnnotationMigrationPlan');

function computeTextHash(input) {
  const text = String(input || '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function selectorPayload(selector) {
  return {
    projectionVersion: selector.projectionVersion,
    textQuote: {
      type: 'TextQuoteSelector',
      exact: selector.textQuote.exact,
      prefix: selector.textQuote.prefix || '',
      suffix: selector.textQuote.suffix || '',
    },
    textPosition: {
      type: 'TextPositionSelector',
      start: Number(selector.textPosition.start),
      end: Number(selector.textPosition.end),
    },
  };
}

class CardsFactoryAnnotationService {
  constructor({
    dbService,
    annotationService = null,
    compatWriteEnabled = true,
    sharedModulesLoader = loadSharedModules,
  } = {}) {
    if (!dbService) throw new TypeError('CardsFactoryAnnotationService requires dbService');
    this.dbService = dbService;
    this.annotationService = annotationService || new AnnotationService({ dbService });
    this.compatWriteEnabled = Boolean(compatWriteEnabled);
    this.sharedModulesLoader = sharedModulesLoader;
  }

  requireGenerationTarget(targetKind, targetId) {
    if (targetKind !== 'generation') {
      throw annotationError('ANNOTATION_CONSUMER_NOT_ENABLED', 409, {
        enabledConsumer: 'cards-factory',
      });
    }
    const generation = this.dbService.getGenerationById(targetId);
    if (!generation) throw annotationError('ANNOTATION_TARGET_NOT_FOUND', 404);
    return generation;
  }

  async normalizeSelector(generation, selector, shared) {
    const rendered = renderCardMarkdown(
      generation.markdown_content,
      generation.card_type,
      generation.folder_name,
      shared.transforms
    );
    const dom = new JSDOM(`<div id="__root">${rendered}</div>`);
    try {
      const root = dom.window.document.getElementById('__root');
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

  buildCompatibilityProjection(generation, annotations, shared) {
    const rendered = renderCardMarkdown(
      generation.markdown_content,
      generation.card_type,
      generation.folder_name,
      shared.transforms
    );
    const dom = new JSDOM(`<div id="__root">${rendered}</div>`);
    try {
      const root = dom.window.document.getElementById('__root');
      const diagnostics = shared.annotationRender.applyAnnotations(root, annotations);
      const renderer = root.firstElementChild;
      if (!renderer) throw annotationError('ANNOTATION_RENDER_FAILED', 500);

      const DOMPurify = createDOMPurify(dom.window);
      const htmlContent = DOMPurify.sanitize(renderer.outerHTML, {
        USE_PROFILES: { html: true },
        ADD_TAGS: shared.transforms.CARD_RENDER_ALLOWED_TAGS,
        ADD_ATTR: shared.transforms.CARD_RENDER_ALLOWED_ATTR,
        FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
        FORBID_ATTR: ['style'],
      });
      return { htmlContent, diagnostics };
    } finally {
      dom.window.close();
    }
  }

  writeCompatibilityProjection(generation, shared) {
    if (!this.compatWriteEnabled) return { written: false };
    const annotations = this.dbService.listCardAnnotations(
      'generation',
      generation.id,
      { statuses: ['active', 'orphaned'] }
    );
    const projection = this.buildCompatibilityProjection(generation, annotations, shared);
    const sourceHash = computeTextHash(generation.markdown_content);
    const previous = this.dbService.getCardHighlightByFile(
      generation.folder_name,
      generation.base_filename,
      sourceHash
    );
    const highlight = this.dbService.upsertCardHighlight({
      generationId: generation.id,
      folderName: generation.folder_name,
      baseFilename: generation.base_filename,
      sourceHash,
      htmlContent: projection.htmlContent,
      version: Math.max(2, Number(previous?.version || 1) + 1),
      updatedBy: 'annotation-compat',
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
    this.requireGenerationTarget(targetKind, targetId);
    return this.annotationService.list(targetKind, targetId);
  }

  async create(payload = {}) {
    const generation = this.requireGenerationTarget(payload.targetKind, payload.targetId);
    const shared = await this.sharedModulesLoader();
    const normalizedSelector = await this.normalizeSelector(generation, payload.selector, shared);
    const execute = this.dbService.db.transaction(() => {
      const annotation = this.annotationService.create({
        ...payload,
        selector: selectorPayload(normalizedSelector),
      });
      const compatibility = this.writeCompatibilityProjection(generation, shared);
      return { annotation, compatibility };
    });
    return this.dbService.withBusyRetry(() => execute());
  }

  async update(id, payload = {}) {
    const current = this.annotationService.get(id);
    const generation = this.requireGenerationTarget(current.targetKind, current.targetId);
    const shared = await this.sharedModulesLoader();
    const execute = this.dbService.db.transaction(() => {
      const annotation = this.annotationService.update(id, payload);
      const compatibility = this.writeCompatibilityProjection(generation, shared);
      return { annotation, compatibility };
    });
    return this.dbService.withBusyRetry(() => execute());
  }

  async remove(id, payload = {}) {
    const current = this.annotationService.get(id);
    const generation = this.requireGenerationTarget(current.targetKind, current.targetId);
    const shared = await this.sharedModulesLoader();
    const execute = this.dbService.db.transaction(() => {
      const annotation = this.annotationService.remove(id, payload);
      const compatibility = this.writeCompatibilityProjection(generation, shared);
      return { annotation, compatibility };
    });
    return this.dbService.withBusyRetry(() => execute());
  }
}

module.exports = {
  CardsFactoryAnnotationService,
  computeTextHash,
  selectorPayload,
};
