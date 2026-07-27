'use strict';

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
const annotationService = new AnnotationService({ dbService });
const cardsFactoryAnnotationService = new CardsFactoryAnnotationService({
  dbService,
  annotationService,
});
const textbookAnnotationService = new TextbookAnnotationService({
  dbService,
  annotationService,
});
const annotationConsumerService = new AnnotationConsumerService({
  annotationService,
  cardsFactoryAnnotationService,
  textbookAnnotationService,
});

module.exports = {
  annotationConsumerService,
  annotationService,
  cardsFactoryAnnotationService,
  textbookAnnotationService,
};
