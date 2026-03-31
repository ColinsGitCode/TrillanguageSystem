# GEMINI CLI PROXY：知识分析任务执行规范（手动触发版）

**版本**：v1.0  
**更新时间**：2026-03-03  
**适用模式**：`GEMINI_MODE=host-proxy`（经 Gateway `:18888`）

---

## 1. 目标

定义一套可手动触发、可解析、可落库的 Gemini 分析任务协议，用于支持：

1. 卡片总结（Summary）
2. 内容归纳（Synthesis）
3. 索引构建（Indexing）
4. 语义边界分析（Synonym Boundary）
5. 语法-例句关联（Grammar Linking）
6. 主题聚类（Knowledge Clustering）

核心原则：**Gemini 只负责推理与结构化输出；系统负责数据拉取、校验、存储与展示。**

---

## 2. 职责边界

职责分工：

- backend：
  - 拉取卡片数据（DB + 文件）
  - 分批组装 prompt
  - 调用 proxy
  - 校验/修复/重试
  - 落库并产出任务结果
- Gemini CLI：
  - 严格按 schema 输出 JSON
  - 不访问数据库、不写文件、不做副作用

---

## 3. 手动触发入口（建议）

## 3.1 API 触发（推荐）

- `POST /api/knowledge/jobs/start`
- `GET /api/knowledge/jobs/:id`
- `POST /api/knowledge/jobs/:id/cancel`

`start` 请求示例：

```json
{
  "job_type": "synonym_boundary",
  "scope": { "from": "20260201", "to": "20260303", "card_type": ["trilingual"] },
  "model": "gemini-3-pro-preview",
  "batch_size": 40,
  "operator": "owner"
}
```

## 3.2 会话触发（运维/调试）

由运维脚本先组好 payload，再经 Gateway 调用：

```bash
curl -s -X POST http://localhost:18888/api/gemini \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${GEMINI_PROXY_API_KEY}" \
  -d '{
    "project": "tri-lang-learning-system",
    "model": "gemini-3-pro-preview",
    "prompt": "<TASK_PROMPT_WITH_JSON_PAYLOAD>"
  }'
```

---

## 4. Gemini 对话执行协议（必须遵守）

每次任务都使用统一三段式 Prompt：

1. **System Rules（固定）**
2. **Task Contract（任务 schema）**
3. **Input Payload（本次批次数据）**

## 4.1 固定 System Rules（模板）

```text
你是知识分析引擎。你只能输出 JSON（UTF-8），禁止输出 Markdown、解释、代码块。
必须严格遵守给定 schema，不得新增字段，不得省略 required 字段。
若输入不足以完成任务，输出 status="needs_more_data"，并给出 missing_fields。
不得编造不存在的卡片 id / 文件名 / 日期。
```

## 4.2 通用输出外壳（所有任务统一）

```json
{
  "task": "summary|index|synonym_boundary|grammar_link|cluster",
  "run_id": "string",
  "batch_id": "string",
  "status": "ok|partial|needs_more_data|failed",
  "errors": [],
  "warnings": [],
  "result": {},
  "quality": {
    "confidence": 0.0,
    "coverage_ratio": 0.0
  }
}
```

---

## 5. 各任务的输入与输出要求

## 5.1 `summary`（总结）

输入最小字段：
- `cards[]`: `{id, phrase, card_type, created_at, en_translation, ja_translation, zh_translation, quality_score}`

输出 `result`：

```json
{
  "overview": "string",
  "top_topics": [
    {"topic": "string", "count": 0, "evidence_ids": [1,2,3]}
  ],
  "quality_observations": [
    {"finding": "string", "severity": "low|medium|high", "evidence_ids": [1]}
  ],
  "action_items": [
    {"priority": 1, "action": "string"}
  ]
}
```

## 5.2 `index`（索引）

输出 `result`：

```json
{
  "entries": [
    {
      "generation_id": 0,
      "phrase": "string",
      "card_type": "trilingual|grammar_ja",
      "lang_profile": "zh|en|ja|mixed",
      "en_headword": "string",
      "ja_headword": "string",
      "zh_headword": "string",
      "aliases": ["string"],
      "tags": ["string"]
    }
  ]
}
```

## 5.3 `synonym_boundary`（语义边界）

输出 `result`：

```json
{
  "groups": [
    {
      "group_key": "string",
      "members": [{"generation_id": 0, "term": "string", "lang": "en|ja|zh"}],
      "boundary_matrix": {
        "tone": "string",
        "register": "string",
        "collocation": "string"
      },
      "misuse_risk": "low|medium|high",
      "recommendation": "string"
    }
  ]
}
```

## 5.4 `grammar_link`（语法关联）

输出 `result`：

```json
{
  "patterns": [
    {
      "pattern": "string",
      "explanation_zh": "string",
      "example_refs": [{"generation_id": 0, "sentence": "string"}],
      "usage_notes": ["string"]
    }
  ]
}
```

## 5.5 `cluster`（主题聚类）

输出 `result`：

```json
{
  "clusters": [
    {
      "cluster_id": "string",
      "label": "string",
      "description": "string",
      "card_ids": [1,2,3],
      "keywords": ["string"]
    }
  ]
}
```

---

## 6. 系统可用性的最低数据要求（必须满足）

为保证前端/UI/报表可消费，后端必须在 Gemini 输出后生成以下标准化产物：

1. `knowledge_jobs` 任务主记录
   - `job_id, job_type, scope, model, status, started_at, finished_at`
2. `knowledge_outputs` 任务结果记录
   - `job_id, batch_id, output_json, confidence, coverage_ratio`
3. 任务级汇总文件（可选）
   - `/data/trilingual_records/knowledge_jobs/<job_id>/summary.json`
4. 面向 UI 的物化结果（按任务类型写入专表）
   - `synonym_groups / grammar_refs / card_tags / knowledge_clusters`

**没有上述四类数据，系统只能“看到一次文本结果”，无法持续使用。**

---

## 7. 校验、重试与失败恢复

## 7.1 校验规则

- JSON 可解析
- `task/run_id/status/result` 必填
- `result` 结构符合任务 schema
- `generation_id/card_ids` 必须可在 `generations` 中查到

## 7.2 自动修复策略

1. 轻微格式错：本地修复（键名纠正、类型转换）
2. 结构缺失：回退一次“schema 修复 prompt”重试
3. 证据缺失：标记 `partial` 并写入 `warnings`

## 7.3 超时与重试

- 单批超时：`GEMINI_PROXY_REQUEST_TIMEOUT_MS` 控制
- 重试：最多 2 次（指数退避）
- 超时后可触发 Gateway reset（沿用现有 proxy 机制）

---

## 8. 分批策略（避免上下文爆炸）

- 推荐 `batch_size=30~50` 卡/批
- `summary/index` 可较大批
- `synonym_boundary/grammar_link` 建议小批高质量（20~30）
- 最终由后端做 reduce（合并去重 + 冲突解决）

---

## 9. Prompt 示例（可直接复用）

```text
[SYSTEM RULES]
你是知识分析引擎。你只能输出 JSON（UTF-8），禁止 Markdown。

[TASK CONTRACT]
task=synonym_boundary
required_fields=task,run_id,batch_id,status,result,quality
result_schema=groups[group_key,members,boundary_matrix,misuse_risk,recommendation]

[INPUT PAYLOAD]
run_id=job_20260303_001
batch_id=batch_03
cards=[...]

[OUTPUT REQUIREMENT]
只输出 1 个 JSON 对象。
```

---

## 10. 与当前系统的对接结论

可行性：**可完全由 GEMINI CLI PROXY 提供分析能力，且支持手动触发。**  
前提：必须实现“任务编排 + schema 校验 + 结构化落库”三件套，否则结果只能一次性阅读，无法被系统持续消费。
