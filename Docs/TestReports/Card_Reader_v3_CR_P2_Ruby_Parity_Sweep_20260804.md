# Card Reader v3 含注音历史卡全量 Parity 复核（CR-P2 补充）

> 状态：**独立复核完成 · 缺陷已修复并复验；非破损卡范围内 parity 失败清零**
>
> 日期：2026-08-04
>
> 上位记录：[CR-P2 单卡型可见 Canary 验收报告](Card_Reader_v3_CR_P2_20260804.md)
>
> 方法：只读。全程使用 `compareCardReaders()` 与 `projectCardDocument()`，
> 不写 SQLite、不改内容、不动白名单。

## 1. 为什么做这次复核

CR-P2 的三张 Canary 卡（`1040/1039/1038`）是 2026-08-04 生成的新卡，
其源 Markdown 的 `<ruby>` 数量均为 **0**（PF-P1 后新卡不再产出 Ruby）。

因此 CardDocument 的 `kind: 'pronunciation'` 代码路径在本轮 Canary 中
**一次都没有被执行**。而 CR-P3 面对的是 **476 张含 Ruby 的三语卡**，
注音渲染是其最主要的未验证风险面。

本次复核用真实历史卡直接压这条路径。

## 2. 注音路径可用性：确认有效

抽样四张含 Ruby 的历史三语卡，比较源 `<ruby>` 数与 v3 产出的
`kind: 'pronunciation'` 节点数：

| generation | 源 `<ruby>` | v3 `pronunciation` 节点 | 结果 |
|---:|---:|---:|---|
| 1023 | 6 | 6 | 一致 |
| 620 | 15 | 15 | 一致 |
| 898 | 18 | 18 | 一致 |
| 632 | 23 | 23 | 一致 |

**结论**：v3 的注音结构化能力本身正确，逐 token 不丢不增。

## 3. 全量 Parity 结果（476 张含 Ruby 三语卡）

| 指标 | 数值 |
|---|---:|
| 样本 | 476 |
| parity 通过 | **413（86.8%）** |
| parity 失败 | 63 |
| 失败码 `VISIBLE_TEXT_MISMATCH` | 63 |
| 失败码 `SECTION_LANGUAGE_MISMATCH` | 58 |
| 诊断码 `UNSUPPORTED_NODE_FLATTENED` | 61 |

### 3.1 失败构成必须分开看

63 张失败中 **62 张集中在 2025-12 ~ 2026-02**，即已知的历史结构破损卡时代
（正文重复两遍、混入 `<pre>` 代码块、LLM 规划文本进入正文）。
这些卡已由
[`auditPronunciationMigrationEligibility.js`](../../scripts/maintenance/auditPronunciationMigrationEligibility.js)
的 `missing-title` / `model-planning-or-tool-residue` 判据识别为 `needs-review`，
并被 `buildPronunciationMigrationManifest.js` 硬门禁排除。**它们不是 v3 缺陷。**

**扣除该批后，真实失败仅 1 张：`generation 850`（2026-07-13）。**

## 4. 缺陷：卡片标题的 Ruby 被压平

### 4.1 现象

`generation 850` 标题源 Markdown：

```markdown
# <ruby>鼻水<rt>はなみず</rt></ruby>の<ruby>症状<rt>しょうじょう</rt></ruby>があります
```

v3 产出的 `document.title`：

```json
"鼻水はなみずの症状しょうじょうがあります"
```

`title` 是**扁平字符串**，Ruby 的 base 与 reading 被直接拼接，
注音假名混入可见标题文本。

### 4.2 算术验证

| 项 | 值 |
|---|---:|
| v2 可见字符 | 639 |
| v3 可见字符 | 649 |
| 差值 | **+10** |
| `はなみず` | 4 |
| `しょうじょう` | 6 |
| 合计 | **10** |

差值与被压平的两个 reading 长度**精确相等**，根因确认。

同时 `pronunciation` 节点数：源 25 → v3 **23**，缺失的 2 个正是标题内的两个 Ruby。

### 4.3 为什么这个缺陷特别危险

1. **v3 自身诊断为空**。该卡 `diagnostics: []`，v3 认为渲染完全正常，
   仅在与 v2 对比时才暴露。
2. **Canary 准入门禁依赖"诊断为空"**
   （`CARD_READER_V3_CANARY_DIAGNOSTICS_PRESENT`）。
   因此**这类静默缺陷可以直接通过现有门禁**。
3. **它恰好复现了 Ruby 本应避免的问题**：注音混入正文，复制即脏。
4. **当前三张 Canary 卡验证不到**，因为它们标题无 Ruby。

### 4.4 影响范围

全库标题含 `<ruby>` 的卡片：**10 / 682（1.5%）**

| 卡型 | 张数 |
|---|---:|
| trilingual | 5 |
| grammar_ja | 5 |

样例：`419`、`420`、`423`、`426`（trilingual）、`716`（grammar_ja）。

## 5. 建议（CR-P3 前置）

> 第 1、2 项已于本轮实施，见第 6 节；第 3 项仍待人工批准。

1. **修复标题 Ruby 处理**：`document.title` 应与 `sections` 使用同一套结构化
   inline 节点，而不是扁平字符串，使标题内 Ruby 正常产出 `pronunciation` 节点。
2. **为 parity 门禁增加计数不变量**：
   「v3 `pronunciation` 节点数 == 源 `<ruby>` 数」。
   卡 850 证明"诊断为空"不足以保证正确性，需要独立的计数校验兜底。
3. **Canary 白名单加入至少一张含 Ruby 的卡**，且优先选择**标题含 Ruby** 的卡，
   否则注音路径与本缺陷在 Canary 中永远不被覆盖。

## 6. 修复与复验（2026-08-04 同日完成）

### 6.1 缺陷修复

根因确认在 [`cardDocument.mjs`](../../services/cardReader/cardDocument.mjs)：H1 使用
`allText()`（**不剔除 `rt`/`rp`**），而 H2 使用 `inlineNodes()`（结构化）。同一文件内
两套处理方式，标题因此被压平。

修复：`document.title` 改为与 `section.title` 相同的 `CardInline[]` 结构。

同步变更的契约消费点：

| 文件 | 变更 |
|---|---|
| `services/cardReader/cardDocument.mjs` | H1 走 `inlineNodes()`，默认值改为 inline 数组 |
| `services/cardReader/cardReaderShadow.mjs` | 可见文字用 `cardDocumentInlineText(document.title)` |
| `app/features/card-modal/card-document.ts` | `title: string` → `title: CardInline[]` |
| `app/features/card-modal/CardReaderV3.tsx` | `<h1><InlineNodes nodes={document.title} /></h1>` |

### 6.2 新增计数不变量门禁

新增 `PRONUNCIATION_NODE_MISMATCH`：**可投影的源 `<ruby>` 数必须等于 v3
`pronunciation` 节点数**，并在 `counts` 中输出 `sourceRubyNodes` /
`v3PronunciationNodes`。

「可投影」需排除两类按契约不产出结构化节点的 Ruby：

- `loanword-block` 外来语块（投影规则本就排除）；
- 反引号代码片段内的字面文本。

> **实施过程中的自我纠正**：该门禁首版仅做朴素正则计数，导致 `679`、`942`
> 两张卡误报。经逐卡核查确认是门禁自身缺陷而非 v3 缺陷，已按上述两类边界修正，
> 并各补一条单元测试固定边界。

### 6.3 复验结果

| 项目 | 修复前 | 修复后 |
|---|---:|---:|
| 卡 850 parity | 失败 | **通过** |
| 卡 850 注音节点 | 25 → 23 | **25 → 25** |
| 卡 850 可见字符 v2/v3 | 639 / 649 | **639 / 639** |
| 全量 parity 通过率 | 413 / 476（86.8%） | **418 / 476（87.8%）** |
| **非破损卡时代失败** | **1** | **0** |
| 破损卡时代失败 | 62 | 58 |

工程门禁：unit **471/471**（新增 2 条注音回归测试）、integration **101/101**、
lint 与 TypeScript 通过。viewer 已重建，`/api/health` 返回 200。

剩余 58 张失败**全部**属于 2025-12 ~ 2026-02 的历史结构破损卡，已由既有
`needs-review` 判据识别并被迁移清单硬门禁排除，不属于 v3 缺陷。

## 7. 对 CR-P3 就绪度的判断

87.8% **不应**被解读为"12% 的卡有问题"。扣除 58 张已知历史破损卡后，
**非破损范围内通过率为 418 / 418 = 100%**。

第 4 节缺陷已修复、第 5 节门禁已落地并复验，CR-P3 的注音风险面现已被真实证据覆盖。
仍需人工批准的前置项：**Canary 白名单加入至少一张标题含 Ruby 的卡**（如 `850`），
否则该路径在 Canary 运行态中依然不被覆盖。

## 8. 边界

- 本次复核为只读，未写 SQLite、未修改任何卡片内容、未变更 Canary 白名单；
- 历史 Ruby 迁移与 legacy reader 删除仍保持禁止状态；
- 本文不授权扩大 Canary 范围，白名单变更仍需人工批准。
