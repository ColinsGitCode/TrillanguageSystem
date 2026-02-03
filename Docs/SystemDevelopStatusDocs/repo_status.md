# Repo 架构与功能设计（最新）

## 项目概览
- 项目名称：Trilingual Records（三语学习卡片生成与管理）
- 目标：输入短语或图片（OCR），生成三语学习卡片（Markdown + HTML + 音频），并提供历史、统计与可观测性仪表盘。
- 默认模型：本地 LLM（OpenAI 兼容接口），Gemini 逻辑保留但已封存。

## 架构总览
- **前端**：`public/` 下的静态站点（纯 HTML/CSS/JS + ES6 Modules）。
  - `index.html`：主生成与浏览界面（卡片生成 + 文件夹/历史/弹窗）。
  - `dashboard.html`：Mission Control 大盘（整体统计）。
  - **JS 模块化**：`public/js/modules/*`
    - `app.js`：主应用入口
    - `dashboard.js`：仪表盘逻辑
    - `api.js`：API 调用封装
    - `store.js`：状态管理
    - `utils.js`：工具函数
    - `audio-player.js`：音频播放器
    - `virtual-list.js`：虚拟列表（性能优化）
  - **样式系统**：
    - `styles.css`：主样式（包含 Sci-Fi 主题变量）
    - `css/dashboard.css`：Mission Control 专用样式
- **后端**：`server.js`（Node + Express）。
- **业务服务层**：`services/`（9个服务模块）。
- **数据存储**：
  - 文件系统：按日期文件夹保存 `.md`/`.html`/`.meta.json`/音频文件。
  - SQLite：`database/schema.sql` 定义的结构化记录与可观测性指标。
- **工具脚本**：
  - `scripts/migrateRecords.js`：历史数据迁移工具（支持批量导入）
- **部署方式**：Docker Compose（`docker-compose.yml`）包含 viewer 服务 + TTS 服务（Kokoro/VOICEVOX）。

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

### 主界面（`index.html`）
**布局结构**：
- 顶部：Mission Control 快捷入口
- 左侧：生成面板（始终可见，非 Tab）
  - 文本输入模式
  - 图片识别模式（OCR）
  - 进度条（9个细粒度阶段）
- 右侧：资源浏览区（双 Tab 切换）
  - **文件夹 Tab**：按日期分组的文件夹列表
  - **历史记录 Tab**：数据库记录列表（搜索/分页/过滤）

**Phrase List 视图**：
- 多列网格卡片布局（`grid-template-columns: repeat(auto-fill, minmax(210px, 1fr))`）
- 卡片式按钮，悬停效果
- 点击打开学习卡片弹窗

**学习卡片弹窗**：
- 全屏模态框展示
- 双 Tab 切换：
  - **CONTENT**：渲染后的学习卡片内容（HTML）
  - **INTEL**：可观测性指标（Tokens/成本/质量/性能）
- 音频播放按钮集成
- 点击外部或 ESC 关闭

**删除功能**：
- 历史记录列表：右键上下文菜单 → 删除
- 支持完整清理：数据库记录 + 所有文件 + 音频

**自动刷新**：
- 生成完成后自动刷新文件夹列表
- 删除后自动刷新当前视图

### Mission Control（`dashboard.html`）
**定位**：整体统计分析大盘（非单卡调试工具）

**核心模块**：
- **Infrastructure**：服务状态矩阵（LLM/TTS/存储）
- **API Fuel**：配额使用仪表盘
- **Data Core**：存储统计
- **Model Arena**：模型对比（Gemini vs Local）
- **Quality Signal**：质量趋势图（7D/30D/90D）
- **Live Feed**：实时日志流

**视觉风格**：Sci-Fi 霓虹主题 + 暗色玻璃质感

## 视觉设计系统
- **主界面**：清爽白色卡片 + 柔和渐变背景
- **Mission Control**：Sci-Fi 霓虹主题
  - 暗色基调：`#0f172a`
  - 玻璃质感（Glassmorphism）：半透明面板 + 模糊效果
  - 霓虹色彩系统：
    - 蓝色 `#3b82f6` - 主色调
    - 紫色 `#a855f7` - 强调色
    - 绿色 `#10b981` - 成功状态
    - 琥珀 `#f59e0b` - 警告状态
    - 红色 `#ef4444` - 错误状态
  - 字体：Space Grotesk（标题） + JetBrains Mono（代码/数据）
- **进度指示**：9阶段细粒度可视化
  - 初始化 → 图像识别 → 构建Prompt → LLM生成 → 解析结果 → 渲染HTML → 保存文件 → 生成音频 → 完成

## 现状与约定
- Gemini 路径保留但默认封存，仅本地 LLM 生效。
- 生成文件保存至挂载卷 `/data/trilingual_records`，按日期目录分组。
- 删除操作支持"数据库记录 + 音频 + 文件系统"完整清理（两种方式）：
  - 按记录 ID：`DELETE /api/records/:id`
  - 按文件名：`DELETE /api/records/by-file?folder=...&base=...`
- 前端完全模块化，使用 ES6 Modules（无构建工具，原生浏览器支持）。

