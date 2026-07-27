'use strict';

const log = require('../../lib/logger').child({ module: 'annotations/shadow-read' });
const {
  CARD_ANNOTATIONS_COMPAT_WRITE_ENABLED,
  CARD_ANNOTATIONS_SHADOW_READ_ENABLED,
} = require('../../lib/serverConfig');
const dbService = require('../storage/databaseService');
const { AnnotationService } = require('./annotationService');
const {
  CardsFactoryAnnotationService,
} = require('./application/cardsFactoryAnnotationService');
const {
  TextbookAnnotationService,
} = require('./application/textbookAnnotationService');
const {
  AnnotationConsumerService,
} = require('./application/annotationConsumerService');
const {
  AnnotationShadowReadService,
} = require('./application/annotationShadowReadService');

const annotationShadowReadService = new AnnotationShadowReadService({
  dbService,
  enabled: CARD_ANNOTATIONS_SHADOW_READ_ENABLED,
  logger: log,
});
const annotationService = new AnnotationService({ dbService });
const cardsFactoryAnnotationService = new CardsFactoryAnnotationService({
  dbService,
  annotationService,
  compatWriteEnabled: CARD_ANNOTATIONS_COMPAT_WRITE_ENABLED,
});
const textbookAnnotationService = new TextbookAnnotationService({
  dbService,
  annotationService,
  compatWriteEnabled: CARD_ANNOTATIONS_COMPAT_WRITE_ENABLED,
});
const annotationConsumerService = new AnnotationConsumerService({
  annotationService,
  cardsFactoryAnnotationService,
  textbookAnnotationService,
});

module.exports = {
  annotationConsumerService,
  annotationService,
  annotationShadowReadService,
  cardsFactoryAnnotationService,
  textbookAnnotationService,
};
