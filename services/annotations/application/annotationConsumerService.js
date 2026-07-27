'use strict';

const { annotationError } = require('../annotationErrors');

class AnnotationConsumerService {
  constructor({
    annotationService,
    cardsFactoryAnnotationService,
    textbookAnnotationService,
  } = {}) {
    if (!annotationService) throw new TypeError('AnnotationConsumerService requires annotationService');
    this.annotationService = annotationService;
    this.consumers = new Map([
      ['generation', cardsFactoryAnnotationService],
      ['textbook_track', textbookAnnotationService],
    ]);
  }

  consumer(targetKind) {
    const service = this.consumers.get(targetKind);
    if (!service) {
      throw annotationError('ANNOTATION_CONSUMER_NOT_ENABLED', 409, {
        enabledConsumers: [...this.consumers.keys()],
      });
    }
    return service;
  }

  list(targetKind, targetId) {
    return this.consumer(targetKind).list(targetKind, targetId);
  }

  create(payload = {}) {
    return this.consumer(payload.targetKind).create(payload);
  }

  update(id, payload = {}) {
    const current = this.annotationService.get(id);
    return this.consumer(current.targetKind).update(id, payload);
  }

  remove(id, payload = {}) {
    const current = this.annotationService.get(id);
    return this.consumer(current.targetKind).remove(id, payload);
  }
}

module.exports = { AnnotationConsumerService };
