'use strict';

class TextbookOperationExecutor {
  constructor({ dbService, ttsService, logger }) {
    this.dbService = dbService;
    this.ttsService = ttsService;
    this.logger = logger;
  }

  async runStep(operationId, step, handler) {
    const operation = this.dbService.getTextbookOperation(operationId);
    if (operation?.result?.steps?.[step]?.status === 'succeeded') {
      return operation.result.steps[step].result || null;
    }
    this.dbService.updateTextbookOperationStep(operationId, step, 'running', {
      publicSummary: `${step} 正在执行`,
    });
    try {
      const result = await handler();
      this.dbService.updateTextbookOperationStep(operationId, step, 'succeeded', {
        publicSummary: `${step} 已完成`,
        result,
      });
      return result;
    } catch (error) {
      this.dbService.updateTextbookOperationStep(operationId, step, 'failed', {
        publicSummary: `${step} 失败`,
        errorCode: error.code || 'TEXTBOOK_OPERATION_STEP_FAILED',
        retryable: true,
      });
      throw error;
    }
  }

  async generateTrackAudio(trackId, options) {
    const result = await this.ttsService.generateTrack(trackId, options);
    if (Number(result?.summary?.failed || 0) > 0) {
      const error = new Error(`${result.summary.failed} textbook TTS tasks failed`);
      error.code = 'TEXTBOOK_TTS_PARTIAL_FAILURE';
      throw error;
    }
    return result;
  }

  async execute(operationId) {
    const operation = this.dbService.claimTextbookOperation(operationId);
    if (!operation) return this.dbService.getTextbookOperation(operationId);
    const command = operation.result?.command || {};
    let published = null;
    try {
      if (operation.kind === 'release') {
        published = await this.runStep(operationId, 'publish', () => (
          this.dbService.publishTextbookTrack(operation.track_id, {
            expectedTrackRevision: command.expectedTrackRevision,
            confirmUnitCount: command.confirmUnitCount,
            expectedPlanRevision: command.expectedPlanRevision,
          })
        ));
        await this.runStep(operationId, 'materialize', () => ({
          unitCount: published?.unitCount || command.confirmUnitCount,
          itemActions: published?.itemActions || null,
        }));
        if (command.includeTts !== false) {
          try {
            await this.runStep(operationId, 'tts', () => this.generateTrackAudio(operation.track_id, {
              force: Boolean(command.forceTts),
            }));
          } catch (error) {
            return this.dbService.finishTextbookOperation(operationId, 'partially_failed', {
              publicSummary: '教材已发布，单句语音部分失败',
              errorCode: error.code || 'TEXTBOOK_TTS_FAILED',
              result: { published: true },
            });
          }
        }
        await this.runStep(operationId, 'sync', () => ({ queuedByPublish: true }));
      } else if (operation.kind === 'tts') {
        await this.runStep(operationId, 'tts', () => this.generateTrackAudio(operation.track_id, {
          force: Boolean(command.force),
        }));
      } else {
        await this.runStep(operationId, 'sync', () => ({ accepted: true }));
      }
      return this.dbService.finishTextbookOperation(operationId, 'succeeded', {
        publicSummary: operation.kind === 'release' ? '教材已发布并完成后台处理' : '后台处理完成',
        result: { published: Boolean(published) },
      });
    } catch (error) {
      this.logger?.error?.({ err: error, operationId }, 'textbook operation failed');
      return this.dbService.finishTextbookOperation(operationId, 'failed', {
        publicSummary: error.message || '后台处理失败',
        errorCode: error.code || 'TEXTBOOK_OPERATION_FAILED',
      });
    }
  }
}

module.exports = {
  TextbookOperationExecutor,
};
