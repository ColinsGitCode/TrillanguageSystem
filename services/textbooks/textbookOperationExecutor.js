'use strict';

function cancellationError() {
  const error = new Error('textbook operation cancelled');
  error.name = 'AbortError';
  error.code = 'TEXTBOOK_OPERATION_CANCELLED';
  return error;
}

function throwIfCancelled(signal) {
  if (signal?.aborted) throw cancellationError();
}

class TextbookOperationExecutor {
  constructor({ dbService, ttsService, logger }) {
    this.dbService = dbService;
    this.ttsService = ttsService;
    this.logger = logger;
  }

  async runStep(operationId, step, handler, signal) {
    throwIfCancelled(signal);
    const operation = this.dbService.getTextbookOperation(operationId);
    if (operation?.result?.steps?.[step]?.status === 'succeeded') {
      return operation.result.steps[step].result || null;
    }
    this.dbService.updateTextbookOperationStep(operationId, step, 'running', {
      publicSummary: `${step} 正在执行`,
    });
    try {
      const result = await handler();
      throwIfCancelled(signal);
      this.dbService.updateTextbookOperationStep(operationId, step, 'succeeded', {
        publicSummary: `${step} 已完成`,
        result,
      });
      return result;
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') {
        this.dbService.updateTextbookOperationStep(operationId, step, 'cancelled', {
          publicSummary: `${step} 已停止`,
          errorCode: 'TEXTBOOK_OPERATION_CANCELLED',
          retryable: true,
        });
        throw cancellationError();
      }
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

  async execute(operationId, options = {}) {
    const { signal } = options;
    const operation = this.dbService.claimTextbookOperation(operationId);
    if (!operation) return this.dbService.getTextbookOperation(operationId);
    if (operation.result?.cancelRequested || signal?.aborted) {
      return this.dbService.finishTextbookOperation(operationId, 'cancelled', {
        publicSummary: '任务已取消，已完成步骤仍然保留',
        result: { cancelRequested: true },
      });
    }
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
        ), signal);
        await this.runStep(operationId, 'materialize', () => ({
          unitCount: published?.unitCount || command.confirmUnitCount,
          itemActions: published?.itemActions || null,
        }), signal);
        if (command.includeTts !== false) {
          try {
            await this.runStep(operationId, 'tts', () => this.generateTrackAudio(operation.track_id, {
              force: Boolean(command.forceTts),
              signal,
            }), signal);
          } catch (error) {
            if (signal?.aborted || error?.name === 'AbortError') throw error;
            return this.dbService.finishTextbookOperation(operationId, 'partially_failed', {
              publicSummary: '教材已发布，单句语音部分失败',
              errorCode: error.code || 'TEXTBOOK_TTS_FAILED',
              result: { published: true },
            });
          }
        }
        await this.runStep(operationId, 'sync', () => ({ queuedByPublish: true }), signal);
      } else if (operation.kind === 'tts') {
        await this.runStep(operationId, 'tts', () => this.generateTrackAudio(operation.track_id, {
          force: Boolean(command.force),
          signal,
        }), signal);
      } else {
        await this.runStep(operationId, 'sync', () => ({ accepted: true }), signal);
      }
      return this.dbService.finishTextbookOperation(operationId, 'succeeded', {
        publicSummary: operation.kind === 'release' ? '教材已发布并完成后台处理' : '后台处理完成',
        result: { published: Boolean(published) },
      });
    } catch (error) {
      if (
        signal?.aborted
        || error?.name === 'AbortError'
        || this.dbService.isTextbookOperationCancellationRequested?.(operationId)
      ) {
        return this.dbService.finishTextbookOperation(operationId, 'cancelled', {
          publicSummary: '任务已取消，已完成步骤仍然保留',
          errorCode: 'TEXTBOOK_OPERATION_CANCELLED',
          result: { cancelRequested: true },
        });
      }
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
  cancellationError,
};
