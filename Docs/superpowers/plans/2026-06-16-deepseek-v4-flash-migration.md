# DeepSeek V4 Flash Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Gemini runtime chain and make DeepSeek V4 Flash the only LLM provider used by card generation and knowledge LLM fallback tasks.

**Architecture:** Keep the existing queue, `/api/generate`, Markdown rendering, TTS, file saving, and database persistence flow. Replace the provider execution segment with one `deepseekService` built on DeepSeek's OpenAI-compatible `/chat/completions` API, then remove Gemini-specific routes, containers, frontend setup UX, tests, package dependencies, and docs.

**Tech Stack:** Node.js, Express, built-in `fetch`, better-sqlite3, vanilla ES modules, Playwright, Docker Compose.

---

## Source References

- DeepSeek quick start: <https://api-docs.deepseek.com/>
- DeepSeek chat completions API: <https://api-docs.deepseek.com/api/create-chat-completion>
- DeepSeek models and pricing: <https://api-docs.deepseek.com/quick_start/pricing>
- Approved spec: `Docs/superpowers/specs/2026-06-16-deepseek-v4-flash-migration-design.md`

## File Structure

- Create: `services/llm/llmErrors.js`
  - Provider-neutral structured error codes used by generation queue retry classification and DeepSeek calls.
- Create: `services/llm/deepseekService.js`
  - DeepSeek HTTP client, request body construction, timeout handling, response parsing, and error mapping.
- Create: `tests/unit/llmErrors.test.js`
  - Replaces Gemini-specific error helper tests.
- Create: `tests/unit/deepseekService.test.js`
  - Tests request construction and provider error mapping with mocked `fetch`.
- Modify: `lib/serverConfig.js`
  - DeepSeek defaults, model resolution, provider normalization, and removal of Gemini model helpers.
- Modify: `tests/unit/serverConfig.test.js`
  - DeepSeek config expectations.
- Modify: `lib/generationHelpers.js`
  - Rename Gemini-specific sanitized response helpers to provider-neutral helpers.
- Modify: `tests/unit/generationHelpers.test.js`
  - Provider-neutral validation helper tests.
- Modify: `services/generation/cardGenerationService.js`
  - Replace Gemini CLI/proxy/local generation branches with DeepSeek Markdown generation.
- Modify: `routes/_shared.js`
  - Remove Gemini service exports and expose DeepSeek config.
- Modify: `routes/generate.js`
  - Request DeepSeek and persist DeepSeek metadata.
- Modify: `routes/generationJobs.js`
  - Enqueue DeepSeek jobs by default.
- Modify: `server.js`
  - Worker HTTP payload sends DeepSeek metadata.
- Modify: `lib/e2eFixtures.js`
  - E2E fixture provider and backoff messages become DeepSeek-shaped.
- Modify: `services/storage/databaseService.js`
  - New schema/default rows use `deepseek`.
- Modify: `services/storage/db/generationJobs.js`
  - Queue row defaults use `deepseek`.
- Modify: `routes/testReset.js`
  - Test fixture rows use DeepSeek metadata.
- Modify: `services/observability/healthCheckService.js`
  - Replace Gemini gateway/executor/API checks with DeepSeek API checks.
- Modify: `routes/health.js`
  - Remove Gemini auth endpoints.
- Modify: `tests/integration/health.test.js`
  - DeepSeek health and removed Gemini route assertions.
- Modify: `services/knowledge/tasks/cluster.js`
  - Replace Gemini fallback invocation with DeepSeek JSON invocation.
- Modify: `services/knowledge/tasks/synonymBoundary.js`
  - Replace Gemini fallback invocation with DeepSeek JSON invocation.
- Modify: `tests/unit/knowledgeTasks.test.js`
  - DeepSeek model fallback and metadata expectations.
- Modify: `public/index.html`
  - DeepSeek teacher label and infrastructure banner defaults.
- Modify: `public/knowledge-hub.html`
  - Tooltip text no longer references Gemini.
- Modify: `public/js/modules/api.js`
  - Remove Gemini auth API helpers.
- Modify: `public/js/modules/app.js`
  - Remove Gemini setup overlay, update infra guard, provider defaults, and visible labels.
- Modify: `public/js/modules/store.js`
  - Default `llmProvider` becomes `deepseek`.
- Modify: `public/styles.css`
  - Rename `mode-gemini` styling to `mode-deepseek` while keeping current layout.
- Modify: `tests/e2e/frontend-regression.spec.js`
  - DeepSeek teacher label and no Gemini setup expectations.
- Rename: `tests/e2e/real-gemini.spec.js` -> `tests/e2e/real-deepseek.spec.js`
  - Optional live DeepSeek acceptance behind `RUN_REAL_DEEPSEEK_E2E=1`.
- Delete: `tests/e2e/gemini-sanitize.spec.js`
  - Gemini proxy sanitizer no longer exists.
- Delete: `tests/unit/geminiErrors.test.js`
- Delete: `tests/unit/geminiProxyService.test.js`
- Delete: `tests/unit/geminiTimeouts.test.js`
- Delete: `tests/unit/geminiProcessUtils.test.js`
- Delete: `services/llm/geminiAuthService.js`
- Delete: `services/llm/geminiCliService.js`
- Delete: `services/llm/geminiErrors.js`
- Delete: `services/llm/geminiGatewayServer.js`
- Delete: `services/llm/geminiProcessUtils.js`
- Delete: `services/llm/geminiProxyService.js`
- Delete: `services/llm/geminiService.js`
- Delete: `services/llm/geminiTimeouts.js`
- Delete: `scripts/infra/gemini-host-proxy.js`
- Delete: `scripts/infra/start-gemini-proxy.sh`
- Delete: `Dockerfile.gemini-gateway`
- Modify: `docker-compose.yml`
  - Remove `gemini-proxy` service and Gemini environment variables.
- Modify: `.env.example`
  - DeepSeek-only LLM config with placeholder values.
- Modify: `package.json`
  - Remove Gemini scripts and `@google/generative-ai`.
- Modify: `package-lock.json`
  - Regenerated after dependency removal.
- Delete active Gemini docs:
  - `Docs/Operations/Gemini/GEMINI_CLI_调用方式详解.md`
  - `Docs/Operations/Gemini/GEMINI_CLI_知识分析任务执行规范.md`
  - `Docs/Architecture/GEMINI_PROXY_AND_SERVER_QUEUE_REDESIGN.md`
  - Matching lowercase `docs/...` copies if present in the worktree.
- Modify docs that mention active Gemini operation:
  - `Docs/README.md`
  - `README.md`
  - `Docs/Architecture/Trilingual_Card_Generation_System.md`
  - `Docs/Architecture/Knowledge/Knowledge_Local_Analysis_System_Design.md`

---

### Task 1: Replace Provider Defaults And Structured Error Helpers

**Files:**
- Modify: `lib/serverConfig.js`
- Modify: `tests/unit/serverConfig.test.js`
- Create: `services/llm/llmErrors.js`
- Create: `tests/unit/llmErrors.test.js`
- Delete: `tests/unit/geminiErrors.test.js`

- [ ] **Step 1: Write failing server config tests**

Replace the Gemini helper sections in `tests/unit/serverConfig.test.js` with:

```js
test.describe('serverConfig.deepseek defaults', () => {
  test.it('uses DeepSeek as the only normalized provider', () => {
    assert.equal(cfg.DEFAULT_LLM_PROVIDER, 'deepseek');
    assert.equal(cfg.normalizeLlmProvider(), 'deepseek');
    assert.equal(cfg.normalizeLlmProvider('gemini'), 'deepseek');
    assert.equal(cfg.normalizeLlmProvider('local'), 'deepseek');
  });

  test.it('defaults to DeepSeek V4 Flash', () => {
    assert.equal(cfg.DEFAULT_DEEPSEEK_MODEL, 'deepseek-v4-flash');
    assert.equal(cfg.DEFAULT_DEEPSEEK_BASE_URL, 'https://api.deepseek.com');
  });

  test.it('sanitizes DeepSeek model names and rejects legacy Gemini aliases', () => {
    assert.equal(cfg.sanitizeDeepSeekModelName('deepseek-v4-flash'), 'deepseek-v4-flash');
    assert.equal(cfg.sanitizeDeepSeekModelName('  deepseek-v4-pro  '), 'deepseek-v4-pro');
    assert.equal(cfg.sanitizeDeepSeekModelName('gemini-cli'), '');
    assert.equal(cfg.sanitizeDeepSeekModelName('gemini-3-flash-preview'), '');
    assert.equal(cfg.sanitizeDeepSeekModelName(''), '');
  });

  test.it('resolves DeepSeek model override before env default', () => {
    const saved = process.env.DEEPSEEK_MODEL;
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-pro';
    try {
      assert.equal(cfg.resolveDeepSeekModel('deepseek-v4-flash'), 'deepseek-v4-flash');
      assert.equal(cfg.resolveDeepSeekModel('gemini-3-pro'), 'deepseek-v4-pro');
      assert.equal(cfg.resolveDeepSeekModel(''), 'deepseek-v4-pro');
    } finally {
      if (saved === undefined) delete process.env.DEEPSEEK_MODEL;
      else process.env.DEEPSEEK_MODEL = saved;
    }
  });
});
```

- [ ] **Step 2: Write provider-neutral error tests**

Create `tests/unit/llmErrors.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CODES,
  statusForCode,
  isRetriableCode,
  codedError,
  errorCodeOf,
  codeForHttpStatus,
} = require('../../services/llm/llmErrors');

test.describe('llmErrors', () => {
  test.it('keeps the queue-compatible capacity code', () => {
    assert.equal(CODES.RATE_LIMITED, 'MODEL_CAPACITY_EXHAUSTED');
  });

  test.it('maps provider codes to HTTP status', () => {
    assert.equal(statusForCode(CODES.CONFIG_ERROR), 500);
    assert.equal(statusForCode(CODES.BAD_REQUEST), 400);
    assert.equal(statusForCode(CODES.AUTH_ERROR), 401);
    assert.equal(statusForCode(CODES.TIMEOUT), 504);
    assert.equal(statusForCode(CODES.RATE_LIMITED), 429);
    assert.equal(statusForCode(CODES.UNAVAILABLE), 502);
    assert.equal(statusForCode(CODES.EMPTY_RESPONSE), 502);
    assert.equal(statusForCode('unknown'), 500);
  });

  test.it('marks transient provider errors as retriable', () => {
    assert.equal(isRetriableCode(CODES.TIMEOUT), true);
    assert.equal(isRetriableCode(CODES.RATE_LIMITED), true);
    assert.equal(isRetriableCode(CODES.UNAVAILABLE), true);
    assert.equal(isRetriableCode(CODES.BAD_REQUEST), false);
    assert.equal(isRetriableCode(CODES.AUTH_ERROR), false);
    assert.equal(isRetriableCode(CODES.CONFIG_ERROR), false);
  });

  test.it('creates coded Error objects', () => {
    const err = codedError(CODES.RATE_LIMITED, 'busy');
    assert.equal(err.message, 'busy');
    assert.equal(err.code, CODES.RATE_LIMITED);
    assert.equal(err.status, 429);
  });

  test.it('extracts direct and payload codes', () => {
    assert.equal(errorCodeOf({ code: CODES.TIMEOUT }), CODES.TIMEOUT);
    assert.equal(errorCodeOf({ payload: { code: CODES.RATE_LIMITED } }), CODES.RATE_LIMITED);
    assert.equal(errorCodeOf(new Error('plain')), '');
  });

  test.it('maps HTTP status to provider codes', () => {
    assert.equal(codeForHttpStatus(400), CODES.BAD_REQUEST);
    assert.equal(codeForHttpStatus(401), CODES.AUTH_ERROR);
    assert.equal(codeForHttpStatus(403), CODES.AUTH_ERROR);
    assert.equal(codeForHttpStatus(408), CODES.TIMEOUT);
    assert.equal(codeForHttpStatus(429), CODES.RATE_LIMITED);
    assert.equal(codeForHttpStatus(500), CODES.UNAVAILABLE);
    assert.equal(codeForHttpStatus(503), CODES.UNAVAILABLE);
  });
});
```

- [ ] **Step 3: Run targeted tests and confirm failures**

Run:

```bash
node --test tests/unit/serverConfig.test.js tests/unit/llmErrors.test.js
```

Expected:

- `serverConfig.deepseek defaults` fails because current config still exports Gemini defaults.
- `tests/unit/llmErrors.test.js` fails because `services/llm/llmErrors.js` does not exist.

- [ ] **Step 4: Implement provider config**

In `lib/serverConfig.js`, remove Gemini model helpers and define:

```js
const PORT = process.env.PORT || 3010;
const RECORDS_PATH = process.env.RECORDS_PATH || '/data/trilingual_records';
const DEFAULT_LLM_PROVIDER = 'deepseek';
const DEFAULT_DEEPSEEK_BASE_URL = String(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
const DEFAULT_DEEPSEEK_MODEL = sanitizeDeepSeekModelName(process.env.DEEPSEEK_MODEL) || 'deepseek-v4-flash';
const DEFAULT_DEEPSEEK_TIMEOUT_MS = toNumberOr(process.env.DEEPSEEK_TIMEOUT_MS, 120000);
const DEFAULT_DEEPSEEK_THINKING = normalizeDeepSeekThinking(process.env.DEEPSEEK_THINKING || 'disabled');
const E2E_TEST_MODE = /^(1|true|yes|on)$/i.test(String(process.env.E2E_TEST_MODE || '').trim());
const SUPPORTED_CARD_TYPES = new Set(['trilingual', 'grammar_ja', 'scenario_phrase']);
const SUPPORTED_DEEPSEEK_MODELS = new Set(['deepseek-v4-flash', 'deepseek-v4-pro']);

function normalizeLlmProvider() {
  return 'deepseek';
}

function sanitizeDeepSeekModelName(modelName) {
  const model = String(modelName || '').trim();
  return SUPPORTED_DEEPSEEK_MODELS.has(model) ? model : '';
}

function resolveDeepSeekModel(modelOverride) {
  return sanitizeDeepSeekModelName(modelOverride)
    || sanitizeDeepSeekModelName(process.env.DEEPSEEK_MODEL)
    || 'deepseek-v4-flash';
}

function normalizeDeepSeekThinking(value) {
  return String(value || '').trim().toLowerCase() === 'enabled' ? 'enabled' : 'disabled';
}
```

Keep existing `toNumberOr`, `normalizeCardType`, and `normalizeSourceMode`. Export:

```js
module.exports = {
  PORT,
  RECORDS_PATH,
  DEFAULT_LLM_PROVIDER,
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_DEEPSEEK_TIMEOUT_MS,
  DEFAULT_DEEPSEEK_THINKING,
  E2E_TEST_MODE,
  SUPPORTED_CARD_TYPES,
  SUPPORTED_DEEPSEEK_MODELS,
  toNumberOr,
  normalizeLlmProvider,
  normalizeCardType,
  normalizeSourceMode,
  sanitizeDeepSeekModelName,
  resolveDeepSeekModel,
  normalizeDeepSeekThinking,
};
```

- [ ] **Step 5: Implement neutral error helper**

Create `services/llm/llmErrors.js`:

```js
'use strict';

const CODES = {
  CONFIG_ERROR: 'LLM_CONFIG_ERROR',
  BAD_REQUEST: 'LLM_BAD_REQUEST',
  AUTH_ERROR: 'LLM_AUTH_ERROR',
  TIMEOUT: 'LLM_TIMEOUT',
  RATE_LIMITED: 'MODEL_CAPACITY_EXHAUSTED',
  UNAVAILABLE: 'LLM_PROVIDER_UNAVAILABLE',
  EMPTY_RESPONSE: 'LLM_EMPTY_RESPONSE',
  INVALID_RESPONSE: 'LLM_INVALID_RESPONSE',
};

const STATUS_BY_CODE = {
  [CODES.CONFIG_ERROR]: 500,
  [CODES.BAD_REQUEST]: 400,
  [CODES.AUTH_ERROR]: 401,
  [CODES.TIMEOUT]: 504,
  [CODES.RATE_LIMITED]: 429,
  [CODES.UNAVAILABLE]: 502,
  [CODES.EMPTY_RESPONSE]: 502,
  [CODES.INVALID_RESPONSE]: 502,
};

const RETRIABLE_CODES = new Set([
  CODES.TIMEOUT,
  CODES.RATE_LIMITED,
  CODES.UNAVAILABLE,
]);

function statusForCode(code) {
  return STATUS_BY_CODE[code] || 500;
}

function isRetriableCode(code) {
  return RETRIABLE_CODES.has(String(code || ''));
}

function codedError(code, message, payload = null) {
  const err = new Error(message || code);
  err.code = code;
  err.status = statusForCode(code);
  if (payload) err.payload = payload;
  return err;
}

function errorCodeOf(err) {
  if (!err) return '';
  return String(err.code || (err.payload && err.payload.code) || '');
}

function codeForHttpStatus(status) {
  const n = Number(status || 0);
  if (n === 400) return CODES.BAD_REQUEST;
  if (n === 401 || n === 403) return CODES.AUTH_ERROR;
  if (n === 408 || n === 504) return CODES.TIMEOUT;
  if (n === 429) return CODES.RATE_LIMITED;
  if (n >= 500) return CODES.UNAVAILABLE;
  return CODES.INVALID_RESPONSE;
}

module.exports = {
  CODES,
  STATUS_BY_CODE,
  RETRIABLE_CODES,
  statusForCode,
  isRetriableCode,
  codedError,
  errorCodeOf,
  codeForHttpStatus,
};
```

- [ ] **Step 6: Delete Gemini error test and run tests**

Run:

```bash
rm tests/unit/geminiErrors.test.js
node --test tests/unit/serverConfig.test.js tests/unit/llmErrors.test.js
```

Expected: both test files pass.

- [ ] **Step 7: Commit**

```bash
git add lib/serverConfig.js services/llm/llmErrors.js tests/unit/serverConfig.test.js tests/unit/llmErrors.test.js
git rm tests/unit/geminiErrors.test.js
git commit -m "feat: switch provider defaults to deepseek"
```

---

### Task 2: Add DeepSeek Service

**Files:**
- Create: `services/llm/deepseekService.js`
- Create: `tests/unit/deepseekService.test.js`

- [ ] **Step 1: Write failing DeepSeek service tests**

Create `tests/unit/deepseekService.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const deepseek = require('../../services/llm/deepseekService');
const { CODES } = require('../../services/llm/llmErrors');

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

function mockFetch(handler) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    const response = handler({ url: String(url), opts, callIndex: calls.length - 1 });
    if (response instanceof Error) throw response;
    return response;
  };
  return { calls, restore: () => { global.fetch = original; } };
}

test.describe('deepseekService', () => {
  test.it('builds a non-stream Markdown chat completion request', async (t) => {
    const fetchMock = mockFetch(() => jsonResponse(200, {
      model: 'deepseek-v4-flash',
      choices: [{ message: { content: '# Card' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    }));
    t.after(() => fetchMock.restore());

    const result = await deepseek.generateMarkdown('make card', {
      apiKey: 'unit-key',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      timeoutMs: 1000,
    });

    assert.equal(result.markdown, '# Card');
    assert.equal(result.model, 'deepseek-v4-flash');
    assert.deepEqual(result.usage, { input: 10, output: 5, total: 15 });

    const call = fetchMock.calls[0];
    assert.equal(call.url, 'https://api.deepseek.com/chat/completions');
    assert.equal(call.opts.headers.Authorization, 'Bearer unit-key');
    const body = JSON.parse(call.opts.body);
    assert.equal(body.model, 'deepseek-v4-flash');
    assert.equal(body.stream, false);
    assert.equal(body.thinking.type, 'disabled');
    assert.equal(body.messages[0].role, 'user');
    assert.equal(body.messages[0].content, 'make card');
    assert.equal(body.response_format, undefined);
  });

  test.it('adds JSON response_format only for JSON calls', async (t) => {
    const fetchMock = mockFetch(() => jsonResponse(200, {
      model: 'deepseek-v4-flash',
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }));
    t.after(() => fetchMock.restore());

    const result = await deepseek.generateJson('return json', {
      apiKey: 'unit-key',
      model: 'deepseek-v4-flash',
    });

    assert.equal(result.text, '{"ok":true}');
    const body = JSON.parse(fetchMock.calls[0].opts.body);
    assert.deepEqual(body.response_format, { type: 'json_object' });
  });

  test.it('throws a non-retryable config error when the key is missing', async () => {
    await assert.rejects(
      deepseek.generateMarkdown('p', { apiKey: '' }),
      (err) => {
        assert.equal(err.code, CODES.CONFIG_ERROR);
        assert.equal(err.status, 500);
        return true;
      }
    );
  });

  test.it('maps 429 to the queue-compatible capacity code', async (t) => {
    const fetchMock = mockFetch(() => jsonResponse(429, { error: { message: 'rate limited' } }));
    t.after(() => fetchMock.restore());

    await assert.rejects(
      deepseek.generateMarkdown('p', { apiKey: 'unit-key' }),
      (err) => {
        assert.equal(err.code, CODES.RATE_LIMITED);
        assert.equal(err.status, 429);
        return true;
      }
    );
  });

  test.it('maps provider 5xx to retryable unavailable errors', async (t) => {
    const fetchMock = mockFetch(() => jsonResponse(503, { error: { message: 'busy' } }));
    t.after(() => fetchMock.restore());

    await assert.rejects(
      deepseek.generateMarkdown('p', { apiKey: 'unit-key' }),
      (err) => {
        assert.equal(err.code, CODES.UNAVAILABLE);
        assert.equal(err.status, 502);
        return true;
      }
    );
  });

  test.it('rejects empty provider content', async (t) => {
    const fetchMock = mockFetch(() => jsonResponse(200, {
      model: 'deepseek-v4-flash',
      choices: [{ message: { content: '' }, finish_reason: 'stop' }]
    }));
    t.after(() => fetchMock.restore());

    await assert.rejects(
      deepseek.generateMarkdown('p', { apiKey: 'unit-key' }),
      (err) => {
        assert.equal(err.code, CODES.EMPTY_RESPONSE);
        return true;
      }
    );
  });
});
```

- [ ] **Step 2: Run targeted test and confirm failure**

Run:

```bash
node --test tests/unit/deepseekService.test.js
```

Expected: fails because `services/llm/deepseekService.js` does not exist.

- [ ] **Step 3: Implement DeepSeek service**

Create `services/llm/deepseekService.js`:

```js
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
  return String(value || '').trim().replace(/\/$/, '');
}

function resolveApiKey(options = {}) {
  return String(options.apiKey || process.env.DEEPSEEK_API_KEY || '').trim();
}

function resolveBaseUrl(options = {}) {
  return trimTrailingSlash(options.baseUrl || process.env.DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL);
}

function normalizeUsage(usage = {}) {
  const input = Number(usage.prompt_tokens || usage.input_tokens || 0) || 0;
  const output = Number(usage.completion_tokens || usage.output_tokens || 0) || 0;
  const total = Number(usage.total_tokens || input + output) || 0;
  return { input, output, total };
}

function extractErrorMessage(payload, fallback) {
  if (!payload || typeof payload !== 'object') return fallback;
  if (typeof payload.error === 'string') return payload.error;
  if (payload.error && typeof payload.error.message === 'string') return payload.error.message;
  if (typeof payload.message === 'string') return payload.message;
  return fallback;
}

function buildRequestBody(prompt, options = {}) {
  const responseMode = String(options.responseMode || 'markdown').trim().toLowerCase();
  const body = {
    model: resolveDeepSeekModel(options.model),
    messages: [{ role: 'user', content: String(prompt || '') }],
    stream: false,
    thinking: { type: normalizeDeepSeekThinking(options.thinking || DEFAULT_DEEPSEEK_THINKING) },
  };
  if (options.temperature != null) body.temperature = Number(options.temperature);
  if (options.maxTokens != null) body.max_tokens = Number(options.maxTokens);
  if (responseMode === 'json') {
    body.response_format = { type: 'json_object' };
  }
  return body;
}

async function chatCompletion(prompt, options = {}) {
  const apiKey = resolveApiKey(options);
  if (!apiKey) {
    throw codedError(CODES.CONFIG_ERROR, 'DEEPSEEK_API_KEY is not configured');
  }

  const baseUrl = resolveBaseUrl(options);
  const timeoutMs = Number(options.timeoutMs || process.env.DEEPSEEK_TIMEOUT_MS || DEFAULT_DEEPSEEK_TIMEOUT_MS);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const body = buildRequestBody(prompt, options);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }

    if (!response.ok) {
      const code = codeForHttpStatus(response.status);
      const message = extractErrorMessage(payload, `DeepSeek API error (${response.status})`);
      throw codedError(code, message, { status: response.status, code, body: payload });
    }

    const content = String(payload?.choices?.[0]?.message?.content || '').trim();
    if (!content) {
      throw codedError(CODES.EMPTY_RESPONSE, 'DeepSeek API returned empty content', payload);
    }

    return {
      content,
      rawOutput: content,
      model: payload.model || body.model,
      usage: normalizeUsage(payload.usage || {}),
      finishReason: payload?.choices?.[0]?.finish_reason || '',
      response: payload,
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw codedError(CODES.TIMEOUT, `DeepSeek API timeout after ${timeoutMs}ms`);
    }
    if (err.code && err.status) throw err;
    throw codedError(CODES.UNAVAILABLE, err.message || 'DeepSeek API unavailable');
  } finally {
    clearTimeout(timeoutId);
  }
}

async function generateMarkdown(prompt, options = {}) {
  const result = await chatCompletion(prompt, { ...options, responseMode: 'markdown' });
  return {
    markdown: result.content,
    rawOutput: result.rawOutput,
    model: result.model,
    usage: result.usage,
    finishReason: result.finishReason,
  };
}

async function generateJson(prompt, options = {}) {
  const result = await chatCompletion(prompt, { ...options, responseMode: 'json' });
  return {
    text: result.content,
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
```

- [ ] **Step 4: Run targeted test and confirm pass**

Run:

```bash
node --test tests/unit/deepseekService.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/llm/deepseekService.js tests/unit/deepseekService.test.js
git commit -m "feat: add deepseek chat completion service"
```

---

### Task 3: Switch Card Generation To DeepSeek Markdown

**Files:**
- Modify: `lib/generationHelpers.js`
- Modify: `tests/unit/generationHelpers.test.js`
- Modify: `services/generation/cardGenerationService.js`
- Modify: `routes/_shared.js`
- Modify: `tests/integration/generate.test.js`

- [ ] **Step 1: Rename sanitized-response helper tests**

In `tests/unit/generationHelpers.test.js`, update the import:

```js
const {
  normalizeAudioTasks,
  resolveCardAudioTasks,
  validateGeneratedContent,
  extractMarkdownProviderResponse,
  validateSanitizedCardResponse,
} = require('../../lib/generationHelpers');
```

Rename test groups:

```js
test.describe('extractMarkdownProviderResponse', () => {
  test.it('returns "" for non-object input', () => {
    assert.equal(extractMarkdownProviderResponse(null), '');
    assert.equal(extractMarkdownProviderResponse('str'), '');
    assert.equal(extractMarkdownProviderResponse(undefined), '');
  });

  test.it('prefers the markdown field over rawOutput', () => {
    assert.equal(extractMarkdownProviderResponse({ markdown: 'A', rawOutput: 'B' }), 'A');
  });

  test.it('falls back to rawOutput when markdown is missing', () => {
    assert.equal(extractMarkdownProviderResponse({ rawOutput: '  B  ' }), 'B');
  });
});
```

Replace every `validateSanitizedGeminiCardResponse` call with `validateSanitizedCardResponse`.

- [ ] **Step 2: Update integration expectations for DeepSeek**

In `tests/integration/generate.test.js`, change the happy-path provider assertion:

```js
assert.equal(res.body.provider_used, 'deepseek');
assert.equal(res.body.provider_requested, 'deepseek');
assert.equal(res.body.observability.metadata.model, 'e2e-fixture');
```

- [ ] **Step 3: Run targeted tests and confirm failures**

Run:

```bash
node --test tests/unit/generationHelpers.test.js tests/integration/generate.test.js
```

Expected:

- `generationHelpers` fails because provider-neutral helper names are not exported.
- `generate` integration fails because route still returns `gemini`.

- [ ] **Step 4: Rename helpers in generationHelpers**

In `lib/generationHelpers.js`, rename:

```js
function extractMarkdownProviderResponse(response) {
  if (!response || typeof response !== 'object') return '';
  return String(response.markdown || response.rawOutput || response.text || '').trim();
}

function validateSanitizedCardResponse(response, cardType = 'trilingual') {
  const markdown = extractMarkdownProviderResponse(response);
  if (!markdown) return false;
  if (/MCP issues detected|Run\s+\/mcp\s+list\s+for\s+status|\/mcp list/i.test(markdown)) {
    return false;
  }

  if (cardType === 'scenario_phrase') {
    return validateScenarioMarkdown(markdown).length === 0;
  }

  const requiredSections = cardType === 'grammar_ja'
    ? ['## 1. 语法概述', '## 2. 日本語', '## 3. 常见误用']
    : ['## 1. 英文', '## 2. 日本語', '## 3. 中文'];
  if (!requiredSections.every((section) => markdown.includes(section))) {
    return false;
  }

  const audioTasks = buildAudioTasksFromMarkdown(markdown);
  const minAudioTasks = cardType === 'grammar_ja' ? 3 : 4;
  return audioTasks.length >= minAudioTasks;
}
```

Export:

```js
module.exports = {
  normalizeAudioTasks,
  resolveCardAudioTasks,
  validateGeneratedContent,
  extractMarkdownProviderResponse,
  validateSanitizedCardResponse,
};
```

- [ ] **Step 5: Replace card generation provider path**

In `services/generation/cardGenerationService.js`:

- Remove imports for `path`, `geminiService`, `runGeminiCli`, `runGeminiProxy`, `localLlmService`, `RECORDS_PATH`, and `resolveGeminiModel`.
- Add imports:

```js
const deepseekService = require('../llm/deepseekService');
const {
  normalizeCardType,
  normalizeSourceMode,
  resolveDeepSeekModel,
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_DEEPSEEK_TIMEOUT_MS,
} = require('../../lib/serverConfig');
const {
  validateSanitizedCardResponse,
} = require('../../lib/generationHelpers');
```

Replace provider branching inside `generateWithProvider` with:

```js
const providerName = 'deepseek';
const model = resolveDeepSeekModel(options.modelOverride || DEFAULT_DEEPSEEK_MODEL);
const useMarkdownOutput = true;
const prompt = buildMarkdownPrompt({ phrase, filenameBase: baseName, cardType });

perf.mark('llmCall');
const response = await deepseekService.generateMarkdown(prompt, {
  model,
  timeoutMs: options.timeoutMs || DEFAULT_DEEPSEEK_TIMEOUT_MS,
});

if (!validateSanitizedCardResponse(response, cardType)) {
  const err = new Error('DeepSeek output failed card-shape validation');
  err.status = 422;
  err.payload = { code: 'LLM_INVALID_RESPONSE', provider: providerName, model };
  throw err;
}

const markdown = response.markdown || '';
const audioTasks = buildAudioTasksFromMarkdown(markdown);
const preparedMarkdown = await prepareMarkdownForCard(markdown, { baseName, audioTasks });
const htmlContent = await renderHtmlFromMarkdown(preparedMarkdown, { baseName, audioTasks, prepared: true });
const content = {
  markdown_content: preparedMarkdown,
  html_content: htmlContent,
  audio_tasks: audioTasks
};
const usage = response.usage && Number(response.usage.total || 0) > 0
  ? response.usage
  : {
      input: TokenCounter.estimate(prompt),
      output: TokenCounter.estimate(markdown),
      total: TokenCounter.estimate(prompt) + TokenCounter.estimate(markdown)
    };
```

Set observability metadata:

```js
metadata: {
  provider: providerName,
  timestamp: Date.now(),
  model: response.model || model,
  promptText: prompt,
  promptParsed: promptData,
  cardType,
  sourceMode,
  outputMode: 'markdown',
  rawOutput: response.rawOutput || markdown,
  outputStructured: JSON.stringify(content, null, 2)
}
```

Remove `generateWithAutoFallback` from exports. Keep only:

```js
module.exports = {
  generateWithProvider,
};
```

- [ ] **Step 6: Update shared route exports**

In `routes/_shared.js`:

- Remove `geminiService`, `runGeminiCli`, `runGeminiProxy`, `localLlmService`, and `geminiAuthService` imports and exports.
- Replace `DEFAULT_GEMINI_MODEL` with `DEFAULT_DEEPSEEK_MODEL`.
- Replace `sanitizeGeminiModelName` and `resolveGeminiModel` exports with `sanitizeDeepSeekModelName` and `resolveDeepSeekModel`.
- Export only `generateWithProvider` from `cardGenerationService`.

- [ ] **Step 7: Update generate route**

In `routes/generate.js`:

- Replace `generateWithAutoFallback` import with `generateWithProvider`.
- Replace `DEFAULT_GEMINI_MODEL` with `DEFAULT_DEEPSEEK_MODEL`.
- Set:

```js
const requestedProvider = 'deepseek';
```

- Change non-E2E generation call:

```js
: await generateWithProvider(phrase, requestedProvider, perf, {
    modelOverride: DEFAULT_DEEPSEEK_MODEL,
    targetFolder: target_folder || '',
    cardType,
    sourceMode
  });
```

- Keep response fields `provider_requested` and `provider_used`; their value should now be `deepseek`.

- [ ] **Step 8: Run targeted tests**

Run:

```bash
node --test tests/unit/generationHelpers.test.js tests/integration/generate.test.js
```

Expected: both pass.

- [ ] **Step 9: Commit**

```bash
git add lib/generationHelpers.js tests/unit/generationHelpers.test.js services/generation/cardGenerationService.js routes/_shared.js routes/generate.js tests/integration/generate.test.js
git commit -m "feat: route card generation through deepseek"
```

---

### Task 4: Update Queue, Storage Defaults, And E2E Fixtures

**Files:**
- Modify: `server.js`
- Modify: `routes/generationJobs.js`
- Modify: `lib/e2eFixtures.js`
- Modify: `services/storage/databaseService.js`
- Modify: `services/storage/db/generationJobs.js`
- Modify: `routes/testReset.js`
- Modify: `tests/integration/generationJobs.test.js`
- Modify: `tests/unit/databaseService.test.js`

- [ ] **Step 1: Write failing queue and fixture expectations**

In `tests/integration/generationJobs.test.js`, update assertions that inspect provider/model:

```js
assert.equal(created.body.job.provider, 'deepseek');
assert.equal(created.body.job.llmModel, 'deepseek-v4-flash');
assert.equal(created.body.job.requestPayload.llm_provider, 'deepseek');
assert.equal(created.body.job.requestPayload.llm_model, 'deepseek-v4-flash');
```

In `tests/unit/databaseService.test.js`, keep provider-filter tests that intentionally insert `gemini` historical rows, but update default-row tests to expect `deepseek`:

```js
assert.equal(job.provider, 'deepseek');
```

- [ ] **Step 2: Run targeted tests and confirm failures**

Run:

```bash
node --test tests/integration/generationJobs.test.js tests/unit/databaseService.test.js
```

Expected: queue-created provider/model assertions fail because defaults still use Gemini.

- [ ] **Step 3: Update server worker payload**

In `server.js`:

- Replace `DEFAULT_GEMINI_MODEL` import with `DEFAULT_DEEPSEEK_MODEL`.
- Change worker payload:

```js
const payload = {
  phrase: job.phraseNormalized,
  llm_provider: 'deepseek',
  card_type: normalizeCardType(job.jobType),
  source_mode: normalizeSourceMode(job.sourceMode),
  target_folder: job.targetFolder || '',
  llm_model: DEFAULT_DEEPSEEK_MODEL
};
```

- [ ] **Step 4: Update generation job route**

In `routes/generationJobs.js`:

```js
const { DEFAULT_DEEPSEEK_MODEL, normalizeCardType, normalizeSourceMode } = require('../lib/serverConfig');
```

Set:

```js
const provider = 'deepseek';
const llmModel = DEFAULT_DEEPSEEK_MODEL;
```

- [ ] **Step 5: Update E2E fixture errors and observability**

In `lib/e2eFixtures.js`, change the auto-backoff simulated error:

```js
const error = new Error('DeepSeek API error (429): {"error":"rate limited","code":"MODEL_CAPACITY_EXHAUSTED"}');
error.status = 429;
error.payload = {
  error: 'DeepSeek rate limited',
  code: 'MODEL_CAPACITY_EXHAUSTED'
};
```

Keep `buildFixtureObservability({ provider: requestedProvider })`; `requestedProvider` now comes in as `deepseek`.

- [ ] **Step 6: Update database defaults for new rows**

In `services/storage/databaseService.js`, replace schema defaults:

```sql
llm_provider TEXT NOT NULL DEFAULT 'deepseek'
```

In any `ensureColumn` list, replace:

```js
"llm_provider TEXT NOT NULL DEFAULT 'deepseek'"
```

Do not migrate existing rows.

- [ ] **Step 7: Update generation job DB mapper defaults**

In `services/storage/db/generationJobs.js`, change defaults:

```js
provider: row.llm_provider || 'deepseek',
```

and:

```js
provider: String(payload.provider || 'deepseek').trim() || 'deepseek',
```

- [ ] **Step 8: Update test reset fixtures**

In `routes/testReset.js`, replace inserted fixture metadata:

```js
llmProvider: 'deepseek',
llmModel: 'deepseek-v4-flash',
```

- [ ] **Step 9: Run targeted tests**

Run:

```bash
node --test tests/integration/generationJobs.test.js tests/unit/databaseService.test.js tests/integration/generate.test.js
```

Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add server.js routes/generationJobs.js lib/e2eFixtures.js services/storage/databaseService.js services/storage/db/generationJobs.js routes/testReset.js tests/integration/generationJobs.test.js tests/unit/databaseService.test.js
git commit -m "feat: persist deepseek generation metadata"
```

---

### Task 5: Replace Gemini Health And Auth Routes

**Files:**
- Modify: `services/observability/healthCheckService.js`
- Modify: `routes/health.js`
- Modify: `tests/integration/health.test.js`
- Modify: `routes/_shared.js`

- [ ] **Step 1: Write failing health route tests**

Replace `tests/integration/health.test.js` with:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { api, closeServer } = require('./_harness');

test.after(async () => { await closeServer(); });

test.describe('/api/health + removed Gemini auth routes', () => {
  test.it('GET /api/health returns DeepSeek service status and e2e flag', async () => {
    const res = await api('GET', '/api/health');
    assert.equal(res.status, 200);
    assert.ok(res.body && typeof res.body === 'object');
    assert.equal(res.body.e2e_test_mode, true);
    const names = res.body.services.map((service) => service.name);
    assert.ok(names.includes('DeepSeek API'));
    assert.equal(names.some((name) => /Gemini/i.test(name)), false);
  });

  test.it('Gemini auth routes are removed', async () => {
    const routes = [
      ['GET', '/api/gemini/auth/status'],
      ['POST', '/api/gemini/auth/start'],
      ['POST', '/api/gemini/auth/submit'],
      ['POST', '/api/gemini/auth/cancel'],
    ];

    for (const [method, route] of routes) {
      const res = await api(method, route, { body: method === 'POST' ? {} : undefined });
      assert.equal(res.status, 404, `${method} ${route}`);
    }
  });
});
```

- [ ] **Step 2: Run targeted test and confirm failure**

Run:

```bash
node --test tests/integration/health.test.js
```

Expected: fails because Gemini auth routes still exist and health still contains Gemini services under some environments.

- [ ] **Step 3: Replace health service checks**

In `services/observability/healthCheckService.js`:

- Remove `buildGatewayHealthUrl`, `buildExecutorHealthUrl`, `checkGeminiGateway`, `checkGeminiHostExecutor`, and `checkGemini`.
- Add:

```js
  static buildDeepSeekModelsUrl() {
    const baseUrl = String(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').trim().replace(/\/$/, '');
    return `${baseUrl}/models`;
  }

  static async checkDeepSeek() {
    const service = {
      name: 'DeepSeek API',
      type: 'llm',
      critical: true,
      status: 'unknown',
      lastCheck: Date.now(),
      details: {
        endpoint: this.buildDeepSeekModelsUrl(),
        model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
        configured: Boolean(String(process.env.DEEPSEEK_API_KEY || '').trim())
      }
    };

    if (/^(1|true|yes|on)$/i.test(String(process.env.E2E_TEST_MODE || '').trim())) {
      service.critical = false;
      service.status = 'online';
      service.message = 'E2E fixture mode';
      return service;
    }

    if (!service.details.configured) {
      service.status = 'offline';
      service.message = 'DEEPSEEK_API_KEY is not configured';
      return service;
    }

    try {
      const startTime = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(service.details.endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      service.latency = Date.now() - startTime;
      if (response.ok) {
        service.status = service.latency > 2000 ? 'degraded' : 'online';
        service.message = service.latency > 2000 ? 'DeepSeek API 响应偏慢' : 'DeepSeek API 正常';
      } else {
        service.status = 'offline';
        service.message = `DeepSeek API 响应异常: ${response.status}`;
      }
    } catch (error) {
      service.status = 'offline';
      service.message = error.name === 'AbortError' ? 'DeepSeek API 请求超时' : error.message;
    }

    return service;
  }
```

In `checkAll()`, add DeepSeek before TTS/storage:

```js
checks.push(this.checkDeepSeek());
```

Keep local LLM health only if it is still useful for OCR diagnostics; do not include it as the generation provider.

- [ ] **Step 4: Remove auth routes**

In `routes/health.js`, remove the Gemini auth route handlers and remove `geminiAuthService` from destructuring:

```js
const {
  HealthCheckService,
  E2E_TEST_MODE,
} = require('./_shared');
```

The file should only mount `GET /api/health`.

- [ ] **Step 5: Remove shared auth export**

In `routes/_shared.js`, ensure `geminiAuthService` is no longer imported or exported.

- [ ] **Step 6: Run targeted test**

Run:

```bash
node --test tests/integration/health.test.js
```

Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add services/observability/healthCheckService.js routes/health.js routes/_shared.js tests/integration/health.test.js
git commit -m "feat: replace gemini health with deepseek"
```

---

### Task 6: Move Knowledge LLM Fallbacks To DeepSeek JSON

**Files:**
- Modify: `services/knowledge/tasks/cluster.js`
- Modify: `services/knowledge/tasks/synonymBoundary.js`
- Modify: `tests/unit/knowledgeTasks.test.js`

- [ ] **Step 1: Add failing knowledge option tests**

In `tests/unit/knowledgeTasks.test.js`, add:

```js
test.describe('knowledge DeepSeek LLM options', () => {
  test.it('cluster uses DeepSeek model fallback', () => {
    const saved = process.env.DEEPSEEK_MODEL;
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';
    try {
      const config = clusterTask._internal.normalizeOptions({});
      assert.equal(config.model, 'deepseek-v4-flash');
      assert.equal(config.llmTransport, 'deepseek');
    } finally {
      if (saved === undefined) delete process.env.DEEPSEEK_MODEL;
      else process.env.DEEPSEEK_MODEL = saved;
    }
  });

  test.it('synonym boundary uses DeepSeek model fallback', () => {
    const saved = process.env.DEEPSEEK_MODEL;
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';
    try {
      const config = synonymBoundaryTask._internal.normalizeOptions({ llmEnabled: true });
      assert.equal(config.model, 'deepseek-v4-flash');
      assert.equal(config.llmTransport, 'deepseek');
    } finally {
      if (saved === undefined) delete process.env.DEEPSEEK_MODEL;
      else process.env.DEEPSEEK_MODEL = saved;
    }
  });
});
```

- [ ] **Step 2: Run targeted tests and confirm failure**

Run:

```bash
node --test tests/unit/knowledgeTasks.test.js
```

Expected: fails because options still default to Gemini proxy/CLI.

- [ ] **Step 3: Update cluster task**

In `services/knowledge/tasks/cluster.js`:

- Replace Gemini imports with:

```js
const deepseekService = require('../../llm/deepseekService');
```

- In `normalizeOptions`, remove `llmTransport`, `llmGatewayUrl`, and proxy auth options. Return:

```js
model: options.model || process.env.KNOWLEDGE_CLUSTER_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
llmTransport: 'deepseek',
```

- Replace `invokeLlm` with:

```js
async function invokeLlm(prompt, config) {
  if (config.llmInvoke) return config.llmInvoke(prompt);
  return deepseekService.generateJson(prompt, {
    model: config.model,
    timeoutMs: config.llmTimeoutMs,
  });
}
```

`responseToText()` already accepts `{ text, rawOutput }`, so no parser rewrite is needed.

- [ ] **Step 4: Update synonym boundary task**

In `services/knowledge/tasks/synonymBoundary.js`:

- Replace Gemini imports with:

```js
const deepseekService = require('../../llm/deepseekService');
```

- In `normalizeOptions`, remove Gemini proxy and CLI fields. Return:

```js
model: options.model || process.env.KNOWLEDGE_SYNONYM_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
llmTransport: 'deepseek',
```

- Replace any Gemini invocation block with:

```js
const response = await deepseekService.generateJson(prompt, {
  model: config.model,
  timeoutMs: config.llmTimeoutMs,
});
```

Preserve existing retry loop controlled by `llmRetries` and `llmRetryDelayMs`.

- [ ] **Step 5: Run targeted tests**

Run:

```bash
node --test tests/unit/knowledgeTasks.test.js
```

Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add services/knowledge/tasks/cluster.js services/knowledge/tasks/synonymBoundary.js tests/unit/knowledgeTasks.test.js
git commit -m "feat: use deepseek for knowledge llm tasks"
```

---

### Task 7: Remove Gemini Setup UX And Update Frontend Labels

**Files:**
- Modify: `public/index.html`
- Modify: `public/knowledge-hub.html`
- Modify: `public/js/modules/api.js`
- Modify: `public/js/modules/app.js`
- Modify: `public/js/modules/store.js`
- Modify: `public/styles.css`
- Modify: `tests/e2e/frontend-regression.spec.js`

- [ ] **Step 1: Write failing frontend expectations**

In `tests/e2e/frontend-regression.spec.js`, change the teacher model assertion:

```js
await expect(page.locator('#teacherModelHint')).toHaveText('DeepSeek V4 Flash');
```

Add this assertion after `await page.goto('/')` in the first test:

```js
await expect(page.locator('#setupOverlay')).toBeHidden();
await expect(page.locator('body')).not.toContainText('Gemini CLI');
```

- [ ] **Step 2: Run targeted E2E test and confirm failure**

Run:

```bash
npm run test:e2e -- tests/e2e/frontend-regression.spec.js --grep "01 首页"
```

Expected: fails because current label still says Gemini.

- [ ] **Step 3: Update HTML labels**

In `public/index.html`:

- Change infra title defaults:

```html
<span id="infraAlertTitle" class="infra-alert-title">DeepSeek API 异常</span>
<span id="infraAlertText" class="infra-alert-text">DeepSeek API 暂不可用，生成任务暂不可用。</span>
```

- Change teacher hint:

```html
<span class="selector-hint mode-deepseek" id="teacherModelHint">DeepSeek V4 Flash</span>
```

- Change `cardTypeHint` class from `mode-gemini` to `mode-deepseek`.

In `public/knowledge-hub.html`, replace tooltip mentions:

```html
title="重建词条索引（纯转换，不调用 LLM）"
title="重建语义分类（规则打底 + DeepSeek 补未命中，需 DeepSeek API key）"
```

- [ ] **Step 4: Remove Gemini auth API methods**

In `public/js/modules/api.js`, delete:

```js
async getGeminiAuthStatus() { ... }
async startGeminiAuth() { ... }
async submitGeminiAuth(code) { ... }
async cancelGeminiAuth() { ... }
```

- [ ] **Step 5: Remove setup overlay bootstrap**

In `public/js/modules/app.js`:

- Remove `initGeminiSetup();` from `init()`.
- Delete the full `initGeminiSetup()` function and helper functions used only by it.
- Replace embed comment with:

```js
// Skip the full app bootstrap — no folder loading, queue, or health pollers.
```

- Update `CARD_TYPE_CONFIG.trilingual.hintClass`:

```js
hintClass: 'mode-deepseek',
```

- In `buildGenerationBlockedReason`, inspect the DeepSeek service:

```js
const deepseek = getInfrastructureService(services, 'DeepSeek API');
if (deepseek && deepseek.status !== 'online') {
  return deepseek.message || 'DeepSeek API 暂不可用，新的生成任务暂不可提交。';
}
```

- In `buildInfrastructureAlertState`, inspect the same service:

```js
const deepseek = getInfrastructureService(services, 'DeepSeek API');
if (deepseek && deepseek.status !== 'online') {
  return {
    visible: true,
    title: 'DeepSeek API 异常',
    text: deepseek.message || 'DeepSeek API 暂不可用，新的生成任务将失败。'
  };
}
```

- Replace default provider strings:

```js
provider: String(job.provider || 'deepseek').trim() || 'deepseek',
```

and:

```js
const provider = 'deepseek';
```

and:

```js
const providerLabel = (metrics.metadata?.provider || rawMetrics?.llm_provider || store.get('llmProvider') || 'deepseek').toUpperCase();
```

- [ ] **Step 6: Update store default**

In `public/js/modules/store.js`:

```js
localStorage.setItem('llm_provider', 'deepseek');
```

and:

```js
llmProvider: 'deepseek',
```

- [ ] **Step 7: Update CSS class**

In `public/styles.css`, rename:

```css
.selector-hint.mode-gemini {
```

to:

```css
.selector-hint.mode-deepseek {
```

Keep the current visual declarations unchanged.

- [ ] **Step 8: Run targeted E2E test**

Run:

```bash
npm run test:e2e -- tests/e2e/frontend-regression.spec.js --grep "01 首页"
```

Expected: passes.

- [ ] **Step 9: Commit**

```bash
git add public/index.html public/knowledge-hub.html public/js/modules/api.js public/js/modules/app.js public/js/modules/store.js public/styles.css tests/e2e/frontend-regression.spec.js
git commit -m "feat: remove gemini setup from frontend"
```

---

### Task 8: Remove Gemini Docker, Package, And Active Docs

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `package.json`
- Modify: `package-lock.json`
- Delete: `Dockerfile.gemini-gateway`
- Delete: `scripts/infra/gemini-host-proxy.js`
- Delete: `scripts/infra/start-gemini-proxy.sh`
- Delete: `Docs/Operations/Gemini/GEMINI_CLI_调用方式详解.md`
- Delete: `Docs/Operations/Gemini/GEMINI_CLI_知识分析任务执行规范.md`
- Delete: `Docs/Architecture/GEMINI_PROXY_AND_SERVER_QUEUE_REDESIGN.md`
- Delete: lowercase `docs/...` Gemini copies if present
- Modify: `Docs/README.md`
- Modify: `README.md`
- Modify: `Docs/Architecture/Trilingual_Card_Generation_System.md`
- Modify: `Docs/Architecture/Knowledge/Knowledge_Local_Analysis_System_Design.md`

- [ ] **Step 1: Update Docker Compose**

In `docker-compose.yml`:

- Remove `gemini-proxy` from `viewer.depends_on`.
- Remove every `GEMINI_*`, `TRAINING_PROXY_*`, `TRAINING_REPAIR_*`, `TRAINING_BACKFILL_*`, and `TRAINING_TEACHER_MODEL` environment entry from `viewer`.
- Add:

```yaml
      - DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY:-}
      - DEEPSEEK_BASE_URL=${DEEPSEEK_BASE_URL:-https://api.deepseek.com}
      - DEEPSEEK_MODEL=${DEEPSEEK_MODEL:-deepseek-v4-flash}
      - DEEPSEEK_TIMEOUT_MS=${DEEPSEEK_TIMEOUT_MS:-120000}
      - DEEPSEEK_THINKING=${DEEPSEEK_THINKING:-disabled}
```

- Delete the entire `gemini-proxy:` service.

- [ ] **Step 2: Update environment example**

Replace the active Gemini and local LLM generation sections in `.env.example` with:

```dotenv
# ========================================
# DeepSeek LLM 配置（当前唯一生成链路）
# ========================================
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_TIMEOUT_MS=120000
DEEPSEEK_THINKING=disabled

# LLM 输出控制
LLM_MAX_TOKENS=4096
LLM_TEMPERATURE=0.2
```

Update knowledge LLM comments:

```dotenv
# KNOWLEDGE_CLUSTER_MODEL=deepseek-v4-flash
# KNOWLEDGE_SYNONYM_MODEL=deepseek-v4-flash
```

Remove Gemini re-enable instructions.

- [ ] **Step 3: Remove package dependency and scripts**

Run:

```bash
npm uninstall @google/generative-ai
```

Then remove these scripts from `package.json` if `npm uninstall` did not touch them:

```json
"gemini-proxy": "node scripts/infra/gemini-host-proxy.js",
"test:e2e:gemini-sanitize": "playwright test tests/e2e/gemini-sanitize.spec.js",
"test:e2e:real": "RUN_REAL_GEMINI_E2E=1 playwright test tests/e2e/real-gemini.spec.js"
```

Add:

```json
"test:e2e:real": "RUN_REAL_DEEPSEEK_E2E=1 playwright test tests/e2e/real-deepseek.spec.js"
```

- [ ] **Step 4: Delete Gemini infra and active docs**

Run:

```bash
git rm Dockerfile.gemini-gateway
git rm scripts/infra/gemini-host-proxy.js scripts/infra/start-gemini-proxy.sh
git rm Docs/Operations/Gemini/GEMINI_CLI_调用方式详解.md
git rm Docs/Operations/Gemini/GEMINI_CLI_知识分析任务执行规范.md
git rm Docs/Architecture/GEMINI_PROXY_AND_SERVER_QUEUE_REDESIGN.md
```

If lowercase `docs/...` copies are tracked, remove them with:

```bash
git rm docs/Operations/Gemini/GEMINI_CLI_调用方式详解.md
git rm docs/Operations/Gemini/GEMINI_CLI_知识分析任务执行规范.md
git rm docs/Architecture/GEMINI_PROXY_AND_SERVER_QUEUE_REDESIGN.md
```

- [ ] **Step 5: Update active docs**

In `README.md`, `Docs/README.md`, `Docs/Architecture/Trilingual_Card_Generation_System.md`, and `Docs/Architecture/Knowledge/Knowledge_Local_Analysis_System_Design.md`:

- Replace active Gemini generation wording with DeepSeek V4 Flash.
- Replace Gemini proxy diagrams with a direct DeepSeek API call.
- Replace config references with `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, and `DEEPSEEK_MODEL`.
- State that historical rows may still show `gemini`, but new generation uses `deepseek`.

- [ ] **Step 6: Run config sanity checks**

Run:

```bash
npm install
npm run lint
```

Expected: dependency tree is stable and lint passes.

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml .env.example package.json package-lock.json README.md Docs/README.md Docs/Architecture/Trilingual_Card_Generation_System.md Docs/Architecture/Knowledge/Knowledge_Local_Analysis_System_Design.md
git add -u
git commit -m "chore: remove gemini runtime assets"
```

---

### Task 9: Rename Or Remove Gemini-Specific Tests

**Files:**
- Delete: `tests/unit/geminiProxyService.test.js`
- Delete: `tests/unit/geminiTimeouts.test.js`
- Delete: `tests/unit/geminiProcessUtils.test.js`
- Delete: `tests/e2e/gemini-sanitize.spec.js`
- Rename: `tests/e2e/real-gemini.spec.js` -> `tests/e2e/real-deepseek.spec.js`
- Modify: `tests/e2e/real-deepseek.spec.js`
- Modify: `tests/unit/observabilityService.test.js`
- Modify: `services/observability/observabilityService.js` if needed for test names only

- [ ] **Step 1: Delete Gemini chain tests**

Run:

```bash
git rm tests/unit/geminiProxyService.test.js
git rm tests/unit/geminiTimeouts.test.js
git rm tests/unit/geminiProcessUtils.test.js
git rm tests/e2e/gemini-sanitize.spec.js
```

- [ ] **Step 2: Rename real acceptance test**

Run:

```bash
git mv tests/e2e/real-gemini.spec.js tests/e2e/real-deepseek.spec.js
```

In `tests/e2e/real-deepseek.spec.js`:

- Replace `RUN_REAL_GEMINI_E2E` with `RUN_REAL_DEEPSEEK_E2E`.
- Replace `PLAYWRIGHT_REAL_KNOWLEDGE_MODEL || 'gemini-2.5-flash'` with `PLAYWRIGHT_REAL_KNOWLEDGE_MODEL || 'deepseek-v4-flash'`.
- Replace test titles so they say `DeepSeek`.
- Replace generated phrase prefix:

```js
const phrase = `PW real deepseek ${Date.now()}`;
```

- Use knowledge options:

```js
options: {
  llmEnabled: true,
  maxPairs: 1,
  maxLlmPairs: 1,
  minCandidateScore: 0,
  llmTimeoutMs: 120000,
  model
}
```

Do not include `llmTransport: 'proxy'`.

- [ ] **Step 3: Rename observability token helper tests only if needed**

If `tests/unit/observabilityService.test.js` only uses Gemini names for token shape, rename descriptions to provider-neutral language. Keep the tested behavior if it parses the same `usageMetadata` shape for historical records.

- [ ] **Step 4: Run unit and Playwright list sanity**

Run:

```bash
npm run test:unit
npx playwright test --list | rg -n "gemini|Gemini|GEMINI" || true
```

Expected:

- Unit tests pass.
- Playwright test list has no Gemini test titles.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/real-deepseek.spec.js tests/unit/observabilityService.test.js services/observability/observabilityService.js package.json
git add -u
git commit -m "test: remove gemini-specific coverage"
```

---

### Task 10: Delete Remaining Gemini Runtime Services

**Files:**
- Delete: `services/llm/geminiAuthService.js`
- Delete: `services/llm/geminiCliService.js`
- Delete: `services/llm/geminiErrors.js`
- Delete: `services/llm/geminiGatewayServer.js`
- Delete: `services/llm/geminiProcessUtils.js`
- Delete: `services/llm/geminiProxyService.js`
- Delete: `services/llm/geminiService.js`
- Delete: `services/llm/geminiTimeouts.js`
- Modify files surfaced by `rg` if imports remain

- [ ] **Step 1: Delete Gemini service files**

Run:

```bash
git rm services/llm/geminiAuthService.js
git rm services/llm/geminiCliService.js
git rm services/llm/geminiErrors.js
git rm services/llm/geminiGatewayServer.js
git rm services/llm/geminiProcessUtils.js
git rm services/llm/geminiProxyService.js
git rm services/llm/geminiService.js
git rm services/llm/geminiTimeouts.js
```

- [ ] **Step 2: Search for broken imports**

Run:

```bash
rg -n "geminiAuthService|geminiCliService|geminiProxyService|geminiGatewayServer|geminiProcessUtils|geminiTimeouts|geminiErrors|geminiService|runGemini|resolveGemini|sanitizeGemini|DEFAULT_GEMINI" .
```

Expected: only deleted-file paths in git diff, or no output. If a live import remains, replace it with DeepSeek or remove the caller path in the same task.

- [ ] **Step 3: Run full unit and integration tests**

Run:

```bash
npm run test:unit
npm run test:integration
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "chore: delete gemini llm services"
```

---

### Task 11: Final Regression, Container Rebuild, And Gemini Absence Audit

**Files:**
- Modify only files required by failed checks.

- [ ] **Step 1: Run scoped Gemini absence audit**

Run:

```bash
rg -n "gemini|Gemini|GEMINI" \
  server.js routes lib services public tests package.json docker-compose.yml .env.example Dockerfile scripts \
  --glob '!Docs/superpowers/specs/2026-06-16-deepseek-v4-flash-migration-design.md' \
  --glob '!Docs/superpowers/plans/2026-06-16-deepseek-v4-flash-migration.md'
```

Expected: no active runtime, frontend, test, Docker, or package references. If hits remain only in historical comments that the user should not see, rewrite them in this task.

- [ ] **Step 2: Run full local regression**

Run:

```bash
npm run lint
npm run test:unit
npm run test:integration
npm run test:e2e
```

Expected: all pass.

- [ ] **Step 3: Rebuild all containers**

Run:

```bash
docker compose up -d --force-recreate --build
```

Expected: `viewer`, `ocr`, `tts-en`, and `tts-ja` containers start. No `gemini-proxy` container is created by the compose project.

- [ ] **Step 4: Verify live local endpoints**

Run:

```bash
curl -fsS http://127.0.0.1:3010/api/health
curl -fsS http://127.0.0.1:3010/knowledge-hub.html >/tmp/knowledge-hub.html
curl -fsS http://127.0.0.1:3010/ >/tmp/trilingual-home.html
```

Expected:

- `/api/health` returns JSON.
- Health services include `DeepSeek API`.
- Health services do not include Gemini Gateway, Gemini Host Executor, or Gemini API.
- Home page and Knowledge Hub return 200.

- [ ] **Step 5: Optional live DeepSeek smoke if key is already in the shell environment**

Run this only when `DEEPSEEK_API_KEY` is already available in the environment. Do not paste a key into the command line.

```bash
node - <<'NODE'
const deepseek = require('./services/llm/deepseekService');
(async () => {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.log('SKIP live DeepSeek smoke: DEEPSEEK_API_KEY is not set');
    return;
  }
  const result = await deepseek.generateJson('Return only {"ok":true}', {
    model: 'deepseek-v4-flash',
    timeoutMs: 30000,
  });
  console.log(result.text);
})();
NODE
```

Expected with key present: output contains `{"ok":true}`.

- [ ] **Step 6: Commit final fixes if any**

If final checks required changes:

```bash
git add <changed-files>
git commit -m "fix: complete deepseek migration verification"
```

If no changes were needed, do not create an empty commit.

---

## Self-Review Checklist

- Spec coverage:
  - Runtime generation provider replacement: Tasks 1, 2, 3, 4.
  - Gemini auth and health removal: Task 5.
  - Knowledge LLM fallback migration: Task 6.
  - Frontend Gemini UX removal: Task 7.
  - Docker, dependency, and docs cleanup: Task 8.
  - Test cleanup: Task 9.
  - Service deletion: Task 10.
  - Full verification and container rebuild: Task 11.
- Secret handling:
  - No task writes a real DeepSeek key to repo files.
  - `.env.example` uses placeholder text only.
  - Live smoke uses an already-exported `DEEPSEEK_API_KEY` and never echoes it.
- Historical data:
  - Existing `gemini` database rows remain readable.
  - New defaults and new jobs use `deepseek`.
- Type consistency:
  - Provider string is `deepseek`.
  - Default model string is `deepseek-v4-flash`.
  - DeepSeek JSON calls use `{ type: 'json_object' }`.
  - Retry-compatible rate-limit code remains `MODEL_CAPACITY_EXHAUSTED`.

## Execution Handoff

Plan complete. Use either:

1. **Subagent-Driven**: dispatch one fresh subagent per task, review each task before the next task.
2. **Inline Execution**: execute this plan in the current session with checkpoints after each task group.
