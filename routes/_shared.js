'use strict';

// Compatibility exports shared by the remaining HTTP adapters. Application
// orchestration imports its ports directly instead of depending on this file.

const tesseractOcrService = require('../services/ocr/tesseractOcrService');
const { deleteRecordFiles } = require('../services/storage/fileManager');
const generationJobService = require('../services/generation/generationJobService');
const { HealthCheckService } = require('../services/observability/healthCheckService');
const dbService = require('../services/storage/databaseService');
const serverConfig = require('../lib/serverConfig');
const { checkGenerateThrottle } = require('../lib/throttle');
const { resetE2EFixtures } = require('../lib/e2eFixtures');
const { createDeleteCardUseCase } = require('../services/application/deleteCard');
const log = require('../lib/logger').child({ module: 'app/delete-card' });

const deleteCard = createDeleteCardUseCase({
  getGenerationById: (id) => dbService.getGenerationById(id),
  deleteGenerationWithLearningState: (id) => dbService.deleteGenerationWithLearningState(id),
  deleteRecordFiles,
  log,
});

module.exports = {
  tesseractOcrService,
  deleteRecordFiles,
  generationJobService,
  HealthCheckService,
  dbService,
  RECORDS_PATH: serverConfig.RECORDS_PATH,
  E2E_TEST_MODE: serverConfig.E2E_TEST_MODE,
  normalizeCardType: serverConfig.normalizeCardType,
  checkGenerateThrottle,
  resetE2EFixtures,
  deleteCard,
};
