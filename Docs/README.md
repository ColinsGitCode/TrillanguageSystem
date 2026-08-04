# Docs 文档入口

## 当前权威基线

按以下优先级判断系统现状：

1. 根目录 CLAUDE.md；
2. 实际代码与 database/schema.sql；
3. Docs/Architecture/Fullstack_Migration_React_Router.md；
4. 其他设计、运营和测试文档。

## 当前产品边界

2026-07-16 当前正式运行产品包含两部分：

- **Cards Factory**：卡片生成、OCR、英文/日文 TTS、共享生成队列、文件夹/历史卡片，以及支持四色标记、取消标记、复制、知识点查询和生成卡片的 CONTENT/INTEL 卡片弹窗；
- **学习辅助 2.0**：学习计划、今日队列、可恢复复习会话、四档评分、FSRS 调度、学习记录与可降级 PlanningSignalProvider。

**教材课程**已完成 TC-D0-TC-D2、TC-P0-TC-P4 和 DS-W2 SaaS workflow 迁移。当前 `/textbooks` 是由服务端 view-model 驱动的桌面校对长流程：Codex Skill 在应用外解析并通过正式 API 导入 draft，页面负责 copy-on-write 修订、逐表达确认、发布 Review Summary、可恢复 operation、局部重试、完成摘要与学习接入。现有 Git 外 Manifest、教材表达搜索、受控官方音频、正式 EN/JA 单句 TTS、持久化标红、派生卡和 `textbook_en/ja` 学习闭环均保留。`TEXTBOOK_FEATURE_ENABLED` 默认开启但仍可关闭。知识图谱 2.0 已确认 KG-D0-D2，完成 KG-P0-P3、KG-R0、KG-R1 与 KG-R2；本地 Graph planning reader 和增量事实 worker 均已通过真实 volume 验收并开启，LLM enrichment 仍关闭，代码、Compose 和示例环境的四项 KG 默认值仍全部为关闭。

SaaS App Shell 与复杂长流程现代化的 35 项任务已于 2026-07-23 全部完成并验收。生产使用 Three LANS typed primitives，不引入 Cloudscape 组件包或 global styles；教材解析仍由 Codex Skill 在应用外完成，页面负责人工确认、发布与学习。当前正式验收范围仅为桌面端。

当前实施与设计入口：

- ../README.md：启动与运行；
- ../CLAUDE.md：当前架构索引；
- Architecture/Fullstack_Migration_React_Router.md：正式架构迁移基线；
- Architecture/Fullstack_Migration_Acceptance_Report.md：D0-P6 架构完成验收记录；
- Architecture/TTS_Model_Selection.md：TTS 决策；
- Features/Card_Annotation_and_Selection_UX_Evaluation.md：当前学习卡片选区与注解层专题评估。CA-P1 已完成 Radix 菜单/右键接入，CA-P2 已完成 ruby-aware selector、历史迁移与 Recogito 取舍 POC，CA-P3–P4 已完成 schema、受控迁移与 shadow read，CA-P5–P7 已切换三个消费者，CA-P8 已停止旧 HTML 双写并切换删除、改期和统计；CA-R1 真实数据只读观察已通过；CA-I1 已补齐四色标记、取消标记、复制、显式确认的 KG 查询和键盘选区；本文不授权修改卡片正文；
- Features/Japanese_Pronunciation_Overlay_and_Ruby_Retirement_Design.md：**Draft，待产品与架构门禁确认**的日语按需注音浮层与 Ruby 退役方案。定义纯日语正文、整词 pronunciation token、轻量 Tooltip、交互式 Popover、人工纠音、与 annotation/TTS/KG/LA/教材的边界，以及历史 generation 不原地改写的受控迁移路线；真实卷审计确认 672/675 张卡含 13,528 个 Ruby 标签，PF-P0 已量化 466 种相邻复合候选并隔离 60 张历史结构破损卡；当前不授权历史 apply 或删除 legacy reader；
- Architecture/Japanese_Pronunciation_Overlay_and_Ruby_Retirement_ADR.md：注音独立投影、offset、纠音事件、API、feature flag 与消费者边界的实现基线；历史迁移、人工决策、shadow replay、Canary 和 Ruby 退役仍需各自验收；
- Features/prototypes/pf-d1-pronunciation-overlay.html：PF-D1 桌面原型，包含 S1-S12 状态；当前作为交互参考，不替代用户逐状态确认；
- superpowers/plans/2026-08-03-japanese-pronunciation-overlay-ruby-retirement.md：日语按需注音浮层与 Ruby 退役的详细执行任务表，共 76 项；代码路径、只读审计、P0-P3 报告和运行观测已开始落地，当前状态为 **In implementation · 历史迁移、Ruby 删除与 PF-R1 观察待门禁**；
- Operations/Pronunciation_Overlay_Runbook.md：注音浮层的开关、Compose 重建、只读审计、历史迁移、降级回滚、隐私观测和桌面质量门禁手册；明确禁止在人工批准前执行历史 apply 或删除 Ruby；
- TestReports/Pronunciation_PF_P0_Feasibility_20260803.md、Pronunciation_PF_P1_New_Cards_20260803.md、Pronunciation_PF_P2_CardModal_20260803.md、Pronunciation_PF_P3_Consumers_20260803.md、Pronunciation_PF_P4_Shadow_Replay_20260803.md、Pronunciation_PF_P4_Historical_Canary_20260803.md、Pronunciation_PF_P5_Ruby_Retirement_20260803.md、Pronunciation_PF_R1_Observation_20260803.md：本轮注音实施与门禁报告；报告明确区分自动化通过、只读证据和必须由用户/时间窗口完成的门禁；
- TestReports/Pronunciation_Final_Acceptance_20260803.md：最终自动化与 Compose 运行态验收报告；记录 lint/typecheck、456/456 unit、89/89 integration、82/82 desktop E2E、7/7 smoke、health online 和 npm audit 0 vulnerabilities；历史迁移、Ruby 删除与 PF-R1 观察仍为 BLOCKED；
- TestReports/Pronunciation_Compound_Review_Batches_20260803.md：466 个复合词候选的只读人工确认批次定义；默认 25 个/批、19 批、全部 `unreviewed`，不自动接受读音、不授权历史迁移；
- Features/Selection_TTS_Product_and_Technical_Design.md：**Accepted 且已实施**的朗读选区 TTS 产品与技术基线。ST-01–ST-37 已全部完成：CardModal 支持英日按需朗读、保守语言确认、三档语速、失败重试和键盘焦点恢复；服务端提供即时二进制 API、共享优先级协调器与独立缓存 volume；CardModal、教材和复习音频使用共享独占播放 owner，并已验证 annotation/KG/learning/FSRS 与 records 零写入；
- Operations/Selection_TTS_Runbook.md：朗读选区 TTS 的启停、配置、Kokoro/VOICEVOX 故障诊断、缓存 MISS/HIT/BYPASS、争用行为、缓存清理和无数据库 downgrade 回滚手册；
- TestReports/Selection_TTS_ST_P4_Acceptance_20260727.md：ST-P4 最终验收报告，记录真实英日 TTS、40 条批量争用、缓存、零业务写入、391 单元/65 集成/53 桌面 E2E 与最终 Compose 健康状态；
- Architecture/Card_Annotation_Layer_ADR.md：**Accepted** 的卡片注解层技术权威。定义稳定实体身份、`card-visible-text-v1`、UTF-16 W3C quote/position selector、表 53–54 和 CA-P3–P8 迁移顺序；CA-P8 后运行时只读写 `card_annotations`，CA-R1 已验证规范 API 与冻结审计边界，CA-I1 在不改 schema 的前提下完成桌面交互层，`card_highlights` 是否 DROP 仍必须另开 ADR；
- TestReports/Card_Annotation_CA_R1_Observation_20260727.md：CA-R1 规范注解层真实 Compose/SQLite 只读观察报告；记录 27 active、1 orphaned、11 条冻结旧快照、退役 API 404、两次状态哈希一致和全量工程门禁，结论为 PASS 且不授权 DROP 旧表；
- TestReports/Card_Annotation_CA_I1_Acceptance_20260727.md：CA-I1 桌面交互补齐验收报告；记录四色标记、改色/软删除、复制、显式确认的 KG 查询、键盘选区与真实页面无溢出检查，结论为 PASS；其中当时尚未纳入的任意选区 TTS 已由后续 ST-P4 正式补齐；
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
- TestReports/SaaS_Textbook_Workflow_DS_W2_Acceptance_20260723.md：DS-W2 教材 SaaS 长流程迁移验收，记录 workflow、copy-on-write、逐表达确认、operation、桌面 E2E/visual 与边界证据；
- TestReports/SaaS_Workflow_DS_W3_Acceptance_20260723.md：DS-W3 横向一致性验收，记录 ProductShell、Cards Factory、Learning Plan、KG unresolved 与 Review Session 的共享交互及领域边界；
- TestReports/SaaS_Workflow_Final_Acceptance_20260723.md：35 项 SaaS workflow 最终验收，记录备份、完整测试、容器重建、真实 volume 数据不变量、运行态 smoke、feature flag 与回滚边界；
- Architecture/schemas/textbook-track-manifest.v1.schema.json：不含教材原文的 Track Manifest v1 机器校验 contract；
- ../skills/import-textbook-track/SKILL.md：TC-P0 教材 Track 导入 Skill；实际 Manifest、截图、官方音频和 dry-run summary 留在 Git 外；
- Features/Modern_Card_UI_Design.md：仍适用于 Cards Factory 的卡片视觉；
- Features/UI_Modernization_Design_System.md：全栈迁移前的 UI 现代化历史实施基线；其 token、领域色、视觉克制与安静学习工作台原则继续有效，旧静态页面和 Shell 路径已失效；
- Features/SaaS_App_Shell_and_Complex_Workflow_Design_Guidelines.md：已实施并验收的 React Router SaaS App Shell 与复杂长流程横向规范。定义 Cloudscape 参考采用边界、四类流程模型、Stage/Task/Step、保存恢复、Review、异步 Job、AI proposal 与共享 Workflow 原语；教材始终由 Codex Skill 在应用外解析，页面只接收草稿并负责人工确认、发布和学习；
- Features/Public_SaaS_UI_UX_Evolution_Baseline.md：公开 SaaS UI/UX 演进与实施基线。定义不增加用户管理前提下的“单工作区 + 公开体验沙箱”边界，记录跨域 Activity Center、页面状态、离开保护、高成本任务恢复、复习专注模式、真实首次学习闭环、AI 与教材内容来源、匿名沙箱、长列表窗口化、路由资源预算、真实性能采集和公开恢复界面；
- Operations/Public_SaaS_Workspace_Runbook.md：公开 SaaS 工作区运行手册。说明 owner / sandbox 进程级边界、匿名 cookie 会话网关、一会话一 viewer 与独立存储、合成示例种子、期限/额度/重置、公开 Compose、双浏览器隔离验收、隐私安全性能采集、容量/启动失败恢复和回滚方式，以及正式互联网发布仍需的 TLS、持久监控和滥用控制；
- Features/prototypes/saas-textbook-workflow-prototype.html：SaaS 复杂长流程桌面可视化原型，使用合成内容覆盖 Skill 草稿接收、人工确认、发布检查、后台处理、局部失败重试和学习入口；
- Architecture/SaaS_Workflow_State_URL_and_View_Model_Contract.md：已接受的复杂流程 Stage、深链接、服务端 view-model、保存/冲突与命令所有权 contract；
- superpowers/plans/2026-07-23-saas-workflow-modernization.md：已完成的 SaaS App Shell 与复杂长流程现代化详细开发任务表，共 35 个任务；Gate 0、DS-W1、DS-W2、DS-W3 和 Final 均已验收；
- Features/Knowledge_Graph_2_0_Product_Definition.md：已确认的 KG-D0 产品定义。把「重复查询」重构为检索困难信号、把「近似词形」重构为知识关联；定义 `lexeme/phrase/grammar_pattern` 三类知识点身份、append-only 显式 lookup 事件语义、日语 basic-form+lemma-reading 规范化与 `inflection-of/polite-of/evidence-of` 确定性关系；Study Item 仍是唯一正式调度单位，KP 只做跨内容组织、查询与只读聚合，图信号只经可降级的 `graphPlanningSignalProvider` 对基础队列受限细排，绝不写 FSRS；
- Features/prototypes/kg-d1-prototype.html：已确认的 KG-D1 桌面端 12 状态原型，覆盖显式 lookup、重复查找、队列内/外边界、一次性加入学习、日语词形关系、unresolved、KP 三类证据、精确重复生成、受限细排与降级态；
- Architecture/Knowledge_Graph_2_0_Domain_and_Data_ADR.md：已接受的 KG-D2 领域与数据 ADR（2026-07-16 Accepted）。定义智能来源四层模型（L0 事实 / L1 确定性分析 / L2 DeepSeek 异步提案 / L3 裁决），DeepSeek 只作异步 proposal、不进同步队列不写 FSRS；11 张 `kg_*` 表 + 1 张 LA 手动入队表（表 37-48）；KP 分层身份、可逆 split/merge、unresolved 工作流、append-only lookup 幂等、`kg-lookup-signal-v1` 只读细排、`加入本次学习` 的共享 bucket 5 amendment；§21-§26 已登记 KG-P0-P3、KG-R0 与 KG-R1 的实施、真实 volume 回填、Canary、reader 性能和显式加入学习验收；
- Architecture/Knowledge_Graph_2_0_Incremental_Maintenance_ADR.md：KG-R2 增量事实维护基线。定义表 49 transaction-local outbox、在线卡片/教材发布原子入队、source revision/hash 双重重验、Evidence superseded/orphaned、增量投影、restart recovery、hash-gated reconciliation 与默认关闭的独立 worker；
- superpowers/plans/2026-07-23-learning-activation-and-kg-next-steps.md：当前 NEXT STEPS 执行草案。固定 LA-R1 真实学习启用 -> LA-R2 14 学习日复盘 -> KG-R3 unresolved 人工评估集 -> KG-D3/P4 DeepSeek 异步 proposal 的顺序、门禁与交付物；
- Operations/Knowledge_Graph_2_0_Runbook.md：KG-R0 的卷级备份、稳定 Manifest 审核、hash-gated apply、投影验收，以及 KG-R1 同快照 Planning Canary、分级启用和恢复手册；
- TestReports/Knowledge_Graph_KG_R1_Canary_20260717.md：KG-R1 真实 volume 启用前后 Canary 证据、性能、零写入边界和本地开关状态；
- TestReports/Knowledge_Graph_KG_R2_Incremental_Maintenance_20260717.md：KG-R2 真实 volume 增量回填、场景 EN/JA Evidence 身份修复、最终零 reconciliation、零学习调度写入与 worker 启用证据；

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

学习辅助 2.0 已在全栈迁移完成后启动产品设计，当前基线为 `Features/Learning_Assistance_2_0_Design_Baseline.md`；知识图谱 2.0 已从 KG-D0 全新启动，并完成 KG-D0-D2、KG-P0-P3、KG-R0、KG-R1 与 KG-R2；仍不复活旧知识 API、旧 schema 或旧页面，且不接管学习调度状态。

## 其他历史边界

2026-05-28 已删除 training pack、few-shot/golden examples、experiment tracking 和人工 review 子系统。旧 Gemini proxy/CLI 方案也已退出运行链路。相关架构与测试文档仅供 git 历史追溯。

## 测试资料

- TestReports/UI_MODERNIZATION_REGRESSION_20260711.md：Cards Factory 现代化基线；
- TestReports/UI_FULL_REGRESSION_20260601.md：历史全站回归，仅作背景；
- TestReports/TEST_PLAN_20260518.md 与 TEST_RUN_20260518.md：历史测试计划与结果。

测试命令和当前覆盖范围以 CLAUDE.md 与 package.json 为准。
