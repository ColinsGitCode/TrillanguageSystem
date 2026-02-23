# AI 可观测性优化路线图（2/4/8周）

更新时间：2026-02-23  
适用工程：`Three_LANS_PJ_CodeX`

## 1. 目标与范围

目标：把“能运行”提升为“可观测、可归因、可复现、可治理”。

覆盖链路：

1. 前端请求（UI）
2. 应用服务（3010）
3. Gemini Gateway（18888）
4. Host Executor（3210）
5. 数据库与实验数据（SQLite）

---

## 2. 当前基础（已具备）

- 已有核心指标：token、cost、latency、quality、prompt/output、few-shot metadata。
- 已有落库：`generations`、`observability_metrics`、`few_shot_runs` 等。
- 已有展示：Mission Control / Intel 页面。
- 已有网关审计与熔断状态。
- 已有人工评审驱动的注入门控（review-gated few-shot）。

---

## 3. 2周计划（稳态优先）

## 3.1 里程碑

- M1：统一 `trace_id`，实现跨服务关联查询。
- M2：上线 SLO 最小集与基础告警。
- M3：结构化阶段耗时固定上报。
- M4：错误快照自动采集（超时/熔断/fetch fail）。

## 3.2 任务清单（按接口/文件）

1. 统一 trace_id
   - API：`POST /api/generate` 入参支持 `trace_id`（无则生成）。
   - 文件：
     - `server.js`
     - `services/geminiProxyService.js`
     - `services/databaseHelpers.js`（如存在）
     - `services/databaseService.js`

2. SLO 聚合接口
   - API：新增 `GET /api/observability/slo?range=24h|7d|30d`
   - 指标：success_rate、p95_latency、timeout_rate、breaker_open_count、queue_depth_peak
   - 文件：
     - `server.js`
     - `services/databaseService.js`

3. 阶段耗时标准化
   - 字段：`promptBuild/llmCall/parse/render/tts/dbPersist/total`
   - 文件：
     - `services/observabilityService.js`
     - `server.js`

4. 错误快照
   - 采集：provider/model/trace_id/prompt_hash/request_id/upstream_status/retry_count/fallback_reason
   - 文件：
     - `server.js`
     - `services/databaseService.js`
     - `database/schema.sql`（补充错误扩展字段）

## 3.3 验收标准

- 任意一条生成记录可用 `trace_id` 反查上下游记录。
- 能查看最近24小时 SLO 摘要。
- 超时/熔断错误可看到完整上下文。

---

## 4. 4周计划（归因与效率）

## 4.1 里程碑

- M5：Prompt/参数版本化。
- M6：质量漂移监控。
- M7：成本效率指标上线。
- M8：队列治理看板上线。

## 4.2 任务清单（按接口/文件）

1. Prompt/参数版本化
   - 字段：`prompt_version`、`param_profile`、`model_revision`
   - 文件：
     - `services/promptEngine.js`
     - `server.js`
     - `database/schema.sql`

2. 质量漂移统计
   - API：`GET /api/observability/drift?group_by=model|provider|lang&window=7d`
   - 文件：
     - `server.js`
     - `services/databaseService.js`

3. 成本效率看板指标
   - 指标：cost_per_success、cost_per_quality_point、gain_per_1k_tokens
   - 文件：
     - `public/js/dashboard.js`
     - `server.js`

4. 队列与重试治理
   - 指标：queue_wait_ms、retry_count、reset_count、rate_limit_hits
   - 文件：
     - 网关工程（18888）
     - 本工程 `services/geminiProxyService.js`（透传与展示）

## 4.3 验收标准

- 能按模型版本解释质量波动原因。
- 能看到“质量提升是否值得 token 成本”的量化结论。

---

## 5. 8周计划（闭环与平台化）

## 5.1 里程碑

- M9：人工评审可信度建模。
- M10：实验可复现包导出。
- M11：自动回归门禁（发布前）。
- M12：故障自愈（stuck inflight/orphan process）。

## 5.2 任务清单（按接口/文件）

1. 评审可信度
   - 指标：review_coverage、review_consistency、inject_accept_rate
   - 文件：
     - `services/exampleReviewService.js`
     - `database/schema.sql`

2. 实验包导出
   - API：`GET /api/experiments/:id/bundle`
   - 内容：输入、prompt版本、模型参数、输出、指标、图表数据
   - 文件：
     - `server.js`
     - `scripts/`（导出脚本）

3. 自动回归门禁
   - 规则：质量不降、SLO不劣化、成本涨幅不超阈值
   - 文件：
     - `scripts/`（回归脚本）
     - `Docs/TestDocs/`（基线报告）

4. 自愈机制
   - 动作：检测 stuck -> reset -> 降级 -> 事件留痕
   - 文件：
     - 网关工程（18888）
     - 本工程容错逻辑（`server.js` / `services/geminiProxyService.js`）

## 5.3 验收标准

- 实验结果可一键复现。
- 线上故障可自动恢复并有完整审计轨迹。

---

## 6. 优先级与依赖

- P0（立即）：M1/M2/M3/M4（2周内容）。
- P1（次级）：M5/M6/M7/M8（4周内容）。
- P2（中期）：M9/M10/M11/M12（8周内容）。

依赖：

1. `gemini_cli_proxy` 上游稳定（3210常驻 + 18888可达）。
2. 本地 LLM 服务健康。
3. 数据库 schema 迁移窗口可执行。

---

## 7. 建议执行顺序（本周）

1. 先做 `trace_id` 与错误快照（高收益、低风险）。
2. 再做 SLO API 与 dashboard 卡片。
3. 最后补阶段耗时结构化字段，完成“可比性”闭环。

