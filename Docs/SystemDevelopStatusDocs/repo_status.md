# Repo 架构与功能设计（最新）

**最后更新**: 2026-02-10  
**版本**: 2.9

## 项目概览

- 项目名称：Trilingual Records（三语学习卡片系统）
- 目标：输入文本或 OCR 图片，生成三语学习卡片（Markdown/HTML/音频）并沉淀可观测数据
- 当前主线：`local LLM + few-shot 轮次优化 + Gemini teacher 对照`
- Gemini 集成策略：默认使用宿主机 `gemini-host-proxy`（容器内不再依赖 Gemini CLI 可执行文件）
- Gemini 默认模型：`gemini-3-pro-preview`（支持 `llm_model` 按请求覆盖）

## 架构总览

- 前端：`public/`（主页面 `index.html` + 统计大盘 `dashboard.html`）
- 后端：`server.js`（Express API + 生成编排 + 对比模式 + 实验追踪）
- 服务层：`services/`（LLM、Prompt、后处理、渲染、TTS、DB、few-shot/experiment）
- 存储层：
  - 文件系统：按日期目录 `YYYYMMDD` 存储 `md/html/meta/audio`
  - SQLite：`generations`、`observability_metrics`、`few_shot_runs`、`experiment_rounds`、`experiment_samples`、`teacher_references`
- 部署：Docker Compose（viewer + ocr + tts-en + tts-ja）+ 宿主机 Gemini Proxy

## 当前能力清单

- 单模型生成：`local`（默认）/ `gemini`（通过 CLI 或 host-proxy）
- 双模型对比：`enable_compare=true`，同时生成 `gemini/local` 以及 `input` 输入卡片
- 详情弹窗双 Tab：
  - `CONTENT`：学习卡片内容与例句音频
  - `INTEL`：质量/Token/性能/Prompt/LLM Output（支持 RAW/结构化切换与复制）
- 删除能力：
  - 按记录 ID 删除：`DELETE /api/records/:id`
  - 按文件删除：`DELETE /api/records/by-file`
  - 均会清理数据库记录与关联音频文件
- 文件浏览：
  - 日期目录列表：`GET /api/folders`
  - 目录内卡片：`GET /api/folders/:folder/files`
  - 文件内容读取：`GET /api/folders/:folder/files/:file`

## Few-shot 与实验机制（主线）

- Prompt 注入流程（local provider）：
  1. baseline prompt 构建
  2. 读取 teacher 或历史高质量样本（`goldenExamplesService`）
  3. 预算控制：`contextWindow * tokenBudgetRatio`
  4. 超预算降级：`budget_reduction -> budget_truncate -> budget_exceeded_disable`
- 轮次追踪：
  - 样本记录：`experiment_samples`
  - 轮次聚合：`experiment_rounds`
  - teacher 快照：`teacher_references`
  - run 明细：`few_shot_runs` + `few_shot_examples`
- 导出与报告脚本：
  - `scripts/run_fewshot_rounds.js`
  - `scripts/export_round_trend_dataset.js`
  - `d3/render_round_trend_charts.mjs`
  - `scripts/generate_round_kpi_report.js`

## 最新验证状态（2026-02-06）

- 实验：`exp_round_local20plus_20260206_073637`（21 条样本）
- 核心结果（local baseline vs local fewshot_r1）：
  - 成功率：`90.48% -> 100.00%`
  - 平均质量：`72.00 -> 79.33`（+7.33）
  - 平均 Tokens：`979.76 -> 1498.48`（+52.94%）
  - 平均延迟：`57.59s -> 59.16s`（+2.73%）
  - 增益效率：`14.14 分 / 1k 额外 token`
- Proxy 透传：`model` 字段已完成代码与 mock 链路验证

## 关键文档入口

- 后端状态：`Docs/SystemDevelopStatusDocs/BACKEND.md`
- API 状态：`Docs/SystemDevelopStatusDocs/API.md`
- 实现状态：`Docs/SystemDevelopStatusDocs/IMPLEMENTATION_STATUS.md`
- 本轮完整测试报告：`Docs/TestDocs/完整测试报告_local20plus_20260206_073637.md`
- 本轮对照报告：`Docs/TestDocs/对照报告_local20plus_vs_gemini3pro_prev.md`

---

**维护者**: Three LANS Team
