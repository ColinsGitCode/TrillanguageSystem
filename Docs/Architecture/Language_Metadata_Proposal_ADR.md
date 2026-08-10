# 日语语言学元数据提案领域与数据 ADR（JLM-D2）

> 状态：**Accepted · 迁移 016 与 JLM-A0-A2 已实施；A1 人工观察继续**
>
> 日期：2026-08-10
>
> 适用范围：Cards Factory 卡片弹窗与选区工具条中的日语外来语来源；仅桌面端。
>
> 关联：
> [JLM-D0 产品设计](../Features/LLM_Generated_Japanese_Linguistic_Metadata_Design.md)、
> [JLM-D1 原型](../Features/prototypes/jlm-d1-foreign-origin-review.html)、
> [JLM-P0 干跑报告](../TestReports/Language_Metadata_JLM_P0_DryRun_20260810.md)、
> [注音浮层 ADR](Japanese_Pronunciation_Overlay_and_Ruby_Retirement_ADR.md)、
> [卡片注解层 ADR](Card_Annotation_Layer_ADR.md)。

## 1. 决策摘要

1. **新增两张表**：`language_metadata_jobs`（提取任务）与 `language_metadata_proposals`
   （候选与裁决事实）。任务与候选分离，使“provider 超时”不会被读成“这张卡没有外来语”。
2. **accepted 不是第三张表**，而是 proposal 的一个 `status`。读取端在投影时合并，
   不建可能与事实不一致的缓存表。
3. **不复用 `pronunciation_tokens`**。该表的 `source` 描述**读音**的来源；
   其中已声明但未使用的 `llm-proposal` 属于方案 C（LLM 读音）的预留值，
   **不得**被外来语来源借用。两者是不同领域事实。
4. **位置以码点范围表达**，与 pronunciation token 对齐但不依赖其边界，
   因此方案 B（整词词性/辞书形）未来可复用同一张表而无需改结构。
5. **幂等键 `proposal_key` 绑定正文版本**，正文一变旧候选即 `stale`，不跨版本复用。
6. **回滚是删表级的**：两张表可整体删除而不影响卡片、注音、学习或 KG 任何既有能力。

## 2. 为什么不复用现有表

| 候选方案 | 否决原因 |
|---|---|
| 塞进 `pronunciation_tokens.evidence_json` | `documentHash()` 不含 `evidence_json`，元数据单独变化不形成可审计 revision；且无处表达 pending/accepted/rejected |
| 复用 `pronunciation_tokens.source='llm-proposal'` | 该字段描述读音来源，一个 token 只有一个 source，无法同时表达“读音来自分析器、外来语来源来自 LLM 候选” |
| 复用 `local_glossary_proposals` | 那是中文释义域，键是词条而非正文位置，且与 generation 版本无关 |
| 复用 `card_annotations` | 注解是用户创作内容，不是机器候选；混入会污染注解统计与迁移边界 |

## 3. Schema（迁移 016，待批准后实施）

### 3.1 `language_metadata_jobs`

```sql
CREATE TABLE IF NOT EXISTS language_metadata_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_key TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('generation', 'textbook_expression')),
  target_id INTEGER NOT NULL CHECK (target_id > 0),
  source_content_hash TEXT NOT NULL CHECK (length(source_content_hash) = 64),
  metadata_kind TEXT NOT NULL CHECK (metadata_kind IN ('foreign-origin')),
  extraction_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'abandoned')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  last_error_code TEXT,
  model TEXT,
  prompt_version TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  UNIQUE (job_key)
);
```

`job_key = sha256(target_kind, target_id, source_content_hash, metadata_kind, extraction_version)`。
同一正文版本重复入队是幂等的。

**存在即证据**：一条 `failed` 或 `queued` 的任务就是“尚未产出结论”的凭证。UI 据此显示
D1 的 S9/S10，而不是显示“没有外来语”。

### 3.2 `language_metadata_proposals`

```sql
CREATE TABLE IF NOT EXISTS language_metadata_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_key TEXT NOT NULL,
  job_id INTEGER,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('generation', 'textbook_expression')),
  target_id INTEGER NOT NULL CHECK (target_id > 0),
  source_content_hash TEXT NOT NULL CHECK (length(source_content_hash) = 64),
  metadata_kind TEXT NOT NULL CHECK (metadata_kind IN ('foreign-origin')),
  surface TEXT NOT NULL CHECK (length(trim(surface)) BETWEEN 1 AND 80),
  start_codepoint INTEGER NOT NULL CHECK (start_codepoint >= 0),
  end_codepoint INTEGER NOT NULL CHECK (end_codepoint > start_codepoint),
  value_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(value_json)),
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  origin TEXT NOT NULL CHECK (origin IN ('llm', 'human')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'stale')),
  model TEXT,
  prompt_version TEXT,
  response_hash TEXT,
  supersedes_proposal_id INTEGER,
  decided_by TEXT,
  decided_at_utc TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  UNIQUE (proposal_key),
  FOREIGN KEY (job_id) REFERENCES language_metadata_jobs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_language_metadata_proposals_target
  ON language_metadata_proposals(target_kind, target_id, source_content_hash, status);
```

`proposal_key` 必须直接复用 JLM-P0 已实现并测试的
`services/languageMetadata/domain/foreignOriginExtraction.js#buildProposalKey`，
**不得在存储层另写一份**。其定义为：

```text
sha256( target_kind ␀ target_id ␀ source_content_hash ␀ metadata_kind ␀
        start_codepoint ␀ end_codepoint ␀ extraction_version )
```

分隔符是 **NUL（U+0000）而非空格**：NUL 不可能出现在任一字段中，
用空格分隔在字段自身含空格时会产生歧义键。此处特意写明，是因为该字符在
代码里不可见，容易在复述时被误写成空格。

**`origin` 字段是关键**：人工修正（D1 的 S5/S7）以 `origin='human'`、`status='accepted'`
写入同一张表，因此“人工修正高于 curated”不需要第二套存储，只需读取端优先级。

### 3.3 为什么不设 accepted 投影表

`accepted` 只是 `status`。读取端按 §5 的优先级实时合并。
只有当实测证明合并成为热点时才引入缓存投影，且该投影必须可从本表完全重建。

## 4. API contract

| 方法与路径 | 作用 | 写入 |
|---|---|---|
| `GET /api/language-metadata?targetKind=&targetId=` | 读取该目标的任务状态与候选/裁决 | 无（严格只读） |
| `POST /api/language-metadata/jobs` | 显式入队一次提取（幂等于 `job_key`） | 仅 jobs |
| `POST /api/language-metadata/proposals/:id/accept` | 接受候选 | 该 proposal |
| `POST /api/language-metadata/proposals/:id/reject` | 拒绝候选 | 该 proposal |
| `POST /api/language-metadata/corrections` | 人工修正（含覆盖 curated）；服务端重读目标、hash、码点范围与 surface | 新增 `origin='human'` 的 accepted，并以 `supersedes_proposal_id` 串联更正版本 |

约束：

- `GET` 必须零写入，与 `/api/local-glossary/lookup` 同级要求；
- 裁决接口带 `expectedStatus` 做乐观并发，冲突返回 409 而非静默覆盖；
- 所有裁决只改本表，**不得**触发 TTS、KG、FSRS、学习队列或 annotation 的任何写入；
- 错误使用结构化 `Error.code`，不靠匹配 message 文本。

## 5. 读取优先级与合并算法

```text
人工修正 (origin=human, accepted)
  > 精选词典 (curated seed)
  > 已确认 AI (origin=llm, accepted)
  > AI 候选 (pending)
  > 待确认
```

合并规则：

1. 只取 `source_content_hash` 等于当前正文 hash 的记录，其余视为 `stale`，不参与；
2. 同一码点范围内按上表取**唯一**胜出者，并在证据中保留被压制的来源（D1 的 S7 要求）；
3. `pending` 必须以独立字段标记，前端据此渲染“AI 候选”，不得与 accepted 同形；
4. 合并只发生在读取投影阶段，**不改写** `pronunciation_tokens` 的
   `reading`、`source`、`status` 或 `documentHash()` 语义。

## 6. 失败语义与幂等

| 情形 | 卡片 | 任务 | 候选 |
|---|---|---|---|
| 主卡生成失败 | 失败（现有语义） | 不创建 | 不创建 |
| **任务创建失败** | 成功 | **必须留下可发现记录并可补偿重建** | 无 |
| provider 超时 | 成功 | `failed` + `attempts+1`，可重试 | 无 |
| 响应非 JSON / schema 不符 | 成功 | `failed`，记录 `last_error_code` | 不写入伪造候选 |
| 定位校验拒绝（P0 的 12 种原因） | 成功 | `succeeded` | 被拒项不入库 |
| 候选落库失败 | 成功 | `failed`，可重试 | 无 |
| 相同 `proposal_key` 重放 | — | — | 幂等，不重复创建 |
| 相同 key、不同 payload | — | — | 冲突进人工检查，不静默覆盖 |

任何重试都**不得**修改 generation 的 Markdown、文件或 `content_hash`。

## 7. 与既有边界的关系

- **不进入 `content_hash`**：本域数据完全在 generation 之外，正文与 hash 永不因元数据改变；
- **不写学习域**：裁决不产生 Review Event、Schedule State 或 FSRS 变更；
- **不写 KG**：与 `kg_lookup_events` 无关；
- **不改注音**：`pronunciation_documents/tokens` 只被读取，不被本域写入；
- **测试重置**：两张表必须加入 `services/storage/db/testReset.js` 的删除清单——
  `tests/unit/testResetCoverage.test.js` 会在遗漏时直接失败。

## 8. Feature flags 与回滚

- `LANGUAGE_METADATA_ENABLED`：默认 **false**。关闭时 `GET` 返回空投影，
  入队与裁决接口返回 404，UI 回落到 curated + “待确认”，与今天行为一致；
- `LANGUAGE_METADATA_EXTRACTION_ENABLED`：默认 **false**，单独控制后台 worker 是否发起第二次
  LLM 调用。可只读展示已有候选而不产生新调用；主卡请求只做 SQLite 入队，绝不等待 provider；
- `LANGUAGE_METADATA_A2_ENABLED`：默认 **false**，且只有前两个开关同时开启时才生效。
  开启后仅改变新卡合同：prompt 不再要求正文外来语标注，后处理器也会清除模型泄漏的
  legacy 标注；关闭后恢复旧版新卡合同，不改写任何已存在 generation；
- 单次 provider 调用受 `LANGUAGE_METADATA_TIMEOUT_MS` 约束（默认 20 秒），失败任务最多重试
  3 次；进程重启时把遗留 `running` 恢复为可重试或 `abandoned`；
- **回滚**：停用 flag 即恢复现状；彻底回滚为 `DROP TABLE` 两张表，
  不触及任何既有表、正文或学习数据。

## 9. 架构门禁清单（本 ADR 的退出条件）

1. [x] 迁移 016 同时更新 `database/schema.sql` 与 `database/migrations/`，并在
   `migrationRunner` 增加 postcondition；
2. [x] 两张新表加入 `testReset` 清单，`testResetCoverage` 测试通过；
3. [x] `GET` 零写入有集成测试证明（对照 `local-glossary/lookup` 的既有做法）；
4. [x] 优先级链五级有单元与集成测试，含“人工修正压过 curated”和同级最新更正胜出；
5. [x] 失败矩阵有自动化覆盖；任务创建失败写入 `generation_errors`，并可通过
   `POST /api/language-metadata/jobs` 幂等补偿；
6. [x] `proposal_key` 与 P0 已测实现保持一致，不出现第二套算法；
7. [x] 两个 flag 默认关闭，关闭时行为与今天逐字节一致；
8. [x] `npm run test:acceptance` 在本次修复后重新全绿；结果记录于
   `Docs/TestReports/Language_Metadata_JLM_A0_A1_Remediation_20260811.md`。

## 10. 原始边界与 A2 增补

- 本 ADR 初版不授权修改主卡 prompt 或删除正文外来语标注；2026-08-11 经用户明确授权、
  双形态兼容测试与三类真实新卡验证后，A2 增补**仅授权新卡**停止写入正文外来语标注；
- A2 不授权改写历史 Markdown/hash，不授权删除 legacy reader，也不把旁路元数据写入正文；
- 不授权对历史卡片批量补齐；
- 不授权方案 B（词性/辞书形）落库，本 ADR 只保证表结构未来可复用；
- 不授权方案 C（LLM 读音）以任何形式进入 accepted；
- 不授权让 KG、TTS、学习调度读取 pending 候选。

## 11. 当前状态

Accepted。JLM-P0 已提供合同、定位算法与成本实测；JLM-D1 原型 12 状态已确认；
迁移 016、A0 持久后台任务、A1 CardModal 裁决与 A2 新卡正文切换均已实施。
A1 的真实准确率与操作体验观察继续；用户于 2026-08-11 明确授权 A2 提前进入本机运行，
该授权不应被解释为 A1 长期观察指标已经自然达标。A2 的仓库默认值仍为关闭。
