/# 🔧 后端架构文档

**项目**: Trilingual Records
**版本**: 2.0 (数据库集成)
**更新日期**: 2026-02-03

---

## 📂 后端文件结构

```
.
├── server.js                          # Express 服务器主入口
├── services/                          # 业务服务层 (12 模块)
│   ├── localLlmService.js            # 本地 LLM 服务 (OpenAI 兼容)
│   ├── geminiService.js              # Gemini API 服务 (已封存)
│   ├── promptEngine.js               # Prompt 构建引擎
│   ├── contentPostProcessor.js       # 内容后处理
│   ├── htmlRenderer.js               # HTML 渲染器
│   ├── japaneseFurigana.js          # 日文注音转换
│   ├── ttsService.js                 # TTS 音频生成
│   ├── fileManager.js                # 文件系统管理
│   ├── observabilityService.js       # 可观测性服务
│   ├── databaseService.js            # 数据库访问层
│   ├── databaseHelpers.js            # 数据库辅助函数
│   └── healthCheckService.js         # 健康检查服务
├── database/
│   └── schema.sql                     # 数据库 Schema (SQLite)
├── scripts/
│   └── migrateRecords.js             # 历史数据迁移工具
└── .env                               # 环境变量配置
```

---

## 🏗️ 架构设计

### 技术栈

- **运行时**: Node.js 18+
- **框架**: Express 4.x
- **数据库**: SQLite 3 (better-sqlite3)
- **LLM 集成**:
  - 本地 LLM (OpenAI 兼容接口) - 主要
  - Gemini API (已封存，代码保留)
- **TTS 服务**:
  - Kokoro (英语)
  - VOICEVOX (日语)
- **其他依赖**:
  - `marked` - Markdown 解析
  - `kuroshiro` - 日文注音
  - `dotenv` - 环境变量

### 架构原则

1. **模块化分层** - Services 层独立于路由层
2. **单一职责** - 每个 service 专注一个功能域
3. **可观测性优先** - 全链路性能/成本/质量监控
4. **数据持久化** - SQLite + 文件系统双重存储
5. **容错设计** - 数据库失败不影响主流程

---

## 🔄 数据流程

### 生成链路（10步）

```
1. 用户请求 (POST /api/generate)
   ↓
2. Prompt 构建 (promptEngine.js)
   ├─ Chain of Thought 推理
   ├─ Few-shot 示例
   └─ JSON Schema 约束
   ↓
3. LLM 生成 (localLlmService.js)
   ├─ OpenAI 兼容 API 调用
   ├─ JSON 解析与修复
   └─ Token 统计
   ↓
4. 结构化验证 (server.js)
   ├─ 字段完整性检查
   └─ 内容格式校验
   ↓
5. 内容后处理 (contentPostProcessor.js)
   ├─ 日文注音处理
   ├─ 标准化格式
   └─ 质量检查
   ↓
6. HTML 渲染 (htmlRenderer.js)
   ├─ Markdown → HTML
   ├─ Ruby 标签注入 (日文)
   └─ 音频按钮集成
   ↓
7. 文件持久化 (fileManager.js)
   ├─ 按日期文件夹组织 (YYYYMMDD)
   ├─ 保存 .md / .html / .meta.json
   └─ 重名处理 (自动 "(2)" 后缀)
   ↓
8. TTS 音频生成 (ttsService.js)
   ├─ 英语: Kokoro API
   ├─ 日语: VOICEVOX API
   └─ 批量生成 .wav 文件
   ↓
9. 可观测性采集 (observabilityService.js)
   ├─ Token 计数 & 成本估算
   ├─ 性能分段统计
   ├─ 质量评分 (0-100)
   └─ Prompt 结构化解析
   ↓
10. 数据库入库 (databaseService.js)
    ├─ generations 表 (主记录)
    ├─ audio_files 表 (音频文件)
    ├─ observability_metrics 表 (指标)
    └─ FTS5 全文索引更新
```

---

## 📦 核心服务模块

### 1. `localLlmService.js` - 本地 LLM 服务

**职责**:
- OpenAI 兼容 API 调用
- JSON 响应解析与修复
- OCR 图像识别
- Token 统计

**关键方法**:
```javascript
async generateContent(prompt)
// 返回: { content: Object, usage: { input, output, total } }

async recognizeImage(imageBase64)
// 返回: string (识别文本)
```

**特性**:
- 自动清理 Markdown 代码围栏
- Unicode 控制字符转义
- JSON 格式修复 (缺失逗号/引号)

---

### 2. `promptEngine.js` - Prompt 构建引擎

**职责**:
- 构建结构化 Prompt
- Chain of Thought 推理指导
- Few-shot 示例注入
- JSON Schema 约束

**Prompt 结构**:
```
[ROLE] 三语翻译专家

[TASK] 生成三语学习卡片

[REASONING PROCESS] (5步推理)
1. 识别输入短语的语言
2. 分析语义与上下文
3. 处理多义词消歧
4. 生成高质量例句
5. 验证翻译准确性

[FEW-SHOT EXAMPLES] (3个示例)
- 日常词汇
- 技术术语
- 多义词处理

[QUALITY STANDARDS]
- 例句长度: 8-20词
- 难度: 适中
- 地道性: 原生表达
- 多样性: 避免重复

[OUTPUT FORMAT] (JSON Schema)
```

---

### 3. `contentPostProcessor.js` - 内容后处理

**职责**:
- 日文注音标准化处理
- 内容格式清理
- 质量检查

**处理流程**:
```javascript
postProcessGeneratedContent(content)
  ├─ 移除不需要的注音 (数字/标点/拉丁字符)
  ├─ 清理多余空白字符
  ├─ 验证三语内容完整性
  └─ 标准化换行符
```

---

### 4. `htmlRenderer.js` - HTML 渲染器

**职责**:
- Markdown → HTML 转换
- 日文 Ruby 标签注入
- 音频播放按钮生成
- 音频任务提取

**关键方法**:
```javascript
async renderHtmlFromMarkdown(markdown, options)
// 返回: HTML 字符串

buildAudioTasksFromMarkdown(markdown)
// 返回: [ { text, lang, filename_suffix } ]

async prepareMarkdownForCard(markdown, options)
// 日文注音处理 + 音频标记清理
```

**音频任务提取规则**:
```markdown
<!-- 输入 -->
{{en-audio-1}}This is an example sentence.

<!-- 输出任务 -->
{
  text: "This is an example sentence.",
  lang: "en",
  filename_suffix: "_en_1"
}
```

---

### 5. `ttsService.js` - TTS 音频生成

**职责**:
- 调用外部 TTS 服务
- 批量音频生成
- 文件保存与错误处理

**TTS 提供商**:
| 语言 | 服务 | 端点 | 格式 |
|------|------|------|------|
| 英语 | Kokoro | `TTS_EN_ENDPOINT` | WAV |
| 日语 | VOICEVOX | `TTS_JA_ENDPOINT` | WAV |

**批量生成**:
```javascript
await generateAudioBatch(audioTasks, options)
// audioTasks: [ { text, lang, filename_suffix } ]
// options: { outputDir, baseName, extension }
// 返回: { tasks: [...], successCount, failCount }
```

---

### 6. `fileManager.js` - 文件系统管理

**职责**:
- 按日期文件夹组织 (YYYYMMDD)
- 文件读写操作
- 重名冲突处理
- 文件系统查询

**目录结构**:
```
/data/trilingual_records/
├── 20260203/
│   ├── hello_world.md
│   ├── hello_world.html
│   ├── hello_world.meta.json
│   ├── hello_world_en_1.wav
│   ├── hello_world_ja_1.wav
│   └── ...
└── 20260202/
    └── ...
```

**重名处理**:
```
hello_world.md
hello_world (2).md
hello_world (3).md
```

**关键方法**:
```javascript
saveGeneratedFiles(phrase, content, options)
// 返回: { baseName, targetDir, folderName, absPaths: {...} }

listFoldersWithHtml()
// 返回: [ { name, displayName, htmlCount } ]

deleteRecordFiles(folder, base)
// 返回: deletedPaths[]
```

---

### 7. `observabilityService.js` - 可观测性服务

**职责**:
- Token 计数与成本估算
- 性能分段监控
- 质量评分 (0-100)
- Prompt 结构化解析

**4个工具类**:

#### A. `TokenCounter`
```javascript
const counter = new TokenCounter();
counter.count(text);  // 返回 token 数量
counter.estimateCost(usage, model);  // 估算成本
```

#### B. `PerformanceMonitor`
```javascript
const perf = new PerformanceMonitor().start();
perf.mark('llmCall');
perf.mark('fileSave');
const stats = perf.end();
// 返回: { total_ms, phases: {...} }
```

#### C. `QualityChecker`
```javascript
const checker = new QualityChecker();
const result = checker.checkGeneration(content);
// 返回: { score, checks: {...}, dimensions: {...}, warnings: [] }
```

**质量评分维度**:
- 内容完整性 (40分)
- 翻译准确性 (30分)
- 例句质量 (20分)
- 格式规范性 (10分)

#### D. `PromptParser`
```javascript
const parser = new PromptParser();
const parsed = parser.parse(prompt);
// 返回: { sections: {...}, fewShots, constraints, outputFormat }
```

---

### 8. `databaseService.js` - 数据库访问层

**职责**:
- SQLite 数据库操作 (CRUD)
- FTS5 全文搜索
- 统计聚合查询
- 级联删除操作

**核心方法**:

#### 写操作
```javascript
insertGeneration(data)
// 插入主记录 + 音频 + 指标 (事务)

deleteGeneration(id)
// 级联删除 (ON DELETE CASCADE)

insertError(errorData)
// 记录生成错误
```

#### 查询操作
```javascript
queryGenerations({ page, limit, search, provider, dateFrom, dateTo })
// 分页查询 + 过滤

getGenerationById(id)
// 获取完整记录 (含音频和指标)

getGenerationByFile(folder, base)
// 根据文件夹+文件名定位

fullTextSearch(query, limit)
// FTS5 全文搜索

getStatistics({ provider, dateFrom, dateTo })
// 统计聚合
```

**统计指标**:
- 总记录数
- 平均质量分
- 平均 Token 数
- 平均延迟
- 总成本
- Provider 分布
- 质量趋势 (7D/30D/90D)

---

### 9. `databaseHelpers.js` - 数据库辅助函数

**职责**:
- 数据转换与映射
- 字段提取与标准化

**关键方法**:
```javascript
prepareInsertData({
  phrase,
  provider,
  model,
  folderName,
  baseName,
  filePaths,
  content,
  observability,
  prompt,
  audioTasks
})
// 返回标准化的数据库插入对象
```

**数据提取**:
```javascript
extractTranslations(markdown)
// 从 Markdown 提取英日中翻译
// 返回: { en, ja, zh }
```

---

### 10. `healthCheckService.js` - 健康检查服务

**职责**:
- 服务状态监控
- 存储空间统计
- 系统健康评估

**检查项**:
```javascript
HealthCheckService.checkAll()
// 返回: {
//   llm: { status, message, model, endpoint },
//   tts_en: { status, message, model, endpoint },
//   tts_ja: { status, message, speaker, endpoint },
//   storage: { used, total, percentage, records },
//   uptime: number
// }
```

**存储统计**:
```javascript
HealthCheckService.getStorageStats()
// 返回: { used, total, percentage, records, files }
```

---

## 🗄️ 数据库设计

### Schema 版本: 1.0

### 表结构总览

| 表名 | 记录类型 | 主要功能 |
|------|----------|----------|
| `generations` | 主记录 | 存储每次生成的核心信息 |
| `audio_files` | 音频文件 | 记录音频生成任务 |
| `observability_metrics` | 指标数据 | Token/成本/性能/质量 |
| `generation_errors` | 错误日志 | 记录失败的生成请求 |
| `model_statistics` | 统计汇总 | 模型性能统计 (预留) |
| `system_health` | 健康历史 | 系统状态快照 (预留) |
| `generations_fts` | 全文索引 | FTS5 虚拟表 |

### 1. `generations` - 主记录表

```sql
CREATE TABLE generations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 短语信息
  phrase TEXT NOT NULL,
  phrase_language TEXT,

  -- LLM 信息
  llm_provider TEXT NOT NULL,
  llm_model TEXT,

  -- 文件路径
  folder_name TEXT NOT NULL,
  base_filename TEXT NOT NULL,
  md_file_path TEXT NOT NULL,
  html_file_path TEXT NOT NULL,
  meta_file_path TEXT,

  -- 内容
  markdown_content TEXT NOT NULL,

  -- 提取翻译
  en_translation TEXT,
  ja_translation TEXT,
  zh_translation TEXT,

  -- 时间戳
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  generation_date DATE,

  -- 元数据
  request_id TEXT UNIQUE
);
```

**索引**:
- `idx_generations_phrase` - 短语查询
- `idx_generations_date` - 日期排序
- `idx_generations_provider` - Provider 过滤
- `idx_gen_date_provider` - 组合索引

---

### 2. `audio_files` - 音频文件表

```sql
CREATE TABLE audio_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generation_id INTEGER NOT NULL,

  -- 音频信息
  language TEXT NOT NULL,
  text TEXT NOT NULL,
  filename_suffix TEXT NOT NULL,
  file_path TEXT NOT NULL,

  -- TTS 信息
  tts_provider TEXT,
  tts_model TEXT,
  tts_voice TEXT,

  -- 音频元数据
  file_size INTEGER,
  duration REAL,
  format TEXT,

  -- 生成状态
  status TEXT DEFAULT 'pending',
  error_message TEXT,

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE CASCADE
);
```

**级联删除**: 当 `generations` 记录删除时，关联音频自动删除

---

### 3. `observability_metrics` - 指标表

```sql
CREATE TABLE observability_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generation_id INTEGER NOT NULL UNIQUE,

  -- Token 统计
  tokens_input INTEGER,
  tokens_output INTEGER,
  tokens_total INTEGER,

  -- 成本估算
  cost_input REAL,
  cost_output REAL,
  cost_total REAL,

  -- 性能指标
  performance_total_ms INTEGER,
  performance_phases TEXT, -- JSON

  -- 质量评分
  quality_score INTEGER,
  quality_checks TEXT, -- JSON
  quality_dimensions TEXT, -- JSON
  quality_warnings TEXT, -- JSON

  -- Prompt & Output
  prompt_full TEXT,
  prompt_parsed TEXT, -- JSON
  llm_output TEXT,

  FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE CASCADE
);
```

**JSON 字段示例**:
```json
// performance_phases
{
  "promptBuild": 12,
  "llmCall": 1850,
  "parse": 5,
  "htmlRender": 120,
  "fileSave": 8,
  "audioGenerate": 3200
}

// quality_dimensions
{
  "completeness": 40,
  "accuracy": 28,
  "exampleQuality": 18,
  "formatting": 10
}
```

---

### 4. FTS5 全文搜索

```sql
CREATE VIRTUAL TABLE generations_fts USING fts5(
  phrase,
  en_translation,
  ja_translation,
  zh_translation,
  markdown_content,
  content=generations,
  content_rowid=id
);
```

**触发器**: 自动同步 `generations` 表的插入/更新/删除

**搜索示例**:
```sql
SELECT * FROM generations_fts WHERE generations_fts MATCH 'hello';
```

---

## ⚙️ 环境变量配置

### `.env` 配置项

```bash
# 服务端口
PORT=3010

# 数据存储路径
RECORDS_PATH=/data/trilingual_records
DB_PATH=/data/trilingual_records/trilingual_records.db

# LLM 配置 (主要)
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=not-needed
LLM_MODEL=qwen2.5:7b
LLM_OCR_MODEL=llama3.2-vision:11b
LLM_MAX_TOKENS=2048
LLM_TEMPERATURE=0.2

# Gemini 配置 (已封存)
# GEMINI_API_KEY=your-key
# GEMINI_MODEL=gemini-1.5-flash-latest

# TTS 配置
TTS_EN_ENDPOINT=http://tts-en:8000
TTS_JA_ENDPOINT=http://tts-ja:50021
TTS_EN_MODEL=kokoro-v0_19.onnx
VOICEVOX_SPEAKER=3

# HTML 渲染模式
HTML_RENDER_MODE=local
```

---

## 🔒 安全设计

### 1. 速率限制

```javascript
// IP 级别速率限制 (4秒/次)
const GENERATE_MIN_INTERVAL_MS = 4000;
const generationThrottle = new Map();

function canGenerate(req) {
  const key = req.ip;
  const now = Date.now();
  const last = generationThrottle.get(key) || 0;
  return now - last >= GENERATE_MIN_INTERVAL_MS;
}
```

### 2. 输入校验

```javascript
function validateGeneratedContent(content, options) {
  const errors = [];
  if (!content || typeof content !== 'object') {
    errors.push('Response is not a valid JSON object');
  }
  if (!content.markdown_content?.trim()) {
    errors.push('markdown_content is missing or empty');
  }
  return errors;
}
```

### 3. 文件路径安全

```javascript
// 禁止路径穿越攻击
const safePath = path.join(RECORDS_PATH, path.basename(folder));
if (!safePath.startsWith(RECORDS_PATH)) {
  throw new Error('Invalid path');
}
```

### 4. 数据库事务

```javascript
// 原子性操作
db.transaction(() => {
  const genId = insertGeneration(data);
  insertAudioFiles(genId, audioTasks);
  insertMetrics(genId, observability);
})();
```

---

## 🚀 性能优化

### 已实现

1. **SQLite WAL 模式** - 提升并发读写
   ```sql
   PRAGMA journal_mode = WAL;
   ```

2. **数据库索引** - 加速常用查询
   - 短语、日期、Provider 的组合索引

3. **FTS5 全文搜索** - 高性能文本搜索
   - 支持中英日混合搜索

4. **JSON 字段压缩** - 减少存储空间
   - performance_phases、quality_checks 等

5. **异步音频生成** - 不阻塞主流程
   - TTS 失败不影响记录保存

6. **文件系统缓存** - 减少重复扫描
   ```javascript
   const folderCache = new Map();
   ```

### 待优化

1. **Redis 缓存层** - 减少数据库查询
2. **批量插入优化** - 迁移工具性能提升
3. **数据库连接池** - 并发处理能力
4. **日志聚合** - 结构化日志输出

---

## 📊 错误处理

### 错误分类

| 错误类型 | HTTP 状态码 | 处理策略 |
|---------|------------|----------|
| 输入验证失败 | 400 | 返回详细错误信息 |
| 速率限制 | 429 | 提示用户稍后重试 |
| LLM 响应格式错误 | 422 | 返回原始响应 + Prompt |
| 文件系统错误 | 500 | 记录日志，返回通用错误 |
| 数据库错误 | 500 | 不影响主流程，后台记录 |

### 错误日志记录

```javascript
// 自动记录到 generation_errors 表
try {
  // 生成逻辑
} catch (err) {
  dbService.insertError({
    phrase: req.body.phrase,
    llmProvider: req.body.llm_provider,
    errorType: err.name,
    errorMessage: err.message,
    errorStack: err.stack,
    prompt,
    llmResponse
  });
}
```

---

## 🧪 测试与调试

### 健康检查

```bash
curl http://localhost:3010/api/health
```

**返回示例**:
```json
{
  "llm": {
    "status": "healthy",
    "message": "LLM service is available",
    "model": "qwen2.5:7b",
    "endpoint": "http://localhost:11434/v1"
  },
  "storage": {
    "used": 245678901,
    "total": 107374182400,
    "percentage": 0.23,
    "records": 342
  }
}
```

### 数据库查询调试

```javascript
// 启用 SQL 日志
const db = require('better-sqlite3')(DB_PATH, { verbose: console.log });
```

---

## 🔗 相关文档

- [API.md](./API.md) - API 接口文档
- [FRONTEND.md](./FRONTEND.md) - 前端架构文档
- [repo_status.md](./repo_status.md) - 项目架构总览
- [database/schema.sql](../../database/schema.sql) - 数据库 Schema

---

**维护者**: Three LANS Team
**最后更新**: 2026-02-03

---

## 📊 可观测性服务增强 (v2.1)

### observabilityService.js

**质量维度标准化**

旧系统（4个内部指标）：
- structuralIntegrity
- contentRichness  
- complianceWithStandards
- audioCompleteness

新系统（4个用户友好指标）：
```javascript
dimensions: {
  completeness: 40,    // 完整性（结构完整度）
  accuracy: 30,        // 准确性（翻译准确度）
  exampleQuality: 20,  // 例句质量（自然度和多样性）
  formatting: 10       // 格式化（HTML和音频标签）
}
```

**详细评分算法**

**1. Completeness (40pts)**
```javascript
static calculateCompletenessScore(checks, content) {
  let score = 0;
  if (checks.jsonValid) score += 10;           // JSON 有效
  if (checks.fieldsComplete) score += 15;      // 字段完整
  if (checks.audioTasksGenerated) score += 10; // 音频任务生成
  const markdown = content.markdown_content || '';
  if (markdown.length > 500) score += 5;       // 内容充实
  return score;
}
```

**2. Accuracy (30pts)**
```javascript
static calculateAccuracyScore(content) {
  let score = 30; // 起始满分
  const markdown = content.markdown_content || '';
  
  // 检查必需结构
  if (!markdown.includes('## 1. English')) score -= 8;
  if (!markdown.includes('## 2. 中文')) score -= 8;
  if (!markdown.includes('## 3. 日本語')) score -= 8;
  if (!markdown.includes('### Definition')) score -= 3;
  if (!markdown.includes('### Example')) score -= 3;
  
  return Math.max(score, 0);
}
```

**3. Example Quality (20pts)**
```javascript
static calculateExampleScore(content) {
  const markdown = content.markdown_content || '';
  const sentences = markdown.match(/\d+\.\s+.+/g) || [];
  
  let score = 0;
  
  // 数量 (0-8pts)
  score += Math.min(sentences.length * 2, 8);
  
  // 长度适中 (0-8pts)
  const avgLength = sentences.reduce((sum, s) => 
    sum + s.length, 0) / (sentences.length || 1);
  if (avgLength >= 30 && avgLength <= 150) score += 8;
  
  // 多样性 (0-4pts)
  const uniqueStarts = new Set(
    sentences.map(s => s.trim().charAt(0))
  );
  if (uniqueStarts.size >= 3) score += 4;
  
  return Math.min(score, 20);
}
```

**4. Formatting (10pts)**
```javascript
static calculateFormattingScore(checks, content) {
  let score = 0;
  const html = content.html_content || '';
  
  if (checks.htmlValid) score += 5;                // HTML有效
  if (html.includes('<audio')) score += 3;         // 音频标签
  if (content.audio_tasks?.length > 0) score += 2; // 音频任务
  
  return score;
}
```

---

## 💾 数据库服务增强 (v2.1)

### databaseService.js

**真实配额统计** (`getStatistics()`)

```javascript
async getStatistics() {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  // 本月 token 使用量
  const monthlyStmt = this.db.prepare(`
    SELECT COALESCE(SUM(tokens_total), 0) as total
    FROM observability_metrics
    WHERE date LIKE ?
  `);
  const tokenUsed = monthlyStmt.get(`${currentMonth}%`)?.total || 0;
  
  // 配额计算
  const MONTHLY_TOKEN_LIMIT = 1000000;
  const quota = {
    used: tokenUsed,
    limit: MONTHLY_TOKEN_LIMIT,
    percentage: (tokenUsed / MONTHLY_TOKEN_LIMIT) * 100,
    resetDate: new Date(now.getFullYear(), now.getMonth() + 1, 1)
                .toISOString().split('T')[0],
    estimatedDaysRemaining: Math.ceil(
      (MONTHLY_TOKEN_LIMIT - tokenUsed) / 
      ((tokenUsed / now.getDate()) || 1)
    )
  };
  
  return { quota, /* ... other stats */ };
}
```

**趋势分段支持**

```javascript
// 生成 7D/30D/90D 趋势数据
const segmentTrend = (data, days) => {
  const cutoffDate = new Date(
    Date.now() - days * 24 * 60 * 60 * 1000
  ).toISOString().split('T')[0];
  return data.filter(row => row.date >= cutoffDate);
};

return {
  tokenTrend: {
    '7d': segmentTrend(dailyTokens, 7),
    '30d': segmentTrend(dailyTokens, 30),
    '90d': segmentTrend(dailyTokens, 90)
  },
  costTrend: { /* 同上 */ },
  latencyTrend: { /* 同上 */ }
};
```

**错误统计**

```javascript
// 总错误数
const errorTotal = this.db.prepare(`
  SELECT COUNT(*) as count FROM generation_errors
`).get().count;

// 错误率
const errorRate = total > 0 ? errorTotal / total : 0;

// 按类型分类
const errorsByType = this.db.prepare(`
  SELECT error_type, COUNT(*) as count
  FROM generation_errors
  GROUP BY error_type
  ORDER BY count DESC
`).all();

// 最近错误
const recentErrors = this.db.prepare(`
  SELECT * FROM generation_errors
  ORDER BY created_at DESC
  LIMIT 10
`).all();

return {
  errors: {
    total: errorTotal,
    rate: errorRate,
    byType: errorsByType,
    recent: recentErrors
  }
};
```

**Provider 分布统计**

```javascript
const providerDist = this.db.prepare(`
  SELECT 
    llm_provider,
    COUNT(*) as count
  FROM generations
  GROUP BY llm_provider
`).all();

return {
  providerDistribution: providerDist.reduce((acc, row) => {
    acc[row.llm_provider] = row.count;
    return acc;
  }, {})
};
```

---

## 🔄 服务层数据流 (更新)

### 完整生成链路

```
1. POST /api/generate
   ↓
2. promptEngine.buildPrompt()
   - Chain of Thought 推理
   - Few-shot 示例
   - JSON Schema 约束
   ↓
3. geminiService.generate() / localLlmService.generate()
   - API 调用
   - JSON 解析
   - Token 统计
   ↓
4. contentPostProcessor.process()
   - 日文注音处理
   - 标准化格式
   - 质量检查
   ↓
5. htmlRenderer.render()
   - Markdown → HTML
   - Ruby 标签注入
   - 音频按钮集成
   ↓
6. fileManager.saveFiles()
   - 按日期文件夹组织
   - 保存 .md/.html/.meta.json
   - 重名处理
   ↓
7. ttsService.generateAudio()
   - Kokoro (英语)
   - VOICEVOX (日语)
   - 顺序生成
   ↓
8. observabilityService.collectMetrics()
   - Token 计数
   - 成本估算
   - 性能分段
   - 质量评分 (新：4维度系统)
   ↓
9. databaseService.insertGeneration()
   - 主记录入库
   - 音频记录入库
   - 指标数据入库
   ↓
10. 返回响应
    - 文件路径
    - 可观测性数据
    - 音频生成状态
```

---

## 📋 更新日志

### 2026-02-05 - v2.1: Enhanced Observability

**质量评分系统**
- ✅ 4 维度标准化：completeness/accuracy/exampleQuality/formatting
- ✅ 详细评分算法实现（4 个独立计算函数）
- ✅ 总分 100 分制，权重分配更合理

**数据库统计增强**
- ✅ 真实配额计算（月度 token 限额 100万）
- ✅ 配额重置日期和剩余天数估算
- ✅ 7D/30D/90D 趋势数据分段
- ✅ 错误统计（总数/率/分类/最近记录）
- ✅ Provider 使用分布统计

**性能优化**
- ✅ SQL 查询优化（使用日期索引）
- ✅ 数据聚合预计算
- ✅ 缓存友好的统计结构

**文件修改**
- `services/observabilityService.js`: +151 行
- `services/databaseService.js`: +177 行
- 总计：+328 行后端代码

### 2026-02-03 - v2.0: Database Integration
- ✅ SQLite 数据库集成
- ✅ 全文搜索 (FTS5)
- ✅ 可观测性指标持久化
- ✅ 历史记录管理

### 2026-01-28 - v1.5: Gemini Migration
- ✅ 迁移至 Gemini API
- ✅ Prompt Engineering 优化
- ✅ 本地 LLM 作为备选

### 2026-02-05 - v2.2: Model Comparison System

**核心功能**
- ✅ 双模型并行对比（Gemini vs Local LLM）
- ✅ 三种生成模式切换（LOCAL / GEMINI / COMPARE）
- ✅ 智能 Winner 判定算法
- ✅ 4 维度指标对比可视化

**后端增强**

**1. 对比模式处理 (`handleComparisonMode`)**
```javascript
async function handleComparisonMode(phrase) {
  // 并行调用双模型
  const [geminiResult, localResult] = await Promise.allSettled([
    generateWithProvider(phrase, 'gemini', perfGemini),
    generateWithProvider(phrase, 'local', perfLocal)
  ]);

  // 对比分析
  const comparison = {
    metrics: {
      speed: { gemini, local },
      quality: { gemini, local },
      tokens: { gemini, local },
      cost: { gemini, local }
    },
    winner: calculateWinner(geminiScore, localScore),
    recommendation: generateRecommendation(winner),
    promptComparison: {
      similarity: analyzePromptSimilarity(geminiPrompt, localPrompt),
      geminiLength, localLength
    }
  };
}
```

**特性**:
- 容错设计：一个模型失败不影响另一个
- 完整 observability 数据包含 prompt 文本
- Prompt 相似度分析

**2. 评分算法**
```javascript
// Winner 判定
score = quality * 0.7 + speedScore * 0.3
winner = abs(scoreA - scoreB) > 5 ? higherScore : 'tie'
```

**权重分配**:
- 70% - 质量评分 (0-100)
- 30% - 速度归一化分数
- 判定阈值：5 分

**3. API 扩展**

**请求参数**:
```json
{
  "phrase": "hello world",
  "llm_provider": "local",
  "enable_compare": true  // 新增参数
}
```

**响应结构**:
```json
{
  "phrase": "hello world",
  "gemini": {
    "success": true,
    "output": { "markdown_content": "...", "audio_tasks": [...] },
    "observability": {
      "tokens": { "input": 450, "output": 820, "total": 1270 },
      "cost": { "total": 0 },
      "quality": { "score": 95 },
      "performance": { "totalTime": 1234 },
      "prompt": { "text": "...", "full": "..." },
      "metadata": {
        "provider": "gemini",
        "model": "gemini-1.5-flash",
        "promptText": "...",
        "rawOutput": "..."
      }
    }
  },
  "local": { /* 同上结构 */ },
  "comparison": {
    "metrics": {
      "speed": { "gemini": 1234, "local": 2456 },
      "quality": { "gemini": 95, "local": 88 },
      "tokens": { "gemini": 1270, "local": 1450 },
      "cost": { "gemini": 0, "local": 0 }
    },
    "winner": "gemini",
    "recommendation": "Gemini wins on speed/quality balance.",
    "promptComparison": {
      "similarity": "identical",
      "geminiLength": 1095,
      "localLength": 1095
    }
  }
}
```

**4. Observability 数据增强**

新增字段：
- `prompt.text` - 完整 prompt 文本
- `metadata.promptText` - 元数据中的 prompt 副本
- `metadata.rawOutput` - LLM 原始输出 JSON
- `metadata.model` - 模型名称

**前端集成**

**UI 组件**:
- 模型选择器（3 按钮：LOCAL / GEMINI / COMPARE）
- 对比弹窗（双列布局）
- Winner Badge（自动判定）
- 指标对比卡片

**状态管理**:
```javascript
// store.js
state = {
  modelMode: 'local' | 'gemini' | 'compare',
  llmProvider: 'local' | 'gemini',
  isGenerating: boolean
}
```

**性能优化**

**并行处理**:
- 使用 `Promise.allSettled` 并行调用
- 总耗时 ≈ max(geminiTime, localTime)
- 相比顺序调用节省 ~50% 时间

**容错设计**:
- 一个模型失败不影响另一个
- 部分成功时仍返回可用数据
- 完整的错误信息传递

**安全性**

**速率限制**:
- 对比模式沿用现有 4 秒/次限制
- 单次请求计费 1 次（虽然调用 2 个模型）

**文件修改**
- `server.js`: +85 行（对比逻辑增强）
- `services/observabilityService.js`: 修改数据结构
- 总计：+85 行后端代码

**配置要求**

启用 Gemini 对比需要：
```bash
GEMINI_API_KEY=your_api_key
GEMINI_MODEL=gemini-1.5-flash-latest
```

本地 LLM（默认启用）：
```bash
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=qwen2.5:7b
```

**相关文档**
- [完整功能文档](../../docs/MODEL_COMPARISON_FEATURE.md)
- [快速上手指南](../../docs/QUICK_START_COMPARISON.md)
- [版本更新说明](../../docs/FEATURE_UPDATE_v2.1.md)

---

**架构改进总结**

本次更新保持了向后兼容性，所有现有功能不受影响。新增的对比模式是完全可选的功能，通过 `enable_compare` 参数控制。

核心设计原则：
1. **模块化** - 对比逻辑独立于单模型生成
2. **容错性** - 部分失败不影响整体
3. **可观测** - 完整的指标收集和对比
4. **性能优先** - 并行处理最小化耗时

---

