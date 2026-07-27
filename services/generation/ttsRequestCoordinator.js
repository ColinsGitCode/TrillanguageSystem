'use strict';

function abortError() {
  const error = new Error('TTS request aborted');
  error.name = 'AbortError';
  error.code = 'TTS_REQUEST_ABORTED';
  return error;
}

class TtsRequestCoordinator {
  constructor(options = {}) {
    this.maxConcurrency = Math.max(1, Number(options.maxConcurrency) || 2);
    this.batchStarvationMs = Math.max(100, Number(options.batchStarvationMs) || 5000);
    this.clock = options.clock || Date.now;
    this.active = 0;
    this.sequence = 0;
    this.interactiveQueue = [];
    this.batchQueue = [];
  }

  run(operation, options = {}) {
    if (typeof operation !== 'function') {
      return Promise.reject(new TypeError('TTS coordinator requires an operation'));
    }
    const requestClass = options.requestClass === 'interactive' ? 'interactive' : 'batch';
    const signal = options.signal;
    if (signal?.aborted) return Promise.reject(abortError());

    return new Promise((resolve, reject) => {
      const entry = {
        id: ++this.sequence,
        operation,
        requestClass,
        signal,
        enqueuedAt: this.clock(),
        resolve,
        reject,
        abortListener: null,
      };
      if (signal) {
        entry.abortListener = () => {
          const queue = requestClass === 'interactive' ? this.interactiveQueue : this.batchQueue;
          const index = queue.indexOf(entry);
          if (index >= 0) {
            queue.splice(index, 1);
            reject(abortError());
          }
        };
        signal.addEventListener('abort', entry.abortListener, { once: true });
      }
      const queue = requestClass === 'interactive' ? this.interactiveQueue : this.batchQueue;
      queue.push(entry);
      this.#drain();
    });
  }

  snapshot() {
    return {
      active: this.active,
      interactiveQueued: this.interactiveQueue.length,
      batchQueued: this.batchQueue.length,
      maxConcurrency: this.maxConcurrency,
      batchStarvationMs: this.batchStarvationMs,
    };
  }

  #takeNext() {
    const oldestBatch = this.batchQueue[0];
    const batchStarved = oldestBatch
      && (this.clock() - oldestBatch.enqueuedAt >= this.batchStarvationMs);
    if (batchStarved || !this.interactiveQueue.length) return this.batchQueue.shift();
    return this.interactiveQueue.shift();
  }

  #drain() {
    while (this.active < this.maxConcurrency) {
      const entry = this.#takeNext();
      if (!entry) return;
      if (entry.signal?.aborted) {
        entry.reject(abortError());
        continue;
      }
      if (entry.abortListener) {
        entry.signal.removeEventListener('abort', entry.abortListener);
      }
      const queueWaitMs = Math.max(0, this.clock() - entry.enqueuedAt);
      const contended = queueWaitMs > 0
        || this.active > 0
        || this.interactiveQueue.length > 0
        || this.batchQueue.length > 0;
      this.active += 1;
      Promise.resolve()
        .then(() => entry.operation({ queueWaitMs, contended }))
        .then(entry.resolve, entry.reject)
        .finally(() => {
          this.active -= 1;
          this.#drain();
        });
    }
  }
}

let sharedCoordinator;

function getSharedTtsCoordinator() {
  if (!sharedCoordinator) {
    sharedCoordinator = new TtsRequestCoordinator({
      maxConcurrency: process.env.TTS_SHARED_MAX_CONCURRENCY || 2,
      batchStarvationMs: process.env.TTS_BATCH_STARVATION_MS || 5000,
    });
  }
  return sharedCoordinator;
}

function resetSharedTtsCoordinatorForTests() {
  sharedCoordinator = null;
}

module.exports = {
  TtsRequestCoordinator,
  getSharedTtsCoordinator,
  resetSharedTtsCoordinatorForTests,
};
