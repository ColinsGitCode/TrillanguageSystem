'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Keep logger noise off the test runner.
process.env.LOG_SILENT = '1';

const {
  TokenCounter,
  PerformanceMonitor,
  PromptParser
} = require('../../services/observability/observabilityService');

test.describe('TokenCounter.estimate', () => {
  test.it('returns 0 for null / empty / non-string input', () => {
    assert.equal(TokenCounter.estimate(null), 0);
    assert.equal(TokenCounter.estimate(undefined), 0);
    assert.equal(TokenCounter.estimate(''), 0);
    assert.equal(TokenCounter.estimate(42), 0);
  });

  test.it('uses ceil(length/4) as the rough token estimate', () => {
    assert.equal(TokenCounter.estimate('1234'), 1);
    assert.equal(TokenCounter.estimate('12345'), 2);
    assert.equal(TokenCounter.estimate('A'.repeat(400)), 100);
  });
});

test.describe('TokenCounter.extractGeminiTokens', () => {
  test.it('returns zeros + cached field when no usage metadata', () => {
    assert.deepEqual(
      TokenCounter.extractGeminiTokens({}),
      { input: 0, output: 0, total: 0, cached: 0 }
    );
    assert.deepEqual(
      TokenCounter.extractGeminiTokens(null),
      { input: 0, output: 0, total: 0, cached: 0 }
    );
  });

  test.it('reads usageMetadata fields', () => {
    const res = TokenCounter.extractGeminiTokens({
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 200,
        totalTokenCount: 300,
        cachedContentTokenCount: 5
      }
    });
    assert.deepEqual(res, { input: 100, output: 200, total: 300, cached: 5 });
  });

  test.it('falls back to `usage` if usageMetadata is missing', () => {
    const res = TokenCounter.extractGeminiTokens({
      usage: { promptTokenCount: 9, candidatesTokenCount: 1, totalTokenCount: 10 }
    });
    assert.equal(res.input, 9);
    assert.equal(res.output, 1);
    assert.equal(res.total, 10);
    assert.equal(res.cached, 0);
  });
});

test.describe('TokenCounter.extractOpenAITokens', () => {
  test.it('returns zeros (no cached field) when usage missing', () => {
    assert.deepEqual(
      TokenCounter.extractOpenAITokens({}),
      { input: 0, output: 0, total: 0 }
    );
  });

  test.it('reads usage.prompt_tokens / completion_tokens / total_tokens', () => {
    const res = TokenCounter.extractOpenAITokens({
      usage: { prompt_tokens: 7, completion_tokens: 13, total_tokens: 20 }
    });
    assert.deepEqual(res, { input: 7, output: 13, total: 20 });
  });
});

test.describe('TokenCounter.calculateCost', () => {
  test.it('returns zero cost for gemini (free tier)', () => {
    assert.deepEqual(
      TokenCounter.calculateCost({ input: 1000, output: 2000, total: 3000 }, 'gemini'),
      { input: 0, output: 0, total: 0 }
    );
  });

  test.it('returns zero cost for local', () => {
    assert.deepEqual(
      TokenCounter.calculateCost({ input: 1, output: 1, total: 2 }, 'local'),
      { input: 0, output: 0, total: 0 }
    );
  });

  test.it('returns zero cost for unknown providers (safe default)', () => {
    assert.deepEqual(
      TokenCounter.calculateCost({}, 'mystery'),
      { input: 0, output: 0, total: 0 }
    );
  });
});

test.describe('PerformanceMonitor', () => {
  test.it('start → mark → end records each phase + totalTime', (t) => {
    // Lock the clock so the test isn't subject to wall-clock jitter.
    t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
    const perf = new PerformanceMonitor().start();
    t.mock.timers.tick(40);
    perf.mark('promptBuild');
    t.mock.timers.tick(120);
    perf.mark('llmCall');
    t.mock.timers.tick(10);
    perf.mark('jsonParse');
    t.mock.timers.tick(5);
    const result = perf.end();

    assert.equal(result.totalTime, 175);
    assert.deepEqual(result.phases, {
      promptBuild: 40,
      llmCall: 120,
      jsonParse: 10
    });
    // networkLatency mirrors the llmCall phase; serverProcessing is the rest.
    assert.equal(result.networkLatency, 120);
    assert.equal(result.serverProcessing, 55);
  });

  test.it('end() falls back to 0 for missing llmCall (serverProcessing == total)', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
    const perf = new PerformanceMonitor().start();
    t.mock.timers.tick(50);
    perf.mark('promptBuild');
    t.mock.timers.tick(10);
    const result = perf.end();

    assert.equal(result.networkLatency, 0);
    assert.equal(result.serverProcessing, 60);
  });
});

test.describe('PromptParser.parse', () => {
  test.it('returns the empty shape for non-string input', () => {
    const out = PromptParser.parse(null);
    assert.equal(out.full, '');
    assert.equal(out.metadata.length, 0);
    assert.equal(out.metadata.tokenCount, 0);
    assert.equal(out.metadata.templateVersion, 'unknown');
    assert.deepEqual(out.structure.chainOfThought, []);
    assert.deepEqual(out.structure.fewShotExamples, []);
  });

  test.it('extracts CoT steps, few-shot examples, and the user input', () => {
    const prompt = [
      '你是三语卡片生成器。',
      '请严格按照以下步骤思考。',
      '步骤1：识别短语含义',
      '步骤2：写出英日中三种翻译',
      '步骤3：补充例句',
      '## 示例',
      '### 示例1：persistent state',
      '示例内容',
      '### 示例2：retry queue',
      '示例内容',
      '## 质量标准',
      '- **完整性**: 所有 section 必须填齐',
      '- **准确性**: 翻译必须忠实',
      '---',
      '用户输入: hello world'
    ].join('\n');

    const out = PromptParser.parse(prompt);
    assert.equal(out.metadata.templateVersion, 'v2.0-optimized');
    assert.ok(out.metadata.length > 0);
    assert.equal(out.metadata.tokenCount, Math.ceil(prompt.length / 4));
    assert.ok(out.structure.systemInstruction.includes('三语卡片生成器'));
    assert.equal(out.structure.chainOfThought.length, 3);
    assert.equal(out.structure.fewShotExamples.length, 2);
    assert.equal(out.structure.fewShotExamples[0].title, 'persistent state');
    assert.deepEqual(out.structure.qualityStandards, ['完整性', '准确性']);
    assert.equal(out.structure.userInput, 'hello world');
  });
});
