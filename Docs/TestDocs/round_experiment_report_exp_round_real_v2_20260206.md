# Round 实验报告（exp_round_real_v2_20260206）

**实验日期**: 2026-02-06  
**实验 ID**: `exp_round_real_v2_20260206`  
**目标**: 观察本地 LLM 在 baseline -> few-shot 迭代轮次下的质量变化趋势。  
**模型**: `qwen2_5_7b`  
**样本短语**: `提示词工程` / `API Gateway` / `多模型对比`

---

## 1. 执行方式

```bash
docker compose restart viewer
docker compose exec -T viewer node scripts/run_fewshot_rounds.js Docs/TestDocs/data/phrases_round_real.txt exp_round_real_v2_20260206
docker compose exec -T viewer node scripts/export_round_trend_dataset.js exp_round_real_v2_20260206 Docs/TestDocs/data
docker compose exec -T viewer node d3/render_round_trend_charts.mjs Docs/TestDocs/data/round_trend_exp_round_real_v2_20260206.json
```

---

## 2. 轮次配置

| Round | 配置 | 说明 |
|---|---|---|
| 0 | baseline | `fewshot.enabled=false` |
| 1 | fewshot_r1 | `count=1, minScore=80, budget=0.20` |
| 2 | fewshot_r2 | `count=2, minScore=82, budget=0.22` |
| 3 | fewshot_r3 | `count=3, minScore=85, budget=0.25` |

---

## 3. 核心结果

### 3.1 每轮聚合指标

| Round | 成功率 | 平均质量分 | 平均 Tokens | 平均延迟 |
|---|---:|---:|---:|---:|
| baseline | 3/3 | 78 | 1124.33 | 57.61s |
| fewshot_r1 | 3/3 | 80 | 1166.67 | 62.61s |
| fewshot_r2 | 3/3 | 78 | 1148.00 | 58.63s |
| fewshot_r3 | 3/3 | 78 | 1134.67 | 56.58s |

### 3.2 相对 baseline 增量

| Round | 质量分增量 | Tokens 增量 | 延迟增量 |
|---|---:|---:|---:|
| fewshot_r1 | +2 | +42.33 | +5.00s |
| fewshot_r2 | 0 | +23.67 | +1.02s |
| fewshot_r3 | 0 | +10.33 | -1.03s |

---

## 4. 关键发现

1. 本轮没有出现持续性质量提升，最佳点在 `fewshot_r1`（+2 分），后续回落到 baseline 水平。  
2. few-shot 实际未生效：`few_shot_runs` 中 `fewshot_enabled=1` 的记录为 `0/12`，`example_count>0` 为 `0/12`。  
3. 降级原因统计：`budget_exceeded_disable=6`、`no_examples=3`、`none=3`（baseline）。  
4. `teacher_references` 未写入（本轮未跑 teacher 参考轮次），所以 `teacher_gap` 图为空。

---

## 5. 可视化图表

### 5.1 Quality 趋势
![](charts/round_quality_trend_exp_round_real_v2_20260206.svg)

### 5.2 Quality vs Tokens（双轴）
![](charts/round_quality_tokens_exp_round_real_v2_20260206.svg)

### 5.3 Teacher Gap（本轮为空）
![](charts/round_teacher_gap_exp_round_real_v2_20260206.svg)

---

## 6. 数据文件

- 轮次执行汇总：`Docs/TestDocs/data/rounds/exp_round_real_v2_20260206/summary.json`
- 轮次趋势 JSON：`Docs/TestDocs/data/round_trend_exp_round_real_v2_20260206.json`
- 轮次趋势 CSV：`Docs/TestDocs/data/round_trend_exp_round_real_v2_20260206.csv`
- 增量 CSV：`Docs/TestDocs/data/round_deltas_exp_round_real_v2_20260206.csv`

---

## 7. 结论与下一步

本轮结果说明：当前瓶颈不在“轮次机制”，而在“few-shot 示例注入未发生”。  
下一轮应优先验证以下两点：

1. 先构建可用 Teacher 样本池（Gemini 高质量记录），并执行 `is_teacher_reference=true` 轮次。  
2. 调整上下文预算与示例长度控制，避免 `budget_exceeded_disable` 导致全量回落到 baseline prompt。
