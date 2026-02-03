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
    - `styles.css`：主样式（包含 Sci-Fi 主题变量 & HUD 样式）
    - `css/dashboard.css`：Mission Control 专用布局
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
  - **开发模式**：支持当前目录挂载，代码实时同步。
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

## 前端功能设计

### 主界面（`index.html`）
**布局结构**：
- 顶部：Mission Control 快捷入口
- 左侧：生成面板（始终可见）
  - 文本输入模式 / OCR 识别模式
  - 9阶段细粒度进度条
- 右侧：资源浏览区（双 Tab）
  - **文件夹 Tab**：按日期分组
  - **历史记录 Tab**：支持搜索/分页/过滤

**Phrase List 视图**：
- 多列网格卡片布局（`grid-template-columns: repeat(auto-fill, minmax(210px, 1fr))`）
- 虚拟滚动（Virtual Scrolling）支持海量数据流畅渲染

**学习卡片弹窗 (Tactical HUD)**：
- **CONTENT Tab**：渲染后的学习内容，集成音频播放。
- **INTEL Tab**：全图表化指标面板
  - Quality Reactor (全息圆环评分)
  - Chrono Waterfall (时序甘特图)
  - Token Flux (堆叠能量条)
  - Dimensional Scan (雷达图)

### Mission Control（`dashboard.html`）
**视觉风格**：Sci-Fi / Observability Theme（暗色玻璃质感）

**核心模块 (Bento Grid v2)**：
- **Infrastructure**：服务状态信号灯矩阵
- **API Fuel**：配额使用油量表
- **Data Core**：存储使用进度
- **Model Arena**：模型 VS 对比面板
- **Quality Signal**：面积辉光趋势图
- **Live Feed**：实时日志流

## 现状与约定
- Gemini 路径保留但默认封存，仅本地 LLM 生效。
- 生成文件保存至挂载卷 `/data/trilingual_records`。
- 删除操作支持"数据库记录 + 音频 + 文件系统"完整清理。
- 前端代码完全模块化 (ES Modules)，无需构建步骤。
