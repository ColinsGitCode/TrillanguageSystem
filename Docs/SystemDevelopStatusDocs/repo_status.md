# Repo 架构与功能设计（最新）

**最后更新**: 2026-02-05
**版本**: 2.2

## 项目概览
- 项目名称：Trilingual Records（三语学习卡片生成与管理）
- 目标：输入短语或图片（OCR），生成三语学习卡片（Markdown + HTML + 音频），并提供历史记录与统计大盘。
- 主要模型：本地 LLM（默认），Gemini 为可选配置。

## 架构总览
- 前端：`public/` 静态站点（ESM 模块化）
  - `index.html`：主生成与浏览界面
  - `dashboard.html`：Mission Control 统计大盘
- 后端：`server.js`（Node + Express）
- 业务服务层：`services/`
- 数据存储：文件系统 + SQLite
- 部署：Docker Compose（viewer + Kokoro + VOICEVOX）

## 核心功能
- 文本输入与 OCR 生成
- 9 阶段进度可视化
- 日期文件夹管理
- Phrase List 多列网格卡片
- 弹窗双 Tab：卡片内容 / MISSION 指标
- **交互升级**：指标详情支持点击 `?` 按钮弹出详细中文定义 (取代旧版 Tooltip)
- **卡片删除**：在详情弹窗中直接删除卡片（同步清理数据库 + 物理文件 + 音频）
- Mission Control 统计大盘（趋势 + 分布 + Recent）

## API 概览
- 生成：`POST /api/generate`
- OCR：`POST /api/ocr`
- 历史：`GET /api/history`, `GET /api/history/:id`
- 统计：`GET /api/statistics`
- 文件：`GET /api/folders`, `GET /api/folders/:folder/files`
- 删除：`DELETE /api/records/:id`, `DELETE /api/records/by-file`

## 视觉风格
- 主页面：浅色简洁卡片风
- Mission Control：暗色玻璃质感统计仪表盘

---

**维护者**: Three LANS Team
