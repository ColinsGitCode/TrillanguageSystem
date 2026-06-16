'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { CODES } = require('../../services/llm/llmErrors');

function loadService() {
  delete require.cache[require.resolve('../../services/llm/deepseekService')];
  return require('../../services/llm/deepseekService');
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function mockFetch(handler) {
  const calls = [];
  const orig = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return handler({ url: String(url), opts, callIndex: calls.length - 1 });
  };
  return { calls, restore: () => { global.fetch = orig; } };
}

function withEnv(values, fn) {
  const saved = {};
  for (const key of Object.keys(values)) {
    saved[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(values)) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    });
}

test.describe('deepseekService', () => {
  test.it('generateMarkdown builds a non-stream DeepSeek chat completion request', async (t) => {
    await withEnv({ DEEPSEEK_API_KEY: 'test-key' }, async () => {
      const m = mockFetch(() => jsonResponse(200, {
        model: 'deepseek-v4-flash',
        choices: [{ message: { content: '# Hello' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
      }));
      t.after(() => m.restore());

      const { generateMarkdown } = loadService();
      const result = await generateMarkdown('Write markdown');

      assert.equal(m.calls.length, 1);
      assert.equal(m.calls[0].url, 'https://api.deepseek.com/chat/completions');
      assert.equal(m.calls[0].opts.method, 'POST');
      assert.equal(m.calls[0].opts.headers['Content-Type'], 'application/json');
      assert.equal(m.calls[0].opts.headers.Authorization, 'Bearer test-key');

      const body = JSON.parse(m.calls[0].opts.body);
      assert.equal(body.model, 'deepseek-v4-flash');
      assert.deepEqual(body.messages[0], { role: 'user', content: 'Write markdown' });
      assert.equal(body.stream, false);
      assert.deepEqual(body.thinking, { type: 'disabled' });
      assert.equal(Object.hasOwn(body, 'response_format'), false);

      assert.equal(result.markdown, '# Hello');
      assert.equal(result.rawOutput, '# Hello');
      assert.equal(result.model, 'deepseek-v4-flash');
      assert.deepEqual(result.usage, { input: 11, output: 7, total: 18 });
      assert.equal(result.finishReason, 'stop');
    });
  });

  test.it('generateJson adds JSON response mode and returns text', async (t) => {
    await withEnv({ DEEPSEEK_API_KEY: 'test-key' }, async () => {
      const m = mockFetch(() => jsonResponse(200, {
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
      }));
      t.after(() => m.restore());

      const { generateJson } = loadService();
      const result = await generateJson('Return JSON', { model: 'deepseek-v4-pro' });

      const body = JSON.parse(m.calls[0].opts.body);
      assert.equal(body.model, 'deepseek-v4-pro');
      assert.deepEqual(body.response_format, { type: 'json_object' });
      assert.equal(result.text, '{"ok":true}');
      assert.equal(result.rawOutput, '{"ok":true}');
      assert.deepEqual(result.usage, { input: 3, output: 4, total: 7 });
    });
  });

  test.it('missing API key throws a config error', async () => {
    await withEnv({ DEEPSEEK_API_KEY: undefined }, async () => {
      const { generateMarkdown } = loadService();
      await assert.rejects(
        () => generateMarkdown('prompt'),
        (err) => err.code === CODES.CONFIG_ERROR && err.status === 500
      );
    });
  });

  test.it('maps 429 provider responses to rate limited errors', async (t) => {
    await withEnv({ DEEPSEEK_API_KEY: 'test-key' }, async () => {
      const m = mockFetch(() => jsonResponse(429, { error: { message: 'slow down' } }));
      t.after(() => m.restore());

      const { generateMarkdown } = loadService();
      await assert.rejects(
        () => generateMarkdown('prompt'),
        (err) => err.code === CODES.RATE_LIMITED && err.status === 429
      );
    });
  });

  test.it('maps 5xx provider responses to unavailable errors', async (t) => {
    await withEnv({ DEEPSEEK_API_KEY: 'test-key' }, async () => {
      const m = mockFetch(() => jsonResponse(503, { error: { message: 'maintenance' } }));
      t.after(() => m.restore());

      const { generateMarkdown } = loadService();
      await assert.rejects(
        () => generateMarkdown('prompt'),
        (err) => err.code === CODES.UNAVAILABLE && err.status === 502
      );
    });
  });

  test.it('empty provider content throws an empty response error', async (t) => {
    await withEnv({ DEEPSEEK_API_KEY: 'test-key' }, async () => {
      const m = mockFetch(() => jsonResponse(200, {
        choices: [{ message: { content: '   ' }, finish_reason: 'stop' }],
      }));
      t.after(() => m.restore());

      const { generateMarkdown } = loadService();
      await assert.rejects(
        () => generateMarkdown('prompt'),
        (err) => err.code === CODES.EMPTY_RESPONSE
      );
    });
  });
});
