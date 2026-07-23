'use strict';

const defaultDbService = require('../storage/databaseService');
const log = require('../../lib/logger').child({ module: 'textbook-operation' });
const { TEXTBOOK_WORK_PATH } = require('../../lib/serverConfig');
const { TextbookTtsService } = require('./textbookTtsService');
const { TextbookOperationExecutor } = require('./textbookOperationExecutor');
const { textbookError } = require('./textbookErrors');

class TextbookOperationService {
  constructor(options = {}) {
    this.dbService = options.dbService || defaultDbService;
    this.executor = options.executor || new TextbookOperationExecutor({
      dbService: this.dbService,
      ttsService: options.ttsService || new TextbookTtsService({
        dbService: this.dbService,
        workPath: options.workPath || TEXTBOOK_WORK_PATH,
      }),
      logger: options.logger || log,
    });
    this.active = new Map();
    this.accepting = true;
  }

  enqueue(trackId, payload) {
    const existing = this.dbService.getTextbookOperationByIdempotencyKey(payload?.idempotencyKey);
    if (existing) {
      return this.dbService.createTextbookOperation(trackId, payload);
    }
    if (payload?.kind === 'release') {
      const track = this.dbService.getTextbookTrack(trackId);
      if (!track) throw textbookError('TEXTBOOK_TRACK_NOT_FOUND', 404);
      const review = this.dbService.getTextbookReviewSummary(track.revision_id);
      if (!review.total || review.confirmed !== review.total) {
        throw textbookError('TEXTBOOK_REVIEW_INCOMPLETE', 409, {
          confirmed: review.confirmed,
          total: review.total,
        });
      }
      if (track.status !== 'verified') throw textbookError('TEXTBOOK_TRACK_NOT_VERIFIED', 409);
      const preview = this.dbService.previewTextbookPublish(trackId);
      const currentPreviewRevision = `${track.revision_id}:${preview.planRevision}`;
      if (String(payload.previewRevision || '') !== currentPreviewRevision) {
        throw textbookError('TEXTBOOK_PREVIEW_REVISION_CONFLICT', 409, {
          expected: currentPreviewRevision,
        });
      }
    }
    const operation = this.dbService.createTextbookOperation(trackId, payload);
    this.schedule(operation.id);
    return operation;
  }

  schedule(operationId) {
    if (!this.accepting || this.active.has(Number(operationId))) return;
    const promise = Promise.resolve()
      .then(() => this.executor.execute(Number(operationId)))
      .finally(() => this.active.delete(Number(operationId)));
    this.active.set(Number(operationId), promise);
  }

  bootstrap() {
    this.accepting = true;
    this.dbService.recoverTextbookOperations();
    for (const operationId of this.dbService.listQueuedTextbookOperationIds()) {
      this.schedule(operationId);
    }
  }

  retry(operationId) {
    const operation = this.dbService.retryTextbookOperation(operationId);
    this.schedule(operation.id);
    return operation;
  }

  async shutdown({ timeoutMs = 30_000 } = {}) {
    this.accepting = false;
    const pending = Promise.allSettled([...this.active.values()]);
    let timer;
    const completed = await Promise.race([
      pending.then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
    if (timer) clearTimeout(timer);
    return {
      drained: completed,
      currentJobId: completed ? null : [...this.active.keys()][0] || null,
    };
  }
}

const textbookOperationService = new TextbookOperationService();

module.exports = textbookOperationService;
module.exports.TextbookOperationService = TextbookOperationService;
