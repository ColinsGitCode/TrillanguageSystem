# 知识图谱 2.0 产品定义（KG-D0）

> 状态：**KG-D0 已确认 · 正式基线**（2026-07-16 用户逐条确认 §11 七条推荐决策；技术前提经 `learningService.js` 排序键核对属实）
>
> 日期：2026-07-16
>
> 上位基线：[学习辅助 2.0 设计基线](Learning_Assistance_2_0_Design_Baseline.md)、[学习辅助 2.0 产品定义 LA-D0](Learning_Assistance_2_0_Product_Definition.md)
>
> 复用接缝：`services/learning/planning/graphPlanningSignalProvider.js`、`services/learning/scheduling/schedulerPort.js`、`services/generation/japaneseFurigana.js`（Kuroshiro/Kuromoji）、`study_items` / `learning_review_events` / `learning_schedule_states`
>
> 阶段状态：KG-D1 桌面原型已于 2026-07-16 确认；下一门禁为 KG-D2 领域与数据 ADR
>
> 边界声明：本文是 CLAUDE.md 所指“任何未来知识图谱工作从 KG-D0 起”的起点，**不复活**已退役的 Knowledge Hub、Knowledge OPS、旧知识分析/taxonomy/synonym/grammar-link/relation/issue-audit 域、旧 API、旧 schema 与旧页面。

---

## 0. 文档定位与权威边界

本文回答一个被重新框定的产品问题：

> 学习者“重复查找同一个表达”和“查找相关词形”这两个现象，应该如何被系统当作**检索困难信号**与**知识关联**处理，而不是只当作生成任务的重复输入。

权威关系固定为：

1. **学习辅助 2.0 拥有学习状态。** Study Item、计划、今日队列、四档评分、FSRS 调度状态、复习闭环与学习历史全部归 LA 2.0（[LA-D0](Learning_Assistance_2_0_Product_Definition.md) / LA-D2 ADR）。本文定义的一切不得拥有或直接改写这些状态。
2. **知识图谱只拥有知识组织、交互事实与可选信号。** 图能力是可降级的 planning signal provider 与知识关联，不是调度依赖。缺失、为空、超时或失败时，学习闭环必须与当前行为一致。
3. **正式调度单位仍是 Study Item。** Knowledge Point（KP）是跨卡片、跨词形的组织、查询与只读聚合单位，不替代 Study Item，也不接管评分和 FSRS。
4. **本文只到 D0 产品定义层。** 用户任务、身份口径、交互事件语义和 LA 协作边界在此定稿；实体、DDL、迁移、打分参数及删除策略留给 KG-D2 ADR。
5. **不复活退役子系统。** 旧 Knowledge 文档只作历史记录（见 [Docs/README.md](../README.md) 退役清单）；本文不引用其 schema、路由或页面。

本文不负责卡片生成质量、TTS、Cards Factory UI 或去重 API 的最终实现。现有精确重复准入继续承担防止重复生成和重复落库的技术职责；KG 2.0 在其旁边建立学习语义，不替换该职责。

---

## 1. 产品结论：把“重复”拆成准入控制、检索信号与知识关联

当前系统对生成输入实施**精确串去重**：`normalizeTagValue(phrase)`（NFKC + 去空格 + 小写，[rules.js](../../services/dataPreparation/rules.js)）与相同 `card_type` 一起判断重复，默认 `reject`，允许显式 `create-version`（[generationJobs.js](../../routes/generationJobs.js)、[cardAdmission.js](../../services/application/cardAdmission.js)）。这项机制仍有价值，但它只回答“是否再次生成”。

学习产品还需要回答另外两个问题：

- **重复显式查找是检索困难信号。** 用户再次主动查找“ありがとう”，说明该表达值得被提醒或加入学习，但这不是一次正式评分，也不能直接推出“未掌握”。
- **相关词形是有类型的知识关联。** `食べる / 食べた / 食べて / 食べます` 是同一词汇知识点的不同表面形式；系统应说明关系，而不是把四个字符串简单当成同义重复。

因此，核心口径修订为：

> **Study Item 是正式学习与调度单位；Knowledge Point 是跨内容组织、查询和只读聚合单位；卡片、词形和 Study Item 是知识点的出现证据。**

v1 的产品承诺是：

1. 用户执行一次**显式知识查找**后，系统能说明该知识点此前是否出现、主动查找过几次、与哪些已学词形相关。
2. 若关联 Study Item 已进入当天基础队列，KG 信号只可在 LA 允许的同 `priority bucket + available_at + due_at` 范围内提供可解释细排，不改变基础集合或到期顺序。
3. 若关联 Study Item 未进入基础队列，系统不得自动拉回；应显示“加入本次学习”操作，由用户显式创建一次性学习意图。该能力属于 LA 与 KG 的协同契约，必须在 KG-D2 中正式增补 LA-D2 后才能实现。
4. 全程不把 lookup 伪装成 rating，不直接修改 FSRS 的 stability、difficulty 或 due time。

---

## 2. 用户任务与场景（v1）

### T1：重复显式查找同一表达

学习者在独立的“查找知识点”操作中第 3 次查找“ありがとうございます”。系统回显：

- 此前主动查找 2 次，最近一次为 07-14；
- 相关卡片和 Study Item 的当前状态；
- 若项目已在今日基础队列中，显示“近期重复查找”的排序解释；
- 若项目不在今日基础队列中，显示“加入本次学习”，但不自动改变到期日或队列。

搜索框输入联想、普通页面浏览和答案揭示均不算这类 lookup。

### T2：查找相关词形

学习者显式查找“食べた”。系统以受支持的日语规则识别其词汇核心为“食べる”，回显“这是『食べる』的过去形式；你已在以下卡片或 Study Item 中见过它”。无法确定词汇核心或存在歧义时，系统必须显示“待确认”，不得强行合并。

### T3：在知识点层查看学习证据

学习者查看“食べる”时，系统分开显示：

- **正式复习证据**：关联 Study Item 的状态、最近评分与调度摘要；
- **检索困难证据**：显式 lookup 次数与最近时间；
- **内容证据**：出现过的卡片、教材表达、场景表达和表面词形。

系统可以由这些只读证据生成“近期需要关注”等风险提示，但不得把 lookup 次数直接改写为“未掌握”，也不得把多个 Study Item 的 FSRS 状态折叠成一个新的可写调度状态。

v1 非目标：跨语言语义合并（谢谢 ↔ ありがとう）、全图浏览页、自动合并卡片、自动把未到期项拉回队列、任何由 KG 直接写入 FSRS 状态的行为。

---

## 3. 核心概念与术语

| 术语 | 定义 | 与现有对象的关系 |
|---|---|---|
| **知识点 Knowledge Point (KP)** | 可被跨内容识别和组织的知识单位；`kp_kind` 为 `lexeme / phrase / grammar_pattern`。 | 新的高阶节点，不替代 Study Item。 |
| **词汇知识点 Lexeme KP** | 一个语言中的词汇规范形；可有多个活用或书写形式。 | v1 日语可确定性物化；英语 v1 只做规范字符串。 |
| **短语知识点 Phrase KP** | 一个稳定的多词表达或完整主表达。 | v1 只按规范化原文建立，不自动合并释义相近短语。 |
| **语法知识点 Grammar Pattern KP** | 有稳定结构键的语法模式。 | v1 仅接受语法卡结构化主语法点；无可靠结构时标为 unresolved。 |
| **出现证据 Evidence** | KP 在系统中的一次具体出现，例如卡片、教材表达、场景表达或 Study Item。 | 指向既有 `generations` / `study_items` 或教材表达。 |
| **词形 Surface Form** | Lexeme KP 在文本中的实际书写形态，例如活用形或敬体。 | 附着到 Lexeme KP；不是默认独立 KP。 |
| **显式 lookup 事件** | 用户明确提交“查找知识点”或确认重复生成提示的一次行为事实。 | 新 append-only 事实；不包含 typeahead、浏览或答案揭示。 |
| **关系/附着 Typed Link** | Surface Form、Evidence 与 KP 之间的有类型连接。 | v1 只做确定性 `inflection-of / polite-of / evidence-of`。 |
| **知识点视图 KP Read Model** | 汇总正式复习证据、检索困难证据和内容证据的只读视图。 | 不写 `learning_schedule_states`。 |

---

## 4. 知识点身份模型

### 4.1 为什么不能用一个 lemma 字符串承担全部身份

- **同音异义与纯假名歧义**：`箸 / 橋` 读音相同，`はし` 作为纯假名输入还可能指向箸、橋或端。读音不能完成义项消歧；无法确定时必须保持 unresolved。
- **多义词**：`かける` 有多个义项。相同规范形可以先形成粗粒度候选，但结构必须支持后续拆分，不能把初次合并当成不可逆事实。
- **知识类型不同**：词汇、短语与语法模式的规范化和关系规则不同，不能共用一个无类型字符串键。
- **跨语言不是身份**：v1 的英语、日语、中文 KP 分开存在；双语/三语对应只作为内容证据中的对齐信息，未来是否升格为关系另行决策。

### 4.2 v1 分层身份键

```text
knowledge_point_key = (
  kp_kind,
  language,
  canonical_form,
  sense_discriminator
)
```

- **kp_kind**：`lexeme | phrase | grammar_pattern`。
- **language**：`ja | en | zh`。v1 每种语言独立建 KP。
- **canonical_form**：随 `kp_kind` 变化：
  - 日语 `lexeme`：以内容词 token 的 `basic_form` 为词汇规范形；再对该 `basic_form` 重新分析，取得 **lemma reading**。不得直接使用原输入 token 的 `reading` 作为 lemma reading。
  - 日语多 token 活用：例如 `食べた / 食べて / 食べます`，以内容词的 `basic_form=食べる` 建 Lexeme KP；助动词/接续 token 只用于推导表面形式关系。
  - 日语纯假名或多候选输入：无法唯一锚定规范词汇时标为 `unresolved`，不创建强附着。
  - 英语 `lexeme/phrase`：v1 仅使用 NFKC、大小写与空白规范化后的字符串，明确称为 **normalized form**，不声称已经完成 lemmatization。
  - 中文 `lexeme/phrase`：使用 NFKC 与空白规范化后的词条或短语。
  - `grammar_pattern`：只使用生成/教材结构中已有的稳定语法模式键；没有稳定来源时不自动物化。
- **sense_discriminator**：v1 默认空，但身份与附着设计必须支持后续拆分、重定向和证据重新归属。已知歧义或置信度不足时宁可 unresolved，不做强合并。

> **保守原则**：只自动合并确定性足够高的规范形；粗粒度结果必须可逆。读音只是身份特征之一，不能单独区分 `箸 / 橋` 这类同音词。

### 4.3 KP 与 `study_items.unit_key` 的关系

`study_items` 已按 `(source_generation_id, unit_key)` 唯一（[schema.sql](../../database/schema.sql)），并覆盖三语、语法、场景、整卡和教材单元。职责固定为：

- `unit_key` 保持不变，仍是卡片内正式学习单元的稳定键，归 LA 2.0。
- KP 是跨 Study Item 的组织与查询节点。一个 KP 可以附着多个 Study Item；一个 Study Item 也可以包含多个 KP。
- v1 只建立可解释的主表达强附着，不对句中每个 token 自动扩图：
  - `trilingual_en/ja`：分别附着对应目标语言的主 Lexeme/Phrase KP；
  - `grammar_ja`：优先附着一个 Grammar Pattern KP；结构不足时 unresolved；
  - `scenario_bilingual`：分别附着 EN 与 JA Phrase KP，共享场景 Evidence，但不合并为跨语言身份；
  - `textbook_en/ja`：分别附着 EN 与 JA Phrase KP，共享教材表达 Evidence。
- 其它词汇只能作为候选或弱证据，v1 不自动强附着。

### 4.4 KG-D2 必须闭合的身份约束

- unresolved 的保存、人工确认与后续重跑语义；
- 粗粒度 KP 拆分、重定向和 Evidence 重归属的可逆迁移；
- 日语 token-sequence 规则及 fixture 覆盖；
- Study Item / 教材表达 / 场景表达与 KP 的强附着唯一性及版本策略。

---

## 5. 显式 lookup 信号契约

### 5.1 哪些行为是 lookup，哪些不是

事件语义必须先于表设计固定：

| 行为 | 事件语义 | 是否计入 lookup / planning signal |
|---|---|---|
| 用户提交“查找知识点”，并打开一个明确结果 | `explicit_lookup` | **是** |
| 用户提交生成，但命中精确重复并选择查看已有知识点 | `duplicate_generation_attempt` | **是**，需关联到既有 KP |
| 首次成功生成、导入教材或首次看到内容 | `content_discovery` | 否；它是内容出现证据，不代表检索困难 |
| 搜索框逐字输入/typeahead 请求 | 只读查询 | 否；不得逐键写事件 |
| 打开卡片、教材或 KP 页面 | 只读浏览 | 否 |
| 复习中揭示答案 | LA 会话动作 | 否；每次复习都会发生，不能当负向信号 |
| 四档评分 | `learning_review_events` | 归 LA，不复制为 KG lookup |

新增 append-only 交互事实时应对齐 `learning_review_events` 的既有约定：

- 具有唯一幂等键，同一次请求重放不重复计数；
- 保存 `knowledge_point_id`、实际 `surface_form`、`interaction_kind`、`occurred_at_utc`、`learning_day`、`time_zone`、可选来源对象；
- append-only，只增不改；
- “此前查过 N 次”只统计 `explicit_lookup` 和可确认的 `duplicate_generation_attempt`，不统计 discovery/reveal/typeahead。

### 5.2 已在基础队列中的项目：provider 只做受限细排

既有 `buildQueueCandidates()` 先过滤未到期项目、截取每日新单元，再调用 provider；最终排序依次为 `bucket → available_at → due_at → provider_score → study_item_id`（[learningService.js](../../services/learning/application/learningService.js)）。因此 KG 信号的真实能力边界是：

```text
显式 lookup 事实
  -> KG 只读 signalReader.readPlanningSignal(studyItem, context)
  -> GraphPlanningSignalProvider.evaluate()
  -> CompositePlanningSignalProvider
  -> 仅对已选入基础队列、且 bucket/available_at/due_at 相同的条目细排
  -> provider_score + explanation_json
```

现有代码已提供以下护栏：

- `signalReader` 为空时 Graph provider 返回 `null`，天然降级；
- provider 必须同步、无副作用；异步结果被判失败；
- 单 provider 默认预算 10ms，超时跳过；
- score 被夹在 ±100，reasons/evidence 只用于解释；
- provider 不得扩大基础集合、跨越到期顺序或替换每日新单元；
- FSRS 仍只通过 `SchedulerPort.schedule()` 接收正式评分。

因此，本文不再使用“lookup 让未到期项目更早回到复习”这类超出契约的表述。

### 5.3 不在基础队列中的项目：显式“加入本次学习”

当关联 Study Item 未到期、超出每日新单元截取范围或因其它 LA 规则未进入基础队列时：

1. KG 只展示状态和 lookup 历史，不自动插入队列；
2. 用户可显式选择“加入本次学习”；
3. 该动作只能创建一次性的、幂等的 LA 学习意图，不得修改原 `due_at`、stability 或 difficulty；
4. 真正开始学习并提交四档评分后，才由 LA 的正常 review event + SchedulerPort 更新调度；
5. 手动项目与到期项的顺序、是否占用每日目标/新单元上限、会话恢复语义必须在 KG-D2 中作为 **LA-D2 协同增补**明确，不能由 Graph provider 私自实现。

在该增补通过前，KG-P 只能交付 lookup 记录、关系回显和基础队列内解释，不得实现自动或手动插队。

### 5.4 隐性 lapse

v1 **不实现隐性 lapse**。显式 lookup 是检索困难证据，不是正式失败评分。若未来评估该能力，必须另行修改 LA 产品与领域 ADR，并要求用户可理解、可追溯；KG 仍不得直接更新 `learning_schedule_states`。

### 5.5 只读保证

页面加载、typeahead、打开搜索结果列表、查看关系、查看掌握证据和答案揭示均不得产生 KG lookup 事件。只有用户提交明确的知识查找或确认重复生成结果时才写入事件。

---

## 6. 日语规范化与确定性关系

### 6.1 抽取能力与限制

[japaneseFurigana.js](../../services/generation/japaneseFurigana.js) 当前只封装 `toRuby()`，内部已初始化 `Kuroshiro + KuromojiAnalyzer`。KG-P 可以在同一分析器边界旁新增 token 分析能力，但不得改坏现有 ruby 输出。

Kuromoji 对活用表达通常返回“内容词 + 助动词/接续词”的 token 序列。例如：

| 输入 | 内容词 token 的 `basic_form` | 原 token `reading` 的含义 | v1 处理 |
|---|---|---|---|
| `食べる` | `食べる` | 当前表面 token 读音 | 重新分析 `食べる` 取得 lemma reading |
| `食べた` | `食べる`（来自 `食べ`） | `食べ` 的读音，不含 `た` | 结合后续 `た` token 推导过去形式 |
| `食べて` | `食べる`（来自 `食べ`） | `食べ` 的读音，不含 `て` | 结合后续 `て` token 推导て形 |
| `食べます` | `食べる`（来自 `食べ`） | `食べ` 的读音，不含 `ます` | 结合后续 `ます` token 推导敬体 |

因此实现必须：

1. 先分析完整输入并定位主内容词；
2. 使用内容词 `basic_form` 作为 lemma spelling；
3. 重新分析 `basic_form` 获取 lemma reading；
4. 使用受测试保护的 token-sequence 规则识别过去、て形和敬体；
5. 多候选、未知词、纯假名歧义或规则未覆盖时返回 unresolved，而不是猜测。

### 6.2 v1 只交付三类确定性 Typed Link

| 类型 | 方向 | 语义 | 来源 |
|---|---|---|---|
| `inflection-of` | Surface Form → Lexeme KP | 受支持的活用形式属于某辞书形 | Kuromoji token sequence + fixture |
| `polite-of` | Surface Form → Lexeme KP | 受支持的敬体形式属于某辞书形 | Kuromoji token sequence + fixture |
| `evidence-of` | Evidence → KP | 某卡片、教材表达、场景表达或 Study Item 是该 KP 的出现证据 | 既有内容结构 |

以下概念不作为 v1 关系边：

- `same-lemma`：多个 Surface Form 附着同一个 Lexeme KP 已表达该事实，不重复建边；
- `appears-in-scenario`：这是 Evidence 的 `context_kind/context_ref` 元数据，不是 KP ↔ KP 关系；
- `pos-variant`：Kuromoji 仅凭词性/活用不能可靠证明派生关系，延后到有词典或人工证据时；
- `synonym`、`cross-language-equiv`：需要词典、人工对齐或 LLM，均不在 v1 自动生成。

### 6.3 知识点层只读聚合

KP Read Model 分开计算并展示：

- **正式学习摘要**：关联 Study Item 的状态、最近评分、reps/lapses 与到期摘要；
- **检索困难摘要**：显式 lookup 次数、最近 lookup、重复生成尝试；
- **内容覆盖摘要**：关联 Evidence、Surface Form、卡型和来源。

Graph signalReader 可以基于检索困难摘要输出有界 planning score，但不得把三个维度压成新的可写“KP 调度状态”。产品 UI 也必须保留来源解释，不能把“查过 3 次”直接显示成“未掌握”。

---

## 7. 与 LA、去重和 FSRS 的边界

1. **KG 不拥有正式学习状态。** Study Item 仍是揭示、评分和 FSRS 调度单位；KP 只做组织、查询和只读聚合。
2. **Graph provider 不能改变集合。** 它仅对现有基础队列中 `bucket/available_at/due_at` 相同的条目细排；未入队项目只能通过待增补的显式 LA 操作加入。
3. **FSRS 保持纯净。** lookup 不映射为 Rating，不写 `learning_review_events`，不直接更新 Schedule State。
4. **精确去重继续有效。** 生成路径仍可返回 409 或显式创建版本。未来命中重复时可附带既有 KP、lookup 历史和“查看已有知识点”操作，但不得为了记信号再次生成相同卡片。
5. **事件语义不混用。** discovery、typeahead、页面浏览和答案 reveal 不是检索困难，不得进入 lookup 计数或 Graph score。
6. **不复活退役域。** 不引入旧 relation/synonym/grammar-link 表或旧 Knowledge API。

---

## 8. v1 范围与非目标

**v1 交付：**

- `lexeme / phrase / grammar_pattern` 三类 KP 身份口径及 unresolved 路径；
- 日语 Lexeme KP 的 basic-form + lemma-reading 规范化和 token-sequence fixtures；
- append-only `explicit_lookup / duplicate_generation_attempt` 事件语义与幂等；
- T1/T2/T3 查询回显；
- `inflection-of / polite-of / evidence-of` 三类确定性 link；
- KP Read Model，将正式学习、检索困难和内容覆盖分开呈现；
- lookup 信号经 Graph provider 对基础队列做受限、可解释细排；
- “加入本次学习”的桌面交互与 LA 协同契约，经 LA-D2 增补后实现。

**明确非目标：**

- 自动把未到期或未选中的 Study Item 拉入基础队列；
- 隐性 lapse；
- 跨语言身份合并或自动 `cross-language-equiv`；
- 自动 synonym、pos-variant 或义项级精确消歧；
- 图谱浏览/可视化页面；
- 自动合并或改写卡片内容；
- 任何 KG 直接写入 `learning_schedule_states` 或修改 FSRS 的行为；
- 复活 Knowledge Hub / OPS / 旧知识分析域。

---

## 9. 成功指标

- **身份正确**：受支持的 `食べる / 食べた / 食べて / 食べます` 归到同一 Lexeme KP；`箸 / 橋` 不因相同读音被合并；歧义 `はし` 进入 unresolved。
- **事件纯净**：typeahead、页面浏览、答案揭示和首次内容出现不会增加 lookup 次数；幂等重放不会重复计数。
- **基础集合不变**：启用 Graph provider 前后，今日基础队列 Study Item 集合完全一致；只允许同 `bucket/available_at/due_at` 项之间出现可解释细排。
- **显式恢复**：未进入基础队列的项目只在用户选择“加入本次学习”后进入一次性学习流程，且加入动作本身不改变 FSRS 状态。
- **证据可解释**：KP 页面分别显示正式学习、检索困难和内容覆盖，不用单一模糊分数掩盖来源。
- **零调度污染**：lookup 与关系抽取不创建伪 `learning_review_events`，不直接改变 stability、difficulty 或 due time。
- **降级正确**：关闭 KG reader 或发生 empty/failed/timedOut 时，LA 队列和复习闭环维持现有确定性行为。

---

## 10. 交付物与后续阶段

- **KG-D1 桌面原型（已确认，2026-07-16）**：12 个桌面状态已覆盖显式查找、重复查找回显、相关词形、unresolved、KP 三类证据、基础队列内解释、Graph reader 降级，以及队列外“加入本次学习”的确认与结果；原型明确 typeahead/reveal 不写 lookup。
- **KG-D2 领域与数据 ADR**：定稿 KP/Surface Form/Evidence/Typed Link/lookup 事件的 schema；定义可逆拆分和 unresolved；固定 token-sequence fixtures；实现只读 signalReader；并以正式增补条款定义“加入本次学习”的 LA 所有权、幂等、容量、队列优先级、恢复和评分语义。
- **KG-P0 识别 POC**：先验证日语 basic-form 重分析、lemma reading、token sequence、纯假名歧义和三种 link；不接运行时队列。
- **KG-P1 事实与读模型**：新增 append-only lookup、Evidence/Link 与 KP Read Model；默认只读回显。
- **KG-P2 可选 planning 信号**：接入 Graph signalReader，验证基础集合不变和确定性降级。
- **KG-P3 显式加入学习**：仅在 LA-D2 协同增补实现并验收后接入。

---

## 11. 推荐决策（2026-07-16 已确认）

1. **义项粒度**：v1 接受可逆的粗粒度 KP，但只有高置信度身份可强附着；歧义项进入 unresolved，不强行合并。
2. **跨语言**：v1 每语言独立建 KP；跨语言对应不属于身份，自动关系继续延后。
3. **隐性 lapse**：v1 关闭，不把 lookup 伪装为失败评分。
4. **lookup 入口**：新增明确的“查找知识点”动作/API；typeahead、浏览和答案 reveal 都是只读，不算 lookup。
5. **附着范围**：v1 只强附着主表达；scenario/textbook 的 EN 与 JA 分别附着 Phrase KP，并共享上下文 Evidence。
6. **英语规范化**：v1 使用 normalized string，不引入 lemmatizer，也不把它称作 lemma。
7. **文档索引**：本文在复审确认前保持未跟踪修订稿；确认后再登记 [Docs/README.md](../README.md)，并将“知识图谱继续后置”更新为“KG-D0 已确认，后续按门禁推进”。

---

## 12. KG-D0 门禁

- [x] 与 LA-D0 的基础队列集合、排序键和 provider 降级边界一致
- [x] Study Item 与 KP 的职责不冲突
- [x] lookup、discovery、typeahead、reveal 和 rating 的事件语义已分离
- [x] 日语 identity 使用 basic form + lemma reading，且歧义进入 unresolved
- [x] v1 Typed Link 限定为可确定性验证的三类
- [x] 未入基础队列的项目不由 provider 自动拉回
- [x] 用户确认 §11 的 7 条推荐决策
- [x] 用户确认本文作为 KG-D0 正式基线并进入 KG-D1
- [x] 用户逐页确认 KG-D1 桌面端 12 状态原型

2026-07-16，KG-D0 生效为正式基线，KG-D1 桌面端 12 状态原型确认完成。下一阶段为 KG-D2 领域与数据 ADR；在 KG-D2 接受前不启动 KG-P0。
