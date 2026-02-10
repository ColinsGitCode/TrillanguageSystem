# 实现状态报告（few-shot 主线）

**日期**: 2026-02-10  
**版本**: v2.9  
**状态**: 进行中（核心链路可用，持续优化）

## 1. 当前阶段结论

- 轮次机制已可执行，数据落库与导出链路已闭环
- 当前主要瓶颈已从“轮次机制缺失”转为“teacher 样本质量与预算策略”
- 本轮已验证 few-shot 真正注入并产生显著提质

## 2. 已完成能力

### 2.0 Gemini 模型路由与默认值（更新）

- 默认 Gemini 模型已统一为：`gemini-3-pro-preview`
- 生效链路：
  - `docker-compose.yml` 默认 `GEMINI_PROXY_MODEL/GEMINI_MODEL`
  - `scripts/start-gemini-proxy.sh` 默认 `GEMINI_PROXY_MODEL`
  - `.env.example` 示例值同步为 `gemini-3-pro-preview`
- `/api/generate` 支持 `llm_model` 覆盖；未传时走默认模型
- Gemini 不可用时自动回退本地模型（`provider_requested=gemini`，`provider_used=local`）

### 2.1 生成与观测

- `POST /api/generate` 支持：
  - `experiment_id/experiment_round/round_name/variant`
  - `is_teacher_reference`
  - `fewshot_options`
  - `llm_model`（可透传覆盖模型）
- `observability.metadata` 提供：
  - `promptText/promptParsed`
  - `rawOutput/outputStructured`
  - `fewShot` 明细（countUsed/fallbackReason/tokens）

### 2.2 数据库与实验追踪

- 已启用并稳定写入：
  - `few_shot_runs`
  - `few_shot_examples`
  - `experiment_rounds`
  - `experiment_samples`
  - `teacher_references`
- 统计回写：
  - `recomputeExperimentRoundStats()` 自动聚合 round 指标
  - `teacherGap`、`successRate`、`avgQuality`、`avgTokens` 可直接出图

### 2.3 导出与图表

- 数据导出：`scripts/export_round_trend_dataset.js`
  - `round_trend_*.json/csv`
  - `round_metrics_*.csv`
  - `round_kpi_summary_*.json`
- 图表生成：`d3/render_round_trend_charts.mjs`
  - `round_quality_trend`
  - `round_gain_efficiency`
  - `round_alignment_stability`
  - `round_gain_tokens_scatter`
- 报告生成：`scripts/generate_round_kpi_report.js`

### 2.4 Gemini host-proxy 透传

- `model` 字段透传已完成端到端代码支持
- mock CLI 链路验证通过（请求 model 与执行模型一致）

## 3. 最新实验结果（21 样本）

- 实验 ID：`exp_round_local20plus_20260206_073637`
- 基线 vs few-shot_r1：
  - 成功率：`90.48% -> 100.00%`
  - 平均质量：`72.00 -> 79.33`（+7.33）
  - 平均 Tokens：`979.76 -> 1498.48`（+52.94%）
  - 平均延迟：`57.59s -> 59.16s`（+2.73%）
  - 增益效率：`14.14 分 / 1k 额外 token`
- 结论：few-shot 已显著提质，但 token 成本仍高

## 4. 当前风险与限制

1. teacher 质量上限依赖 Gemini 侧稳定性与模型质量
2. `budget_exceeded_disable` 在预算偏紧时会导致 few-shot 回退
3. baseline 偶发失败仍存在（`fetch failed` / `truncated output`）
4. 绝对质量上限仍未稳定追平最佳 teacher 轮次

## 5. 下一步执行重点

1. 扩大高质量 teacher 样本池并建立筛选门槛
2. 调整 `tokenBudgetRatio + exampleMaxChars` 组合，降低回退率
3. 细化错误分类（网络/截断/解析）并做重试策略
4. 增加“质量提升 vs token 成本”门控，自动停更劣化配置

## 6. 关键文档索引

- 完整实验报告：`Docs/TestDocs/完整测试报告_local20plus_20260206_073637.md`
- 对照报告：`Docs/TestDocs/对照报告_local20plus_vs_gemini3pro_prev.md`
- KPI 报告：`Docs/TestDocs/fewshot_round_kpi_report_exp_round_local20plus_20260206_073637.md`

---

**维护者**: Three LANS Team
