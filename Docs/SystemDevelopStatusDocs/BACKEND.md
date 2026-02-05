# 🔧 后端架构文档

**项目**: Trilingual Records
**版本**: 2.3
**更新日期**: 2026-02-05

---

## 📂 后端文件结构

```
.
├── server.js                          # Express 服务器入口
├── services/                          # 业务服务层
│   ├── localLlmService.js            # 本地 LLM（OpenAI 兼容）
│   ├── geminiService.js              # Gemini API（可选）
│   ├── geminiCliService.js           # Gemini CLI（容器内直连）
│   ├── geminiProxyService.js         # Gemini CLI Host Proxy（推荐）
│   ├── geminiAuthService.js          # Gemini CLI 认证会话管理
│   ├── promptEngine.js               # Prompt 构建
│   ├── contentPostProcessor.js       # 内容后处理
│   ├── htmlRenderer.js               # HTML 渲染
│   ├── japaneseFurigana.js          # 日文注音
│   ├── ttsService.js                 # TTS 音频生成
│   ├── fileManager.js                # 文件系统管理
│   ├── observabilityService.js       # 可观测性指标
│   ├── databaseService.js            # SQLite 访问
│   ├── databaseHelpers.js            # 数据库辅助
│   └── healthCheckService.js         # 健康检查
├── database/
│   └── schema.sql                     # SQLite Schema
└── scripts/
    ├── migrateRecords.js             # 历史数据迁移
    ├── gemini-host-proxy.js          # 宿主机 Gemini CLI 代理
    └── bootstrap_stack.py            # 一键启动/状态/停止控制脚本
```

---

## 🏗️ 架构设计

### 技术栈
- **运行时**: Node.js 20+
- **框架**: Express 4.x
- **数据库**: SQLite 3（better-sqlite3）
- **LLM 集成**:
  - 本地 LLM（OpenAI 兼容，默认）
  - Gemini（可选，**默认通过宿主机 Gemini CLI Host Proxy**）
- **TTS 服务**:
  - 英语：Kokoro
  - 日语：VOICEVOX

### 架构原则
1. 服务层模块化
2. 可观测性优先（Token/成本/质量/性能）
3. 文件系统 + 数据库双存储
4. 异常不中断主流程（TTS/DB 失败不阻塞生成）

---

## 🔄 生成链路（10步）

```
1. POST /api/generate
2. promptEngine.buildPrompt() / buildMarkdownPrompt()
3. localLlmService.generateContent() / geminiProxyService.runGeminiProxy()
4. Markdown 结构校验与解析
5. contentPostProcessor.postProcessGeneratedContent()
6. htmlRenderer.prepareMarkdownForCard()
7. htmlRenderer.renderHtmlFromMarkdown()
8. fileManager.saveGeneratedFiles()
9. ttsService.generateAudioBatch()
10. databaseService.insertGeneration()
```

---

## 📦 核心模块

### localLlmService.js
- OpenAI 兼容接口调用
- JSON 解析与修复
- OCR 图片识别

### promptEngine.js
- Prompt 模板与结构化输出约束
- 支持 Markdown Prompt（Gemini CLI / Host Proxy）

### contentPostProcessor.js
- 日文注音处理
- 内容清洗与质量检查

### htmlRenderer.js
- Markdown → HTML
- 音频标记注入
- 音频任务提取

### observabilityService.js
- Token 统计与成本估算
- 性能分段（prompt/LLM/解析/渲染/存储/TTS）
- 质量评分（4 维度）
  - completeness / accuracy / exampleQuality / formatting

### databaseService.js
- 记录入库（generations + audio_files + observability_metrics）
- FTS5 全文搜索
- 统计聚合（趋势/分布/错误/配额）

### fileManager.js
- 日期文件夹组织（YYYYMMDD）
- 文件读写、重名处理
- 按文件名删除记录与音频

---

## 🗄️ 数据库设计（摘要）

- `generations`: 生成主记录
- `audio_files`: 音频任务与文件
- `observability_metrics`: 指标数据
- `generation_errors`: 错误记录
- `generations_fts`: FTS5 搜索

---

## ⚙️ 环境变量（关键项）

```bash
PORT=3010
RECORDS_PATH=/data/trilingual_records
DB_PATH=/data/trilingual_records/trilingual_records.db

# Local LLM (默认)
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=qwen2.5-coder:latest
LLM_OCR_MODEL=qwen2.5-coder:latest
LLM_MAX_TOKENS=2048
LLM_TEMPERATURE=0.2

# Gemini (可选)
# GEMINI_MODE=host-proxy
# GEMINI_PROXY_URL=http://host.docker.internal:3210/api/gemini
# GEMINI_PROXY_MODEL=gemini-cli
# MARKDOWN_PROMPT_PATH=./prompts/phrase_3LANS_markdown.md

# TTS
TTS_EN_ENDPOINT=http://tts-en:8000
TTS_JA_ENDPOINT=http://tts-ja:50021
TTS_EN_MODEL=hexgrad/Kokoro-82M
VOICEVOX_SPEAKER=2
```

---

## ✅ 现状说明

- 默认使用本地 LLM；Gemini 仅在配置时启用。
- Gemini 推荐模式：Host Proxy（宿主机 Gemini CLI 认证与调用，容器仅发起 HTTP 请求）。
- 支持 `enable_compare` 参数进行双模型对比（API 级别，不在 UI 暴露）。
- `/api/statistics` 返回完整趋势/配额/错误统计，用于大盘展示。

---

**维护者**: Three LANS Team
**最后更新**: 2026-02-05
