# Repo 架构与功能设计（最新）

## 项目概览
- 项目名称：Trilingual Records（三语学习卡片生成与管理）
- 目标：输入短语或图片（OCR），生成三语学习卡片（Markdown + HTML + 音频），并提供历史、统计与可观测性仪表盘。
- 默认模型：本地 LLM（OpenAI 兼容接口），Gemini 逻辑保留但已封存。

## 架构总览
- 前端：`public/` 下的静态站点（纯 HTML/CSS/JS）。
  - `index.html`：主生成与浏览界面（卡片生成 + 文件夹/历史/弹窗）。
  - `dashboard.html`：Mission Control 大盘（整体统计）。
  - JS 模块化：`public/js/modules/*`。
- 后端：`server.js`（Node + Express）。
- 业务服务层：`services/`。
- 数据存储：
  - 文件系统：按日期文件夹保存 `.md`/`.html`/`.meta.json`/音频文件。
  - SQLite：`database/schema.sql` 定义的结构化记录与可观测性指标。
- 部署方式：Docker Compose（`docker-compose.yml`）包含 viewer 服务 + TTS 服务（Kokoro/VOICEVOX）。

## 运行与部署
- `docker-compose.yml`：
  - `viewer`：主服务（端口 3010）。
  - `tts-en`：Kokoro（端口 8000）。
  - `tts-ja`：VOICEVOX（端口 50021）。
- 挂载卷：`trilingual_records` -> `/data/trilingual_records`。
- 关键环境变量：
  - `RECORDS_PATH=/data/trilingual_records`
  - `DB_PATH=/data/trilingual_records/trilingual_records.db`
  - `LLM_BASE_URL`、`LLM_MODEL`、`LLM_OCR_MODEL`
  - `TTS_EN_ENDPOINT`、`TTS_JA_ENDPOINT`、`TTS_EN_MODEL`、`VOICEVOX_SPEAKER`

## 核心流程（生成链路）
1. 输入（文本或 OCR 图像）。
2. Prompt 构建（`services/promptEngine.js`）。
3. LLM 生成（`services/localLlmService.js`）。
4. 结构化解析与校验（JSON 结构验证）。
5. 内容后处理（`services/contentPostProcessor.js`，含日文注音处理）。
6. HTML 渲染与音频任务生成（`services/htmlRenderer.js`）。
7. 文件落盘（`services/fileManager.js`）。
8. TTS 生成（`services/ttsService.js`）。
9. 指标采集（`services/observabilityService.js`）。
10. 入库（`services/databaseService.js`）。

## 主要模块说明
- `services/localLlmService.js`
  - OpenAI 兼容请求、JSON 解析、OCR 识别。
- `services/promptEngine.js`
  - Prompt 模板与结构化输出约束。
- `services/contentPostProcessor.js`
  - 结果标准化、质量检查、去除不需要的注音等。
- `services/htmlRenderer.js`
  - Markdown -> HTML，音频按钮注入。
- `services/observabilityService.js`
  - Token 计数、成本估算、性能分段、质量评分、Prompt 结构化。
- `services/databaseService.js`
  - SQLite 访问，含 FTS 搜索、统计聚合、详情查询。
- `services/fileManager.js`
  - 按日期文件夹管理、文件读写、按文件名删除。 
- `services/healthCheckService.js`
  - 服务健康检查与存储统计。
- `services/ttsService.js`
  - Kokoro / VOICEVOX 音频生成。

## 数据模型（SQLite）
- `generations`：生成主记录（phrase、provider、folder/base、文件路径、内容摘要等）。
- `audio_files`：音频文件记录（语言/文本/文件路径/状态）。
- `observability_metrics`：Token、成本、性能、质量、Prompt、LLM 输出等。
- `generation_errors`：错误记录。

## API 设计（server.js）
- 生成与 OCR
  - `POST /api/generate`
  - `POST /api/ocr`
- 健康与统计
  - `GET /api/health`
  - `GET /api/statistics`
  - `GET /api/search`
  - `GET /api/recent`
- 历史记录
  - `GET /api/history`（分页/搜索/过滤）
  - `GET /api/history/:id`
- 文件系统
  - `GET /api/folders`
  - `GET /api/folders/:folder/files`
  - `GET /api/folders/:folder/files/:file`
- 删除
  - `DELETE /api/records/:id`
  - `DELETE /api/records/by-file?folder=...&base=...`

## 前端功能设计
- 主界面（`index.html`）
  - 文本输入与 OCR 生成。
  - 文件夹视图（按日期分组）。
  - Phrase List 多列卡片视图。
  - 弹窗展示学习卡片内容。
  - 弹窗 Tab：`卡片内容 / MISSION 指标`。
  - 删除按钮：支持删除该卡片所有文件 + 数据库记录。
  - 自动刷新列表（生成后刷新）。

- 历史记录（History）
  - 搜索、分页、Provider 过滤。
  - 点击记录打开弹窗。
  - 右键上下文删除。

- Mission Control（`dashboard.html`）
  - 不再展示单卡指标，展示整体统计大盘。
  - 模块：
    - Overview（总量/平均质量/平均 Tokens/平均延迟）
    - Cost Summary
    - Quality / Token / Latency 趋势
    - Provider 分布
    - Recent Records
  - 风格：沿用 Mission Control 的暗色玻璃质感视觉。

## 现状与约定
- Gemini 路径保留但默认封存，仅本地 LLM 生效。
- 生成文件保存至挂载卷 `/data/trilingual_records`，按日期目录分组。
- 删除操作支持“数据库记录 + 音频 + 文件系统”完整清理。

