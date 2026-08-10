# 日语语言学元数据的 LLM 生成方案（JLM-D0）

> 状态：**Draft · §11 决策已于 2026-08-10 全部确认，JLM-P0 进行中；仍不代表当前运行基线**
>
> 日期：2026-08-10（第二轮修订、决策确认同日）
>
> 产品范围：在卡片正文成功生成后，异步提取日语外来语来源，并为后续动词词性、
> 辞书形提案预留同一套受控元数据流程；消费端为 CardModal 注音浮层与选区工具条。
>
> 上位约束：
> [日语按需注音浮层与 Ruby 退役设计](Japanese_Pronunciation_Overlay_and_Ruby_Retirement_Design.md)、
> [统一选区与本地中文释义](Unified_Selection_and_Local_Chinese_Glossary.md)、
> 根 `CLAUDE.md` 的 Markdown-first、历史正文不原地改写、`content_hash` 可追溯与领域所有权边界。
>
> 文档角色：本文评估“把日语词性、辞书形与片假名外语来源交给 LLM 提案”的产品和
> 架构方向。本文在 Accepted 前**不授权修改 prompt、schema、`content_hash` 或现有注音数据**。

## 0. 决策摘要

1. **主卡生成保持现状**：DeepSeek 继续只负责生成并返回 Markdown；现有正文生成、校验、
   入库和 `content_hash` 计算链路不与语言学元数据绑在一起。
2. **元数据是第二阶段**：卡片正文成功入库后，再用一次独立、可重试、可失败的 LLM 请求
   提取结构化元数据。元数据失败不得回滚卡片，也不得阻塞卡片使用。
3. **LLM 结果默认只是 proposal**：未经人工确认不得作为权威事实展示。UI 必须区分
   “AI 候选”“人工确认”“精选词典”和“待确认”。
4. **外来语来源先做**：方案 A 先进入 shadow 和人工确认流程；动词词性与辞书形方案 B
   等 A 稳定后再做；读音方案 C 不进入自动接受链路。
5. **旁路元数据不进入 Markdown，也不进入 `generations.content_hash`**；历史 generation
   的 Markdown 和 hash 永远不原地改写。
6. **现有 pronunciation token 不是 proposal 容器**：读音来源、外来语来源、词性提案是
   不同领域事实，不能共用 `pronunciation_tokens.source` 表达。

---

## 1. 现状核实（2026-08-10 实测）

### 1.1 片假名外语来源：当前样本覆盖不足

悬停显示的 curated 外语来源来自
`services/pronunciation/dictionaries/ja-pronunciation-v2.json`：

- 词典共 11 条；
- 其中 6 条带 `foreignOrigin`；
- 当前正式数据卷只有 11 张 generation 已持久化 pronunciation document；
- 这 11 张卡中有 48 条片假名 token，去重后为 26 个 surface；
- 26 个 surface 中 4 个能由当前 curated 词典显示外语来源，22 个显示“待确认”。

全库基数（同日实测）：

| 项 | 数量 |
|---|---|
| generations 总数 | 685 |
| 含日语区的卡 | 683 |
| 正文已含 `loanword-block` 的卡 | 443 |
| **已持久化 pronunciation document 的卡** | **11（占含日语卡的 1.6%）** |

因此 **4/26（15%）和 22/26（85%）只是当前 11 张新卡 pronunciation projection 的小样本
基线，不代表全部卡片库**。该样本仅覆盖含日语卡片的 1.6%，不能外推成全库准确覆盖率。

pronunciation document 是按需惰性生成的，这同时意味着：方案 A 的实际可见收益受限于
projection 的生成覆盖，而不仅取决于 LLM 提取质量。验收时必须区分“proposal 已产出”与
“用户实际能看到”。

未覆盖样本包括 プロジェクト、フィードバック、セキュリティ、インターフェース、ログイン、
カレンダー、アカウント 等常用词。这个小样本已经足以证明 curated 词典需要可扩展的候选来源，
但不足以证明 LLM 能把可靠覆盖率直接提高到接近 100%。

### 1.2 LLM 输出存在可复现的不稳定

1042 与 1043 均在同一版 prompt（约定“外来语标注：英文 = 片假名”）下生成：

| 卡片 | 生成时间（UTC） | 实际输出 | 是否符合约定 |
|---|---|---|---|
| 1042 | 2026-08-07 06:04 | `schedule -> スケジュール` | 是 |
| 1043 | 2026-08-10 05:30 | `数据 -> データ` | 否（给了中文，未给英文） |
| 1044 | 2026-08-10 06:12 | `机械 · machine · マシン` | 是（新版 prompt） |

新版 prompt（“中文 = English = 片假名”，提交于 06:09 UTC）目前只有 1044 一张卡验证过，
样本量为 1，不足以证明稳定。

结论：LLM 能提供有价值的候选，但输出形态和内容均不可直接当作 accepted 事实。

### 1.3 当前真实链路

当前卡片生成只有一条主 LLM 调用：

```text
输入短语
  -> DeepSeek generateMarkdown
  -> Markdown 合同校验
  -> TTS / 文件发布 / admission
  -> generations 入库并计算 content_hash
  -> 独立生成 pronunciation document/tokens
```

当前 DeepSeek 不可用时，卡片正文也无法生成。因此后文所说的“降级不失败”只指：
**卡片正文已经成功后，语言学元数据提取、校验或持久化失败，不得使主卡生成失败**。

### 1.4 `content_hash` 的准确语义

- `study_items` 的稳定身份是 `(source_generation_id, unit_key)`，不是 `content_hash`；
- `content_hash` 是正文版本快照，被 admission、study item 内容版本、复习事件和其它投影引用；
- 数据库只强制它是 64 位 SHA-256，并没有提供“允许任意原地改正文”的语义；
- 普通历史 generation 必须遵守产品约束：**不原地改写正文，应使用旁路数据或正式修订流程**。

因此，1043 的原始 Markdown 不做原地修正；未来可以通过经确认的旁路元数据覆盖 UI 展示，
但原始生成事实仍保留。

### 1.5 pronunciation 现有能力与缺口

当前 `pronunciation_tokens.evidence_json` 能携带 curated `foreignOrigin`，但它不是完整的
元数据提案系统：

- `documentHash()` 不包含 `evidence_json`，元数据单独变化不会自然形成可审计 revision；
- 现有 correction event 只处理读音、边界、resolve/reject、split/merge；
- `pronunciation_tokens.source` 描述读音从词典、分析器或人工而来，不能同时表示外来语来源的
  提案状态；
- 当前 UI 看到 `foreignOrigin` 就会直接展示，没有 pending/accepted/rejected 的区别。

所以方案 A 需要独立 proposal 合同，不能只是把 LLM 结果直接塞进 `evidence_json`。

---

## 2. 总体架构：主生成与元数据提取解耦

```text
主流程（现有，保持可独立成功）
  DeepSeek Markdown -> 校验 -> 入库 -> content_hash -> 卡片可用
                                      |
                                      v
元数据流程（新增，best effort）
  建立 extraction job -> 读取已持久化日语正文
  -> LLM JSON 提取 -> 服务器校验与定位
  -> proposal 入库 -> UI 待确认
  -> 人工接受/拒绝 -> accepted projection
```

### 2.1 为什么不用同一次 LLM 响应

如果把 Markdown 和元数据放进同一个 JSON envelope：

- envelope 解析失败会同时丢失正文和元数据；
- 元数据字段不合规可能迫使一张本来合格的卡失败；
- 切换输出合同会放大现有生成链路的回归面；
- 无法诚实兑现“元数据失败不影响主卡”。

因此 v1 明确采用第二次 best-effort 调用。增加的 token 和延迟必须在 P0 实测，不预先宣称
“增量成本很低”。异步任务完成前，卡片仍使用 curated 词典和“待确认”状态。

### 2.2 提取输入

元数据提取器只接收：

- `generation_id`；
- `source_content_hash`；
- 从已校验 Markdown 中确定性抽出的日语正文片段；
- 卡型、片段序号和必要的局部上下文；
- metadata prompt version。

不把英文区、中文解释、HTML 控件或完整 observability 数据发给第二次请求。

### 2.3 LLM 输出合同

方案 A 的建议输出形状：

```json
{
  "schema_version": "jlm-foreign-origin-v1",
  "items": [
    {
      "segment_index": 1,
      "surface": "スケジュール",
      "occurrence": 1,
      "origin_term": "schedule",
      "origin_language": "en",
      "confidence": "medium"
    }
  ]
}
```

LLM 不负责提供可信 offset。服务器必须使用 `segment_index + surface + occurrence` 在原始日语
片段中重新定位，并拒绝以下输出：

- surface 不存在或 occurrence 越界；
- surface 不是完整片假名候选；
- origin term 为空、包含不可接受标记或长度超限；
- language/confidence 不在白名单；
- 同一位置出现互相冲突的候选。

服务器计算并持久化最终 `start_codepoint/end_codepoint`。后续 proposal 必须同时绑定
`source_content_hash`，正文变更后旧 proposal 自动视为 stale，不允许跨版本复用。

---

## 3. 方案 A：片假名外语来源 proposal（优先实施）

### 3.1 状态和优先级

外来语来源必须拥有独立状态：

- `pending`：LLM 候选，尚未确认；
- `accepted`：人工接受；
- `rejected`：人工拒绝；
- `stale`：绑定的 `source_content_hash` 已不是当前正文版本。

消费优先级：

```text
人工修正/确认 > curated 词典 > accepted LLM proposal > pending LLM proposal > 待确认
```

`pending` 不得伪装成权威来源。Tooltip/Popover 可显示“AI 候选：schedule”，并提供接受、修改、
拒绝入口；只有 accepted 或 curated 内容才能使用普通的“英语来源”标签。

**curated 条目的纠错入口**：优先级链最上层是“人工修正/确认”，因此该层必须真实存在，否则
curated 之上是空的、一条错误的 curated 条目将永远无法被覆盖。v1 要求：

- 对任何已显示的外语来源（含 curated），UI 都提供“来源不对”入口，与本地词典的
  “释义不合适”保持一致的交互范式；
- 人工修正写入 `metadata_kind = 'foreign-origin'` 的 accepted 记录，并在优先级上高于 curated；
- 不原地修改 `ja-pronunciation-v2.json`：curated 是随代码发布的只读种子，运行期纠正一律走
  proposal/裁决事实，保证可审计、可回滚；
- 若某 surface 同时存在人工修正与 curated，读取端必须稳定选择人工修正，并在证据中保留两者。

### 3.2 逻辑数据合同

JLM-D2 再决定最终表名和 migration，但至少需要以下字段：

| 字段 | 作用 |
|---|---|
| proposal_key | 幂等键，绑定正文版本、位置、类型和提取版本 |
| target_kind / target_id | generation 等目标 |
| source_content_hash | 防止候选跨正文版本漂移 |
| metadata_kind | v1 为 `foreign-origin` |
| surface / start_codepoint / end_codepoint | 与正文和 pronunciation token 对齐 |
| value_json | origin term、language 等结构化值 |
| confidence | LLM 自报置信度，只作参考 |
| model / prompt_version / response_hash | 可追溯来源 |
| status | pending / accepted / rejected / stale |
| accepted_by / accepted_at_utc | 人工裁决审计 |
| created_at_utc / updated_at_utc | 生命周期 |

失败后尚未形成 proposal 的任务，还需要可重试的 extraction job 状态。任务与 proposal 分离，
避免把 provider 超时伪装成“没有外来语”。

### 3.3 与 pronunciation 的衔接

- proposal 表拥有“候选和裁决事实”；
- pronunciation service 在读取 token 时，按位置和正文 hash 合并 accepted/curated 元数据；
- 不改变 token 的 reading、source、status 和 document hash 语义；
- 元数据裁决不得创建或推进 learning review、FSRS、TTS 或 KG 事件；
- 后续如需把 accepted 结果做成缓存投影，投影必须可从 proposal 事实重建。

### 3.4 覆盖率口径

验收报告必须同时输出：

1. **候选覆盖率**：有合法 pending/accepted proposal 的片假名候选比例；
2. **确认覆盖率**：有 curated 或 accepted 来源的比例；
3. **准确率抽样**：人工抽样判断来源是否正确；
4. **拒绝率**：被人工拒绝的 proposal 比例；
5. **无结果率**：LLM 未返回、返回非法或被定位校验拒绝的比例。

不得用“候选覆盖率接近 100%”代替“可靠覆盖率接近 100%”。

---

## 4. 方案 B：动词词性与辞书形 proposal（A 稳定后再做）

LLM 可以提出 `固まった -> 固まる`、词性为动词等候选，但它不能仅绑定现有 Kuromoji
`token_key`，因为当前 token 可能是 `固まっ|た`。

方案 B 必须：

- 以原始日语片段的 `start_codepoint/end_codepoint` 表达整词范围；
- 与现有 pronunciation token 边界解耦；
- 人工确认前不进入 accepted 显示层；
- 确认后由 UI 使用 union range 展示整词信息，但不偷偷改写读音 token；
- 若未来决定真正 merge pronunciation token，必须走 pronunciation correction 的正式
  merge 事件，不能由 LLM proposal 自动完成。

这类元数据当前不被 `study_items`、FSRS 或队列排序直接引用。学习页面只把 pronunciation
projection 作为答案显示数据消费。因此方案 B 的首期价值是改善 CardModal、教材和复习答案的
语言说明，不宣称会改变调度效果。

---

## 5. 方案 C：读音不进入 LLM 自动接受链路

日语读音具有上下文相关性，人名、专名、数词和多义词并不总能由单一规则得到唯一答案。
因此“不使用 LLM 自动接受读音”的理由不是“读音永远唯一”，而是：

1. Kuromoji、curated 词典和人工纠音可审计、可重放；
2. LLM 读音错误不容易被初学者发现，会直接造成学习错误；
3. 当前 pronunciation 投影已有 unresolved 和人工 correction 流程；
4. 当前 TTS 直接接收日语正文，并不消费 `reading_hiragana`；
5. 学习域只把 pronunciation projection 作为复习答案的**展示数据**消费
   （`services/learning/application/learningService.js` 在 review item view-model 中读取它），
   FSRS 调度、队列排序与评分**不读取** pronunciation token。

结论：v1 继续使用分析器 + curated 词典 + 人工纠音。未来如研究 LLM 读音，只能进入 pending
proposal 和独立评测，不能自动转正。

---

## 6. Markdown 与 `content_hash` 迁移规则

### 6.1 历史卡

- 不修改历史 Markdown；
- 不重算历史 `content_hash`；
- 保留历史外来语标注作为原始生成事实；
- accepted 旁路元数据可在 UI 中优先展示，但不删除原始记录。

### 6.2 新卡分阶段切换

**JLM-A0 Shadow**

- 主 prompt 和 Markdown 输出完全不变；
- 第二阶段提取 proposal，但 UI 默认不展示；
- 用固定 fixture 验证新增元数据流程不会改变同一份 Markdown 字节和 hash。

**JLM-A1 Review**

- UI 显示 AI 候选并允许人工裁决；
- 主 Markdown 仍保持兼容，比较 legacy 标注与 proposal 的一致率。

**JLM-A2 New-card Cutover**

- 只有 A0/A1 门禁通过后，才从新卡 prompt 中删除“外来语标注”正文要求；
- 从该版本起，新卡 Markdown 发生设计内的格式变化，并生成自己的正常 `content_hash`；
- 历史卡不变；旁路元数据始终排除在 generation hash 之外。

**A2 不是一次 prompt 改动，而是一次正文形态变更。** 实测 `loanword-block` 当前有 12 处
消费方，A2 之前必须逐一确认：

| 层 | 文件 | 关注点 |
|---|---|---|
| 生成 | `contentPostProcessor.js`、`markdownParser.js`、`htmlRenderer.js` | 缺块时不得报错或产出空壳 |
| 注解锚点 | `text-projection.mjs`（`card-visible-text-v1` 排除类名）、`annotation-anchor.mjs` | 排除规则须长期兼容两种形态 |
| Card Reader v3 | `cardReaderShadow.mjs`、`cardDocument.mjs`、`CardReaderV3.tsx`、`card-document.ts` | v2/v3 对比口径 |
| 渲染 | `card-render-transforms.mjs` | 新旧形态渲染一致 |

两个必须在 A2 门禁中显式验证的风险：

1. **与 CR-P2 Canary 的对比口径冲突**：Card Reader v3 正处于可见 Canary，其 parity
   comparator **显式排除 `loanword-block`** 后再比对。新卡不再产出该块之后，同一套排除
   规则在新旧卡上的行为将分叉，必须确认 v2/v3 parity 在两种形态下都成立。
2. **长期双形态**：全库 **443 张卡正文已含 `loanword-block`**，且历史卡按 §6.1 永不改写。
   因此排除规则、解析分支和锚点兼容需要**无限期保留**，不能按“切换完成即可清理”规划。

A2 追加退出门禁：

- 上表 12 处消费方在“有块 / 无块”两种正文上均有覆盖测试；
- 新旧两种形态在同一页面共存时，注解锚点与 CR v3 对比口径均不回归；
- 明确记录双形态为长期状态，不排期清理历史正文。

因此验收不再要求“真实 LLM 新输出与实施前逐字节一致”。正确门禁是：

1. A0 固定 provider fixture 下，启用/禁用元数据提取所得 Markdown 字节完全一致；
2. 修改 proposal 状态或值不会改变对应 generation 的 Markdown 和 `content_hash`；
3. A2 之后持久化的 `content_hash` 必须等于实际 Markdown 的 SHA-256。

---

## 7. 失败、重试与幂等

- 主卡失败：维持现有失败语义，不创建元数据任务；
- **主卡成功、extraction job 创建失败**：卡片成功，但此时既没有 proposal 也没有可重试的
  job，元数据会**静默丢失**。这与 §3.2 要防的“把 provider 超时伪装成没有外来语”是同一类
  问题，因此 job 创建失败必须留下可发现的记录（可恢复的待建任务或显式告警），
  并可由后续补偿流程重建；**不得只写日志了事**；
- 主卡成功、元数据 provider 超时：卡片成功，job 标记 retryable；
- JSON 不合规或定位失败：卡片成功，记录 rejection reason，不写伪造 proposal；
- proposal 持久化失败：卡片成功，job 重试；
- 相同 `proposal_key` 重放：幂等，不创建重复候选；
- 相同 key、不同 payload：冲突并进入人工检查，不静默覆盖；
- 重试不得修改 generation Markdown、文件或 `content_hash`。

模型和 prompt 版本必须来自实际运行配置，不在代码或文档合同中写死为某个 DeepSeek 型号。

---

## 8. 明确不在本文范围

- 自动合并 pronunciation token（`固まっ|た -> 固まった`）；
- 纯假名 token 全部可交互及其噪音治理；
- 历史卡片批量补齐外来语来源；
- 修改历史 `content_hash`、学习记录、FSRS 或队列；
- 让 KG、TTS 或学习调度依赖 pending proposal；
- 把候选覆盖率直接解释为学习质量提升。

---

## 9. 建议实施顺序

| 阶段 | 内容 | 退出门禁 |
|---|---|---|
| JLM-P0 | 固定样本、JSON schema、定位算法、第二次调用成本/延迟 POC | **已完成 2026-08-10**，见 [JLM-P0 干跑报告](../TestReports/Language_Metadata_JLM_P0_DryRun_20260810.md)：合同 16/16、单元 24/24、零库写入；实测同输入三次运行候选覆盖率 64%–76%、服务端零拒绝、出现 2/8 次 120s 超时 |
| JLM-D1 | AI 候选、人工确认、冲突和失败状态桌面原型 | **原型已交付 2026-08-10**（[jlm-d1-foreign-origin-review.html](prototypes/jlm-d1-foreign-origin-review.html)，S1–S12）；**退出门禁仍为用户逐状态确认，未确认前不进入 D2** |
| JLM-D2 | job/proposal/accepted 投影、API、幂等与回滚 ADR | 架构门禁确认 |
| JLM-A0 | Shadow 提取，默认不展示 | 主 Markdown 零变化、失败不影响生成 |
| JLM-A1 | CardModal 人工裁决与可见观察 | 准确率、拒绝率和操作体验通过 |
| JLM-A2 | 新卡移除 Markdown 外来语标注 | 新卡冒烟、hash 与历史兼容门禁通过，且 §6.2 表列 12 处消费方在“有块 / 无块”两种正文上均通过、CR v3 parity 不分叉 |
| JLM-B0 | 动词词性与辞书形 range proposal POC | 独立评审后决定是否实施 |

方案 C 不排期。

---

## 10. 方案 A 验收标准

1. 主卡 Markdown 生成、校验、音频和入库路径在 A0 不变；
2. 元数据超时、非法 JSON、定位失败和数据库失败均不回滚已成功卡片；
3. proposal 全部绑定 `source_content_hash`、位置、model、prompt version 和 response hash；
4. pending 内容在 UI 中明确标记“AI 候选”，不得伪装成 curated/accepted；
5. 人工修正 > curated > accepted LLM > pending 的优先级有单元和集成测试，
   且**存在可用的 curated 纠错入口**（§3.1），该入口不修改 `ja-pronunciation-v2.json`；
6. 修改、接受或拒绝元数据不会改变 generation Markdown 与 `content_hash`；
7. A2 前不删除新卡 prompt 中的 legacy 外来语要求；A2 不改历史卡；
8. `npm run test:architecture` 的注音门禁保持通过；
9. 提供候选覆盖率、确认覆盖率、准确率抽样、拒绝率和无结果率；
   覆盖率必须同时报告分母（含日语卡总数与已有 pronunciation projection 的卡数），
   不得用 projection 子集冒充全库；
10. 提供第二次 LLM 调用的 token、延迟、失败率与重试成本报告；
11. feature flag 默认关闭，Shadow 通过后才逐阶段开启；
12. 不向 TTS、KG、FSRS、学习队列或 annotation 写入衍生事件；
13. **extraction job 创建失败留有可发现记录且可补偿重建**，不得静默丢失（§7）；
14. A2 的 12 处 `loanword-block` 消费方在两种正文形态下均有覆盖测试，
    且 CR v3 parity 在新旧卡上不分叉（§6.2）。

---

## 11. 决策（2026-08-10 全部确认）

- [x] 确认主生成与元数据提取采用两次独立调用；
- [x] 确认方案 A 的 LLM 结果默认是 pending proposal；
- [x] 确认 pending 只以“AI 候选”显示，人工确认后才转 accepted；
- [x] 确认元数据使用独立 proposal 合同，不复用 pronunciation token `source`；
- [x] 确认以服务器重新定位的 codepoint range 作为关联依据；
- [x] 确认历史 Markdown/hash 不改写；
- [x] 确认 A2 只对新卡删除 Markdown 外来语标注；
- [x] 确认接受“新旧两种正文形态长期共存”，`loanword-block` 兼容分支不排期清理；
- [x] 确认 curated 条目的纠错走 proposal/裁决事实，不原地改随代码发布的词典文件；
- [x] 确认候选覆盖率与确认覆盖率分开验收；
- [x] 确认方案 B 在 A 稳定后另行进入 POC；
- [x] 确认方案 C 不进入自动接受链路。

---

## 12. 状态

本文为第二轮评审后的修订稿，仍为 **Draft**。在 §11 决策确认和 JLM-P0 完成前，
不修改 prompt、schema、`content_hash` 或任何运行代码。

第二轮评审补入的内容（均为 2026-08-10 实测支撑）：

1. §1.1 补全库分母：685 张 generation / 683 张含日语 / 443 张正文已含 `loanword-block` /
   仅 11 张（1.6%）有 pronunciation projection，并说明 projection 惰性生成会限制可见收益；
2. §3.1 补 curated 纠错入口——原优先级链最上层“人工修正”缺少落地方式，会使错误的 curated
   条目永远无法被覆盖；
3. §5 措辞对齐 §4：学习域确实读取 pronunciation（作为复习答案展示数据），
   只是 FSRS/队列/评分不读，原表述过宽；
4. §6.2 补 A2 的真实影响面：12 处 `loanword-block` 消费方、与 CR-P2 Canary 的 parity
   口径冲突、443 张历史卡导致的长期双形态，以及对应的追加退出门禁；
5. §7 补 extraction job 创建失败分支——原失败矩阵在此处会静默丢数据。
