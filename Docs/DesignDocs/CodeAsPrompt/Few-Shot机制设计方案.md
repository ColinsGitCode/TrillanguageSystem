# Few-Shot 机制设计方案（动态 Golden Examples）

**版本**: v1.0  
**日期**: 2026-02-06  
**目标**: 通过动态 Few-shot（Gemini Golden Examples）提升本地 LLM 生成质量，同时控制 token 增长。

---

## 1. 现状与差距

### 已有能力
- ✅ Observability 数据（quality_score / tokens / performance）
- ✅ SQLite 存储完整生成记录
- ✅ 双模型对比（Gemini vs Local）
- ✅ `services/goldenExamplesService.js` 已存在

### 必须修复的问题
1. `goldenExamplesService.js` 直接使用 `db.prepare`，但当前 `databaseService` 导出的是实例，应改为 `dbService.db.prepare(...)` 或新增 `query()` 接口。
2. SQL 中引用了不存在字段：`om.prompt_text`, `om.output_raw` → 实际应为 `prompt_full`, `prompt_parsed`, `llm_output`, `metadata`。
3. Few-shot 示例输出需与 **本地 LLM 输出模式**匹配（JSON / Markdown）。

---

## 2. 设计目标

1. **质量提升**：平均质量评分 +10% 以上（≥ 80）
2. **成本可控**：token 增量 ≤ 20%
3. **可回滚**：通过环境变量开关可即时关闭
4. **可观测**：记录使用了哪些 Few-shot 示例

---

## 3. 本地 LLM 约束清单（已补充）

### 3.1 运行与硬件约束
- **平台**：Jetson AGX Orin 64GB
- **推理框架**：vLLM（CUDA 12.6）
- **环境**：`vllm_jp6` (Python 3.10)
- **并发**：`max_num_seqs=4`（高并发受限）
- **TTFT**：首字延迟可能为秒级（需控制 Prompt 增量）

### 3.2 模型与上下文约束
- **模型**：`Qwen2.5-VL-7B-Instruct`
- **上下文长度**：`max_model_len=4096`
- **显存策略**：`gpu_memory_utilization=0.42`（与 Embedding/Reranker 共存）
- **Block Size**：`64`（XFormers paged attention 依赖）

### 3.3 注意力后端约束
- **固定后端**：`XFORMERS`
- **禁用 TRITON**：`VLLM_USE_TRITON_FLASH_ATTN=0`
- **FlashAttention PTX 不稳定**：Jetson CUDA 12.6 下避免启用

### 3.4 输出与格式约束
- **输出模式**：默认 **JSON**（用于解析与 TTS 任务生成）
- **Few-shot 示例必须匹配输出模式**（JSON/Markdown）
- **JSON 合规性必须优先**：避免超长示例导致解析失败

### 3.5 多模态 / OCR 约束
- **模型具备多模态能力**（VL）
- **但当前 Few-shot 方案只针对文本生成链路**  
  （OCR / 图像输入需独立评估与预算）

### 3.6 预算与降级策略约束
- **上下文预算硬上限**：4096 tokens
- **few-shot 预算比例**：≤ 25%（建议 1024 tokens 内）
- **超预算降级顺序**：减少示例 → 截断示例 → 关闭 few-shot

---

## 4. 机制设计

### 4.1 Few-shot 注入时机
- 仅 **本地 LLM** 生效
- `ENABLE_GOLDEN_EXAMPLES=true` 时启用
- 注入位置：`generateWithProvider()` → prompt 构建后、LLM 调用前

### 4.2 示例来源策略（可配置）

| 策略 | 描述 | 适用场景 |
|------|------|----------|
| HIGH_QUALITY_GEMINI | 质量分数 ≥ 85 的 Gemini 结果 | 默认 |
| GEMINI_WINNER | 对比模式 Gemini 胜出案例 | 精准对标 |
| DIVERSE_SAMPLING | 多样性采样（不同长度/语言） | 覆盖面 |

配置项：
```bash
GOLDEN_EXAMPLES_STRATEGY=HIGH_QUALITY_GEMINI
GOLDEN_EXAMPLES_COUNT=3
GOLDEN_EXAMPLES_MIN_SCORE=85
```

### 4.3 示例格式对齐

**输出模式 = JSON（默认）**
- 只保留必要字段：
  - `markdown_content`
  - `audio_tasks`
- 保证示例 JSON 完整且可解析

**输出模式 = Markdown**
- 直接使用 `markdown_content` 原文

### 4.4 Token 预算控制

新增环境变量：
```bash
LLM_CONTEXT_WINDOW=4096
```

规则：
- Few-shot token ≤ 总预算的 25%
- 超预算时依次降级：
  1. 减少示例数量
  2. 截断示例内容
  3. 关闭 few-shot（回落到 base prompt）

### 4.5 Observability 写入

在 `observability.metadata` 中补充：
```json
{
  "fewShot": {
    "enabled": true,
    "strategy": "HIGH_QUALITY_GEMINI",
    "count": 3,
    "exampleIds": [123, 456, 789]
  }
}
```

---

## 5. 数据记录设计（DB 为主）

### 4.1 设计目标
- **可对照**：同一短语的 baseline / few-shot 可直接配对分析
- **可追溯**：能回溯 used examples、prompt 版本、预算策略
- **可视化**：直接输出图表所需指标（质量 / token / 成功率 / 延迟）

### 4.2 推荐表结构（新增）

**表 1：few_shot_runs（每次生成一条）**
```sql
CREATE TABLE IF NOT EXISTS few_shot_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generation_id INTEGER NOT NULL,
  experiment_id TEXT NOT NULL,
  variant TEXT NOT NULL,              -- baseline | fewshot
  fewshot_enabled INTEGER NOT NULL,   -- 0/1
  strategy TEXT,
  example_count INTEGER,
  min_score INTEGER,
  context_window INTEGER,
  token_budget_ratio REAL,
  base_prompt_tokens INTEGER,
  fewshot_prompt_tokens INTEGER,
  total_prompt_tokens_est INTEGER,
  output_tokens INTEGER,
  output_chars INTEGER,
  quality_score REAL,
  quality_dimensions TEXT,            -- JSON
  latency_total_ms INTEGER,
  success INTEGER,                    -- 0/1
  fallback_reason TEXT,
  prompt_hash TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE CASCADE
);
```

**表 2：few_shot_examples（运行与示例的多对多）**
```sql
CREATE TABLE IF NOT EXISTS few_shot_examples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  example_generation_id INTEGER NOT NULL,
  example_quality_score REAL,
  example_prompt_hash TEXT,
  similarity_score REAL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (run_id) REFERENCES few_shot_runs(id) ON DELETE CASCADE
);
```

**建议索引**
```sql
CREATE INDEX IF NOT EXISTS idx_fsr_experiment ON few_shot_runs(experiment_id);
CREATE INDEX IF NOT EXISTS idx_fsr_variant ON few_shot_runs(variant);
CREATE INDEX IF NOT EXISTS idx_fsr_created_at ON few_shot_runs(created_at);
CREATE INDEX IF NOT EXISTS idx_fse_run_id ON few_shot_examples(run_id);
```

### 4.3 必收字段（核心图表）
- `experiment_id`, `variant`, `fewshot_enabled`
- `strategy`, `example_count`, `min_score`
- `base_prompt_tokens`, `fewshot_prompt_tokens`, `total_prompt_tokens_est`
- `quality_score`, `quality_dimensions`
- `output_tokens`, `output_chars`
- `latency_total_ms`
- `success`, `fallback_reason`

### 4.4 扩展字段（深度分析）
- `prompt_hash`（与 prompt_full 解耦）
- `example_generation_id` / `example_quality_score`
- `similarity_score`（长度差/关键词重叠/语言类型）
- `template_compliance`（从 quality_checks 提取）

---

## 6. 实施步骤（开发）

### Step 1: 修复 goldenExamplesService
- 改为 `dbService.db.prepare(...)`
- SQL 字段对齐实际 schema
- 支持输出模式（JSON / Markdown）
- 示例格式化时保证 JSON 合规

### Step 2: 接入 generateWithProvider
- 本地 LLM + `ENABLE_GOLDEN_EXAMPLES=true` 时启用
- 获取相关示例 → 构建增强 Prompt

### Step 3: Token 预算控制
- 估算 few-shot token，超预算降级

### Step 4: 记录 Observability
- 写入 few-shot metadata（策略、数量、示例 id）

---

## 7. 执行与验证方案

### 5.1 Baseline vs Few-shot 对比

```bash
# 关闭 few-shot
export ENABLE_GOLDEN_EXAMPLES=false
docker compose restart viewer
./scripts/batch-test.sh phrases.txt baseline.json

# 开启 few-shot
export ENABLE_GOLDEN_EXAMPLES=true
export GOLDEN_EXAMPLES_COUNT=3
docker compose restart viewer
./scripts/batch-test.sh phrases.txt enhanced.json
```

### 5.2 评估指标

- 质量评分（score）平均值变化
- 维度：completeness / accuracy / exampleQuality
- tokens 增量 < 20%

---

## 8. 开发执行计划（落地顺序）

### 阶段 0：Schema 与迁移
- 更新 `database/schema.sql`：新增 `few_shot_runs` / `few_shot_examples` + 索引
- 新增迁移脚本（建议）：`scripts/migrate_fewshot_tables.js`
- 验收：SQLite 中可查询到两张新表

### 阶段 1：修复 GoldenExamplesService
- 改为 `dbService.db.prepare(...)`
- SQL 字段对齐 schema（`prompt_full` / `prompt_parsed` / `llm_output` / `metadata`）
- 支持输出模式（JSON / Markdown）
- 验收：`getRelevantExamples()` 返回稳定样本

### 阶段 2：Few-shot 注入与预算控制
- `ENABLE_GOLDEN_EXAMPLES=true` 且 `provider=local` 时启用
- 估算 token：`basePromptTokens` / `fewshotTokens` / `totalPromptTokens`
- 超预算降级：减少示例 → 截断 → 关闭 few-shot
- 验收：超长输入不导致 LLM 失败

### 阶段 3：DB 数据写入（核心）
- 新增 `services/fewShotMetricsService.js`
- 写入 `few_shot_runs` 与 `few_shot_examples`
- 同步写入 `observability.metadata.fewShot`
- 验收：每次 few-shot 生成都有 run + examples 记录

### 阶段 4：实验归档机制
- `/api/generate` 支持 `experiment_id` / `variant`
- 默认自动生成 `experiment_id`
- 验收：同短语 baseline/fewshot 可配对统计

### 阶段 5：批量测试与报告
- `scripts/batch-test.sh`：批量生成 + 写 experiment_id
- `scripts/compare-results.js`：输出对比统计（CSV/JSON）
- 验收：产出可直接画图的数据集

### 阶段 6：文档对齐
- 更新 `BACKEND.md` / `API.md`
- 记录新表与实验字段

---

## 9. 风险与回滚

| 风险 | 影响 | 缓解 |
|------|------|------|
| Few-shot 过长导致超上下文 | 生成失败 | token 预算控制 |
| 示例与输出格式不一致 | JSON 解析失败 | 示例格式对齐 |
| Gemini 样本不足 | Few-shot 空 | fallback 不使用 few-shot |

回滚方式：
```bash
export ENABLE_GOLDEN_EXAMPLES=false
docker compose restart viewer
```

---

## 10. 交付清单

- 修复 `services/goldenExamplesService.js`
- `server.js` 接入 Few-shot
- 新增配置项（.env / docker-compose）
- `scripts/batch-test.sh` + `scripts/compare-results.js`
- 更新 BACKEND/API 文档
