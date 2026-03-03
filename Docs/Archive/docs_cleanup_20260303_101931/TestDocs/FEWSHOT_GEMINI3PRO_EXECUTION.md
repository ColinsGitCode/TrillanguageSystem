# Few-shot 实验执行清单（Gemini3-Pro Teacher）

**目标**：用 `gemini-3-pro` 构建高质量 teacher 池，并用可视化 KPI 直观验证 few-shot 是否有效。

## 1. 前置条件

- 服务可用：`/api/health` 返回 `ok`
- Gemini CLI 可用且已认证：`gemini -p "hello"`
- 环境变量建议：

```bash
export GEMINI_MODE=cli
export GEMINI_CLI_MODEL=gemini-3-pro
export GEMINI_TEACHER_MODEL=gemini-3-pro
export ENABLE_GOLDEN_EXAMPLES=true
```

## 2. 执行清单

1. 准备测试短语文件（建议 20+ 条）  
   文件示例：`Docs/TestDocs/data/phrases_round_real.txt`
2. 执行轮次实验（含 teacher seed）  
   配置文件：`Docs/TestDocs/data/rounds_teacher_gemini3pro_v1.json`
3. 导出 round 趋势 + KPI 数据集  
4. 生成 D3 图表  
5. 生成实验报告（Markdown）

## 3. 一键命令（容器内）

```bash
EXPERIMENT_ID=exp_round_gemini3pro_$(date +%Y%m%d_%H%M%S)
node scripts/run_fewshot_rounds.js \
  Docs/TestDocs/data/phrases_round_real.txt \
  "$EXPERIMENT_ID" \
  Docs/TestDocs/data/rounds_teacher_gemini3pro_v1.json

node scripts/export_round_trend_dataset.js "$EXPERIMENT_ID" Docs/TestDocs/data
node d3/render_round_trend_charts.mjs "Docs/TestDocs/data/round_trend_${EXPERIMENT_ID}.json"
node scripts/generate_round_kpi_report.js "$EXPERIMENT_ID"
```

## 4. 关键指标（推荐汇报口径）

- `deltaQuality`：相对 baseline 的质量分增益
- `gainPer1kExtraTokens`：每增加 1k token 带来的质量增益
- `teacherAlignmentPct`：本地输出质量 / teacher 平均质量
- `teacherGapClosurePct`：Teacher Gap 收敛比例
- `qualityStdDev` / `qualityCvPct`：稳定性（波动越低越好）
- `improvementRatioPct`：出现有效提升的轮次占比

## 5. 图表说明

- `round_quality_trend_*.svg`：轮次质量趋势
- `round_gain_efficiency_*.svg`：质量增益 + 每千 token 增益
- `round_alignment_stability_*.svg`：Teacher 对齐率与稳定性
- `round_gain_tokens_scatter_*.svg`：质量增益与 token 成本权衡

## 6. 判定标准（建议）

- 作用成立：`improvementRatioPct >= 50%` 且 `avgTeacherAlignmentPct` 持续提升
- 作用显著：`deltaQuality >= +2` 且 `gainPer1kExtraTokens > 0`
- 可上线：在满足质量提升的同时，`tokenIncreasePct` 与 `latencyIncreasePct` 处于可接受范围
