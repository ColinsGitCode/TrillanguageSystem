'use strict';

const crypto = require('node:crypto');
const {
  SELECTION_TTS_CACHE_MAX_BYTES,
  SELECTION_TTS_CACHE_PATH,
  SELECTION_TTS_CACHE_TTL_HOURS,
  SELECTION_TTS_ENABLED,
  SELECTION_TTS_MAX_CHARS,
  SELECTION_TTS_MAX_CONCURRENCY,
  SELECTION_TTS_MAX_RESPONSE_BYTES,
  SELECTION_TTS_TIMEOUT_MS,
} = require('../../lib/serverConfig');
const ttsService = require('../generation/ttsService');
const { SelectionTtsCache } = require('./selectionTtsCache');
const { SelectionTtsError, selectionTtsError } = require('./selectionTtsErrors');

const ALLOWED_SPEEDS = new Set([0.8, 1, 1.2]);
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu;
const MARKUP = /<[^>]*>/u;

function normalizeSelectionText(value) {
  return String(value || '')
    .replace(CONTROL_CHARACTERS, '')
    .trim()
    .replace(/\s+/gu, ' ');
}

function abortError() {
  return selectionTtsError('SELECTION_TTS_ABORTED', '发音请求已取消', 499);
}

function waitForRecord(record, signal) {
  record.subscribers += 1;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      record.subscribers -= 1;
      if (!record.settled && record.subscribers === 0) record.controller.abort();
      callback(value);
    };
    const onAbort = () => finish(reject, abortError());
    record.promise.then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error)
    );
    if (signal?.aborted) {
      finish(reject, abortError());
      return;
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

class SelectionTtsService {
  constructor(options = {}) {
    this.enabled = options.enabled ?? SELECTION_TTS_ENABLED;
    this.maxChars = options.maxChars || SELECTION_TTS_MAX_CHARS;
    this.timeoutMs = options.timeoutMs || SELECTION_TTS_TIMEOUT_MS;
    this.maxConcurrency = options.maxConcurrency || SELECTION_TTS_MAX_CONCURRENCY;
    this.maxResponseBytes = options.maxResponseBytes || SELECTION_TTS_MAX_RESPONSE_BYTES;
    this.synthesizeSpeech = options.synthesizeSpeech || ttsService.synthesizeSpeech;
    this.getSynthesisIdentity = options.getSynthesisIdentity || ttsService.getSynthesisIdentity;
    this.cache = options.cache || new SelectionTtsCache({
      rootPath: options.cachePath || SELECTION_TTS_CACHE_PATH,
      ttlMs: (options.cacheTtlHours || SELECTION_TTS_CACHE_TTL_HOURS) * 60 * 60 * 1000,
      maxBytes: options.cacheMaxBytes || SELECTION_TTS_CACHE_MAX_BYTES,
    });
    this.active = 0;
    this.inFlight = new Map();
  }

  publicConfig() {
    return {
      enabled: this.enabled,
      languages: ['en', 'ja'],
      speeds: [...ALLOWED_SPEEDS],
      maxChars: this.maxChars,
    };
  }

  validate(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw selectionTtsError('SELECTION_TTS_INVALID_INPUT', '请求内容无效', 400);
    }
    if (typeof payload.text !== 'string') {
      throw selectionTtsError('SELECTION_TTS_INVALID_INPUT', 'text 必须是字符串', 400);
    }
    const text = normalizeSelectionText(payload.text);
    if (!text || MARKUP.test(text)) {
      throw selectionTtsError('SELECTION_TTS_INVALID_INPUT', '请选择纯文本内容', 400);
    }
    const length = Array.from(text).length;
    if (length > this.maxChars) {
      throw selectionTtsError('SELECTION_TTS_TEXT_TOO_LONG', `选区不能超过 ${this.maxChars} 个字符`, 413);
    }
    const language = String(payload.language || '').trim().toLowerCase();
    if (!['en', 'ja'].includes(language)) {
      throw selectionTtsError('SELECTION_TTS_INVALID_INPUT', 'language 仅支持 en 或 ja', 400);
    }
    const speed = Number(payload.speed);
    if (!ALLOWED_SPEEDS.has(speed)) {
      throw selectionTtsError('SELECTION_TTS_INVALID_INPUT', 'speed 仅支持 0.8、1.0 或 1.2', 400);
    }
    return { text, language, speed, length };
  }

  cacheKey(input) {
    const identity = this.getSynthesisIdentity(input);
    return {
      identity,
      key: crypto.createHash('sha256').update(JSON.stringify({
        version: 'selection-tts-v1',
        text: input.text,
        language: input.language,
        speed: input.speed,
        identity,
      })).digest('hex'),
    };
  }

  async synthesize(payload, options = {}) {
    if (!this.enabled) {
      throw selectionTtsError('SELECTION_TTS_DISABLED', '朗读选区功能未开启', 404);
    }
    const input = this.validate(payload);
    const { identity, key } = this.cacheKey(input);
    const cached = await this.cache.get(key);
    if (cached) {
      if (Buffer.isBuffer(cached.buffer) && cached.buffer.length <= this.maxResponseBytes) {
        return {
          buffer: cached.buffer,
          ...cached.metadata,
          cacheStatus: 'HIT',
          characterCount: input.length,
        };
      }
      await this.cache.remove?.(key);
    }

    const existing = this.inFlight.get(key);
    if (existing) return waitForRecord(existing, options.signal);
    if (this.active >= this.maxConcurrency) {
      throw selectionTtsError('SELECTION_TTS_BUSY', '发音服务正忙，请稍后重试', 429);
    }

    const controller = new AbortController();
    const record = {
      controller,
      subscribers: 0,
      settled: false,
      promise: null,
    };
    this.active += 1;
    record.promise = this.#generate(input, identity, key, controller)
      .finally(() => {
        record.settled = true;
        this.active -= 1;
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, record);
    return waitForRecord(record, options.signal);
  }

  async #generate(input, identity, key, controller) {
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      const result = await this.synthesizeSpeech(input, {
        requestClass: 'interactive',
        signal: controller.signal,
      });
      if (!Buffer.isBuffer(result.buffer) || result.buffer.length === 0) {
        throw selectionTtsError('SELECTION_TTS_PROVIDER_FAILED', '发音服务返回了空音频', 502);
      }
      if (result.buffer.length > this.maxResponseBytes) {
        throw selectionTtsError('SELECTION_TTS_PROVIDER_FAILED', '发音结果超过安全大小限制', 502);
      }
      const metadata = {
        contentType: result.contentType || (identity.format === 'mp3' ? 'audio/mpeg' : 'audio/wav'),
        ttsProvider: result.ttsProvider || identity.provider,
        ttsModel: result.ttsModel || identity.model,
        ttsVoice: result.ttsVoice || identity.voice,
        queueWaitMs: Number(result.queueWaitMs) || 0,
        contended: Boolean(result.contended),
      };
      const stored = await this.cache.set(key, result.buffer, metadata);
      return {
        buffer: result.buffer,
        ...metadata,
        cacheStatus: stored ? 'MISS' : 'BYPASS',
        characterCount: input.length,
      };
    } catch (error) {
      if (error instanceof SelectionTtsError) throw error;
      if (timedOut) {
        throw selectionTtsError('SELECTION_TTS_TIMEOUT', '发音生成超时，请重试', 504);
      }
      if (error?.name === 'AbortError' || error?.code === 'TTS_REQUEST_ABORTED') throw abortError();
      throw selectionTtsError('SELECTION_TTS_PROVIDER_FAILED', '发音服务暂时不可用', 502);
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = {
  ALLOWED_SPEEDS,
  SelectionTtsService,
  normalizeSelectionText,
};
