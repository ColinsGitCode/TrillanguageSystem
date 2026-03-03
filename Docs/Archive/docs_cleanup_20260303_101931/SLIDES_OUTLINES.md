# AI Agent 可观测性落地汇报（SLIDES_OUTLINES）

**演示主题**：AI Agent 可观测性——业界落地综述 + 本工程实践复盘  
**适用对象**：架构评审 / 平台工程 / AI Agent 应用研发  
**关联工程**：Trilingual Records（本仓库）  
**输出目标**：可直接转 PPTX 的分页大纲（每页配 1 张 SVG 图表）

---

## 调研范围与来源（官方文档，2026-02）

- OpenTelemetry 三支柱与上下文传播：  
  [Traces](https://opentelemetry.io/docs/concepts/signals/traces/) / [Metrics](https://opentelemetry.io/docs/concepts/signals/metrics/) / [Logs](https://opentelemetry.io/docs/concepts/signals/logs/) / [Context Propagation](https://opentelemetry.io/docs/concepts/context-propagation/)
- GenAI 语义约定（语义字段标准化）：  
  [GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- Agent/LLM 追踪语义生态：  
  [OpenInference (Arize)](https://github.com/Arize-ai/openinference) / [Phoenix Docs](https://docs.arize.com/phoenix)
- Agent 工程观测平台实践：  
  [LangSmith Observability](https://docs.smith.langchain.com/observability)
- 评估与观测闭环（Evals）：  
  [OpenAI Evals Guide](https://platform.openai.com/docs/guides/evals)
- 企业级观测平台参考：  
  [Azure AI Foundry Observability](https://learn.microsoft.com/en-us/azure/ai-foundry/concepts/observability)

---

## 业界落地综述（先行结论）

- 共识 1：Agent 观测必须从“请求级日志”升级为“步骤级 Trace + 语义字段”。
- 共识 2：仅看准确率不够，必须同时看质量、延迟、Token/成本、安全四维。
- 共识 3：离线评测与在线观测需要同源数据，才能形成发布门禁。
- 共识 4：标准化（OTel + GenAI SemConv + OpenInference）是跨模型与跨平台治理前提。
- 共识 5：高可用体系必须包含故障回放、可归因和自动恢复策略。

---

## Slide 0 封面：从可运行到可治理

- 目标：定义本次汇报边界——不是“功能演示”，而是“可观测治理方案”。
- 三个核心问题：行业共识、本工程已落地能力、下一步治理闭环。

![Slide 0 Chart](TestDocs/charts/ai_agent_observability_cn/slide_00_cover_ai_agent_observability.svg)

**讲者备注**：先把“可观测性”定位成工程控制系统，不是可选功能。  
**Data Source**：业界公开标准 + 本工程实现

---

## Slide 1 行业痛点：Agent 为什么必须可观测

- Agent 失败不再是单点失败，而是链路中的隐性失败（工具、模型、上下游、网络）。
- 质量、成本、时延与安全目标互相拉扯，必须统一观测。
- 核心结论：无观测 = 无法稳定迭代。

![Slide 1 Chart](TestDocs/charts/ai_agent_observability_cn/slide_01_industry_pain_driver.svg)

**讲者备注**：用“系统复杂性”解释为什么传统日志监控不够。  
**Data Source**：OTel/Agent 平台实践总结

---

## Slide 2 落地框架：四层可观测架构

- L1 采集：SDK / 中间件 / DB Hook / Tool Hook
- L2 遥测：Trace / Metrics / Logs / Events
- L3 评估：离线评测 + 在线抽检 + 人评校准
- L4 运营：SLO、告警、发布门禁、事故复盘

![Slide 2 Chart](TestDocs/charts/ai_agent_observability_cn/slide_02_industry_observability_stack.svg)

**讲者备注**：强调“采集只是第一层，运营才是终点”。  
**Data Source**：OTel + 业界平台共性能力

---

## Slide 3 标准化路径：OTel + GenAI SemConv + OpenInference

- OTel 负责跨系统追踪与上下文传播。
- GenAI SemConv 负责统一模型调用关键字段语义。
- OpenInference 补齐 LLM/Tool/Agent 过程语义。

![Slide 3 Chart](TestDocs/charts/ai_agent_observability_cn/slide_03_standards_alignment.svg)

**讲者备注**：标准化的价值是“跨模型迁移成本下降 + 排障效率提升”。  
**Data Source**：OTel / OpenInference 官方文档

---

## Slide 4 平台能力对照（能力维度，不做产品排名）

- 对照维度：Tracing、Live Monitor、Evaluation、Prompt Versioning、OTel、Self-host。
- 结论：主流平台在观测与评测趋同，差异主要在部署形态与治理深度。
- 本工程策略：先内部打通观测数据面，再决定是否外接平台。

![Slide 4 Chart](TestDocs/charts/ai_agent_observability_cn/slide_04_platform_capability_matrix.svg)

**讲者备注**：这一页用于“买平台 vs 自建能力”的决策讨论。  
**Data Source**：LangSmith / Phoenix / Azure 公开能力说明

---

## Slide 5 SLI/SLO 设计：把观测变成治理

- 四类 SLI：质量、性能、成本、安全。
- SLO 不是单一阈值，而是一组发布门禁规则。
- 本工程建议：将 `quality + latency + token` 联动门禁化。

![Slide 5 Chart](TestDocs/charts/ai_agent_observability_cn/slide_05_agent_slo_framework.svg)

**讲者备注**：SLO 页是“工程动作”入口，后续都要映射到此页。  
**Data Source**：SRE 方法 + 本工程实验指标体系

---

## Slide 6 本工程映射：系统链路与观测落点（已实现）

- 真实链路：Web UI -> Node Server -> Gateway(18888) -> Host Executor(3210)。
- 持久化：SQLite + 文件系统（卡片与音频资产）。
- 观测落点：请求、模型输出、阶段耗时、质量评分、few-shot 元数据。

![Slide 6 Chart](TestDocs/charts/ai_agent_observability_cn/slide_06_project_architecture_mapping.svg)

**讲者备注**：先证明我们已有“可观测数据面”，不是从零开始。  
**Data Source**：`/Users/xueguodong/WorkTechDir/Three_LANS_PJ_CodeX/server.js`、`/Users/xueguodong/WorkTechDir/Three_LANS_PJ_CodeX/database/schema.sql`

---

## Slide 7 本工程数据模型：可追溯关系（已实现）

- 核心链路：`generations -> observability_metrics -> few_shot_runs -> experiment_samples`。
- 审核体系：`example_units / example_reviews / review_campaigns` 已入库。
- 能力结果：可按“样本-提示词-输出-指标”全链路回放。

![Slide 7 Chart](TestDocs/charts/ai_agent_observability_cn/slide_07_project_data_model_traceability.svg)

**讲者备注**：这是“实验可信度”和“问题归因”成立的结构基础。  
**Data Source**：`/Users/xueguodong/WorkTechDir/Three_LANS_PJ_CodeX/database/schema.sql`

---

## Slide 8 当前完成度评估：覆盖评分（现状盘点）

- 已完成较高：链路采集、质量评估、实验可复现。
- 仍有缺口：运营治理、故障自愈。
- 管理含义：下一阶段应把“观测数据”转化为“自动动作”。

![Slide 8 Chart](TestDocs/charts/ai_agent_observability_cn/slide_08_capability_coverage_score.svg)

**讲者备注**：这页用于解释为什么后续路线优先做 SLO/告警/自愈。  
**Data Source**：`/Users/xueguodong/WorkTechDir/Three_LANS_PJ_CodeX/Docs/SystemDevelopStatusDocs/*.md`

---

## Slide 9 真实案例：GEMINI fetch fail 的观测价值

- 观测链路把故障从“现象”推进到“根因”：3210 不可用、解析漂移、上游阻塞。
- 修复动作：守护进程 + 解析策略 + 健康检查。
- 复盘价值：相同故障可快速定位并复用处理模板。

![Slide 9 Chart](TestDocs/charts/ai_agent_observability_cn/slide_09_incident_case_fetch_fail.svg)

**讲者备注**：用真实事故证明观测体系在生产中的价值。  
**Data Source**：故障修复记录 + 网关调用链路实践

---

## Slide 10 优化优先级矩阵：下一步做什么

- 近优先：统一 Trace-ID、SLO 告警、Prompt 发布门禁。
- 中期：自动回归评测、成本效率追踪。
- 长期：故障自愈编排与自动降级。

![Slide 10 Chart](TestDocs/charts/ai_agent_observability_cn/slide_10_optimization_priority_matrix.svg)

**讲者备注**：优先级依据“业务影响 x 实施复杂度”。  
**Data Source**：当前缺口分析 + 运维目标

---

## Slide 11 路线图：2 周 / 4 周 / 8 周交付节奏

- 2 周（稳态）：统一标识、基础告警、阶段耗时标准化。
- 4 周（归因）：Prompt 版本化、质量漂移监控、成本看板。
- 8 周（闭环）：自动回归门禁、自愈编排、可信评审模型。

![Slide 11 Chart](TestDocs/charts/ai_agent_observability_cn/slide_11_delivery_roadmap_2_4_8_weeks.svg)

**讲者备注**：每阶段可交付可验收，避免“大而全”。  
**Data Source**：`/Users/xueguodong/WorkTechDir/Three_LANS_PJ_CodeX/Docs/DesignDocs/Observability/AI_Observability_Roadmap.md`

---

## Slide 12 目标态：可观测运营闭环

- 目标闭环：可观测 -> 可解释 -> 可决策 -> 可优化。
- 北极星指标：成功率、P95 延迟、质量下限、MTTR、单位质量成本。
- 决策请求：按路线图推进并建立季度复盘机制。

![Slide 12 Chart](TestDocs/charts/ai_agent_observability_cn/slide_12_target_state_operating_model.svg)

**讲者备注**：收口到运营模型与 KPI，而不是停留在技术实现。  
**Data Source**：本工程指标体系 + 运营治理目标

---

## 图表生成方式（D3）

- 渲染脚本：`/Users/xueguodong/WorkTechDir/Three_LANS_PJ_CodeX/d3/render_ai_agent_observability_cn_slides.mjs`
- 输出目录：`/Users/xueguodong/WorkTechDir/Three_LANS_PJ_CodeX/Docs/TestDocs/charts/ai_agent_observability_cn/`
- 执行命令：

```bash
node /Users/xueguodong/WorkTechDir/Three_LANS_PJ_CodeX/d3/render_ai_agent_observability_cn_slides.mjs
```

