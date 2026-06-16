'use strict';

const {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_DEEPSEEK_TIMEOUT_MS,
  DEFAULT_DEEPSEEK_THINKING,
  resolveDeepSeekModel,
  normalizeDeepSeekThinking,
} = require('../../lib/serverConfig');
const {
  CODES,
  codedError,
  codeForHttpStatus,
} = require('./llmErrors');

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function resolveApiKey(options = {}) {
  const apiKey = String(options.apiKey || process.env.DEEPSEEK_API_KEY || '').trim();
  if (!apiKey) {
    throw codedError(CODES.CONFIG_ERROR, 'DeepSeek API key is not configured');
  }
  return apiKey;
}

function resolveBaseUrl(options = {}) {
  return trimTrailingSlash(options.baseUrl || process.env.DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL);
}

function normalizeUsage(usage = {}) {
  const input = Number(usage.prompt_tokens ?? usage.input_tokens ?? usage.input ?? 0) || 0;
  const output = Number(usage.completion_tokens ?? usage.output_tokens ?? usage.output ?? 0) || 0;
  const total = Number(usage.total_tokens ?? usage.total ?? input + output) || 0;
  return { input, output, total };
}

function extractErrorMessage(payload, fallback = 'DeepSeek provider request failed') {
  if (!payload) return fallback;
  if (typeof payload === 'string') return payload || fallback;
  return payload.error?.message
    || payload.error?.msg
    || payload.message
    || payload.msg
    || fallback;
}

function buildRequestBody(prompt, options = {}) {
  const body = {
    model: resolveDeepSeekModel(options.model || DEFAULT_DEEPSEEK_MODEL),
    messages: [{ role: 'user', content: String(prompt || '') }],
    stream: false,
    thinking: { type: normalizeDeepSeekThinking(options.thinking || DEFAULT_DEEPSEEK_THINKING) },
  };

  if (options.responseFormat === 'json') {
    body.response_format = { type: 'json_object' };
  }

  return body;
}

function parseJsonText(text, status) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (err) {
    if (status >= 200 && status < 300) {
      throw codedError(CODES.INVALID_RESPONSE, `DeepSeek returned invalid JSON: ${err.message}`);
    }
    return { message: text };
  }
}

function isAbortError(err) {
  return err?.name === 'AbortError';
}

async function chatCompletion(prompt, options = {}) {
  const apiKey = resolveApiKey(options);
  const baseUrl = resolveBaseUrl(options);
  const timeoutMs = Number(options.timeoutMs || DEFAULT_DEEPSEEK_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let responseText;
  let payload;
  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(buildRequestBody(prompt, options)),
      signal: controller.signal,
    });
    responseText = await response.text();
    payload = parseJsonText(responseText, response.status);
  } catch (err) {
    if (isAbortError(err)) {
      throw codedError(CODES.TIMEOUT, `DeepSeek request timed out after ${timeoutMs}ms`);
    }
    if (err?.code) throw err;
    throw codedError(CODES.UNAVAILABLE, `DeepSeek request failed: ${err.message || err}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const code = codeForHttpStatus(response.status);
    throw codedError(code, extractErrorMessage(payload, `DeepSeek provider returned HTTP ${response.status}`), {
      status: response.status,
      body: payload,
    });
  }

  const content = payload?.choices?.[0]?.message?.content;
  const text = typeof content === 'string' ? content : '';
  if (!text.trim()) {
    throw codedError(CODES.EMPTY_RESPONSE, 'DeepSeek returned an empty response');
  }

  return {
    text,
    rawOutput: text,
    model: payload.model || buildRequestBody(prompt, options).model,
    usage: normalizeUsage(payload.usage),
    finishReason: payload?.choices?.[0]?.finish_reason || null,
    payload,
  };
}

async function generateMarkdown(prompt, options = {}) {
  const result = await chatCompletion(prompt, { ...options, responseFormat: undefined });
  return {
    markdown: result.text,
    rawOutput: result.rawOutput,
    model: result.model,
    usage: result.usage,
    finishReason: result.finishReason,
  };
}

async function generateJson(prompt, options = {}) {
  const result = await chatCompletion(prompt, { ...options, responseFormat: 'json' });
  return {
    text: result.text,
    rawOutput: result.rawOutput,
    model: result.model,
    usage: result.usage,
    finishReason: result.finishReason,
  };
}

module.exports = {
  chatCompletion,
  generateMarkdown,
  generateJson,
  _internal: {
    buildRequestBody,
    normalizeUsage,
    resolveBaseUrl,
    resolveApiKey,
    extractErrorMessage,
  },
};
