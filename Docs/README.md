# Docs 文档入口

## 当前权威基线

按以下优先级判断系统现状：

1. 根目录 CLAUDE.md；
2. 实际代码与 database/schema.sql；
3. Docs/Architecture/Fullstack_Migration_React_Router.md；
4. 其他设计、运营和测试文档。

## 当前产品边界

2026-07-16 当前正式运行产品包含两部分：

- **Cards Factory**：卡片生成、OCR、英文/日文 TTS、共享生成队列、文件夹/历史卡片、标红与 CONTENT/INTEL 卡片弹窗；
- **学习辅助 2.0**：学习计划、今日队列、可恢复复习会话、四档评分、FSRS 调度、学习记录与可降级 PlanningSignalProvider。

**教材课程**已完成 TC-D0-TC-D2 与 TC-P0-TC-P4，并于 2026-07-15 通过完整架构验收。当前具备 `/textbooks` 桌面校对工作台：Git 外 Manifest 校验、draft 导入、七张教材表、教材表达搜索、受控官方音频播放、正式 EN/JA 单句 TTS、持久化选区标红、人工 verified、显式发布到学习辅助、`textbook_en/ja` 学习单元、教材 Track 范围计划、教材复习视图，以及会同步完成态的选区派生卡任务。`TEXTBOOK_FEATURE_ENABLED` 默认开启但仍可关闭。知识图谱 2.0 已确认 KG-D0-D2，并完成 KG-P0-P3：migration 003 的 11 张 `kg_*` 表、migration 004 的 LA 手动入队表、确定性身份/词形、append-only lookup/resolution、unresolved 人工裁决、Evidence、point stats/planning signal、同步 Graph signalReader，以及 `/knowledge` 的显式查找与确认加入学习。三项 KG 开关首次部署仍全部关闭。

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
- Features/Textbook_Courses_Product_Definition.md：已确认的教材课程产品定义与 TC-P4 完成状态，定义专用 Skill 导入、教材内容诚信、官方音频、Track 页面、派生卡和学习辅助 2.0 接入边界；
- Features/prototypes/tc-d1-prototype.html：已确认的 TC-D1 桌面端 12 状态可视化原型，使用合成内容并覆盖校对、官方/TTS 音频、派生卡和学习辅助接入；
- Architecture/Textbook_Courses_Domain_Data_and_Media_ADR.md：已接受的 TC-D2 ADR 及 TC-P0-TC-P4 实施/验收记录，定义教材七表、修订、逐方向 hash、Manifest、API、媒体安全、Cards Factory 隔离和 LA-D2 增补；
- Operations/Textbook_Courses_Runbook.md：教材导入、校对、发布、媒体、修订、备份恢复与故障降级运行手册；
- TestReports/Textbook_Courses_TC_P4_Acceptance_20260715.md：TC-P4 完整验收报告；
- Architecture/schemas/textbook-track-manifest.v1.schema.json：不含教材原文的 Track Manifest v1 机器校验 contract；
- ../skills/import-textbook-track/SKILL.md：TC-P0 教材 Track 导入 Skill；实际 Manifest、截图、官方音频和 dry-run summary 留在 Git 外；
- Features/Modern_Card_UI_Design.md：仍适用于 Cards Factory 的卡片视觉；
- Features/UI_Modernization_Design_System.md：设计 tokens 与 UI 横向约束；
- Features/Knowledge_Graph_2_0_Product_Definition.md：已确认的 KG-D0 产品定义。把「重复查询」重构为检索困难信号、把「近似词形」重构为知识关联；定义 `lexeme/phrase/grammar_pattern` 三类知识点身份、append-only 显式 lookup 事件语义、日语 basic-form+lemma-reading 规范化与 `inflection-of/polite-of/evidence-of` 确定性关系；Study Item 仍是唯一正式调度单位，KP 只做跨内容组织、查询与只读聚合，图信号只经可降级的 `graphPlanningSignalProvider` 对基础队列受限细排，绝不写 FSRS；
- Features/prototypes/kg-d1-prototype.html：已确认的 KG-D1 桌面端 12 状态原型，覆盖显式 lookup、重复查找、队列内/外边界、一次性加入学习、日语词形关系、unresolved、KP 三类证据、精确重复生成、受限细排与降级态；
- Architecture/Knowledge_Graph_2_0_Domain_and_Data_ADR.md：已接受的 KG-D2 领域与数据 ADR（2026-07-16 Accepted）。定义智能来源四层模型（L0 事实 / L1 确定性分析 / L2 DeepSeek 异步提案 / L3 裁决），DeepSeek 只作异步 proposal、不进同步队列不写 FSRS；11 张 `kg_*` 表 + 1 张 LA 手动入队表（表 37-48）；KP 分层身份、可逆 split/merge、unresolved 工作流、append-only lookup 幂等、`kg-lookup-signal-v1` 只读细排、`加入本次学习` 的共享 bucket 5 amendment；§21-§24 已登记 KG-P0-P3 实施、测试、真实 volume dry-run、reader 性能与显式加入学习验收；

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

学习辅助 2.0 已在全栈迁移完成后启动产品设计，当前基线为 `Features/Learning_Assistance_2_0_Design_Baseline.md`；知识图谱 2.0 已从 KG-D0 全新启动，并完成 KG-D0-D2 与 KG-P0-P3；仍不复活旧知识 API、旧 schema 或旧页面，且不接管学习调度状态。

## 其他历史边界

2026-05-28 已删除 training pack、few-shot/golden examples、experiment tracking 和人工 review 子系统。旧 Gemini proxy/CLI 方案也已退出运行链路。相关架构与测试文档仅供 git 历史追溯。

## 测试资料

- TestReports/UI_MODERNIZATION_REGRESSION_20260711.md：Cards Factory 现代化基线；
- TestReports/UI_FULL_REGRESSION_20260601.md：历史全站回归，仅作背景；
- TestReports/TEST_PLAN_20260518.md 与 TEST_RUN_20260518.md：历史测试计划与结果。

测试命令和当前覆盖范围以 CLAUDE.md 与 package.json 为准。
