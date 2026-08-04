# 日语按需注音浮层与 Ruby 退役领域与数据 ADR

> 状态：**Implementation baseline · 2026-08-03**
>
> 适用范围：Cards Factory、教材已发布表达、Review 答案面；仅桌面端。
>
> 关联：
> [PF-D0 产品设计](../Features/Japanese_Pronunciation_Overlay_and_Ruby_Retirement_Design.md)、
> [PF-D1 原型](../Features/prototypes/pf-d1-pronunciation-overlay.html)、
> [Selection TTS 设计](../Features/Selection_TTS_Product_and_Technical_Design.md)、
> [Card Annotation ADR](Card_Annotation_Layer_ADR.md)、
> [LA-D2](../Features/Learning_Assistance_2_0_Design_Baseline.md)。

## 1. 决策摘要

1. 活动正文永远是纯文本 Markdown/HTML，不保存或生成 `<ruby>`、`<rt>`、`<rp>`。
2. 读音是独立投影，不是 generation 正文的替代版本。
3. generation 的 `content_hash`、Study Item、Review Event 和 annotation 不因读音投影改变。
4. pronunciation document 以 `(target_kind, target_id, source_content_hash)` 绑定内容版本；内容
   hash 变化会产生新的投影，不覆盖旧 generation，也不复用旧的 document 身份。
5. pronunciation token 用纯正文 Unicode code point offset；annotation 继续使用自己的
   UTF-16 selector，通过显式 adapter 连接，不把两种单位混为一谈。
6. 读音来源按“教材/人工 > 版本化词典 > 确定性分析 > LLM proposal > unresolved”裁决。
7. LLM 只能异步提出候选，不能直接写 accepted token。
8. Tooltip 只读、不含按钮、不写 KG；Popover 是非模态操作面板，调用已有 TTS/KG/LA/生成卡
   API，不拥有这些领域的状态。
9. 修正是 append-only event；同 event key 同 payload 幂等，不同 payload 冲突，旧 revision
   提交被拒绝。
10. 旧 Ruby 仅作为迁移输入和审计档案；在历史迁移完成前由 legacy reader 保护，最终通过
    `PRONUNCIATION_LEGACY_RUBY_READER_ENABLED=0` 验收后删除生产调用。

## 2. 内容身份与历史迁移

### 2.1 选择：活动投影，不改 generation

不采用原地把 Ruby 删除后再写回 generation 的方案。原因是 generation 的
`content_hash` 已参与 admission、Study Item 内容一致性和 annotation/review 审计。

当前实现使用以下身份：

```text
generation.content_hash                 原始卡片事实
pronunciation_documents.source_hash    该内容版本的读音投影输入
pronunciation_documents.document_hash   token 投影内容
pronunciation_documents.revision        该投影的修正版本
```

同一 target 的内容修订得到新 `source_content_hash`，旧投影仍可审计；同一 source hash 的
重跑若 document hash 相同则幂等，若不同则必须带当前 revision 才能更新投影。任何路径都
不修改 `generations.markdown_content`、`content_hash` 或学习事实。

历史 Ruby 解析顺序是：读原始 generation → 生成 plain projection → 解析 legacy Ruby 为
证据 token → 词典/人工覆盖可确定的整词 → 写 pronunciation document。原 Markdown 保留在
档案中，生产页面不再把它当作活动 DOM 输入。

### 2.2 教材表达

教材 expression 使用 `target_kind=textbook_expression`，source hash 来自已发布 expression
revision 的 `ja_unit_hash`；若旧数据没有该 hash，使用官方日文文本的 SHA-256。教材官方
读音可以标为 `source=textbook`，但仍通过相同 token view-model 展示。Track 未发布或没有
当前 expression revision 时，API 不创建 pronunciation document。

## 3. Schema 与不变量

migration `012_pronunciation_overlay.sql` 与 `database/schema.sql` 同步创建三张表：

### `pronunciation_documents`

- `target_kind`：`generation | textbook_track | textbook_expression`；
- `target_id`：正整数；
- `source_content_hash`：64 位 SHA-256；
- `projection_version`、`analyzer_version`、`dictionary_version`；
- `status`：`ready | partial | stale | archived`；
- `document_hash` 与递增 `revision`；
- `(target_kind, target_id, source_content_hash)` 唯一。

### `pronunciation_tokens`

Token 只保存表层范围、读音、来源和证据：

```text
(document_id, token_key, surface, start_codepoint, end_codepoint,
 reading_raw, reading_hiragana, unit_kind, status, source,
 rule_version, evidence_json, components_json)
```

`source` 和 `status` 使用数据库 CHECK。`components_json` 只是整词内部组成关系，不会在
正文中创建嵌套可点击 span。

### `pronunciation_correction_events`

事件不可 UPDATE/DELETE，携带 event key、payload hash、expected/resulting revision。投影
更新与 token 重写在同一 SQLite transaction 中完成；旧事件不被覆盖。

## 4. Offset 与正文渲染 contract

`plainText` 是去除 Markdown 结构、Ruby 标签和 HTML 标签后的可见正文投影，版本为
`pronunciation-plain-text-v1`。token 的 start/end 是 `Array.from(text)` 得到的 code point
位置，end 为开区间。Emoji、日文假名、汉字都按 code point 计数。

浏览器在 DOMPurify/Markdown 渲染之后，按 token range 把文本节点包成：

```html
<span class="pronunciation-token"
      data-pronunciation-token-id="token:1"
      data-pronunciation-reading="きんむひょう"
      lang="ja">勤務表</span>
```

span 的 `user-select` 必须保持 `text`，不能使用 button。若 annotation 把一个 token 切成
多个 DOM 片段，片段共享 token key；如果 source hash、document hash 或 block projection
不一致，则 fail closed，退回可读纯正文而不是猜一个范围。

## 5. Source 与 accepted 规则

### 5.1 可接受来源

| 来源 | 是否可直接 accepted | 说明 |
|---|---|---|
| 教材官方/用户人工 | 是 | 绑定 revision 与 reviewer/evidence |
| 版本化特例词典 | 是 | 例如 `一人 -> ひとり`、`勤務表 -> きんむひょう` |
| Kuromoji 单 token | 是，除非命中特例 | 保留片假名 raw，写入平假名 normalized |
| 确定性合并规则 | 仅在抽样门禁通过后 | 记录 rule version 和组成 |
| DeepSeek | 否，只有 proposal | 需人工接受后转 manual/dictionary |
| 无法判断 | 否 | `unresolved`，不得伪造确定读音 |

“最长 accepted”只是渲染时的重叠选择，不是发现词语或接受词典的规则。相邻 Ruby、连续
汉字或同为名词都不能单独成为 accepted 依据。

### 5.2 版本与纠音

重新分析时，先读取现有 correction event 和 manual/dictionary 来源；同一 token 的人工
否决不得被 analyzer 重跑复活。纠音后 `revision + 1`，前端刷新 query cache，正文内容
保持不变。

## 6. API contract

### GET `/api/pronunciation`

参数：`targetKind=generation|textbook_expression`、`targetId`。响应包含 `plainText`、
document view-model 和 token 列表。feature flag 关闭返回 404 + `PRONUNCIATION_FEATURE_DISABLED`；
不支持的 target 返回 501；不存在目标返回 404。

### POST `/api/pronunciation/corrections`

请求至少包含 `targetKind`、`targetId`、`tokenKey`、`eventKey`、`eventType`、
`expectedRevision` 和修正 payload。重复 event key 同 payload 返回幂等成功；同 key 不同
payload 返回 `PRONUNCIATION_EVENT_CONFLICT`；revision 过期返回
`PRONUNCIATION_REVISION_STALE`。

`eventType` 的正式取值为 `reading|resolve|reject|boundary|split|merge`。`reading` 请求示例：

```json
{
  "targetKind": "generation",
  "targetId": 850,
  "tokenKey": "token:example",
  "eventKey": "client-generated-idempotency-key",
  "eventType": "reading",
  "expectedRevision": 1,
  "readingRaw": "ひとり",
  "readingHiragana": "ひとり",
  "status": "accepted"
}
```

纠音只接受已持久化 document。未迁移历史卡的 GET 只返回 `persisted=false`、`revision=0`
的内存临时投影，纠音必须返回 `PRONUNCIATION_DOCUMENT_NOT_FOUND`；禁止由读取或纠音请求
隐式创建历史投影。

日志只允许记录 target id、状态、耗时、长度和错误码，不记录完整卡片、选区或读音文本。

### 6.3 中文残留过滤

分析器返回的纯汉字 token 只有在存在 reading、词典命中或人工/教材 accepted 来源时才进入
pronunciation projection。若 surface 只含汉字、Kuromoji 的 `basic_form` 为 `*` 且没有
reading，则按 `pronunciation-quality-v1` 跳过，避免把中文提示残留显示成“读音待确认”。
该规则不修改原 Markdown，不改变 generation、annotation、KG、LA 或 FSRS 数据。

## 7. 前端所有权

- CardModal、TextbookPublishedBrowser、ReviewSessionPage 共享 `PronunciationText`/token
  enhancer 的交互合同；
- CardModal 保留 annotation/selection 的现有所有权；
- Review 只有 reveal 后查询和渲染答案注音，不改变 cue、评分或 FSRS；
- 教材从 expression revision 获取 token，不自行调用分析器；
- TTS 统一使用 Selection TTS 与全局 exclusive audio owner；
- KG 只在 Popover 显式点击“查知识点”时写 lookup；
- LA 只在用户显式选择加入时执行 manual intent；
- Tooltip 和打开 Popover 都不自动创建学习项、查词事件或 review event。

## 8. Feature flags 与回滚

| Flag | 默认 | Compose 验收值 | 作用 |
|---|---:|---:|---|
| `PRONUNCIATION_OVERLAY_ENABLED` | `false` | `true` | 允许读音查询与浮层 |
| `PRONUNCIATION_ACTIONS_ENABLED` | `false` | `true` | 允许纠音等写动作 |
| `PRONUNCIATION_LEGACY_RUBY_READER_ENABLED` | `true` | `true` 直到 PF-P5 | 保护未迁移历史输入 |
| `PRONUNCIATION_LLM_PROPOSAL_ENABLED` | `false` | `false` | 异步 proposal，当前不启用 |

关闭 overlay 后，纯正文、选择、复制、标红、TTS 和学习评分仍可工作。关闭 actions 后，
Popover 仍可显示读音，但纠音写入被安全拒绝。legacy reader 只有在活动命中为零、历史
canary 和 annotation shadow replay 通过后才允许关闭。

## 9. 验收门禁

1. 新生成三语、语法、场景卡 Markdown 与活动 DOM 无 Ruby；
2. `勤務表`、`掲示板`、`一人`、`来月` 有可解释来源；
3. 60 张结构破损卡在人工决策清单中，不自动进入迁移；
4. historical dry-run 两次 hash 一致，apply 默认不执行；
5. annotation、TTS、KG、LA、Study Item 和 Review Event 计数不被读音投影改变；
6. Selection 非空时不打开 Popover，双击 accepted token 能精确选词；
7. feature flag 关闭时正文仍可读，stale/unresolved 不显示伪确定读音；
8. correction event 具备幂等、冲突和 stale revision 门禁；
9. PF-P5 前不删除 legacy reader；PF-P5 后生产代码不再生成或渲染 Ruby。

## 10. 当前实现状态

已落地：migration 012、repository、deterministic service、dictionary、API route、新卡
plain-content pipeline、CardModal overlay、教材/Review 共享 renderer、审计与 dry-run
脚本、PF-D1 静态原型和本 ADR。

尚需真实运行确认：当前 volume 的历史 apply、60 张卡的人工决策、annotation shadow replay、
多日 PF-R1 观察、关闭 legacy reader 后的全量容器验收。未经这些证据，不把 Ruby 退役标记为
最终 PASS，也不对历史数据库执行 `--apply`。
