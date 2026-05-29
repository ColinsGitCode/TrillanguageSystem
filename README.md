# 三语卡片生成系统（Trilingual Records Viewer）

一个基于 Express 的 Web 应用：通过 LLM（Gemini）生成中 / 英 / 日三语学习卡片并合成配音音频。除卡片生成外，还包含 SQLite 支撑的历史记录与可观测性层、两条后台任务队列（生成队列 + 知识分析队列），以及一个知识分析子系统（同义词组、语法模式、语义聚类）。

## 功能概览

- **三语卡片生成**：输入短语或选区文本 → CoT 提示词 → LLM → Markdown/HTML 卡片 → TTS 配音（英文 `.mp3`、日文 `.wav`）。
- **日语语法卡**：`grammar_ja` 卡片类型，专用提示词模板。
- **OCR 输入**：Tesseract 识别图片文本作为生成来源。
- **后台队列**：生成任务与知识任务均为 DB 支撑的队列，支持重试 / 退避、启动时恢复滞留任务。
- **知识分析**：同义词边界、语法关联、语义聚类、卡片索引、问题审计、整体摘要等 6 类任务。
- **可观测性**：按生成记录 token 数、各阶段耗时、质量评分；DB / LLM / TTS 健康巡检。
- **前端页面**：`index.html`（主应用）、`dashboard.html`（Mission Control）、`knowledge-hub.html`、`knowledge-ops.html`，纯原生 JS、无框架。

## 快速开始

### 本地运行

```bash
npm install
npm start                 # 服务监听 3010 端口
npm run gemini-proxy      # 宿主机侧 Gemini 执行器，监听 :13210（独立进程）
```

### Docker（推荐，完整栈）

```bash
docker compose up -d --build   # viewer + gemini-proxy + ocr + tts-en + tts-ja
docker compose logs -f
```

> `gemini` CLI 二进制与 `scripts/infra/gemini-host-proxy.js` 运行在**宿主机**而非容器内。可用 `scripts/infra/install_host_executor_launchd.sh` 安装为 macOS LaunchAgent。

## 常用命令

```bash
npm test              # node:test 单元测试（tests/unit/*.test.js，~238 项，约 1s）
npm run lint          # ESLint 9 flat config，零警告基线
npm run lint:fix      # 自动修复
npm run test:e2e      # Playwright 全量 E2E（隔离服务，端口 3310）
npm run test:e2e:smoke   # happy-path 生成 / OCR / 历史
```

## 架构速览

```
用户输入 → promptEngine（CoT）→ LLM provider → JSON/Markdown → htmlRenderer → fileManager → ttsService
                                              ↓
                          databaseService（历史、可观测性、指标）
```

### LLM provider 链

`services/generation/cardGenerationService.js` 按请求选择 provider：

- `provider=local` → 本地 OpenAI 兼容端点（`LLM_BASE_URL`）
- `provider=gemini` + `GEMINI_MODE=host-proxy`（默认生产路径）→ 3 跳链：`viewer → gemini-gateway 容器(:18888) → 宿主机执行器(:13210，spawn gemini CLI)`
- `provider=gemini` + `GEMINI_MODE=cli` → 进程内 CLI 传输

超时层级由 `services/llm/geminiTimeouts.js` 单一基准派生；错误码约定见 `services/llm/geminiErrors.js`（用 `.code` 字段分类，不要正则匹配错误信息）。

### 目录结构

```
server.js        约 100 行：仅 bootstrap（中间件、路由挂载、错误中间件、listen）
lib/             进程级基础设施（logger、serverConfig、throttle、生成辅助函数）
routes/          每个文件 = 一个领域的 express.Router()
services/        业务逻辑，按领域分子目录：
  ├── llm/         LLM provider 与 gemini 传输链
  ├── generation/  卡片生成管线 + 内容处理
  ├── knowledge/   知识分析引擎 + 任务
  ├── observability/  可观测性 / 健康巡检 / 统计
  ├── storage/     DB（databaseService + db/ 各领域 SQL 模块）+ 文件管理
  ├── ocr/         Tesseract OCR
  └── fixtures/    E2E 确定性输出
prompts/         卡片生成提示词模板（buildMarkdownPrompt 加载，活跃输入）
public/          前端（原生 JS，ES modules，marked.js + DOMPurify）
database/        schema.sql（约 14 张表 + FTS5 全文检索）
tests/unit/      node:test 单元测试；tests/e2e/  Playwright
scripts/         运维 / 迁移 / 测试脚本
ocr_service/     Tesseract OCR sidecar（docker-compose 引用）
Docs/            架构 / 功能 / 运维 / 测试报告文档
```

## 数据与持久化

- **SQLite**（`better-sqlite3`）。`services/storage/databaseService.js` 负责 schema 初始化与启动时的增量迁移（`ensureTableColumns`），各表族委托给 `services/storage/db/` 下的领域模块。**新增表请新建领域模块 + 类上的委托方法，不要在 databaseService.js 内联 SQL。**
- 生成的卡片文件落盘于 `RECORDS_PATH` 下按 `YYYYMMDD` 分目录，冲突追加 `(2)`/`(3)` 后缀。
- **安全**：`RECORDS_PATH` 不作为静态目录挂载；HTML 校验禁止 `script`/`iframe`/`object`/`embed`；HTML 响应带 CSP 头。

## Docker 服务

| 端口 | 服务 |
|---|---|
| 3010 | viewer（Express） |
| 18888 | gemini-proxy 网关容器（转发至宿主机执行器） |
| — | ocr（Tesseract sidecar） |
| 8000 | Kokoro TTS（英文） |
| 50021 | VOICEVOX（日文） |

## 环境变量

完整集合见 `.env.example`。关键项：

- **LLM**：`GEMINI_MODE`、`GEMINI_PROXY_URL`、`GEMINI_PROXY_MODEL`、`GEMINI_EXECUTION_BUDGET_MS`、`GEMINI_MAX_CONCURRENT`；本地 LLM 用 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`。
- **存储**：`DB_PATH`、`RECORDS_PATH`、`RECORDS_TIMEZONE`（单元测试用 `DB_PATH=:memory:`）。
- **TTS**：`TTS_EN_ENDPOINT`（Kokoro）、`TTS_JA_ENDPOINT`（VOICEVOX）。
- **OCR**：`OCR_PROVIDER=tesseract`、`OCR_TESSERACT_ENDPOINT`、`OCR_LANGS`。
- **日志**：`LOG_LEVEL`、`LOG_PRETTY`、`LOG_SILENT`。

## 更多文档

- **`CLAUDE.md`**（根目录）：持续维护的架构索引，最权威的入口。
- **`Docs/`**：架构（`Architecture/`）、功能（`Features/`）、运维（`Operations/`）、测试报告（`TestReports/`）。
