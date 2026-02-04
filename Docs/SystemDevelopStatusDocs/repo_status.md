# Repo 架构与功能设计（最新）

**最后更新**: 2026-02-05
**版本**: 2.1 - Light Theme + Enhanced Observability

## 项目概览
- 项目名称：Trilingual Records（三语学习卡片生成与管理）
- 目标：输入短语或图片（OCR），生成三语学习卡片（Markdown + HTML + 音频），并提供历史、统计与可观测性仪表盘。
- 主要模型：Gemini API (Gemini 1.5 Flash)，本地 LLM 作为备选。
- UI 主题：明亮简洁的 Light 主题，专业商务风格。

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
- **API Fuel**：真实配额使用仪表盘（月度 token 限额追踪）
- **Data Core**：存储统计
- **Model Arena**：模型对比（Gemini vs Local）
- **Quality Signal**：质量趋势图（7D/30D/90D）
- **Live Feed**：增强的实时日志流（显示短语/provider/质量/tokens/成本）
- **Provider Distribution**：供应商使用分布横向条形图
- **Error Monitor**：错误监控面板（失败率 + 错误类型分类）
- **Token/Cost/Latency Trends**：三大趋势图表（D3.js 可视化）

**视觉风格**：明亮简洁的 Light 主题 + 专业商务风格

## 视觉设计系统 (v2.1 - Light Theme)
- **全局主题**：明亮简洁的 Light 主题
  - 浅色基调：`#f8f9fa` (页面背景)
  - 纯白卡片：`#ffffff` (卡片背景)
  - 柔和边框：`#e5e7eb` (边界线)
  - 深色文字：`#1f2937` (主文本) / `#6b7280` (次要文本)

- **品牌色彩系统**（保持不变）：
  - 蓝色 `#3b82f6` - 主色调
  - 紫色 `#8b5cf6` - 强调色
  - 绿色 `#10b981` - 成功状态
  - 琥珀 `#f59e0b` - 警告状态
  - 红色 `#ef4444` - 错误状态

- **交互效果**：
  - 清晰阴影：`box-shadow: 0 1px 3px rgba(0,0,0,0.05)`
  - 悬停增强：边框颜色变化 + 阴影加深
  - 平滑过渡：0.2s ease 动画

- **字体系统**：
  - Space Grotesk（标题/品牌）
  - JetBrains Mono（代码/数据/指标）
  - Noto Serif（学习卡片正文）

- **进度指示**：9阶段细粒度可视化
  - 初始化 → 图像识别 → 构建Prompt → LLM生成 → 解析结果 → 渲染HTML → 保存文件 → 生成音频 → 完成

- **Tooltip 系统**：
  - 所有指标支持鼠标悬停显示中文说明
  - 深色背景 (#1f2937) + 白色文字
  - 带箭头指示器，8px 偏移
  - 平滑淡入动画 (0.2s)
  - 35+ 个 tooltip 覆盖所有关键指标

## 现状与约定
- 主要使用 Gemini API (gemini-1.5-flash-latest)，本地 LLM 作为备选。
- 生成文件保存至挂载卷 `/data/trilingual_records`，按日期目录分组。
- 删除操作支持"数据库记录 + 音频 + 文件系统"完整清理（两种方式）：
  - 按记录 ID：`DELETE /api/records/:id`
  - 按文件名：`DELETE /api/records/by-file?folder=...&base=...`
- 前端完全模块化，使用 ES6 Modules（无构建工具，原生浏览器支持）。


---

## 📋 更新日志

### 2026-02-05 - v2.1: Light Theme + Enhanced Observability

**主题系统改造**
- ✅ 全局切换为明亮简洁的 Light 主题
- ✅ 页面背景：深色 → 浅灰白 (#f8f9fa)
- ✅ 卡片背景：半透明深蓝 → 纯白 (#ffffff)
- ✅ 文字颜色：浅灰 → 深灰黑 (#1f2937)
- ✅ 移除玻璃态效果，改用清晰阴影
- ✅ 保持品牌色不变，确保视觉一致性

**Tooltip 系统**
- ✅ 实现自定义 tooltip 组件（CSS ::after + ::before）
- ✅ 添加 35+ 个中文指标说明
  - Dashboard: 13 个区域 tooltip
  - INTEL 面板: 22+ 个元素 tooltip
- ✅ 深色背景 + 箭头指示器
- ✅ 平滑淡入动画
- ✅ 移动端响应式支持

**可观测性增强** (2026-02-04)
- ✅ 真实配额数据替换 mock 数据
  - 月度 token 限额追踪 (100万)
  - 重置日期显示（每月1号）
  - 剩余天数估算
- ✅ 质量维度标准化
  - 4 维度系统：completeness (40pts) + accuracy (30pts) + exampleQuality (20pts) + formatting (10pts)
  - 详细评分算法实现
- ✅ Dashboard 新增功能
  - Provider Distribution 横向条形图
  - Error Monitor 面板（失败率 + 分类）
  - Token/Cost/Latency 三大趋势图（D3.js）
  - Enhanced Live Feed（显示短语/质量/成本）
- ✅ 单卡 INTEL 面板增强
  - Prompt/Output 可折叠查看器
  - 质量维度详细条形图
  - 生成配置参数显示
  - 低质量警告提示
  - JSON/CSV 导出功能
- ✅ 数据库统计增强
  - 7D/30D/90D 趋势分段
  - 实时错误统计
  - Provider 使用分布

**文件修改汇总**
- `public/styles.css`: Light 主题变量 + 组件样式
- `public/css/dashboard.css`: Dashboard 专用样式 + Tooltip 系统
- `public/dashboard.html`: 新增容器 + Tooltip 属性
- `public/js/modules/app.js`: INTEL 面板增强 + Tooltip
- `public/js/modules/dashboard.js`: 实时统计 + 趋势图表
- `services/databaseService.js`: 真实配额计算 + 趋势分段
- `services/observabilityService.js`: 质量维度标准化

**总计变更**
- 10 个文件修改
- +1227 行新增代码
- -288 行删除代码
- 净增长 +939 行
