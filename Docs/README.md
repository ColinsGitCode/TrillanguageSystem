# Docs 文档入口

## 当前权威基线

按以下优先级判断系统现状：

1. 根目录 CLAUDE.md；
2. 实际代码与 database/schema.sql；
3. Docs/Architecture/Fullstack_Migration_React_Router.md；
4. 其他设计、运营和测试文档。

## 当前产品边界

2026-07-13 起，当前产品只保留 **Cards Factory**：卡片生成、OCR、英文/日文 TTS、共享生成队列、文件夹/历史卡片、标红与 CONTENT/INTEL 卡片弹窗。

当前实施入口：

- ../README.md：启动与运行；
- ../CLAUDE.md：当前架构索引；
- Architecture/Fullstack_Migration_React_Router.md：正式架构迁移基线；
- Architecture/Fullstack_Migration_Acceptance_Report.md：D0-P6 架构完成验收记录；
- Architecture/TTS_Model_Selection.md：TTS 决策；
- Features/Modern_Card_UI_Design.md：仍适用于 Cards Factory 的卡片视觉；
- Features/UI_Modernization_Design_System.md：设计 tokens 与 UI 横向约束。

## 已退役：Mission / Knowledge / SRS

Mission Control、Knowledge Hub、Knowledge OPS、旧知识分析、旧 SRS/复习/学习计划已于 2026-07-13 从运行时代码、API、数据库 schema 和测试基线中删除。旧数据库会在启动时自动 DROP 对应表。

下列文档只保留为**历史决策记录**，不得作为当前实现或未来 2.0 设计基线：

- Architecture/Knowledge/*；
- Operations/Knowledge_Local_Analysis_Development_Execution.md；
- Features/Knowledge_Hub_UI_Redesign.md；
- Features/Knowledge_Hub_and_Semantic_Classification.md；
- Features/Engagement_and_Retention_System.md；
- TestReports/UI_Validation_MissionControl_20260305.md；
- 所有旧 Knowledge、SRS、TRAIN、review 相关计划与测试报告。

学习辅助 2.0 与知识图谱 2.0 只会在全栈迁移完成后重新启动产品设计，不复活旧 API、旧 schema 或旧页面。

## 其他历史边界

2026-05-28 已删除 training pack、few-shot/golden examples、experiment tracking 和人工 review 子系统。旧 Gemini proxy/CLI 方案也已退出运行链路。相关架构与测试文档仅供 git 历史追溯。

## 测试资料

- TestReports/UI_MODERNIZATION_REGRESSION_20260711.md：Cards Factory 现代化基线；
- TestReports/UI_FULL_REGRESSION_20260601.md：历史全站回归，仅作背景；
- TestReports/TEST_PLAN_20260518.md 与 TEST_RUN_20260518.md：历史测试计划与结果。

测试命令和当前覆盖范围以 CLAUDE.md 与 package.json 为准。
