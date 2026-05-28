# Docs 文档入口

当前文档已按用途重组为 7 类：

- `Docs/Architecture/`：系统架构、数据库、Observability、测试架构
- `Docs/Features/`：仍在使用的功能设计
- `Docs/Operations/`：运行、Gemini、知识任务、模型配置与排障
- `Docs/Experiments/`：Code as Prompt、Few-shot、质量评估与实验方案
- `Docs/Status/`：当前实现状态、接口、前后端现状
- `Docs/TestReports/`：测试报告与验收产物
- `Docs/Archive/`：里程碑、退役功能、历史归档

## 建议阅读顺序

1. `Docs/Status/repo_status.md`
2. `Docs/Status/IMPLEMENTATION_STATUS.md`
3. `Docs/Status/API.md`
4. `Docs/Status/BACKEND.md`
5. `Docs/Status/FRONTEND.md`

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

### 4. Code as Prompt / Few-shot / 质量评估

- `Docs/Experiments/CodeAsPrompt/Few-Shot机制设计方案.md`
- `Docs/Experiments/CodeAsPrompt/Schema-First_校验修复循环落地方案.md`
- `Docs/Experiments/CodeAsPrompt/review_scoring_and_injection_gate.md`
- `Docs/Experiments/CodeAsPrompt/例句人工评审驱动FewShot注入方案.md`
- `Docs/Experiments/CodeAsPrompt/商用模型API场景下Prompt优化优先级建议.md`
- `Docs/Experiments/Quality/QUALITY_IMPROVEMENT_GUIDE.md`
- `Docs/Experiments/Quality/质量评价设计文档.md`

### 5. UI / Card 功能

- `Docs/Features/Modern_Card_UI_Design.md`

### 6. 测试与验收

- `Docs/Architecture/Testing/Playwright_E2E_Testing_Design.md`
- `Docs/TestReports/TRAIN_QUALITY_ACCEPTANCE_20260308.md`
- `Docs/TestReports/TRAIN_REFINEMENT_EXECUTION_20260308.md`
- `Docs/TestReports/UI_Validation_MissionControl_20260305.md`
- `Docs/TestReports/UI_Validation_TRAIN_Selection_20260309.md`

### 7. 历史与归档

- `Docs/Archive/Milestones/`
- `Docs/Archive/RetiredFeatures/`
- `Docs/Archive/HistoricalTests/`
- `Docs/Archive/Assets/`

`Docs/Archive/` 已进一步拆成 4 层：里程碑、退役能力、历史测试与资源资产。
