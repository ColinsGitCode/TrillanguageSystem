# LLM Provider 统一层重构设计文档

> **项目名称**: Trilingual Records Viewer - LLM Provider 层统一化重构
> **版本**: v1.0
> **创建日期**: 2026-02-09
> **作者**: Claude & Team

---

## 目录

- [1. 背景与动机](#1-背景与动机)
- [2. 现状分析与痛点](#2-现状分析与痛点)
- [3. 技术选型](#3-技术选型)
- [4. 架构设计](#4-架构设计)
- [5. Zod Schema 设计](#5-zod-schema-设计)
- [6. 实施方案](#6-实施方案)
- [7. 迁移策略](#7-迁移策略)
- [8. 兼容性与风险评估](#8-兼容性与风险评估)
- [9. 测试计划](#9-测试计划)
- [10. 后续演进：Langfuse 可观测性平台](#10-后续演进langfuse-可观测性平台)

---

## 1. 背景与动机

### 1.1 项目现状

当前三语卡片生成系统后端由 Node.js/Express 构建，核心数据流为：

```
用户输入 → Prompt 构建 → LLM 调用 → JSON 解析 → 后处理 → HTML 渲染 → 文件存储 → TTS 生成
```

在 LLM 调用层，系统已演化出 **5 个独立 Service 文件** 来适配不同 Provider：

| 文件 | 职责 | 行数 |
|------|------|------|
| `geminiService.js` | Gemini SDK 调用（已封存） | 124 |
| `localLlmService.js` | OpenAI 兼容 API（Ollama/vLLM） | 205 |
| `geminiCliService.js` | Gemini CLI 子进程调用 | 77 |
| `geminiProxyService.js` | Gemini Host Proxy HTTP 调用 | 22 |
| `geminiAuthService.js` | Gemini CLI OAuth 认证管理 | ~100 |

### 1.2 引发本次重构的核心问题

**问题 1：Provider 切换逻辑散落在 server.js 中**

`server.js:generateWithProvider()` (L122-L338) 包含大量 if/else 分支来决定调用哪个 Provider，以及如何归一化响应格式：

```javascript
// server.js L132-L139 — 模式判断逻辑
const geminiMode = (process.env.GEMINI_MODE || 'cli').toLowerCase();
const useGeminiCli = provider === 'gemini' && geminiMode === 'cli';
const useGeminiProxy = provider === 'gemini' && geminiMode === 'host-proxy';
const useLocalMarkdown = provider === 'local' && localOutputMode === 'markdown';
const useMarkdownOutput = useGeminiCli || useGeminiProxy || useLocalMarkdown;
```

```javascript
// server.js L251-L287 — 三路分发 + 两路响应归一化
if (useGeminiCli) {
    response = await runGeminiCli(prompt, { ... });
} else if (useGeminiProxy) {
    response = await runGeminiProxy(prompt, { ... });
} else {
    response = await llmService.generateContent(prompt);
}

// 再加一段归一化
if (useGeminiCli || useGeminiProxy) {
    // ...20 行代码将 markdown 响应转为统一格式
} else if (response.content && response.usage) {
    content = response.content;
    usage = response.usage;
} else {
    content = response;
    usage = { input: 0, output: 0, total: 0 };
}
```

**问题 2：JSON 解析逻辑重复实现**

`parseJsonFromText()` 在两个文件中各写了一份，功能相似但实现不同：

- `geminiService.js:31-48` — 简单版，只处理 markdown code block
- `localLlmService.js:13-40` — 增强版，增加了 truncation 检测和 brace 定位

两个实现都缺乏结构化校验，只做了 `JSON.parse` 后就直接使用，依赖 `validateGeneratedContent()` 在后续环节做字段检查。

**问题 3：Token 统计粗糙**

`observabilityService.js:TokenCounter.estimate()` 使用 `Math.ceil(text.length / 4)` 进行估算，对中日韩混合文本误差极大（CJK 字符通常 1 字 = 1-2 token，而非 0.25 token）。各 Provider 的 usage 提取方式也各不相同。

**问题 4：输出校验薄弱**

`validateGeneratedContent()` (server.js L104-L118) 仅做最基本的 null 检查：

```javascript
function validateGeneratedContent(content, options = {}) {
    const errors = [];
    if (!content || typeof content !== 'object') {
        errors.push('Response is not a valid JSON object');
        return errors;
    }
    if (typeof content.markdown_content !== 'string' || !content.markdown_content.trim()) {
        errors.push('markdown_content is missing or empty');
    }
    return errors;
}
```

不检查 `audio_tasks` 的结构（是否为数组、子项是否包含 text/lang/filename_suffix）、不检查 markdown 是否包含三语 section。

---

## 2. 现状分析与痛点

### 2.1 架构图（当前）

```
                          server.js (generateWithProvider)
                                    |
                 ┌──────────────────┼──────────────────────┐
                 |                  |                       |
        geminiService.js    geminiCliService.js    localLlmService.js
        (Gemini SDK)        (子进程 spawn)          (OpenAI API)
                 |                                         |
        geminiProxyService.js                    (Ollama / vLLM)
        (HTTP Proxy)
                 |
        geminiAuthService.js
        (OAuth 认证)

        [各 Service 自行实现 JSON 解析、错误处理、响应格式]
        [server.js 负责归一化、校验、后处理]
```

### 2.2 痛点量化

| 指标 | 当前值 | 目标值 |
|------|--------|--------|
| LLM 相关 Service 文件数 | 5 个 | 1-2 个 |
| `parseJsonFromText` 实现数 | 2 个 | 0 个（由 Zod + Structured Output 替代） |
| server.js `generateWithProvider` 行数 | ~216 行 | ~60 行 |
| LLM 响应归一化分支数 | 3 个 if/else | 0 个（统一接口） |
| 输出 Schema 校验字段数 | 2 个（markdown_content, html_content） | 完整 Schema（含 audio_tasks 结构校验） |
| Token 估算误差（CJK 文本） | ~300% | <20%（使用 Provider 原生 usage） |

---

## 3. 技术选型

### 3.1 选型对比

| 维度 | Vercel AI SDK (`ai`) | LangChain.js | 直接封装 |
|------|---------------------|-------------|---------|
| **Provider 统一** | 原生支持 Google, OpenAI, Ollama 等 | 支持，但 Chain 抽象过重 | 需自行实现 |
| **Structured Output** | `generateObject()` + Zod | 有，但 API 较复杂 | 需自行实现 |
| **Token Usage** | 统一 `usage` 对象 | 通过 callbacks | 需自行适配 |
| **包体大小** | `ai` 核心 ~50KB | >500KB + 大量子依赖 | 0 |
| **学习成本** | 低（函数式 API） | 高（Chain/Agent/Memory 概念） | 中 |
| **与 Express 集成** | 原生 Node.js，无缝 | 需要适配 | 无缝 |
| **维护活跃度** | Vercel 官方维护，周更 | 社区维护，更新频繁但 breaking change 多 | N/A |

### 3.2 最终选择

**Vercel AI SDK (`ai`) + Provider 适配包 + Zod**

```
ai                    → 核心统一接口（generateText / generateObject）
@ai-sdk/google        → Google Gemini Provider
@ai-sdk/openai-compatible → OpenAI 兼容 Provider（覆盖 Ollama / vLLM）
zod                   → Schema 定义与运行时校验
```

选择理由：
1. **函数式 API**，不引入 Chain/Graph 等概念，与当前代码风格一致
2. **Structured Output** 让 LLM 直接输出符合 Zod Schema 的对象，消除 `parseJsonFromText`
3. **统一 usage 对象**，不再需要分别处理 Gemini/OpenAI 的 token 格式
4. **渐进式迁移**，可以逐个 Provider 替换，不需要一次性重写

### 3.3 新增依赖清单

| 包名 | 版本 | 用途 | 大小 |
|------|------|------|------|
| `ai` | ^4.x | 核心 SDK | ~50KB |
| `@ai-sdk/google` | ^1.x | Gemini Provider | ~20KB |
| `@ai-sdk/openai-compatible` | ^0.x | Ollama/vLLM Provider | ~15KB |
| `zod` | ^3.x | Schema 定义与校验 | ~55KB |

安装命令：

```bash
npm install ai @ai-sdk/google @ai-sdk/openai-compatible zod
```

### 3.4 可移除的依赖

重构完成后可移除：

| 包名 | 原因 |
|------|------|
| `@google/generative-ai` | 被 `@ai-sdk/google` 替代 |

---

## 4. 架构设计

### 4.1 架构图（重构后）

```
                        server.js (generateWithProvider - 精简版)
                                    |
                          services/llmUnifiedService.js
                          (统一入口，~80 行)
                                    |
                    ┌───────────────┼───────────────┐
                    |               |               |
              @ai-sdk/google  @ai-sdk/openai   Gemini CLI
              (Gemini API)    (Ollama/vLLM)    (保留，适配封装)
                                    |
                              Zod Schema
                          (trilingualCardSchema)
                              校验 + 类型安全
```

### 4.2 模块职责划分

#### `services/llmUnifiedService.js` — 新增，统一 LLM 调用入口

```
职责：
  1. 根据 provider 参数选择对应的 AI SDK model 实例
  2. 调用 generateObject() 获取结构化输出（JSON 模式）
     或 generateText() 获取 Markdown 纯文本输出
  3. 返回统一格式：{ content, usage, model }
  4. 封装重试逻辑（context window 超限时自动缩减 maxTokens）

不做的事：
  - 不做 prompt 构建（由 promptEngine.js 负责）
  - 不做后处理（由 contentPostProcessor.js 负责）
  - 不做文件存储或 TTS（由各自 service 负责）
```

#### `services/schemas/trilingualCard.js` — 新增，Zod Schema 定义

```
职责：
  1. 定义 LLM 输出的完整 Schema（markdown_content, audio_tasks 等）
  2. 被 llmUnifiedService.js 用于 generateObject() 的 schema 参数
  3. 被 server.js 用于替代 validateGeneratedContent()
  4. 导出 TypeScript 类型（如果未来迁移 TS）
```

#### 保留文件

| 文件 | 处理方式 |
|------|---------|
| `geminiCliService.js` | **保留**，包装为统一接口的 fallback 选项 |
| `geminiAuthService.js` | **保留**，CLI 认证逻辑独立于 Provider 层 |
| `geminiService.js` | **归档后删除**，功能由 `@ai-sdk/google` 替代 |
| `localLlmService.js` | **归档后删除**，功能由 `@ai-sdk/openai-compatible` 替代 |
| `geminiProxyService.js` | **归档后删除**，功能由统一层替代 |
| `observabilityService.js` | **保留并简化**，移除 `TokenCounter.estimate()`，改用 SDK 原生 usage |
| `promptEngine.js` | **保留不变**，prompt 构建逻辑独立于 Provider 层 |

### 4.3 调用流程（重构后）

```
POST /api/generate
    │
    ▼
server.js: 解析请求参数
    │
    ▼
promptEngine.js: buildPrompt() / buildMarkdownPrompt()
    │ (返回 prompt 字符串)
    ▼
llmUnifiedService.js: generate(prompt, { provider, outputMode, schema })
    │
    ├─ provider='google'  → @ai-sdk/google (Gemini API)
    ├─ provider='ollama'  → @ai-sdk/openai-compatible (Ollama)
    ├─ provider='vllm'    → @ai-sdk/openai-compatible (vLLM)
    └─ provider='gemini-cli' → geminiCliService.js (子进程，保留)
    │
    │ (所有路径返回统一格式)
    ▼
{ content: { markdown_content, audio_tasks }, usage: { input, output, total }, model }
    │
    ▼
server.js: 后处理、渲染、存储、TTS（逻辑不变，但代码精简）
```

---

## 5. Zod Schema 设计

### 5.1 核心 Schema：trilingualCardSchema

```javascript
// services/schemas/trilingualCard.js
const { z } = require('zod');

/**
 * 单条音频任务 Schema
 */
const audioTaskSchema = z.object({
  text: z.string().describe('要朗读的文本，去掉末尾标点，日语不含 ruby 标记'),
  lang: z.enum(['en', 'ja']).describe('语言代码'),
  filename_suffix: z.string().regex(/^_(en|ja)_\d+$/).describe('文件名后缀，如 _en_1')
});

/**
 * 三语卡片完整输出 Schema
 * 用于 generateObject() 的 schema 参数，同时用于校验
 */
const trilingualCardSchema = z.object({
  markdown_content: z.string()
    .min(100)
    .describe('Markdown 格式的三语翻译卡片内容，包含英文、日语、中文三个 section'),
  audio_tasks: z.array(audioTaskSchema)
    .length(4)
    .describe('4 条音频任务：en_1, en_2, ja_1, ja_2')
});

/**
 * Markdown 纯文本输出模式（用于 Gemini CLI / Proxy 场景）
 * 此模式下 LLM 只输出 Markdown，audio_tasks 由后处理从 Markdown 中提取
 */
const markdownOnlySchema = z.object({
  markdown_content: z.string().min(50)
});

module.exports = {
  trilingualCardSchema,
  markdownOnlySchema,
  audioTaskSchema
};
```

### 5.2 Schema 使用场景

| 场景 | Schema | 说明 |
|------|--------|------|
| JSON 模式（Gemini API / Local LLM） | `trilingualCardSchema` | LLM 直接输出结构化 JSON |
| Markdown 模式（Gemini CLI / Proxy） | `markdownOnlySchema` | LLM 输出纯 Markdown，audio_tasks 由 `buildAudioTasksFromMarkdown()` 后处理补充 |
| 响应校验（替代 `validateGeneratedContent`） | `trilingualCardSchema.safeParse()` | 统一校验，返回详细错误信息 |

### 5.3 替代现有校验

**现在** (`server.js:validateGeneratedContent`):
```javascript
function validateGeneratedContent(content, options = {}) {
    const errors = [];
    if (!content || typeof content !== 'object') {
        errors.push('Response is not a valid JSON object');
    }
    if (typeof content.markdown_content !== 'string' || !content.markdown_content.trim()) {
        errors.push('markdown_content is missing or empty');
    }
    return errors;
}
```

**重构后**:
```javascript
const { trilingualCardSchema } = require('./services/schemas/trilingualCard');

// 在需要校验的地方
const result = trilingualCardSchema.safeParse(content);
if (!result.success) {
    const errors = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
    return res.status(422).json({ error: 'Validation failed', details: errors });
}
// result.data 是类型安全的
```

---

## 6. 实施方案

### 6.1 新增文件

#### 6.1.1 `services/schemas/trilingualCard.js`

如上 [5.1 节](#51-核心-schematrilingualcardschema) 所述。

#### 6.1.2 `services/llmUnifiedService.js`

核心统一层，约 120 行：

```javascript
// services/llmUnifiedService.js
const { generateObject, generateText } = require('ai');
const { createGoogleGenerativeAI } = require('@ai-sdk/google');
const { createOpenAICompatible } = require('@ai-sdk/openai-compatible');
const { trilingualCardSchema, markdownOnlySchema } = require('./schemas/trilingualCard');
const { runGeminiCli } = require('./geminiCliService');
require('dotenv').config();

// ========== Provider 工厂 ==========

function createProvider(providerName) {
  switch (providerName) {
    case 'google':
    case 'gemini': {
      const google = createGoogleGenerativeAI({
        apiKey: process.env.GEMINI_API_KEY
      });
      const modelId = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
      return google(modelId);
    }

    case 'local':
    case 'ollama':
    case 'vllm': {
      const baseURL = process.env.LLM_BASE_URL || 'http://localhost:11434/v1';
      const provider = createOpenAICompatible({
        name: providerName,
        baseURL,
        apiKey: process.env.LLM_API_KEY || 'EMPTY'
      });
      const modelId = process.env.LLM_MODEL || 'qwen2.5-coder:latest';
      return provider(modelId);
    }

    default:
      throw new Error(`Unknown provider: ${providerName}`);
  }
}

// ========== 统一生成接口 ==========

/**
 * 统一 LLM 调用入口
 *
 * @param {string} prompt - 完整 prompt 文本
 * @param {Object} options
 * @param {string} options.provider - 'google' | 'local' | 'gemini-cli'
 * @param {string} options.outputMode - 'json' | 'markdown'
 * @param {number} options.maxTokens - 最大输出 token 数
 * @param {number} options.temperature - 生成温度
 * @param {string} options.baseName - 文件名基础（用于 CLI 模式）
 * @returns {Promise<{ content: Object, usage: Object, model: string }>}
 */
async function generate(prompt, options = {}) {
  const {
    provider = 'local',
    outputMode = 'json',
    maxTokens = Number(process.env.LLM_MAX_TOKENS || 2048),
    temperature = Number(process.env.LLM_TEMPERATURE || 0.2),
    baseName = 'output'
  } = options;

  // Gemini CLI 特殊路径（子进程调用，无法走 AI SDK）
  if (provider === 'gemini-cli') {
    const cliResult = await runGeminiCli(prompt, {
      baseName,
      model: options.modelOverride || process.env.GEMINI_CLI_MODEL || ''
    });
    return {
      content: { markdown_content: cliResult.markdown, audio_tasks: [] },
      usage: { input: 0, output: 0, total: 0 },
      model: cliResult.model || 'gemini-cli'
    };
  }

  const model = createProvider(provider);

  // JSON 结构化输出模式
  if (outputMode === 'json') {
    const result = await generateObject({
      model,
      schema: trilingualCardSchema,
      prompt,
      maxTokens,
      temperature
    });

    return {
      content: result.object,
      usage: {
        input: result.usage?.promptTokens || 0,
        output: result.usage?.completionTokens || 0,
        total: (result.usage?.promptTokens || 0) + (result.usage?.completionTokens || 0)
      },
      model: provider
    };
  }

  // Markdown 纯文本输出模式
  const result = await generateText({
    model,
    prompt,
    maxTokens,
    temperature
  });

  return {
    content: { markdown_content: result.text, audio_tasks: [] },
    usage: {
      input: result.usage?.promptTokens || 0,
      output: result.usage?.completionTokens || 0,
      total: (result.usage?.promptTokens || 0) + (result.usage?.completionTokens || 0)
    },
    model: provider
  };
}

/**
 * OCR 图像识别（统一入口）
 */
async function recognizeImage(base64Image, options = {}) {
  const provider = options.provider || 'local';
  const model = createProvider(provider);

  const result = await generateText({
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Transcribe the text in this image exactly as is. Preserve original language.' },
          { type: 'image', image: base64Image }
        ]
      }
    ],
    maxTokens: Number(process.env.LLM_OCR_MAX_TOKENS || 512),
    temperature: 0
  });

  return result.text;
}

module.exports = { generate, recognizeImage, createProvider };
```

### 6.2 修改文件

#### 6.2.1 `server.js` — generateWithProvider 精简

重构前（约 216 行，L122-L338），重构后预计约 60 行。

核心改动：

```javascript
// 重构前 (server.js L122-L263) — Provider 分发 + 响应归一化
async function generateWithProvider(phrase, provider, perf, options = {}) {
  let llmService;
  try {
    llmService = provider === 'gemini' ? geminiService : require('./services/localLlmService');
  } catch (e) { ... }

  // ... 30 行 prompt 模式判断 ...
  // ... 100 行 few-shot 注入 ...
  // ... 30 行 三路分发 + 归一化 ...
}

// 重构后 — 调用统一层
async function generateWithProvider(phrase, provider, perf, options = {}) {
  perf.mark('promptBuild');
  const { targetDir, folderName } = ensureTodayDirectory();
  const baseName = buildBaseName(phrase, targetDir);

  // 确定输出模式
  const outputMode = resolveOutputMode(provider);
  const prompt = outputMode === 'markdown'
    ? buildMarkdownPrompt({ phrase, filenameBase: baseName })
    : buildPrompt({ phrase, filenameBase: baseName });

  // Few-shot 注入（逻辑保持不变，但独立为函数）
  const { enhancedPrompt, fewShotMeta } = await injectFewShot(prompt, phrase, provider, options);

  // 统一调用
  perf.mark('llmCall');
  const llmResult = await llmUnifiedService.generate(enhancedPrompt, {
    provider: mapProviderName(provider),
    outputMode,
    baseName,
    modelOverride: options.modelOverride
  });

  // Markdown 模式后处理（补充 audio_tasks 和 html）
  const content = await postProcessLlmOutput(llmResult.content, outputMode, baseName);

  perf.mark('jsonParse');
  const quality = QualityChecker.check(content, phrase);
  const promptData = PromptParser.parse(enhancedPrompt);

  return {
    output: content,
    prompt: enhancedPrompt,
    fewShot: fewShotMeta,
    baseName, targetDir, folderName,
    observability: {
      tokens: llmResult.usage,           // 直接使用 SDK 返回的精确 usage
      cost: TokenCounter.calculateCost(llmResult.usage, provider),
      quality,
      prompt: promptData,
      metadata: {
        provider,
        timestamp: Date.now(),
        model: llmResult.model,
        // ...其余 metadata
      }
    }
  };
}
```

#### 6.2.2 `services/observabilityService.js` — 简化 TokenCounter

```javascript
// 移除 estimate() 方法（不再需要粗估）
// 保留 calculateCost()、extractGeminiTokens()、extractOpenAITokens() 作为兼容 fallback
// 新增：直接使用 AI SDK 的 usage 对象

class TokenCounter {
  // 删除: static estimate(text) { ... }  — 被 SDK 原生 usage 替代

  // 保留: 成本计算
  static calculateCost(tokens, provider) { ... }

  // 新增: 从 AI SDK usage 提取统一格式（实际上 SDK 已经统一了，这里只做保险映射）
  static fromAiSdkUsage(usage) {
    return {
      input: usage?.promptTokens || 0,
      output: usage?.completionTokens || 0,
      total: (usage?.promptTokens || 0) + (usage?.completionTokens || 0)
    };
  }
}
```

注意：`TokenCounter.estimate()` 在 `goldenExamplesService.js` 的 Few-shot token 预算计算中仍有使用。该处调用需要保留一个简单估算方法（或使用 `tiktoken` 库进行精确计算）。重构阶段暂保留 `estimate()` 仅供 Few-shot 预算使用，添加 `@deprecated` 标记。

#### 6.2.3 `package.json` — 依赖更新

```json
{
  "dependencies": {
    "ai": "^4.0.0",
    "@ai-sdk/google": "^1.0.0",
    "@ai-sdk/openai-compatible": "^0.1.0",
    "zod": "^3.23.0",
    // 保留
    "better-sqlite3": "^12.6.2",
    "dotenv": "^17.2.3",
    "express": "^4.19.2",
    "kuroshiro": "^1.2.0",
    "kuroshiro-analyzer-kuromoji": "^1.1.0",
    "marked": "^9.1.6",
    "d3": "^7.9.0",
    "jsdom": "^27.4.0"
    // 移除: "@google/generative-ai" — 被 @ai-sdk/google 替代
  }
}
```

### 6.3 环境变量更新

新增/修改的环境变量：

```bash
# .env 新增

# Provider 选择（替代原来的多个 MODE 变量）
# 可选值: google | local | gemini-cli
LLM_PROVIDER=local

# 以下变量保持不变，被新的统一层读取：
# GEMINI_API_KEY, GEMINI_MODEL
# LLM_BASE_URL, LLM_API_KEY, LLM_MODEL
# LLM_MAX_TOKENS, LLM_TEMPERATURE
# GEMINI_CLI_MODEL, GEMINI_CLI_BIN

# 以下变量在迁移完成后废弃：
# GEMINI_MODE (被 LLM_PROVIDER 替代)
# LLM_OUTPUT_MODE (被统一层自动判断)
```

---

## 7. 迁移策略

### 7.1 分阶段执行

采用**逐步替换**策略，每个阶段可独立部署和回滚：

```
Phase 1 (Day 1-2)     Phase 2 (Day 3-4)      Phase 3 (Day 5)        Phase 4 (Day 6-7)
┌────────────────┐    ┌────────────────┐     ┌────────────────┐     ┌────────────────┐
│ 新增 Schema    │    │ 新增统一层     │     │ server.js 切换 │     │ 清理旧代码     │
│ + Zod 校验     │    │ + 双写验证     │     │ 至新统一层     │     │ + 移除旧 Service│
│                │    │                │     │                │     │                │
│ - 新建 schemas/│    │ - 新建统一层   │     │ - 修改 server  │     │ - 删除旧文件   │
│ - 添加 Zod 依赖│    │ - 影子模式运行 │     │ - 更新 .env    │     │ - 更新文档     │
│ - 单元测试     │    │ - 对比输出一致 │     │ - 集成测试     │     │ - 更新 CLAUDE.md│
└────────────────┘    └────────────────┘     └────────────────┘     └────────────────┘
     安全，无影响         安全，不影响生产      核心切换，需回滚方案      收尾清理
```

### 7.2 Phase 1：Schema 层 (风险: 低)

**目标**: 引入 Zod，定义 Schema，不改变任何运行时逻辑。

**步骤**:
1. `npm install zod`
2. 创建 `services/schemas/trilingualCard.js`
3. 编写 Schema 单元测试（使用现有的 LLM 输出样本数据）
4. 在 `validateGeneratedContent` 旁边添加 Zod 校验（双写，仅 log 不阻断）

**验证方式**:
```javascript
// server.js — 双写校验（Phase 1 临时代码）
const zodResult = trilingualCardSchema.safeParse(content);
if (!zodResult.success) {
  console.warn('[Zod Validation]', zodResult.error.issues);
}
// 继续使用原 validateGeneratedContent 的结果
```

**回滚**: 删除 `schemas/` 目录和 Zod 依赖即可。

### 7.3 Phase 2：统一层 (风险: 低)

**目标**: 新增 `llmUnifiedService.js`，以影子模式运行，对比新旧输出。

**步骤**:
1. `npm install ai @ai-sdk/google @ai-sdk/openai-compatible`
2. 创建 `services/llmUnifiedService.js`
3. 在 `generateWithProvider` 中添加影子调用（不影响主流程）:

```javascript
// server.js — 影子模式（Phase 2 临时代码）
const mainResult = await llmService.generateContent(prompt);  // 原逻辑

// 影子调用新统一层，仅记录结果对比
try {
  const shadowResult = await llmUnifiedService.generate(prompt, { provider, outputMode });
  console.log('[Shadow] Usage comparison:', {
    old: usage,
    new: shadowResult.usage
  });
} catch (shadowErr) {
  console.warn('[Shadow] Failed:', shadowErr.message);
}
```

**验证方式**: 比较 token usage 数值、输出结构是否一致。

**回滚**: 删除影子调用代码。

### 7.4 Phase 3：切换 (风险: 中)

**目标**: 将 `generateWithProvider` 切换到新统一层。

**步骤**:
1. 重构 `generateWithProvider`，调用 `llmUnifiedService.generate()`
2. 用 Zod `safeParse` 替换 `validateGeneratedContent`
3. 更新 `.env` 配置
4. 运行完整集成测试

**回滚方案**:
- 保留旧 Service 文件不删除（Phase 3 不删文件）
- `.env` 添加 `USE_UNIFIED_LAYER=true/false` 开关
- 回滚时只需将开关设为 `false`

```javascript
// 安全开关
const useUnifiedLayer = process.env.USE_UNIFIED_LAYER !== 'false';

if (useUnifiedLayer) {
  response = await llmUnifiedService.generate(prompt, { ... });
} else {
  // 旧逻辑，保留至 Phase 4
  response = await legacyGenerate(prompt, provider, ...);
}
```

### 7.5 Phase 4：清理 (风险: 低)

**目标**: 在 Phase 3 稳定运行一段时间后，清理旧代码。

**步骤**:
1. 删除旧文件:
   - `services/geminiService.js`
   - `services/localLlmService.js`
   - `services/geminiProxyService.js`
2. 移除 `USE_UNIFIED_LAYER` 开关
3. 移除 `@google/generative-ai` 依赖
4. 更新 `CLAUDE.md` 架构描述
5. 更新 `server.js` 顶部的 require 语句

---

## 8. 兼容性与风险评估

### 8.1 兼容性矩阵

| 组件 | 影响 | 处理方式 |
|------|------|---------|
| **Gemini CLI 模式** | 不受影响 | CLI 走子进程，不经过 AI SDK，保留原逻辑 |
| **Gemini Proxy 模式** | 需适配 | 由 `@ai-sdk/openai-compatible` 替代，需验证 Proxy 端点兼容性 |
| **Few-shot 注入** | 不受影响 | Few-shot 在 prompt 层操作，与 Provider 层无关 |
| **后处理管线** | 不受影响 | `contentPostProcessor.js`, `htmlRenderer.js` 不涉及 LLM 调用 |
| **TTS 服务** | 不受影响 | TTS 在 LLM 调用之后，独立模块 |
| **数据库层** | 不受影响 | 数据库存储的是处理后的结果，格式不变 |
| **experiment tracking** | 需小改 | `observability.tokens` 格式略有变化（字段名从 `input/output` 到 `promptTokens/completionTokens`），在统一层中映射 |
| **前端** | 不受影响 | API 响应结构不变 |

### 8.2 风险清单

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| Vercel AI SDK 与 Ollama 兼容性问题 | 中 | 高 | Phase 2 影子模式充分验证 |
| `generateObject` 对本地小模型效果不佳 | 中 | 中 | fallback 到 `generateText` + 手动 JSON.parse |
| Token usage 字段映射遗漏 | 低 | 低 | 统一层内做完整映射，单元测试覆盖 |
| AI SDK 版本更新导致 breaking change | 低 | 中 | 锁定主版本号（`^4.x`） |

### 8.3 generateObject 对本地模型的兼容性说明

Vercel AI SDK 的 `generateObject()` 依赖模型支持 **JSON mode** 或 **tool calling**。对于本地模型：

- **Ollama + Qwen2.5**: 支持 `response_format: { type: "json_object" }`，兼容
- **vLLM + Qwen2.5**: 支持 `guided_json` 参数，兼容
- **小参数模型 (<7B)**: 可能在严格 Schema 约束下输出不稳定

**Fallback 策略**:

```javascript
async function generate(prompt, options) {
  try {
    // 优先尝试 generateObject (结构化输出)
    return await generateWithSchema(prompt, options);
  } catch (err) {
    if (err.message.includes('JSON') || err.message.includes('schema')) {
      console.warn('[Unified] Structured output failed, falling back to text + parse');
      // fallback: generateText + 手动解析
      return await generateWithTextFallback(prompt, options);
    }
    throw err;
  }
}
```

---

## 9. 测试计划

### 9.1 单元测试

| 测试对象 | 测试项 | 优先级 |
|---------|--------|--------|
| `trilingualCardSchema` | 合法输入通过校验 | P0 |
| `trilingualCardSchema` | 缺少 `markdown_content` 校验失败 | P0 |
| `trilingualCardSchema` | `audio_tasks` 数量不为 4 校验失败 | P0 |
| `trilingualCardSchema` | `filename_suffix` 格式错误校验失败 | P1 |
| `audioTaskSchema` | `lang` 不在 `['en', 'ja']` 校验失败 | P1 |
| `llmUnifiedService.createProvider` | `google` 返回有效 model 实例 | P0 |
| `llmUnifiedService.createProvider` | `local` 返回有效 model 实例 | P0 |
| `llmUnifiedService.createProvider` | 未知 provider 抛出错误 | P1 |

### 9.2 集成测试

```bash
# 测试 1: Local LLM (Ollama) JSON 模式
curl -X POST http://localhost:3010/api/generate \
  -H "Content-Type: application/json" \
  -d '{"phrase":"hello world", "llm_provider":"local"}'

# 预期: 返回包含 markdown_content 和 4 条 audio_tasks 的 JSON

# 测试 2: Gemini API JSON 模式
curl -X POST http://localhost:3010/api/generate \
  -H "Content-Type: application/json" \
  -d '{"phrase":"hello world", "llm_provider":"google"}'

# 测试 3: Gemini CLI Markdown 模式（保持不变）
curl -X POST http://localhost:3010/api/generate \
  -H "Content-Type: application/json" \
  -d '{"phrase":"hello world", "llm_provider":"gemini-cli"}'

# 测试 4: 对比模式
curl -X POST http://localhost:3010/api/generate \
  -H "Content-Type: application/json" \
  -d '{"phrase":"hello world", "enable_compare":true}'

# 测试 5: OCR
curl -X POST http://localhost:3010/api/ocr \
  -H "Content-Type: application/json" \
  -d '{"image":"data:image/jpeg;base64,..."}'
```

### 9.3 验收标准

| 验收项 | 标准 |
|--------|------|
| **功能等价** | 所有现有 API 端点行为不变 |
| **Token 精度** | usage 来自 Provider 原生返回，不再使用 `length/4` 估算 |
| **Schema 校验** | 所有 LLM 输出经过 Zod Schema 校验，校验失败返回详细错误 |
| **代码量减少** | `server.js:generateWithProvider` 从 ~216 行降至 ~60 行 |
| **Service 文件减少** | LLM 相关文件从 5 个降至 2 个（`llmUnifiedService.js` + `geminiCliService.js`） |
| **无回归** | 对比模式、Few-shot 注入、实验追踪等功能正常 |

---

## 10. 后续演进：Langfuse 可观测性平台

> 本节为**可选**的后续演进方案，不在本次重构范围内。
> 建议在 Prompt 迭代进入密集期、需要系统性对比 prompt 版本效果时引入。

### 10.1 为什么是 Langfuse

| 维度 | 当前自建 (observabilityService.js) | Langfuse |
|------|-----------------------------------|----------|
| Token 统计 | `length/4` 粗估 | Provider 原生精确值 |
| Trace 可视化 | 无（仅 console.log） | Web UI 时间线 |
| Prompt 版本管理 | 无 | 内置 Prompt 管理与版本对比 |
| 质量评分 | 自建 `QualityChecker`（规则） | 支持自定义评分 + LLM-as-Judge |
| 成本追踪 | 硬编码 `return 0` | 按 model 自动计算 |
| 数据持久化 | SQLite (better-sqlite3) | PostgreSQL + ClickHouse |
| 部署方式 | 无需额外部署 | Docker self-host 或 Cloud |

### 10.2 引入条件

满足以下**任一**条件时可考虑引入：

1. Prompt 版本迭代超过 5 个，需要系统性对比效果
2. 需要跨会话的 LLM 调用追踪和回溯
3. 自建的 `experimentTrackingService.js` 数据量增长，SQLite 查询变慢
4. 需要多人协作查看实验数据

### 10.3 集成方式（参考）

Langfuse 提供了 Vercel AI SDK 的原生集成，与本次重构的技术选型完美衔接：

```javascript
// 未来集成示例
const { observeAI } = require('langfuse-vercel-ai');

const result = await observeAI(generateObject, {
  model,
  schema: trilingualCardSchema,
  prompt,
  experimental_telemetry: {
    metadata: { phrase, provider }
  }
});
```

### 10.4 部署方式

```yaml
# docker-compose.yml 新增
services:
  langfuse:
    image: langfuse/langfuse:latest
    ports:
      - "3100:3000"
    environment:
      DATABASE_URL: postgresql://...
```

---

## 附录

### A. 文件变动清单

| 文件 | 操作 | Phase |
|------|------|-------|
| `services/schemas/trilingualCard.js` | **新增** | 1 |
| `services/llmUnifiedService.js` | **新增** | 2 |
| `server.js` | **修改**（精简 generateWithProvider） | 3 |
| `services/observabilityService.js` | **修改**（简化 TokenCounter） | 3 |
| `package.json` | **修改**（新增/移除依赖） | 1-4 |
| `.env.example` | **修改**（新增 LLM_PROVIDER） | 3 |
| `CLAUDE.md` | **修改**（更新架构描述） | 4 |
| `services/geminiService.js` | **删除** | 4 |
| `services/localLlmService.js` | **删除** | 4 |
| `services/geminiProxyService.js` | **删除** | 4 |

### B. 关键代码引用

本文档引用的源码位置（基于当前 commit `916f9f8`）：

| 引用 | 文件:行号 |
|------|----------|
| Provider 分发逻辑 | `server.js:122-338` |
| JSON 解析 (Gemini) | `geminiService.js:31-48` |
| JSON 解析 (Local) | `localLlmService.js:13-40` |
| Token 粗估 | `observabilityService.js:20-23` |
| 输出校验 | `server.js:104-118` |
| 响应归一化 | `server.js:266-287` |

### C. 参考链接

- [Vercel AI SDK 文档](https://sdk.vercel.ai/docs)
- [Vercel AI SDK - Google Provider](https://sdk.vercel.ai/providers/ai-sdk-providers/google-generative-ai)
- [Vercel AI SDK - OpenAI Compatible](https://sdk.vercel.ai/providers/openai-compatible-providers)
- [Zod 文档](https://zod.dev)
- [Langfuse 文档](https://langfuse.com/docs)
- [Langfuse Vercel AI SDK 集成](https://langfuse.com/docs/integrations/vercel-ai-sdk)
