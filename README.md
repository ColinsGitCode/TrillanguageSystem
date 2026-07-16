# 三语卡片生成系统

Cards Factory 是一个本地学习卡片生产工作台：通过 DeepSeek 生成中/英/日三语卡、日语语法卡和场景表达卡，并为英文与日文内容合成语音。

## 当前功能

- 三类 Markdown-first 卡片生成；
- 图片 OCR 输入；
- 服务端共享生成队列、失败重试与审计详情；
- 文件夹、历史卡片、删除与标红；
- CONTENT / INTEL 学习卡弹窗；
- 生成 token、耗时、质量数据与基础服务健康检查；
- Kokoro 英文 TTS 与 VOICEVOX 日文 TTS。
- 学习辅助 2.0：学习计划、今日队列、FSRS 复习、四档评分与学习记录；
- 教材课程：Git 外 Manifest、人工校对、官方整轨、英日单句 TTS、标红、派生卡与学习计划接入。

Mission Control、Knowledge Hub、Knowledge OPS、旧知识分析与旧 SRS/复习/学习计划已于 2026-07-13 退役并从运行时、API 和数据库 schema 删除。学习辅助 2.0 已重新设计并上线；知识图谱 2.0 继续后置。

## 快速开始

本地：

    npm install
    npm run build:react
    npm start

访问 http://127.0.0.1:3010/。

Docker Compose：

    docker compose up -d --build
    docker compose logs -f

Compose project name 为 three_lans_system，默认启动 viewer、ocr、tts-en、tts-ja。

## 验证命令

    npm test
    npm run test:integration
    npm run lint
    npm run smoke
    npm run test:e2e
    npm run test:textbooks:acceptance

## 架构速览

    Input/OCR
      -> generation queue
      -> atomic SQLite claim
      -> executeCardGeneration use case
      -> promptEngine
      -> DeepSeek
      -> Markdown/HTML validation
      -> TTS + filesystem
      -> SQLite history/observability

Cards Factory 由 React Router v7 + TypeScript 在根路径渲染；同一 `server.mjs` 进程组合 React SSR、Express API、CommonJS services 与 better-sqlite3。旧 `public/index.html` 和浏览器 ESM 前端已删除，`public/` 仅保留 favicon 静态资产。

### 目录

    server.mjs         React Router + Express production composition root
    server.js          API-only integration-test bootstrap
    app/               React Cards Factory、Card Modal、typed API client、styles
    routes/            generate/jobs/files/history/health/ocr
    services/
      generation/      prompt、后处理、ruby、HTML、TTS、队列
      llm/             DeepSeek 与本地 OpenAI-compatible adapter
      observability/   生成指标与健康检查
      storage/         SQLite 与 records filesystem
      ocr/             Tesseract adapter
      fixtures/        E2E 确定性输出
    public/            favicon 等无逻辑静态资产
    prompts/           三类卡片的活跃 prompt 模板
    database/          当前 SQLite schema
    tests/             unit / integration / Playwright
    Docs/              架构、功能、运维与历史记录

## 数据

- SQLite 使用 better-sqlite3 + WAL。
- 生成 worker 直接调用应用 use case，不再通过 HTTP 调用自身；队列使用 busy timeout、有界重试、原子 claim、重启恢复与优雅停机。
- 卡片文件写入 RECORDS_PATH，并按日期或目标文件夹组织。
- RECORDS_PATH 不作为静态目录暴露。
- HTML 经校验和 DOMPurify 净化；禁止 script、iframe、object、embed。
- 启动时会删除已经退役的 Knowledge/SRS/training 历史表。

## Provider

- DeepSeek：默认 deepseek-v4-pro。
- 英文 TTS：Kokoro，MP3。
- 日文 TTS：VOICEVOX，WAV。
- 中文作为母语解释文本，不生成语音。
- OCR：Tesseract sidecar；可选 OpenAI-compatible 本地模型仅用于 OCR/开发回退。

## 环境变量

完整清单见 .env.example。常用项：

- DEEPSEEK_API_KEY、DEEPSEEK_BASE_URL、DEEPSEEK_MODEL、DEEPSEEK_TIMEOUT_MS；
- DB_PATH、RECORDS_PATH、RECORDS_TIMEZONE；
- TTS_EN_ENDPOINT、TTS_JA_ENDPOINT；
- OCR_PROVIDER、OCR_TESSERACT_ENDPOINT、OCR_LANGS；
- LOG_LEVEL、LOG_PRETTY、LOG_SILENT。
- SQLITE_BUSY_TIMEOUT_MS、SQLITE_BUSY_RETRY_MAX、SQLITE_BUSY_RETRY_BASE_MS、GENERATION_WORKER_SHUTDOWN_TIMEOUT_MS。

## 文档

- CLAUDE.md：当前代码架构权威索引；
- Docs/Architecture/Fullstack_Migration_React_Router.md：正式迁移基线；
- Docs/Architecture/Fullstack_Migration_Acceptance_Report.md：D0-P6 架构完成验收；
- Docs/Architecture/TTS_Model_Selection.md：TTS 决策；
- Docs/README.md：当前文档与历史文档边界。
