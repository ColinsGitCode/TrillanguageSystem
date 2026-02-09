# Trilingual Records: Few-shot 提质汇报大纲 (Final)

**演示主题**: Code as Prompt — 基于代码演进驱动的本地 LLM 提质实践
**受众**: 技术评审 / 项目管理 / 架构与算法团队
**技术栈**: Node.js + D3.js + Gemini 3 Pro (Teacher) + Qwen 2.5-7B (Student)
**口径说明**: 全文明确区分不同实验 ID，禁止跨实验混用结论

---

## Slide 1 封面：问题与目标

- 目标一句话：在不依赖云端推理主链路的前提下，让本地 LLM 输出质量可测量地提升。
- 核心内容：
  - 业务场景：文本/OCR -> 三语卡片 + TTS
  - 核心挑战：质量、稳定性、成本三者冲突
  - 本次要回答的问题：**few-shot 是否"统计显著地有效"**

**讲者备注**：先定义问题，承诺后续用数据和统计检验验证。开场即提出"统计显著"这一标准。

---

## Slide 2 成功标准：评估框架

- 目标一句话：先定义"什么叫优化成功"，再看结果。
- 核心内容：
  - 主指标：`Quality Score`、`Success Rate`
  - 约束指标：`Avg Tokens`、`Avg Latency`
  - 效率指标：`Gain per 1k Extra Tokens = DeltaQuality / (DeltaTokens/1000)`
  - 稳定性指标：`Quality CV%`
  - **统计指标**：`p-value`、`95% CI`、`Cohen's d`

**讲者备注**：强调三点——提质不是单看分数、必须带上成本、结论必须有统计支撑。

---

## Slide 3 系统架构：从产品到可观测

- 目标一句话：展示系统为何支持可重复实验。
- 核心内容：
  - 前端：生成页 + Mission Control
  - 后端：`server.js` 编排、provider 切换、对比模式
  - 存储：文件系统 + SQLite（含实验表）
  - 关键：所有生成请求自动记录到 `experiment_samples` + `observability_metrics`

**讲者备注**：把"为什么能做实验"归因到结构化落库与追踪链路。

---

## Slide 4 Code as Prompt — 代码即提示词

- 目标一句话：展示 Prompt 不是一段静态文本，而是随代码演进的工程产物。
- 核心内容：
  - **Prompt 演进三代**：
    1. V1 静态模板 (`codex_prompt/phrase_3LANS_markdown.md`) — 硬编码指令
    2. V2 程序化生成 (`services/promptEngine.js`) — CoT 5 步推理 + 质量标准
    3. V3 动态注入 (`services/goldenExamplesService.js`) — 运行时 Few-shot + Bigram 相似度选取
  - **关键代码变更**：
    - `promptEngine.js:buildPrompt()` → 5 维质量标准嵌入 prompt
    - `goldenExamplesService.js:getRelevantExamples()` → 从 LENGTH() 近邻到 bigram 相似度
    - `observabilityService.js:calculateCompletenessScore()` → 从长度加分到结构检查
  - **启示**：提示词的优化本质上是代码重构，需要版本控制、可测试、可回滚

**讲者备注**：这是整个演讲的核心差异化观点。不是展示 prompt 多巧妙，而是展示 prompt 如何像代码一样演进、测试、迭代。引用具体 git commit 和 diff 增强说服力。

---

## Slide 5 Few-shot 机制：Teacher 样本注入

- 目标一句话：说明 few-shot 不只是开关，而是有检索与筛选策略。
- 核心内容：
  - 样本来源优先级：
    1. 同实验 `teacher_references`（SQL 查询，按 quality_score DESC）
    2. 历史高质量样本（默认 gemini，bigram 相似度重排）
  - 筛选条件：`minScore ≥ 80`、bigram 关键词相似度排序
  - Token 预算：`contextWindow * tokenBudgetRatio`
  - 回退链：`budget_reduction -> budget_truncate -> budget_exceeded_disable`
  - **代码映射**：
    - `goldenExamplesService.js:bigramSimilarity()` → Dice coefficient 实现
    - `server.js:handleFewShotInjection()` → 预算计算与回退逻辑

**讲者备注**：讲清"为什么这套机制有机会提升质量"，以及预算控制如何防止 token 膨胀。

---

## Slide 6 一键复现 — 实验可执行性

- 目标一句话：实验从运行到报告全流程脚本化，任何人可在 5 分钟内复现。
- 核心内容：
  - 实验管线 4 步：
    ```
    run_fewshot_rounds.js     → 执行实验，输出 JSONL
    export_round_trend_dataset.js → 导出数据 + 统计检验
    render_round_trend_charts.mjs → D3 渲染 6 类 SVG 图表
    generate_round_kpi_report.js  → 生成 KPI 报告 Markdown
    ```
  - 一键执行：
    ```bash
    node scripts/run_fewshot_rounds.js benchmark_phrases_50.txt $EXP_ID rounds.json
    node scripts/export_round_trend_dataset.js $EXP_ID
    node d3/render_round_trend_charts.mjs data/round_trend_$EXP_ID.json
    node scripts/generate_round_kpi_report.js $EXP_ID
    ```
  - 输出物：JSON 数据集 + CSV + SVG 图表 + Markdown 报告

**讲者备注**：强调"可复现"是科学方法的基础。代码即实验记录，git log 即实验日志。

---

## Slide 7 实验设计：50 样本 Benchmark

- 目标一句话：用分类标注的 50 条短语系统验证 few-shot 效果。
- 核心内容：
  - **实验 ID**: `exp_benchmark_50_20260209_140431`
  - **样本设计**：
    - 日常词汇 (15 条)：打招呼、加油、干杯...
    - 技术术语 (20 条)：API Gateway、提示词工程、向量数据库...
    - 歧义/复杂 (15 条)：水很深、带节奏、降维打击...
  - **对照**：baseline (无 few-shot) vs fewshot_r1 (2 示例)
  - **改进点**：修正评分器偏差 + 升级示例选取 + 引入统计检验

**讲者备注**：明确"这次实验比之前 21 样本更可靠"，并解释为什么。分类设计允许按维度拆解结论。

---

## Slide 8 结果：50 样本实验数据

- 目标一句话：few-shot 提升统计显著，但幅度需诚实报告。
- 核心数据：

| 指标 | Baseline | Fewshot_r1 | Delta |
|------|-------:|-------:|------:|
| 成功率 | 98% | 98% | 0 |
| 平均质量 | 75.00 | 76.88 | **+1.88** |
| 平均 Tokens | 1029 | 1414 | +385 (+37%) |
| 质量 CV% | 5.22% | 4.16% | **-1.06pp** |
| Gain/1k Tokens | - | 4.88 | - |

- **统计检验**：
  - 配对 t-test: **p = 0.0005**
  - Wilcoxon: **p = 0.0010**
  - 95% CI: **[0.84, 2.83]**
  - Cohen's d: **0.537 (medium)**

![Quality Trend](../TestDocs/charts/round_quality_trend_exp_benchmark_50_20260209_140431.svg)
![Gain Efficiency](../TestDocs/charts/round_gain_efficiency_exp_benchmark_50_20260209_140431.svg)

**讲者备注**：先给结论再解释代价。对比旧实验 +7.33 中有评分器偏差的部分，保持可信度。

---

## Slide 9 分类洞察：谁受益最大？

- 目标一句话：日常词汇提升最大，技术术语提升空间有限。
- 核心数据：

| 类别 | Baseline 质量 | Fewshot 质量 | Delta | Gain/1k Tokens |
|------|-------:|-------:|------:|------:|
| 日常词汇 | 73.47 | 77.20 | **+3.73** | **9.06** |
| 技术术语 | 77.95 | 78.85 | +0.90 | 2.33 |
| 歧义/复杂 | 77.80 | 79.21 | +1.41 | 3.75 |

- **规律**：baseline 质量越低，few-shot 增益越大
- **解读**：
  - 日常词汇短小，模型需要更多上下文引导来填充三语卡片
  - 技术术语本身信息密度高，模型已能较好处理
  - 歧义表达的多义位展开受益于示例引导

**讲者备注**：这页传递"不同场景效果不同"的细粒度洞察，避免一刀切结论。

---

## Slide 10 自我批判：已知问题与局限

- 目标一句话：承认不足比掩盖缺陷更有价值。
- 核心内容：
  1. **评分器仍为规则驱动**：无法评估语义准确性和翻译流畅度
  2. **Teacher 样本池未充分利用**：本次实验未预注入 Gemini Teacher 参考
  3. **Token 预算紧张**：contextWindow=2048, budget≈368 tokens，部分请求示例被裁剪
  4. **单轮对比**：仅 baseline vs fewshot_r1，未验证多轮渐进
  5. **旧实验偏差修正**：+7.33 中约 5.45 来自评分器长度偏差，真实贡献 +1.88
  - **代码层面的修正**：
    - `observabilityService.js`: `markdown.length > 500` → 三语结构完整性检查
    - `goldenExamplesService.js`: `LENGTH()` 近邻 → bigram 相似度重排

**讲者备注**：主动暴露问题建立信任。每个局限对应一个可执行的改进方向。

---

## Slide 11 优化路线图：代码变更驱动

- 目标一句话：每个优化方向都绑定具体代码变更。
- 核心内容：

| 阶段 | 优化方向 | 代码变更 | 预期影响 |
|------|------|------|------|
| 30天 | 扩充 Teacher 池 | `run_fewshot_rounds.js` 增加 teacher-seed 轮 | quality +2~3 |
| 30天 | 放宽 token 预算 | `tokenBudgetRatio: 0.18 → 0.25` | 减少回退 |
| 60天 | 语义检索替代 bigram | `goldenExamplesService.js` → 向量召回 | 示例相关度 +50% |
| 60天 | LLM 评分器 | `observabilityService.js` → GPT/Gemini 评分 | 评估准确度 |
| 90天 | 多 Teacher 融合 | 新增 `teacherFusionService.js` | 多源一致性 |
| 90天 | Unified LLM Layer | `llmUnifiedService.js` (Vercel AI SDK) | 降低维护成本 |

**讲者备注**：路线图不是 PPT 上的空中楼阁，每一项都有对应的文件路径和实施方案。引用 `Docs/DesignDocs/LLM_Provider_Unified_Layer_Design.md` 增强可信度。

---

## Slide 12 工程价值：可观测 + 可追溯 + 可复制

- 目标一句话：few-shot 不只是模型优化，也是工程效率优化。
- 核心内容：
  - **可观测**：每次生成自动记录 token、延迟、质量分到 SQLite
  - **可追溯**：实验参数、样本、输出、指标全链路可复盘
  - **可复制**：脚本化管线，任何人可在新环境重跑实验
  - **可验证**：统计检验集成到导出脚本，报告自动包含 p-value/CI
  - **代码证据**：
    - `databaseService.js` → 11 张表自动建表
    - `statisticsService.js` → 4 种检验方法，零外部依赖
    - `export_round_trend_dataset.js` → 导出时自动配对检验

**讲者备注**：从"算法收益"上升到"研发效能收益"。代码本身就是最好的文档。

---

## Slide 13 总结与决策请求

- 目标一句话：确认继续投入方向与验收方式。
- 核心结论：
  - Few-shot 提升**统计显著** (p=0.0005, d=0.537)
  - 真实提升 **+1.88 分**（修正评分器偏差后）
  - 日常词汇受益最大 (+3.73)，技术术语受益有限 (+0.90)
  - 稳定性改善 (CV: 5.22% → 4.16%)
  - Token 成本 +37%，延迟 +6%
- 决策请求：
  1. 批准扩充 Teacher 池（预计 +2~3 质量增益）
  2. 放宽 token 预算到 0.25（减少回退截断）
  3. 启动 LLM 评分器替代规则评分
  4. 确认 30/60/90 天 KPI 阈值

**讲者备注**：用数据说话，以决策请求收尾。每个请求对应一个可量化的预期收益。

---

*Data Source: `exp_benchmark_50_20260209_140431` | Pipeline: run → export → chart → report | Statistical tests: paired t-test, Wilcoxon, 95% CI, Cohen's d*
