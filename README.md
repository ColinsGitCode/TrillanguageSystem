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

Mission Control、Knowledge Hub、Knowledge OPS、旧知识分析与旧 SRS/复习/学习计划已于 2026-07-13 退役并从运行时、API 和数据库 schema 删除。学习辅助与知识图谱将在全栈架构改造完成后重新设计。

## 快速开始

本地：

    npm install
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

## 架构速览

    Input/OCR
      -> generation queue
      -> promptEngine
      -> DeepSeek
      -> Markdown/HTML validation
      -> TTS + filesystem
      -> SQLite history/observability

当前 Cards Factory 仍由 public/index.html + 浏览器 ESM 渲染；后端是 Express + CommonJS services + better-sqlite3。React Router v7 + TypeScript 的 hybrid composition root 已上线，/__rr-poc 作为独立架构探针，根页面尚未切换 owner。

### 目录

    server.js          Express bootstrap + generation worker
    routes/            generate/jobs/files/history/health/ocr
    services/
      generation/      prompt、后处理、ruby、HTML、TTS、队列
      llm/             DeepSeek 与本地 OpenAI-compatible adapter
      observability/   生成指标与健康检查
      storage/         SQLite 与 records filesystem
      ocr/             Tesseract adapter
      fixtures/        E2E 确定性输出
    public/            当前 Cards Factory 原生前端
    prompts/           三类卡片的活跃 prompt 模板
    database/          当前 SQLite schema
    tests/             unit / integration / Playwright
    Docs/              架构、功能、运维与历史记录

## 数据

- SQLite 使用 better-sqlite3 + WAL。
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

## 文档

- CLAUDE.md：当前代码架构权威索引；
- Docs/Architecture/Fullstack_Migration_React_Router.md：正式迁移基线；
- Docs/Architecture/TTS_Model_Selection.md：TTS 决策；
- Docs/README.md：当前文档与历史文档边界。
