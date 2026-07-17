# 知识图谱 2.0 领域与数据 ADR（KG-D2）

> 状态：**Accepted · 已确认基线**（2026-07-16 用户确认 §20 全部门禁；核心技术前提经 `learningService.js` 排序键、`materializeStudyItems.js`、`deepseekService.js`、迁移与表号核对属实）
>
> 日期：2026-07-16
>
> 上位产品基线：[知识图谱 2.0 产品定义（KG-D0）](../Features/Knowledge_Graph_2_0_Product_Definition.md)
>
> 已确认交互基线：[KG-D1 桌面原型](../Features/prototypes/kg-d1-prototype.html)
>
> 协同基线：[学习辅助 2.0 产品定义](../Features/Learning_Assistance_2_0_Product_Definition.md)、[学习辅助 2.0 领域与数据 ADR](Learning_Assistance_2_0_Domain_and_Data_ADR.md)
>
> 决策范围：Knowledge Point、Surface Form、Evidence、Typed Link、unresolved、lookup 事件、只读聚合、Graph Planning Signal，以及“加入本次学习”的 LA-D2 协同增补。
>
> 实施门禁：本文被用户确认并改为 `Accepted` 前，**不得新增 KG schema、KG API、Graph signalReader 或手动入队实现**。

---

## 0. 决策摘要与权威边界

本文作出以下建议决策，待评审确认后生效：

1. **Study Item 继续是唯一正式学习与调度单位。** Knowledge Point（KP）只拥有知识身份、表面形式、内容证据、显式检索事实和只读聚合，不拥有评分、FSRS 或 due time。
2. **KG v1 的自动识别以确定性能力为主。** 日语词形依赖本地 Kuroshiro/Kuromoji 与受测试规则；内容附着依赖现有结构；不使用 LLM 自动接受词义、同义词或跨语言关系。
3. **系统的生成式语言智能来自远程 DeepSeek API。** 当前默认模型由 `DEEPSEEK_MODEL=deepseek-v4-pro` 配置，调用边界为 `services/llm/deepseekService.js`。KG 中如未来使用 DeepSeek，只能运行在异步提案层，不能进入同步队列、不能直接接受关系、不能写 FSRS。
4. **歧义必须保存为 unresolved。** `はし` 等多候选输入建立待确认 case，不猜测、不强附着、不产生 planning score。
5. **身份修订可逆。** 拆分、合并、重定向和 Evidence 重归属通过 append-only resolution event 与 point transition 留痕；既有 lookup/review 事实不重写。
6. **lookup 是 append-only 交互事实。** 只有明确提交的 `explicit_lookup` 和用户确认查看既有知识点后的 `duplicate_generation_attempt` 计入；typeahead、浏览、答案揭示和评分均不计入。
7. **Graph provider 只读预计算信号。** `readPlanningSignal()` 只按 `study_item_id` 同步读取本地 `kg_planning_signals`，目标为单次索引查询；严禁网络、LLM、重分析或写入。
8. **“加入本次学习”归 LA 所有。** 新增一张 `learning_manual_queue_intents` 表；该动作不修改 Schedule State，已调度的非新 Study Item 进入今日队列，正常评分后才由现有 Review Event + SchedulerPort 更新 FSRS。
9. **新 schema 使用全新 `kg_*` 命名。** 不复用启动时已退役并删除的 `knowledge_*` 表、旧路由或旧页面。
10. **schema 继续双路径同一真源。** `database/schema.sql` 描述完整期望状态；migration 003 负责 KG 表 37-47，migration 004 负责 LA 表 48。每个阶段都必须让完整 schema 与对应存量库迁移保持一致。

权威关系固定为：

- KG-D0 决定产品语义与非目标；本文不得扩大为全图浏览、自动同义词、跨语言身份或隐性 lapse。
- LA-D2 决定学习状态、队列、会话、评分与调度；本文 §10 仅对“显式一次性入队”作协同增补。
- 当前代码是实施事实。若本文与现有 `PlanningSignalProvider`、队列排序或 migration runner 不一致，必须先修订本文，不能让实现者自行解释。
- 旧 Knowledge Hub / OPS、旧 taxonomy/synonym/relation/issue-audit 域继续保持退役状态。

---

## 1. 已核实的现有事实

### 1.1 学习队列与 Graph provider

现有 `buildQueueCandidates()` 已形成不可绕开的执行顺序：

1. 从 active Study Item 和 Schedule State 计算到期集合；
2. 截取不超过 `dailyNewLimit` 且不突破剩余行动目标的新单元；
3. 基础集合确定后才调用 Planning Provider；
4. 最终排序为 `bucket -> available_at -> due_at -> provider_score DESC -> study_item_id`。

当前实际基础桶为：

| bucket | 当前语义 |
|---:|---|
| 1 | 逾期且最近失败 |
| 2 | 其它逾期 |
| 3 | 今日到期且最近失败 |
| 4 | 其它今日到期 |
| 5 | schema 允许但当前代码未生成；由本文 §10 amendment 首次定义为已调度未到期项的用户主动加入位置 |
| 6 | 今日新单元 |

`GraphPlanningSignalProvider` 当前为可选壳：`signalReader` 为空即返回 `null`。Composite contract 已强制：

- provider 必须同步且无副作用；返回 Promise 会被判失败；
- 单 provider 默认预算 10ms；
- score 夹在 `[-100, 100]`；
- groups、reasons、evidence 均有长度上限；
- empty、failed、timedOut 自动降级，不阻断队列。

因此，任何“实时调用 DeepSeek 决定今日顺序”的设计都与现行契约冲突，本文明确禁止。

### 1.2 调度所有权

`learning_review_events` 是正式评分的 append-only 事实，`learning_schedule_states` 是可重建的当前 FSRS 投影。只有揭示答案后的四档评分可经过 `SchedulerPort.schedule()` 更新调度。

以下行为均不得直接改动 `stability`、`difficulty`、`due_at_utc` 或写伪 Review Event：

- 显式 lookup；
- 重复生成尝试；
- 浏览 KP；
- 查看相关词形；
- unresolved 人工确认；
- 点击“加入本次学习”。

### 1.3 当前语言与智能能力

| 能力 | 当前来源 | 执行位置 | KG-D2 使用方式 |
|---|---|---|---|
| 学习卡文本生成、解释与翻译 | 远程 DeepSeek API；默认配置 `deepseek-v4-pro` | `services/llm/deepseekService.js` -> `/chat/completions` | v1 不用于自动建图；未来只作异步候选提案 |
| 日语分词、辞书形和词形特征 | 本地 Kuroshiro + Kuromoji analyzer | `services/generation/japaneseFurigana.js` 的现有 analyzer 边界 | KG-P0 扩展 token 分析接口并锁定 fixture |
| 日语汉字 ruby | 本地 Kuroshiro + Kuromoji | `toRuby()` | 保持现有输出行为，不由 KG 改写 |
| 正式复习调度 | `ts-fsrs@5.4.1` | `SchedulerPort` 后 | KG 不介入公式与状态 |
| 教材截图结构化导入 | Codex Skill + 人工校对 | 应用运行时之外 | 作为 Evidence 来源，不把 Skill 当运行时 KG 服务 |
| 歧义、义项拆分和语义关系接受 | 人工确认 | KG resolution workflow | 人工是 v1 最终裁决者 |

这里必须区分两类能力：

- **确定性分析**可以可靠、可测试、可重放地识别有限词形与结构附着；
- **生成式智能**可以提出语言学候选和解释，但输出具有概率性，不能直接成为已接受关系或学习调度事实。

### 1.4 数据库与迁移真源

当前迁移仅有：

- `001_learning_assistance_p0.sql`；
- `002_textbook_courses.sql`。

`database/schema.sql` 是全新安装的完整期望状态；存量库由带 checksum 的 migration runner 收敛。KG 实施必须同时：

1. 在 `schema.sql` 追加 KG 期望 schema；
2. 新增 `003_knowledge_graph_2_0.sql`；
3. 在 migration runner 中增加 KG postcondition；
4. 对新库、从 002 升级的存量库和重复启动分别验证。

---

## 2. 智能来源架构

### 2.1 四层能力模型

KG 2.0 不把“智能化”模糊成一个黑盒。每个输出必须能回答“来自哪一层、谁有最终决定权”。

```text
L0 事实与约束
  SQLite / schema checks / hashes / append-only events / exact source structure
        |
L1 确定性语言分析
  NFKC normalization / Kuroshiro / Kuromoji / token-sequence rules
        |
L2 异步生成式提案
  DeepSeek (`DEEPSEEK_MODEL`; current default: deepseek-v4-pro)
  via existing deepseekService, structured JSON only
        |
L3 裁决与发布
  deterministic validator or explicit human review
        |
  accepted KG facts and rebuildable read models
        |
  synchronous GraphPlanningSignalProvider reader
```

各层职责：

- **L0** 保证身份、幂等、审计、来源和调度边界；脚本代码在这里提供可靠性，不声称具备语言推理。
- **L1** 处理可由分析器与 fixture 证明的词形；失败时输出 unresolved。
- **L2** 只生成 proposal，例如“可能是同义词”“可能对应某义项”“建议公开解释”。它没有接受权限。
- **L3** 把 proposal 转为 accepted/rejected decision。确定性规则只可接受其明确白名单范围；语义关系必须人工确认。

### 2.2 DeepSeek 的真实边界

当前系统通过以下配置调用 DeepSeek：

- `DEEPSEEK_API_KEY`：运行时密钥；
- `DEEPSEEK_BASE_URL`：默认 `https://api.deepseek.com`；
- `DEEPSEEK_MODEL`：当前默认 `deepseek-v4-pro`；
- 请求端点：`${baseUrl}/chat/completions`。

KG 未来若启用 LLM enrichment，必须复用该 adapter，不再建立第二套 Gemini、CLI 或私有 HTTP 客户端。调用规则固定为：

1. 只由异步 job/use case 发起；
2. 请求和响应都通过版本化 JSON schema；
3. 持久化 `provider_id / model_id / prompt_schema_version / prompt_version / input_hash / output_hash / public_reason`；
4. 不持久化 API key、Authorization header 或私有推理过程；
5. 输出只进入 resolution proposal/event，不直接进入 active link；
6. DeepSeek 不可用、超时或返回非法结构时，KG 确定性能力和学习闭环保持可用；
7. 教材官方原文默认不得发送给 KG enrichment；未来若要发送，必须有独立显式开关和来源范围确认。

### 2.3 v1 不使用 LLM 自动建图

KG v1 的 accepted link 只有：

- `inflection-of`：Kuromoji token sequence + 已通过 fixture 的规则；
- `polite-of`：Kuromoji token sequence + 已通过 fixture 的规则；
- `evidence-of`：来自 generation、Study Item 或 textbook expression 的明确结构。

`synonym`、`cross-language-equiv`、`pos-variant`、精确 sense disambiguation 都不在 v1 自动接受范围。DeepSeek 可在未来版本提出这些关系，但必须经过新 ADR 或本文 amendment，且默认进入人工确认。

---

## 3. 领域对象与所有权

### 3.1 聚合边界

| 领域对象 | 所有者 | 是否事实 | 可否影响 FSRS |
|---|---|---:|---:|
| Knowledge Point | KG | 身份实体 | 否 |
| Surface Form | KG | 规范化语言对象 | 否 |
| Content Evidence | KG | 来源快照/定位事实 | 否 |
| Resolution Event | KG | append-only 决策事实 | 否 |
| Point Transition | KG | append-only 身份演进事实 | 否 |
| Point/Surface 与 Point/Evidence Link | KG | 可重建当前投影 | 否 |
| Lookup Event | KG | append-only 交互事实 | 否 |
| KP Stats / Planning Signal | KG | 可重建读模型 | 只可细排基础队列 |
| Study Item / Review Event / Schedule State | LA | 正式学习事实与投影 | 是，且仅归 LA |
| Manual Queue Intent | LA | 一次性用户意图工作流 | 加入队列，不直接改 FSRS |

### 3.2 Knowledge Point

KP 支持三种 `kp_kind`：

- `lexeme`；
- `phrase`；
- `grammar_pattern`。

生命周期为：

- `active`：可被查询与附着；
- `retired`：因拆分、合并或身份替换退出当前视图，但保留审计；
- `archived`：无有效来源且不再展示，仍不物理删除事实。

KP 不保存一个可写“掌握度”。正式学习、检索困难和内容覆盖只在 read model 中分区聚合。

### 3.3 Surface Form

Surface Form 表达“用户看到或输入的实际形式”，不是默认独立知识点。例如：

- `食べる`：canonical surface；
- `食べた` / `食べて`：`inflection-of`；
- `食べます`：`polite-of`；
- `はし`：可以存在 Surface Form，但在无法消歧时不附着任何 active KP。

分析器版本不进入 Surface Form 身份 hash，避免升级 analyzer 后重复创建同一表面形式；分析结果和 token sequence 作为版本化分析快照保存。

### 3.4 Evidence

Evidence 表达一个 KP 在现有内容中的具体出现。v1 允许的来源类型：

- `generation`；
- `study_item`；
- `textbook_expression`。

场景表达仍属于 generation/Study Item 的 locator，不新建 `scenario` 数据域。Evidence 使用多态来源键，避免让 KG 反向改变既有表；写入时由 application service 验证来源存在并保存不可变 source hash/locator。

Evidence 来源被删除或内容变化时：

- 不级联删除历史 lookup 或 resolution event；
- 当前 Evidence 投影可转为 `orphaned` 或 `superseded`；
- 新内容 revision 建立新 Evidence 快照；
- 旧证据仍可在审计视图中追溯，但不再计入当前内容覆盖。

---

## 4. 身份、规范化与 hash

### 4.1 KP 身份键

稳定身份输入为：

```json
{
  "identityVersion": "kg-identity-v1",
  "kpKind": "lexeme|phrase|grammar_pattern",
  "language": "en|ja|zh",
  "canonicalForm": "...",
  "canonicalReading": "... or empty",
  "senseDiscriminator": "... or empty"
}
```

按固定键序列化后计算 SHA-256，得到 `point_key`。`point_key` 全局唯一且永不复用。

规范化规则：

- 所有语言先执行 NFKC、首尾空白删除与连续空白收敛；
- 英语 v1 再转小写，只称 normalized form，不称 lemma；
- 中文保留原字符，不做自动繁简转换；
- 日语 Lexeme 使用主内容词 `basic_form`；随后重新分析 `basic_form` 获取 lemma reading；
- 日语 Phrase 保留规范化完整表达，不把一句话拆成多个强 KP；
- Grammar Pattern 只接受已有稳定结构键；无稳定键则 unresolved；
- `sense_discriminator` 默认空；只有人工确认或未来已接受词典证据才填充。

同一 `point_key` 已存在时返回既有 KP，不创建重复行。

### 4.2 Surface Form 身份

`surface_key` 使用 `surface-identity-v1 + language + normalized_surface + normalized_reading` 计算。Analyzer、token sequence 和 rule version 属于分析证据，不属于身份。

同一个 Surface Form 可以在不同上下文中成为多个 Resolution Case 的输入，但只有高置信度、已接受的 link 才进入当前关系投影。

### 4.3 日语 P0 fixture 门禁

KG-P0 必须固定并保存原始 token sequence fixture，至少覆盖：

| 输入 | 必须验证的结论 |
|---|---|
| `食べる` | canonical Lexeme 为 `食べる`，lemma reading 来自对 basic form 的重分析 |
| `食べた` | 主内容词 basic form 为 `食べる`，识别为受支持过去形式 |
| `食べて` | 主内容词 basic form 为 `食べる`，识别为受支持て形 |
| `食べます` | 主内容词 basic form 为 `食べる`，识别为敬体 |
| `箸` / `橋` | 不因读音相同而合并 |
| `はし` | 无唯一上下文时 unresolved，不强附着 |
| 未知词或 analyzer 无 basic form | unresolved，不使用 LLM 猜测补位 |

fixture 必须记录：依赖版本、原 token JSON、规则版本、期望 canonical form、expected link kind 和 resolution outcome。升级 Kuroshiro/Kuromoji 时先跑 fixture；结果漂移必须显式评审。

---

## 5. 关系与证据投影

### 5.1 v1 Typed Link

当前投影只接受：

| link kind | from | to | 接受来源 |
|---|---|---|---|
| `canonical` | Surface Form | Lexeme/Phrase/Grammar KP | 身份创建 use case |
| `inflection-of` | Surface Form | Lexeme KP | `kuromoji-rule-v1` + fixture |
| `polite-of` | Surface Form | Lexeme KP | `kuromoji-rule-v1` + fixture |
| `evidence-of` | Evidence | KP | 结构化主表达 extractor 或人工确认 |

`canonical` 是内部附着类型，产品展示的关系仍以 KG-D0 的三类为准；它用于保证每个 KP 有明确规范表面形式。

### 5.2 强附着与弱候选

- **active link**：已被确定性白名单规则或人工决策接受；参与搜索、KP 详情和 planning signal。
- **candidate**：只保存在 Resolution Case/Event payload；不参与 planning，不显示为已确认关系。
- **superseded link**：历史投影；保留 decision event 引用，但不参与当前读模型。

v1 只把主表达作为强 Evidence：

- `trilingual_en/ja`：各自目标语言主表达；
- `grammar_ja`：稳定主语法点；
- `scenario_bilingual`：EN/JA 主表达分别附着，共享场景 locator；
- `textbook_en/ja`：EN/JA 官方表达分别附着，共享 textbook expression locator。

句内其它 token 只可产生候选，不能因“出现过”自动扩成大量 active KP。

### 5.3 关系来源与公开解释

每个 active link 必须保存：

- decision/resolution event id；
- `source_kind`：`deterministic_rule | user | maintenance`；
- analyzer/rule/provider 版本；
- source input/output hash；
- 可公开的短理由；
- 建立时间。

不得保存模型 chain-of-thought。UI 理由应为稳定事实，例如“Kuromoji 将『食べた』分析为『食べる』的过去形式”，而不是模型内部推理文本。

---

## 6. unresolved、拆分、合并与可逆性

### 6.1 unresolved workflow

以下情况必须建立 Resolution Case，而不是 active link：

- 纯假名、多候选或同音歧义；
- analyzer 无法定位唯一主内容词；
- Grammar Pattern 无稳定结构键；
- Evidence 与既有 KP 身份冲突；
- LLM/词典只提出语义候选，尚未人工确认。

case 状态：

- `open`；
- `resolved`；
- `dismissed`；
- `superseded`。

候选列表可以被 analyzer 版本重跑更新，但既有人工 accepted decision 不得被自动覆盖。重新判断必须显式 reopen，并产生新的 Resolution Event。

### 6.2 append-only resolution event

所有会改变当前身份/关系投影的动作都先写 Resolution Event：

- `case-opened`；
- `candidate-proposed`；
- `case-resolved`；
- `case-dismissed`；
- `point-created`；
- `point-split`；
- `point-merged`；
- `surface-attached` / `surface-detached`；
- `evidence-attached` / `evidence-detached`；
- `decision-reverted`。

同一事务内先插入事件，再更新 points/links/case 当前投影。事件具有唯一 `event_key + request_hash` 语义：同 key 同 body 幂等返回，同 key 不同 body 返回 409。

### 6.3 拆分和合并

- **拆分**：旧粗粒度 KP 转 `retired`；创建两个或更多 successor；Point Transition 记录 `split-into`；明确可归属的 active links 重投影到 successor。
- **合并**：多个 predecessor 转 `retired`；一个 survivor/new successor 保持 active；Point Transition 记录 `merge-into`。
- **撤销**：不删除历史 transition；写新的 resolution event 和反向/替代 transition，重建当前投影。

历史事实处理：

- Review Event 永不重写；它仍指向原 Study Item。
- Lookup Event 永不被复制到所有 successor。若旧事件只指向粗粒度 KP，默认保留在 retired KP；只有可由具体 Evidence/Surface/context 证明时，才通过新的 resolution event 在读模型中重新归属。
- 任何拆分不得把一条模糊 lookup 同时计入多个新 KP，否则会放大 planning signal。

---

## 7. 显式 lookup 事件

### 7.1 写入条件

只允许两类 `interaction_kind`：

- `explicit_lookup`：用户明确提交查找，并打开 resolved 或 unresolved 结果；
- `duplicate_generation_attempt`：生成命中精确重复后，用户明确选择“查看已有知识点”。原始 409 本身不自动写事件。

以下操作是纯读：

- typeahead；
- 搜索结果列表展示；
- 浏览 KP/卡片/教材；
- reveal；
- 四档 rating；
- 首次生成或导入内容。

### 7.2 事件内容与幂等

Lookup Event 保存：

- `event_key` 和 `request_hash`；
- `interaction_kind`；
- resolved `point_id` 或 unresolved `resolution_case_id`，两者恰有一个；
- 可选 `surface_form_id`；
- 原始 input、normalized input 与 language/kind hint；
- 可选来源 context；
- `occurred_at_utc`；
- 通过 LA Time Service 计算的 `learning_day` 与 `time_zone`；
- 创建时间。

事件 append-only，禁止 UPDATE/DELETE。相同 key + 相同 request hash 返回既有事件；相同 key + 不同 request hash 返回 `409 KG_EVENT_KEY_CONFLICT`。

### 7.3 unresolved 事件后续归属

unresolved lookup 可以写事件并指向 Resolution Case，但在 case 未解决前：

- 不计入任何具体 KP 的 lookup 次数；
- 不生成 Graph planning score；
- UI 只显示“待确认”。

case 后续 resolved 时，不更新原事件；projection builder 通过 case 的 accepted resolution 归属到目标 KP。若以后拆分仍无法证明具体义项，则该历史事件留在原/retired 身份，不进行扇出。

---

## 8. 只读聚合与 Graph Planning Signal

### 8.1 三类证据必须分开

`kg_point_stats` 不生成单一“掌握分”。它分别物化：

1. **正式学习**：关联 Study Item 数、active 数、到期数、Review Event 数、最近评分时间；
2. **检索困难**：7/30 天 explicit lookup、duplicate attempt、最近 lookup；
3. **内容覆盖**：active Evidence 数、Surface Form 数、来源/卡型分布。

正式学习字段只读 LA 表，不反向写入 LA。Projection 必须保存 `projection_version`、事实 watermark 和 `computed_at_utc`，可从事实重建。

### 8.2 v1 planning score

planning score 只表达近期检索困难，不表达“掌握度”。建议算法 `kg-lookup-signal-v1`：

```text
explicit component  = min(explicit_lookup_count_7d, 3) * 8
duplicate component = min(duplicate_attempt_count_30d, 2) * 3
point score          = min(30, explicit component + duplicate component)
study item score     = max(score of its active attached points)
```

约束：

- 只有 resolved、active KP 与 active strong Evidence link 参与；
- unresolved、retired、weak candidate 不参与；
- 多 KP 使用 `max` 而不是求和，避免一张复杂卡因附着数量获得不合理优势；
- score 永不为负，最大 30；
- 30 是 KG provider 对 Composite 的单个加数上限，不是最终 composite score；现有 Composite 会汇总其它 provider 后再统一夹到 `[-100, 100]`；
- reasons 只公开计数和时间窗，不声称“未掌握”；
- 算法版本变化必须重建投影并更新 `signal_version`。

### 8.3 同步 signalReader

`GraphPlanningSignalReader.readPlanningSignal(studyItem, context)` 的实现契约：

1. 只执行按 `study_item_id` 命中的本地 prepared query；
2. 返回 `null` 或 `{ score, groups, reasons, evidence }`；
3. 不调用 DeepSeek、词典网络、Kuromoji 或异步 API；
4. 不更新 watermark 或任何数据库行；
5. 缺表、功能关闭、无信号或读取失败时返回 `null`；
6. 在 provider 10ms 预算内完成；P2 必须用慢查询/锁故障验证确定性降级。

`kg_planning_signals` 是可重建投影。Lookup/Resolution/Evidence 事务提交后由应用服务同步触发小范围 rebuild，另提供全量维护重建；队列请求本身不负责 rebuild。

### 8.4 基础集合与降级不变量

启用/关闭 KG reader 时必须满足：

- `study_item_id` 基础集合完全一致；
- bucket、available_at、due_at 完全一致；
- 只允许相同三项排序键内出现 provider score 细排；
- reader empty/failed/timedOut 时顺序回到已有基础顺序；
- FSRS 参数、Schedule State 和 Review Event 零变化。

---

## 9. v1 数据模型总览

KG-P1 新增 11 张 `kg_*` 表；KG-P3 通过 migration 004 另新增 1 张 LA 所有表。表号接现有 `schema.sql` 的表 36 顺延。

| 表号 | 表 | 类型 | 说明 |
|---:|---|---|---|
| 37 | `kg_points` | 身份实体 | KP 稳定身份与生命周期 |
| 38 | `kg_surface_forms` | 语言对象 | 表面形式、规范化与分析快照 |
| 39 | `kg_evidence` | 来源快照 | generation/Study Item/textbook expression 出现证据 |
| 40 | `kg_resolution_cases` | 工作流投影 | unresolved 与人工裁决状态 |
| 41 | `kg_resolution_events` | append-only 事实 | proposal、决策、拆分、合并、撤销审计 |
| 42 | `kg_point_transitions` | append-only 事实 | predecessor -> successor 身份演进 |
| 43 | `kg_point_surface_links` | 可重建投影 | active/superseded Surface -> KP link |
| 44 | `kg_point_evidence_links` | 可重建投影 | active/superseded Evidence -> KP link |
| 45 | `kg_lookup_events` | append-only 事实 | 显式检索与确认后的重复生成尝试 |
| 46 | `kg_point_stats` | 可重建读模型 | 三类证据分区聚合 |
| 47 | `kg_planning_signals` | 可重建读模型 | 按 Study Item 的同步 provider 信号 |
| 48 | `learning_manual_queue_intents` | LA 工作流 | 一次性“加入本次学习”意图 |

不新增 synonym、cross-language、graph-layout、mastery-state 或 LLM-private-reasoning 表。

---

## 10. LA-D2 协同增补：“加入本次学习”

本节在本文 Accepted 后，正式 amendment [LA-D2 §8 Daily Queue](Learning_Assistance_2_0_Domain_and_Data_ADR.md)。KG 只发起 use case，所有数据与执行归 LA。

### 10.1 适用范围

v1 只允许加入满足以下条件的 Study Item：

- 当前 `learning_plans.status='active'`，并存在有效 Learning Profile；
- `lifecycle='active'`；
- 已存在 `learning_schedule_states`，即不是从未学习的新单元；
- 来源未被 quarantined/unresolved；
- 当前 learning day 尚无该 Study Item 的 Review Event；
- 用户已明确确认加入。

Fresh Study Item 不支持该入口，因为它会绕过 `dailyNewLimit`。UI 应显示“尚未开始学习”，未来若要手动拉入 fresh item，必须另行修改 LA 产品决策。

一次性 intent 可以在明确确认后越过当前 plan scope（例如计划只含日语，但用户主动加入一个已调度英语单元），但只影响当日队列：不得修改 `learning_plans.scope_json`，UI 必须显示“本次额外加入”。若该 Study Item 当天已经评分，返回“今日已学习”，不能通过新 intent 触发第二次正式评分；Again/Hard 需要的同日重现继续由现有 Schedule State 与 queue entry 工作流负责。

### 10.2 幂等与容量

- 请求带 `intentKey`；同 key 同 body 幂等，同 key 不同 body 返回 409；
- `(plan_id, learning_day, study_item_id)` 唯一；
- item 已在今日队列时返回既有 entry，不写重复 intent；
- 每日手动 intent 上限为 `min(daily_action_goal, 20)`，策略版本 `manual-intent-v1`；
- 达到每日行动目标后仍可在容量内显式加入，但 UI 标记为“额外学习”；
- 手动加入不占 `dailyNewLimit`，因为 v1 禁止 fresh item；
- 真正完成评分后才计入每日行动数。

### 10.3 队列优先级

插入队列时：

- 若该 item 按当前 learning day 实际已经 overdue/due today，则使用自然 bucket 1-4，不因手动来源降级；
- 其它已调度但未到期的 item 使用 bucket 5，`reason='manual-lookup'`；
- bucket 5 排在所有到期项之后、bucket 6 新单元之前；
- entry explanation 明确 `source='manual-intent'`，不得伪装成系统到期；
- 已有 entry 的 bucket/reason 不被手动意图覆盖。

现有 schema 允许 bucket 1-6。KG-P3 实施核对发现，LA-P1 已经把 bucket 5 用于 FSRS 返回 `shortTerm=true` 后的 `difficult-reappearance`，这早于本文最初对“空 bucket 5”的判断。本文据实修订为**共享优先级层**：`difficult-reappearance` 与 `manual-lookup` 都位于到期 bucket 1-4 之后、新单元 bucket 6 之前，并由 `reason` 与 explanation source 严格区分。手动 intent 不得覆盖既有困难项 entry，困难项重现也不得伪装成手动来源。

### 10.4 会话恢复与评分

- 无今日队列时先按现有 plan/profile revision ensure queue，再原子加入 entry；
- 有 active session 且绑定同一 queue 时，可追加 entry，但不得改变当前已揭示 entry；下一次取队列时可见；
- active session 绑定其它 revision/queue 时返回 `409 LEARNING_ACTIVE_SESSION_CONFLICT`；
- 浏览器重启后通过 queue entry + manual intent 恢复；
- 用户评分后，现有 review transaction 正常写 Review Event 与 Schedule State；同时把 intent 标记 completed 并记录 completion event id；
- 未评分 intent 在学习日结束后标记 expired；历史 queue snapshot 与 intent 保留；
- 点击加入、取消或过期都不写 Review Event，不改 Schedule State。

### 10.5 分析与历史

学习历史需新增独立的 `manualAssigned/manualReviewed` 指标，不能把 bucket 5 混入 new。若手动加入的 item 自然属于 bucket 1-4，它仍计入 due 完成，同时可通过 intent 表计入 manual 来源，两者维度不同，不互相排斥。

---

## 11. 表级契约

### 11.1 `kg_points`

核心字段：

- `id`；
- `point_key CHAR(64) UNIQUE`；
- `kp_kind CHECK lexeme|phrase|grammar_pattern`；
- `language CHECK en|ja|zh`；
- `canonical_form`；
- `canonical_reading` nullable；
- `sense_discriminator` 默认空；
- `identity_version`；
- `lifecycle CHECK active|retired|archived`；
- `created_by_event_id` nullable（bootstrap 时可后补 FK/顺序需在迁移设计处理）；
- `created_at_utc / updated_at_utc`。

`point_key` 永不复用；retired point 不物理删除。

### 11.2 `kg_surface_forms`

核心字段：

- `surface_key CHAR(64) UNIQUE`；
- `language`；
- `surface_text / normalized_surface / normalized_reading`；
- `analysis_status CHECK analyzed|unresolved|unsupported`；
- `analyzer_id / analyzer_version / analysis_rule_version`；
- `token_sequence_json`；
- `analysis_input_hash / analysis_output_hash`；
- timestamps。

JSON 必须 `json_valid`；未分析结果保存明确状态，不用空 JSON 伪装成功。

### 11.3 `kg_evidence`

核心字段：

- `evidence_key CHAR(64) UNIQUE`；
- `source_kind CHECK generation|study_item|textbook_expression`；
- `source_ref_id`；
- `source_revision`；
- `locator_json`；
- `language`；
- `source_text`（只保存必要主表达，不复制整份教材）；
- `source_content_hash CHAR(64)`；
- `evidence_role CHECK primary|context`；
- `lifecycle CHECK active|superseded|orphaned`；
- timestamps。

多态来源不做伪 FK；application service 必须在写入事务前验证来源，并以 source hash/locator 保留可审计身份。

### 11.4 `kg_resolution_cases` 与 `kg_resolution_events`

Case 保存当前工作流：

- case key、kind、language、kp kind hint；
- surface/evidence 可选引用；
- normalized input；
- `candidates_json`；
- status、revision、resolved point；
- opened/resolved timestamps。

Event 保存不可变事实：

- `event_key UNIQUE / request_hash`；
- case id nullable；
- action 与 actor kind（`rule|user|maintenance|llm-proposal`）；
- provider/model/analyzer/rule/prompt versions；
- input/output hash；
- structured payload 与 public reason；
- occurred/created UTC。

LLM proposal 只写 `candidate-proposed` event，不得在同一操作中创建 active link。

### 11.5 `kg_point_transitions`

字段：predecessor point、successor point、`transition_kind CHECK split-into|merge-into|replacement`、resolution event、created UTC。允许一对多和多对一；禁止 predecessor=successor；同一 event 下组合唯一。

### 11.6 link projections

`kg_point_surface_links`：

- point id、surface form id；
- `link_kind CHECK canonical|inflection-of|polite-of`；
- lifecycle active/superseded；
- decision event、source kind、rule version、confidence、public reason；
- active partial unique indexes。

`kg_point_evidence_links`：

- point id、evidence id；
- attachment role primary/context；
- strength strong/weak；
- lifecycle active/superseded；
- decision event、extractor version、public reason；
- active partial unique indexes。

Planning v1 只读取 active + strong 链接。

### 11.7 `kg_lookup_events`

除 §7 字段外，数据库层必须：

- FK 到 point/case/surface（允许 point 或 case 二选一）；
- check `interaction_kind` 白名单；
- check UTC/learning day 基本格式；
- 为 `(point_id, occurred_at_utc)`、`(resolution_case_id, occurred_at_utc)`、`learning_day` 建索引；
- 通过触发器阻止 UPDATE/DELETE，或由与 Review Event 一致的 storage contract + 测试保证 append-only；实施阶段优先采用 DB trigger。

### 11.8 read models

`kg_point_stats` 以 `point_id` 为主键，保存三类分区字段、projection version、facts watermark 和 computed UTC。

`kg_planning_signals` 以 `study_item_id` 为主键，保存：

- score（0-30）；
- `point_ids_json`；
- groups/reasons/evidence JSON；
- signal version；
- source watermark；
- computed UTC。

两表可清空重建，不属于不可丢失事实。

### 11.9 `learning_manual_queue_intents`

核心字段：

- `intent_key UNIQUE / request_hash`；
- plan id、learning day、time zone；
- queue id、queue entry id、Study Item id；
- policy version；
- status `active|completed|expired|cancelled`；
- completion Review Event id nullable；
- created/completed/expired timestamps；
- unique `(plan_id, learning_day, study_item_id)`。

该表归 `services/learning`，不得放入 `services/kg` storage owner。

---

## 12. API 契约

### 12.1 KG API

| Method | Route | 写事实 | 说明 |
|---|---|---:|---|
| GET | `/api/kg/search?q=&language=&kind=` | 否 | typeahead/搜索，只读，不计 lookup |
| POST | `/api/kg/lookups` | 是 | 明确提交，幂等写 explicit lookup |
| GET | `/api/kg/points/:id` | 否 | KP 三类证据摘要 |
| GET | `/api/kg/points/:id/forms` | 否 | active 词形与公开理由 |
| GET | `/api/kg/points/:id/evidence` | 否 | 当前内容 Evidence |
| GET | `/api/kg/resolution-cases/:id` | 否 | unresolved 候选 |
| POST | `/api/kg/resolution-cases/:id/decisions` | 是 | 人工 resolve/dismiss/reopen，带 revision 与 event key |

重复生成集成不新增隐式副作用：生成 API 仍返回既有 409 contract；只有用户点击“查看已有知识点”时，前端才显式调用 `/api/kg/lookups`，kind 为 `duplicate_generation_attempt`。

### 12.2 LA 协同 API

| Method | Route | 说明 |
|---|---|---|
| POST | `/api/learning/manual-queue-intents` | 加入已调度 Study Item，返回 intent + queue entry |
| GET | `/api/learning/manual-queue-intents/today` | 恢复当日手动意图状态 |

### 12.3 错误码

- `KG_INVALID_INPUT`；
- `KG_POINT_NOT_FOUND`；
- `KG_RESOLUTION_CASE_NOT_FOUND`；
- `KG_EVENT_KEY_CONFLICT`；
- `KG_RESOLUTION_STALE`；
- `KG_FEATURE_DISABLED`；
- `LEARNING_MANUAL_INTENT_INELIGIBLE`；
- `LEARNING_MANUAL_INTENT_ALREADY_REVIEWED_TODAY`；
- `LEARNING_MANUAL_INTENT_LIMIT_REACHED`；
- `LEARNING_ACTIVE_SESSION_CONFLICT`；
- `LEARNING_QUEUE_REVISION_CONFLICT`。

所有响应沿用现有 JSON envelope 和统一 error middleware；不得返回模型私有推理、绝对文件路径或密钥。

---

## 13. 服务与代码边界

建议结构：

```text
services/kg/
  application/
    lookupKnowledgePoint.js
    resolveKnowledgeCase.js
    rebuildKnowledgeProjections.js
  domain/
    knowledgeIdentity.js
    japaneseFormAnalysis.js
    planningSignalPolicy.js
  storage/
    kgRepository.js
    graphPlanningSignalReader.js
  enrichment/
    proposeSemanticRelations.js   # v1 disabled; async only

routes/kg.js

services/learning/application/
  addManualQueueIntent.js
```

边界规则：

1. `routes/kg.js` 必须在 `lib/httpRuntime.createApp()` 显式挂载，并进入 API-only integration harness。
2. Route 只做 schema validation、认证边界预留和 envelope，不写 SQL。
3. Identity/normalization 为纯函数；Kuromoji adapter 与现有 ruby service 共享初始化能力，但不能破坏 `toRuby()`。
4. Repository 使用现有 `better-sqlite3` 同步事务；所有事件 + 投影更新必须原子。
5. GraphPlanningSignalReader 只读，不依赖 application service。
6. DeepSeek enrichment 复用现有 `deepseekService`，只能由异步 use case/job 调用。
7. `services/kg` 不得 import SchedulerPort 的写入方法；`services/learning` 不得依赖 KG 表生成基础队列。

建议 feature flags：

- `KG_ENABLED=0|1`：KG 查询/lookup 总开关；
- `KG_PLANNING_ENABLED=0|1`：Graph reader 开关；
- `KG_LLM_ENRICHMENT_ENABLED=0|1`：未来异步 proposal 开关，v1 默认 0。

上线默认档位固定为：

1. migration 003 和 KG-P1 初次部署时三项均默认 `0`，只允许维护脚本 dry-run/rebuild；
2. KG-P1 只读 API、lookup 幂等和人工 unresolved 流程验收后，显式把 `KG_ENABLED` 切为 `1`；
3. KG-P2 集合一致性、10ms 与降级门禁通过后，才可显式把 `KG_PLANNING_ENABLED` 切为 `1`；
4. `KG_LLM_ENRICHMENT_ENABLED` 在 KG v1 始终保持 `0`，未来只能通过新 ADR/amendment 开启。

因此不是由“是否存在 KG 表”决定功能启用；每一级能力都有独立开关和验收点。`.env.example` 与 Compose 必须写出同样的默认值，不能在不同启动方式下漂移。

关闭 KG 时 `/learn`、评分、Cards Factory、教材和生成链路必须继续工作。

---

## 14. 迁移、回填与回滚

### 14.1 迁移文件

KG-P1 的 schema 提交包含：

- `database/migrations/003_knowledge_graph_2_0.sql`；
- `database/schema.sql` 表 37-47；
- migration runner 的 `KG_P1_TABLES` postcondition；
- schema/migration parity 测试；
- 新库、002 存量库和重复启动测试。

KG-P3 的 LA amendment 另由 `database/migrations/004_learning_manual_queue_intents.sql` 交付表 48，并增加独立 `LEARNING_P3_TABLES` postcondition；不得修改已应用 migration 003 的 checksum。

### 14.2 回填顺序

1. **P0 只读识别 POC**：跑 fixture，不写生产库；
2. **P1 dry-run manifest**：从 eligible/whole-card-only Study Item、generation 和 published textbook expression 产生 KP/Surface/Evidence 建议；
3. 输出计数、unresolved、冲突、预计 links 与 source hashes；
4. 人工抽样通过后才执行事务回填；
5. 回填只接受确定性白名单关系；LLM proposal 默认关闭且不得自动接受；
6. 重建 point stats 与 planning signals；
7. `KG_PLANNING_ENABLED` 仍保持 0，先只读验收；
8. P2 单独打开 Graph reader 并做集合一致性测试；
9. P3 最后落地 manual intent。

### 14.3 回滚

在尚未产生用户 lookup/resolution/manual intent 前，可以回滚应用并删除空 KG 表。

一旦产生事实：

- 不允许通过 DROP 丢弃 `kg_lookup_events`、`kg_resolution_events`、`kg_point_transitions` 或 `learning_manual_queue_intents`；
- 运行回滚应关闭 feature flags、卸载 route/provider、保留事实表；
- 可清空并重建 `kg_point_stats` 和 `kg_planning_signals`；
- active links 若需重建，必须先保留 resolution events；
- migration checksum 不得修改；修复使用新 migration。

---

## 15. 安全、版权与隐私

- Lookup input 视为用户数据，只保存在本地 SQLite；日志只记 event id、kind、长度和 hash，不记录完整查询文本。
- DeepSeek key 只从环境读取，不进 DB、event payload、日志、前端或测试 fixture。
- KG v1 默认不向 DeepSeek发送教材官方原文；`KG_LLM_ENRICHMENT_ENABLED` 即使开启，也必须有来源 allowlist。
- Public reason 不得包含模型私有推理。
- 所有 JSON 输入限制深度、数组长度和字符串长度；搜索 query 设最大长度。
- Resolution decision 使用 optimistic revision，防止两个窗口覆盖人工裁决。
- 多态 Evidence locator 不接受绝对文件路径或 `..`；教材媒体继续由其受控媒体路由管理。

---

## 16. 可观测性

至少记录以下结构化指标：

- `kg_lookup_total{kind,resolution}`；
- `kg_resolution_cases_open_total{reason}`；
- `kg_resolution_decisions_total{actor,action}`；
- `kg_projection_rebuild_duration_ms{projection}`；
- `kg_planning_reader_total{result=applied|empty|failed|timed_out}`；
- `kg_planning_reader_duration_ms`；
- `kg_manual_intent_total{result}`；
- `kg_llm_proposal_total{provider,model,result}`（未来，默认无数据）。

健康检查只检查本地 schema/projection 状态；不得为了 health check 调用 DeepSeek。LLM provider 健康继续复用现有系统级检查。

---

## 17. 测试策略与验收

### 17.1 Unit

- identity hash 稳定性与 NFKC/空白/大小写；
- EN normalized form 不误称 lemma；
- 日语 P0 token fixtures；
- `箸/橋` 分离、`はし` unresolved；
- resolution event 幂等与 stale revision；
- split/merge 不复制模糊 lookup；
- planning score 时间窗、cap、max-not-sum；
- manual intent 容量、bucket 与 fresh item 拒绝。

### 17.2 Integration

- 003 migration 新库/002 升级/重复启动/checksum；
- 11 张 KG 表 + 1 张 LA 表 postcondition；
- lookup append-only、同 key 冲突；
- typeahead/reveal/rating 零 KG event；
- unresolved resolve 后 projection 归属且原 event 未更新；
- Evidence 来源删除后的 orphaned 行为；
- Graph reader 单索引查询、无写事务；
- 手动加入不更新 Schedule State，评分后只走现有 scheduler transaction；
- bucket 5 analytics 不被计入 new。

### 17.3 Queue invariants

用同一 DB snapshot 对比 `KG_PLANNING_ENABLED=0/1`：

- queue Study Item set 完全相同；
- bucket/available/due 完全相同；
- 只允许同三键内排序改变；
- signalReader 抛错、慢于 10ms、返回非法结果时恢复基础顺序；
- DeepSeek endpoint 被阻断时队列仍全绿，并证明队列路径从未发起网络请求。

### 17.4 E2E（仅桌面端）

- S1-S12 原型对应状态；
- typeahead 不增加计数，提交 lookup 增加一次；
- 重复生成 409 后只有点击查看才写事件；
- unresolved 人工选择与 optimistic conflict；
- “加入本次学习”确认、幂等、容量、会话恢复和评分；
- KG feature off 的降级界面；
- 不要求移动端布局或移动端专项验收。

KG-D1 12 状态与本文契约映射如下，原型当前已包含 12 个真实 section 和 12 个可切换按钮，不存在 S8-S12 stub：

| 状态 | 本文契约 |
|---|---|
| S1 查找入口 | §7 明确提交与只读 typeahead |
| S2 重复查找且已在队列 | §7 lookup + §8 只读统计/基础集合内信号 |
| S3 重复查找但不在队列 | §10 手动 intent 资格与边界 |
| S4 加入确认 | §10.1-§10.2 显式确认、容量与幂等 |
| S5 加入结果 | §10.3-§10.4 queue entry、零 Schedule State 写入 |
| S6 相关词形 | §4 fixture + §5 Surface link |
| S7 unresolved | §6 Resolution Case/Event |
| S8 KP 三类证据 | §8.1 `kg_point_stats` 分区聚合 |
| S9 词形聚类 | §5 accepted link 与 Evidence 元数据 |
| S10 精确重复 | §7.1 用户选择后才写 duplicate attempt |
| S11 队列内上浮 | §8.2-§8.4 预计算 score 与同键细排 |
| S12 降级态 | §8.3-§8.4 reader 返回 null 与基础顺序 |

### 17.5 性能门禁

- Graph reader p95 < 5ms、单次硬预算 10ms；
- 搜索结果默认 limit <= 20；
- rebuild 可分批，不在 HTTP 请求中全量重建；
- 数据量至少用当前 Study Item 全量和 10 倍合成 lookup 事件做压力测试。

---

## 18. 取舍与拒绝方案

### 18.1 拒绝：让 LLM 实时决定队列

原因：网络调用与 10ms 同步契约不兼容；不可复现；服务失败会污染核心学习路径；模型升级会静默改变队列。改用异步 proposal + 预计算 signal。

### 18.2 拒绝：LLM 自动接受 synonym/cross-language 关系

原因：语义关系依赖上下文和义项；误连会跨卡片放大；v1 无足够人工评估集。只保留未来 proposal 接缝。

### 18.3 拒绝：把 lookup 当 Again

原因：lookup 不是答案揭示后的主动回忆评分；会伪造 Review Event 并污染 FSRS。lookup 只产生检索困难信号。

### 18.4 拒绝：让 Graph provider 扩大基础集合

原因：现有 provider 在集合选定后运行；绕过该顺序会破坏 `dailyNewLimit`、到期优先级和可降级性。队列外项目只能通过 LA 手动意图加入。

### 18.5 拒绝：按字符串直接合并 KP

原因：同音异义、多义词和纯假名歧义会造成不可逆错误。采用分层身份、unresolved 与可逆 transition。

### 18.6 拒绝：复用旧 `knowledge_*` 表

原因：旧域已被明确退役并由启动清理删除；复用会混淆产品语义和迁移历史。新域只使用 `kg_*`。

---

## 19. 实施阶段

### KG-P0：识别 POC（已完成，2026-07-16）

- 暴露只读 token analyzer；
- 固定 §4.3 fixture；
- 验证 identity hash、unresolved 和三类关系；
- 输出 dry-run，不改 schema、不接队列。

### KG-P1：事实与读模型

- migration 003 + schema truth；
- KP/Surface/Evidence/Resolution/Lookup；
- 只读搜索与 KP 详情 API；
- point stats/planning signal rebuild；
- 默认 `KG_PLANNING_ENABLED=0`。

### KG-P2：Graph signalReader

- 单索引同步 reader；
- provider explanation；
- 集合一致性、10ms、错误降级；
- 小范围运行观察后再默认开启。

### KG-P3：显式加入学习

- LA-D2 amendment 表与 use case；
- bucket 5、容量、恢复、分析指标；
- S3-S5 交互接入；
- 端到端确认无 Schedule State 直接写入。

### 后续但不属于 v1

- DeepSeek 异步语义 proposal；
- 词典/embedding 候选；
- synonym/cross-language 人工确认；
- 全图可视化；
- 基于真实学习数据重新评估 signal 权重。

---

## 20. KG-D2 接受门禁

- [x] 用户确认 §0 十条建议决策
- [x] 用户确认“智能来源四层模型”与 DeepSeek 只作异步 proposal
- [x] 用户确认 v1 不使用 LLM 自动建图
- [x] 用户确认 11 张 KG 表 + 1 张 LA 表的数据边界
- [x] 用户确认 unresolved、split/merge 与历史事实不重写
- [x] 用户确认 lookup 写入条件与幂等语义
- [x] 用户确认 `kg-lookup-signal-v1` 只在基础集合内细排
- [x] 用户确认“加入本次学习”的 fresh-item 禁止、每日容量、bucket 5、会话和评分语义
- [x] migration 003 / schema.sql 双路径规则已确认
- [x] 回滚、版权、隐私和 feature flag 边界已确认
- [x] KG-D1 的 12 个桌面状态均能由本文领域契约解释（§17.4 映射已核实）
- [x] 用户确认本文为 Accepted，允许进入 KG-P0

2026-07-16 全部门禁通过，本文转为 Accepted，成为知识图谱 2.0 的领域与数据基线；KG-P0 已获准启动。后续实施必须遵守本文的所有权、降级、幂等、只读聚合与 LA 协同边界。

---

## 21. KG-P0 实施记录（2026-07-16）

KG-P0 已完成并通过门禁，交付范围严格限制为只读 POC：

- `services/generation/japaneseFurigana.js` 在既有单例 Kuroshiro/Kuromoji 初始化边界上暴露 `analyzeJapaneseTokens()`，未额外加载第二份词典，原 `toRuby()` 行为保持兼容；
- `services/kg/domain/knowledgeIdentity.js` 实现 `kg-identity-v1` / `surface-identity-v1` 的稳定规范化与 SHA-256 identity；
- `services/kg/domain/japaneseFormAnalysis.js` 实现 basic form 重分析、lemma reading、`canonical / inflection-of / polite-of` 判定与保守 unresolved；
- `services/kg/domain/knowledgeEvidence.js` 以结构化来源生成只读 `evidence-of` candidate；
- `tests/fixtures/kg-p0-japanese-token-fixtures.json` 固定 analyzer/rule 版本、原始 token JSON、预期关系、unresolved 原因和 point key；
- `scripts/poc/kgP0DryRun.js` / `npm run kg:p0` 输出 `mode=read-only-no-database` 的 POC manifest。

实测结果：

| 项目 | 结果 |
|---|---|
| fixture | 8 |
| resolved / unresolved | 6 / 2 |
| `食べる / 食べた / 食べて / 食べます` | 同一 point key `8d738529...beda2` |
| `箸 / 橋` | 相同 lemma reading，但 point key 不同 |
| `はし` | `ambiguous-kana-input` |
| 未知 `xyz` | `unsupported-token` |
| accepted relation candidates | `inflection-of` 2、`polite-of` 1、`evidence-of` 1；另有内部 canonical 3 |
| lint | 通过 |
| unit | 311/311 通过（其中 KG-P0 新增 17） |
| integration | 57/57 通过 |

边界核验：未新增或修改 `database/schema.sql`、migration、route、LearningService、Planning Provider、feature flag、DeepSeek 调用或运行时数据库数据。KG-P0 只证明确定性身份与关系规则可行；下一阶段为 **KG-P1 事实表、读模型与只读 API**，必须另行实施 migration 003，且初次部署的 KG feature flags 继续全部为 0。

---

## 22. KG-P1 实施记录（2026-07-16）

KG-P1 已完成事实层、工作流投影、读模型和受控 API，未接入 Planning Provider：

- `database/migrations/003_knowledge_graph_2_0.sql` 与 `database/schema.sql` 同步交付表 37-47；migration runner 对 11 张 `kg_*` 表执行 postcondition，并通过新库/存量库对象级 parity；
- `KnowledgeGraphService` 与 `KgRepository` 实现确定性 KP/Surface、Evidence、append-only lookup/resolution、unresolved case 和 revision-checked 人工 resolve/dismiss/reopen；
- `rebuildKnowledgeProjections` 可清空重建 `kg_point_stats` 与 `kg_planning_signals`，`kg-lookup-signal-v1` 使用 7/30 天窗口、max-not-sum 与 30 分 cap；
- `/api/kg` 提供搜索、显式 lookup、KP 详情/词形/Evidence、Resolution Case 与人工 decision；搜索不写事实，同 key 同 body 幂等，同 key 不同 body 返回 409；
- `KG_ENABLED`、`KG_PLANNING_ENABLED`、`KG_LLM_ENRICHMENT_ENABLED` 在代码、`.env.example` 与 Compose 中均默认 `0`；关闭时 `/api/kg/*` 返回 `KG_FEATURE_DISABLED`，学习、教材、生成和 FSRS 不受影响；
- `kgP1BackfillDryRun.js` 以 SQLite readonly 连接扫描 eligible/whole-card-only Study Item 与 published textbook expression，只输出 Git 外 manifest，不写 KG 表。

真实 Compose volume 验收：

| 项目 | 结果 |
|---|---:|
| migration versions | baseline + 001 + 002 + 003 |
| KG tables | 11 |
| active eligible Study Items | 1132 |
| extracted Study Item sources | 1167 |
| published textbook sources | 40 |
| resolved / unresolved candidates | 1156 / 52 |
| suggested KP / Surface / Evidence | 1106 / 1106 / 1120 |
| unresolved breakdown | whole-card 1、ambiguous kana 43、unsupported token 4、unsupported sequence 1、empty source 3 |
| dry-run 后 KG point/lookup/resolution/signal rows | 0 / 0 / 0 / 0 |
| lint | 通过 |
| unit | 317/317 通过 |
| integration | 60/60 通过 |
| smoke | 7/7 通过 |
| Docker build/runtime | React production build 通过，viewer/health 正常，npm audit 0 vulnerabilities |

边界核验：KG-P1 没有调用 DeepSeek 建图、没有写 Review Event 或 Schedule State、没有接入 `GraphPlanningSignalProvider`，也没有执行回填 apply。真实 manifest 保留在容器 `/tmp`，不进入 Git。下一阶段为 **KG-P2 单索引同步 signalReader、解释透传、基础集合一致性、10ms 预算和错误降级验收**。

---

## 23. KG-P2 实施记录（2026-07-16）

KG-P2 已完成预计算 Graph Planning Signal 到学习队列的只读接入：

- `GraphPlanningSignalReader` 只在 `KG_ENABLED && KG_PLANNING_ENABLED` 时准备 `WHERE study_item_id = ?` 的本地同步查询；关闭、缺表、无行、读取异常或非法投影均返回 `null`；
- `createDefaultPlanningSignalProvider({ graphSignalReader })` 把 reader 注入既有 `GraphPlanningSignalProvider`，不改变 Heuristic Provider、Composite contract 或 SchedulerPort；
- provider 仍在基础集合完成截取后运行；同一 DB snapshot 的开关对照证明 Study Item 集合、bucket、available_at 和 due_at 完全一致，只允许相同三键内按 provider score 细排；
- queue explanation 透传 `graph-contract`、`kg-lookup-signal-v1`、公开 reason 与 `point:<id>` provenance；不公开内部 watermark，不在读路径重建投影；
- reader 抛错、非法结果和超过 10ms 的结果分别进入 failed/timedOut 降级；基础顺序恢复，队列请求不失败；
- 读路径不调用 DeepSeek、Kuromoji 或网络，不写 lookup、Review Event、Schedule State 或 FSRS。

验收结果：

| 项目 | 结果 |
|---|---:|
| prepared query | `study_item_id INTEGER PRIMARY KEY` |
| reader volume | 1132 planning signals + 11320 synthetic lookup facts |
| reader p95 | `< 5ms` 门禁通过 |
| provider hard budget | 10ms；超时确定性降级通过 |
| same-snapshot set/base-key parity | 通过 |
| lint | 通过 |
| unit | 324/324 通过 |
| integration | 61/61 通过 |
| smoke | 7/7 通过 |

上线边界保持不变：`KG_ENABLED`、`KG_PLANNING_ENABLED`、`KG_LLM_ENRICHMENT_ENABLED` 在代码、`.env.example` 与 Compose 中继续默认 `0`。KG-P2 已通过打开 planning flag 所需的技术门禁；KG-P3 已完成显式加入学习闭环。本阶段不替代小范围运行观察，也不在默认环境自动开启。

---

## 24. KG-P3 实施记录（2026-07-16）

KG-P3 已完成“知识点查找 -> 明确确认 -> 加入本次学习 -> 正常评分”的 LA 协同闭环：

- `database/migrations/004_learning_manual_queue_intents.sql` 与 `database/schema.sql` 同步交付表 48；migration runner 对新表执行 postcondition，并保持新库/存量库对象级 parity；
- `LearningService.addManualQueueIntent()` 只接受 active、admitted、已有 Schedule State 且今日未评分的 Study Item；fresh item、未确认请求、超容量和跨 queue active session 均使用稳定错误码拒绝；
- intent 与 queue entry 在同一事务写入；同 key 同 body 幂等，同 key 不同 body 返回 409，`(plan, learning_day, Study Item)` 保持唯一；
- 已自然进入今日队列的 item 返回原 entry 且不写 intent；overdue/due item 使用自然 bucket 1-4，未到期 item 使用 bucket 5 + `manual-lookup`；已有 entry 的 reason/bucket 不被覆盖；
- bucket 5 与既有 `difficult-reappearance` 共存，以 reason/source 区分，二者均不能越过 bucket 1-4，也不计入 fresh；
- 同 queue active session 可追加且不改变当前或已揭示 entry；评分仍由现有 Review Event + SchedulerPort transaction 更新 FSRS，并在同一事务把 intent 标记 completed；加入、恢复和过期本身不写 Review Event 或 Schedule State；
- `/api/learning/manual-queue-intents` 与 `/today` 提供显式加入和浏览器恢复；学习历史新增独立 `manualAssigned/manualReviewed/manualCompletionRate`，不污染 due/new 指标；
- `/knowledge` 落地 KG-D1 S3-S5 桌面交互：只读 suggestion、显式 lookup、KP/词形/Evidence、关联 Study Item 调度状态、确认对话框与“查看今日学习”；功能关闭时明确降级。

验收结果：lint、React typecheck、328 项 unit、62 项 integration 与生产 React build 均通过；Playwright 覆盖“未确认不发请求、确认后只调用一次 manual-intent”交互。三项 KG feature flag 继续默认 `0`，P3 不自动开启图查询或 planning。

---

## 25. KG-R0 受控事实回填（2026-07-16）

KG-P0-P3 交付的是 schema、确定性规则和运行时闭环；既有学习单元不会自动写入 KG 事实表。KG-R0 补齐首次生产数据初始化，但不改变 KG v1 的功能边界：

- `buildKnowledgeBackfillManifest()` 升级为稳定 v3 hash：生成时间不参与 hash，日语 token/lemma token 与分析 hash 保留在本地 Manifest；`kg-source-extractor-v2` 先移除日语 ruby 注音层，再对英语/日语执行目标语言与残留 HTML 门禁；
- `applyKnowledgeBackfill()` 只接受显式批准的 `expectedManifestHash`，先重建当前 Manifest，再逐条复核 Evidence source hash；hash 不匹配或 source drift 时零写入；
- apply 仅允许空 KG 事实库，防止初始回填与未来增量维护混淆；在一个事务内物化确定性 KP、surface、Evidence、link 和有可用正文的 unresolved case，随后重建投影；
- `scripts/maintenance/applyKnowledgeBackfill.js` 强制 `--apply`、SQLite backup 路径和不可覆盖 report 路径；卷级备份、审核和分级启用见 `Docs/Operations/Knowledge_Graph_2_0_Runbook.md`；
- 运行时三项 KG flag 在 R0 后仍默认 `0`。只有回填报告和人工样本验收后，才允许先启用 `KG_ENABLED`；`KG_PLANNING_ENABLED` 继续等待小范围运行观察。

首次 v2 apply 在 UI 样本验收中发现历史翻译列存在语言错位与 ruby 正文污染，已按运行手册关闭 KG 并恢复 pre-R0 SQLite backup。恢复验收为 `integrity_check=ok`、外键违规 0、11 张 KG 表全空。v2 批次永久作废；后续 apply 只能使用通过 resolved 语言/标记门禁的 v3 Manifest。

最终批准的 v3 Manifest hash 为 `b79afaf97f1a1c1fd445fc150060ffc925ec7de3759a15460857085f77037275`。v3c apply 插入 855 个 KP、1107 个 surface、1123 条 Evidence、255 个可物化 unresolved case，回填本身写入 lookup 0 条；语言错位与残留标记违规均为 0。`study_items=1141` 保持不变，Review Event、Schedule State 与 Manual Intent 均保持 0，SQLite `integrity_check=ok` 且外键违规为 0。

运行时抽样同时修正了一个所有权偏差：typeahead 搜索结果点击只能选择并读取 KP，不得调用 lookup mutation；只有用户显式提交“查找”才写 append-only lookup。E2E 对 `/api/kg/lookups` 设置失败拦截并断言结果选择发送 0 次请求。最终桌面验收覆盖英文 resolved、日语 kanji reading、pure-kana unresolved 与错误语言输入拒绝；本地运行环境只启用 `KG_ENABLED`，planning 与 LLM enrichment 继续关闭。

---

## 26. KG-R1 小范围观察与 Planning Canary（2026-07-17）

KG-R1 增加 `runPlanningCanary` 与 `kg:r1:canary` 只读维护入口。工具以 `readonly + PRAGMA query_only` 打开真实 SQLite，在同一 snapshot 上对 baseline、真实 Graph reader 和强制失败 reader 执行相同的 `buildQueueCandidates`，不创建 plan/profile/queue，不写 lookup、Review Event、Schedule State、Manual Intent 或 FSRS。报告强制使用 Git 外不可覆盖路径。

真实 volume 首次启用前后两轮均通过全部门禁：1134 个候选行中取代表性 20 项，唯一真实 Graph signal 把 Study Item 7 从索引 6 细排到索引 0；Study Item 集合与每项 bucket、available/due 三键完全一致，强制失败精确恢复 baseline。500 次 reader 探针的 p95 为 0.0013ms / 0.0014ms，均无超过 10ms；query plan 使用整数主键，网络调用和 18 张观察表计数变化为 0，SQLite integrity 为 `ok`、外键违规为 0。

本地运行环境据此启用 `KG_PLANNING_ENABLED=1`，保留 `KG_LLM_ENRICHMENT_ENABLED=0`；代码、Compose 和 `.env.example` 默认值继续全部关闭。当前真实库没有学习计划、持久化队列、Schedule State 或 Review Event，因此 KG-R1 只确认 planning 能力安全启用，未虚报真实用户队列 explanation 验收。首个真实计划/队列产生后须补 queue snapshot 观察；在此之前不得为验收伪造用户计划。

---

## 27. KG-R2 增量事实维护增补（2026-07-17）

KG-R0 的空库一次性 apply 不承担后续在线维护。KG-R2 以独立 ADR
`Knowledge_Graph_2_0_Incremental_Maintenance_ADR.md` 增补本基线：新增表 49
`kg_source_sync_jobs` 与 migration 005；在线卡片和教材发布只在自身 SQLite
事务内原子写 outbox，确定性分析、Evidence 更新和投影重建由独立 worker 异步完成。

旧 revision 的 Evidence 必须先写 append-only `evidence-detached` 再转
`superseded`；来源删除/退役转 `orphaned`。worker 在提交分析前重新加载完整
source bundle 并复核 revision/hash，source drift 任务记为 `superseded`，不得把过期
Evidence 写为 active。KG-R2 不写 Review Event、Schedule State、Manual Intent 或
FSRS，不调用 DeepSeek 建图。

新增 `KG_INCREMENTAL_SYNC_ENABLED` 独立控制消费者；代码、Compose 与
`.env.example` 默认均为 `0`。内容事务不受该开关影响，关闭期间仍安全积累 outbox。
首次启用必须经过 Git 外只读 plan、hash-gated apply、SQLite backup 与报告验收。

真实 Compose volume 已于 2026-07-17 完成首次 KG-R2 验收。初始 plan 识别 86 个 R0 后缺失来源；首次 apply 后的二次审计发现 `kg-evidence-v1` 未把语言纳入身份，导致 36 个场景 Study Item 的 EN/JA Evidence 冲突。实现升级为 `kg-evidence-v2` 后重新受控 apply，最终 active Evidence 为 1159、活动来源语言重复为 0、场景 EN/JA 缺失为 0、outbox 仅有 86 条 succeeded，最终 reconciliation plan 为零。全过程没有写 Review Event、Schedule State、Manual Intent、Learning Plan、Daily Queue 或 FSRS；SQLite integrity 为 `ok`、外键违规为 0。详细证据与恢复点见运行手册 §8.5 和 KG-R2 测试报告。
