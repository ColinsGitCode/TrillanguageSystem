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

## 3. 机制设计

### 3.1 Few-shot 注入时机
- 仅 **本地 LLM** 生效
- `ENABLE_GOLDEN_EXAMPLES=true` 时启用
- 注入位置：`generateWithProvider()` → prompt 构建后、LLM 调用前

### 3.2 示例来源策略（可配置）

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

### 3.3 示例格式对齐

**输出模式 = JSON（默认）**
- 只保留必要字段：
  - `markdown_content`
  - `audio_tasks`
- 保证示例 JSON 完整且可解析

**输出模式 = Markdown**
- 直接使用 `markdown_content` 原文

### 3.4 Token 预算控制

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

### 3.5 Observability 写入

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

## 4. 实施步骤（开发）

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

## 5. 执行与验证方案

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

## 6. 风险与回滚

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

## 7. 交付清单

- 修复 `services/goldenExamplesService.js`
- `server.js` 接入 Few-shot
- 新增配置项（.env / docker-compose）
- `scripts/batch-test.sh` + `scripts/compare-results.js`
- 更新 BACKEND/API 文档

