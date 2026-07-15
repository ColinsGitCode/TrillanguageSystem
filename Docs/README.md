# Docs 文档入口

## 当前权威基线

按以下优先级判断系统现状：

1. 根目录 CLAUDE.md；
2. 实际代码与 database/schema.sql；
3. Docs/Architecture/Fullstack_Migration_React_Router.md；
4. 其他设计、运营和测试文档。

## 当前产品边界

2026-07-15 当前正式运行产品包含两部分：

- **Cards Factory**：卡片生成、OCR、英文/日文 TTS、共享生成队列、文件夹/历史卡片、标红与 CONTENT/INTEL 卡片弹窗；
- **学习辅助 2.0**：学习计划、今日队列、可恢复复习会话、四档评分、FSRS 调度、学习记录与可降级 PlanningSignalProvider。

**教材课程**已完成 TC-D0、TC-D1、TC-D2、TC-P0、TC-P1、TC-P2、TC-P3 与 TC-P3.1。当前具备 `/textbooks` 桌面校对工作台：Git 外 Manifest 校验、draft 导入、七张教材表、教材表达搜索、受控官方音频播放、正式 EN/JA 单句 TTS、持久化选区标红、人工 verified、显式发布到学习辅助、`textbook_en/ja` 学习单元、教材 Track 范围计划、教材复习视图，以及会同步完成态的选区派生卡任务。`TEXTBOOK_FEATURE_ENABLED` 默认开启但仍可关闭。知识图谱 2.0 继续后置。

当前实施与设计入口：

- ../README.md：启动与运行；
- ../CLAUDE.md：当前架构索引；
- Architecture/Fullstack_Migration_React_Router.md：正式架构迁移基线；
- Architecture/Fullstack_Migration_Acceptance_Report.md：D0-P6 架构完成验收记录；
- Architecture/TTS_Model_Selection.md：TTS 决策；
- Features/Learning_Assistance_2_0_Design_Baseline.md：学习计划与复习 2.0 当前正式产品设计基线；
- Features/Learning_Assistance_2_0_Product_Definition.md：已确认的 LA-D0 用户任务、产品术语、回忆方向、学习单元、计划/队列/评分策略与成功指标（含 §15.1 LA-D1 原型确认记录）；
- Features/prototypes/la-d1-prototype.html：已确认的 LA-D1 桌面端 12 页可视化原型（浏览器直接打开）；
- Architecture/Learning_Assistance_2_0_Domain_and_Data_ADR.md：已接受的 LA-D2 领域、事件、调度、时区和 API contract，以及 2026-07-14 LA-P0-P4 实施记录；
- Features/Learning_Assistance_2_0_Data_Preparation_Plan.md：现有卡片备份、审计、同步、标签与音频整备实施基线（DP0-DP7）；
- Features/Card_Classification_and_Tagging.md：卡片分类与标签专题（T0 数据回填与在线增量打标已完成；T1 API / T2 UI 待实施；兼作 LA 2.0 可选信号源）；
- Features/Textbook_Courses_Product_Definition.md：已确认的教材课程 TC-D0 产品定义，定义专用 Skill 导入、教材内容诚信、官方音频、Track 页面、派生卡和学习辅助 2.0 接入边界，并记录 TC-P3.1 当前完成状态；
- Features/prototypes/tc-d1-prototype.html：已确认的 TC-D1 桌面端 12 状态可视化原型，使用合成内容并覆盖校对、官方/TTS 音频、派生卡和学习辅助接入；
- Architecture/Textbook_Courses_Domain_Data_and_Media_ADR.md：已接受的 TC-D2 ADR 及 TC-P0/TC-P1/TC-P2/TC-P3/TC-P3.1 实施记录，定义教材七表、修订、逐方向 hash、Manifest、API、媒体安全、Cards Factory 隔离和 LA-D2 增补；
- Architecture/schemas/textbook-track-manifest.v1.schema.json：不含教材原文的 Track Manifest v1 机器校验 contract；
- ../skills/import-textbook-track/SKILL.md：TC-P0 教材 Track 导入 Skill；实际 Manifest、截图、官方音频和 dry-run summary 留在 Git 外；
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

学习辅助 2.0 已在全栈迁移完成后启动产品设计，当前基线为 `Features/Learning_Assistance_2_0_Design_Baseline.md`；知识图谱 2.0 保持后置，不复活旧 API、旧 schema 或旧页面。

## 其他历史边界

2026-05-28 已删除 training pack、few-shot/golden examples、experiment tracking 和人工 review 子系统。旧 Gemini proxy/CLI 方案也已退出运行链路。相关架构与测试文档仅供 git 历史追溯。

## 测试资料

- TestReports/UI_MODERNIZATION_REGRESSION_20260711.md：Cards Factory 现代化基线；
- TestReports/UI_FULL_REGRESSION_20260601.md：历史全站回归，仅作背景；
- TestReports/TEST_PLAN_20260518.md 与 TEST_RUN_20260518.md：历史测试计划与结果。

测试命令和当前覆盖范围以 CLAUDE.md 与 package.json 为准。
