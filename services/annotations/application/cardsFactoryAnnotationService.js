'use strict';

const { JSDOM } = require('jsdom');
const { AnnotationService } = require('../annotationService');
const { annotationError } = require('../annotationErrors');
const {
  loadSharedModules,
  renderCardMarkdown,
} = require('./buildAnnotationMigrationPlan');

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
    sharedModulesLoader = loadSharedModules,
  } = {}) {
    if (!dbService) throw new TypeError('CardsFactoryAnnotationService requires dbService');
    this.dbService = dbService;
    this.annotationService = annotationService || new AnnotationService({ dbService });
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

  list(targetKind, targetId) {
    this.requireGenerationTarget(targetKind, targetId);
    return this.annotationService.list(targetKind, targetId);
  }

  async create(payload = {}) {
    const generation = this.requireGenerationTarget(payload.targetKind, payload.targetId);
    const shared = await this.sharedModulesLoader();
    const normalizedSelector = await this.normalizeSelector(generation, payload.selector, shared);
    const annotation = this.annotationService.create({
      ...payload,
      selector: selectorPayload(normalizedSelector),
    });
    return { annotation };
  }

  async update(id, payload = {}) {
    const current = this.annotationService.get(id);
    this.requireGenerationTarget(current.targetKind, current.targetId);
    return { annotation: this.annotationService.update(id, payload) };
  }

  async remove(id, payload = {}) {
    const current = this.annotationService.get(id);
    this.requireGenerationTarget(current.targetKind, current.targetId);
    return { annotation: this.annotationService.remove(id, payload) };
  }
}

module.exports = {
  CardsFactoryAnnotationService,
  selectorPayload,
};
