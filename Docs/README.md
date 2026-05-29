# Docs 文档入口

当前文档按用途分为 4 类：

- `Docs/Architecture/`：系统架构、数据库、Observability、测试架构
- `Docs/Features/`：仍在使用的功能设计
- `Docs/Operations/`：运行、Gemini、知识任务、模型配置与排障
- `Docs/TestReports/`：测试报告与验收产物

## 现状以何处为准

项目的"当前现状"（目录结构、provider 链、persistence、background jobs、frontend 模块、测试与环境变量等）请直接参考：

- **`CLAUDE.md`**（项目根目录）：持续维护的架构索引，是最权威的入口
- **代码本身**：`routes/`、`services/`、`services/db/`、`services/knowledge/`、`lib/`、`public/js/modules/`
- **`database/schema.sql`**：数据库结构

历史上的 `Docs/Status/` 目录（IMPLEMENTATION_STATUS / BACKEND / FRONTEND / API / repo_status 等）已废弃并删除，不再代表当前状态；如需查阅可从 git 历史恢复。

## 已移除子系统（2026-05-28）

**训练包（training pack）、few-shot / golden examples、实验追踪（experiment tracking）、人工评审（review）** 子系统已整体删除。相关代码（`trainingPackService`、`goldenExamplesService`、`exampleReviewService`、`fewShotMetricsService`、`experimentTrackingService`、`/api/training`、`/api/review`、`/api/experiments`、卡片 TRAIN/REVIEW 页）、数据库表（`few_shot_*`、`experiment_*`、`teacher_references`、`example_*`、`review_*`、`card_training_assets`）均已移除，启动时会自动 DROP 旧库中的这些表。

下列历史文档中关于这些子系统的章节**仅作历史参考，不代表当前实现**：

- `Docs/Architecture/数据库设计方案.md`（含已删除的 few_shot / experiment / review / training 表）
- `Docs/Architecture/Observability/AI_Observability_Roadmap.md`（few-shot 效果面板）
- `Docs/Architecture/GEMINI_PROXY_AND_SERVER_QUEUE_REDESIGN.md`
- `Docs/TestReports/`（TRAIN / review_scoring 相关报告与图表）

## 主题导航

### 1. 系统主架构

- `Docs/Architecture/Trilingual_Card_Generation_System.md`
- `Docs/Architecture/GEMINI_PROXY_AND_SERVER_QUEUE_REDESIGN.md`
- `Docs/Architecture/数据库设计方案.md`

### 2. Knowledge / 知识系统

- `Docs/Architecture/Knowledge/Knowledge_Local_Analysis_System_Design.md`
- `Docs/Architecture/Knowledge/Knowledge_System_Upgrade_Strategy.md`
- `Docs/Architecture/Knowledge/Smart_Knowledge_Base_Upgrade.md`
- `Docs/Operations/Knowledge_Local_Analysis_Development_Execution.md`

### 3. Gemini / 运行与调用

- `Docs/Operations/Gemini/GEMINI_CLI_调用方式详解.md`
- `Docs/Operations/Gemini/GEMINI_CLI_知识分析任务执行规范.md`
- `Docs/Operations/vLLM_Recommended_Config.md`

### 4. UI / Card 功能

- `Docs/Features/Modern_Card_UI_Design.md`

### 5. 测试与验收

- `Docs/Architecture/Testing/Playwright_E2E_Testing_Design.md`
- `Docs/TestReports/TRAIN_QUALITY_ACCEPTANCE_20260308.md`
- `Docs/TestReports/TRAIN_REFINEMENT_EXECUTION_20260308.md`
- `Docs/TestReports/UI_Validation_MissionControl_20260305.md`
- `Docs/TestReports/UI_Validation_TRAIN_Selection_20260309.md`
- `Docs/TestReports/TEST_PLAN_20260518.md`
- `Docs/TestReports/TEST_RUN_20260518.md`

> 历史归档（里程碑日志、退役功能设计、历史测试报告、过期现状快照、历史资源资产）已于 2026-05-29 整体删除，如需查阅可从 git 历史恢复。
