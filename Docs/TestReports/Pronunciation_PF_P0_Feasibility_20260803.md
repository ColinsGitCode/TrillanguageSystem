# PF-P0 Japanese Pronunciation Feasibility Report

日期：2026-08-03

状态：研究完成；历史迁移阻塞，不能翻转 PF-P0 PASS

## 1. 目的

本报告记录 PF-P0 的只读可行性验证。验证对象是“废弃历史卡片中的 Ruby，并由 Tooltip/Popover 展示整词读音”这一目标是否已经具备自动迁移条件。

本轮只读取 `/tmp/pronunciation-gate0.db`，没有修改生产 SQLite、Markdown、annotation、KG、学习数据或教材数据。所有数字都可以由仓库脚本重新生成。

## 2. 可复现命令

```bash
npm run pronunciation:ruby-inventory -- --db /tmp/pronunciation-gate0.db
npm run pronunciation:eligibility -- --db /tmp/pronunciation-gate0.db
npm run pronunciation:compound-candidates -- --db /tmp/pronunciation-gate0.db
npm run pronunciation:benchmark -- --db /tmp/pronunciation-gate0.db
npm run pronunciation:migration-manifest -- --db /tmp/pronunciation-gate0.db
```

新增加的 `pronunciation:benchmark` 不写数据库，只对真实候选调用当前 Kuromoji/Kuroshiro 分析器和本地词典。

## 3. 输入基线

| 指标 | 结果 |
|---|---:|
| generations | 675 |
| 含 Ruby 的 generation | 672 |
| Ruby 标签 | 13,528 |
| 不同 Ruby 基文 | 2,829 |
| 相邻 Ruby 组 | 598 |
| 相邻 Ruby 组件标签 | 1,321 |
| 不同相邻候选 | 466 |

审计内容哈希：`1f47a4e6cf3c2ca98cb97d32a9ff33f1a1849755c52beebc66c40b306d3e817c`

这里的 466 是当前组件感知统计。旧设计文档中的 465 已过时，不能作为新的验收数字。

## 4. 历史内容准入

| 状态 | 数量 | 含义 |
|---|---:|---|
| eligible | 612 | 标题结构和内容质量满足只读迁移前置条件 |
| needs-review | 60 | 缺标题或含历史模型/工具残留，需要人工决定 |
| excluded | 3 | 不进入迁移候选 |

60 张 `needs-review` 卡全部来自旧 Gemini 2.5 Flash 时期，最后一张时间为 2026-02-10。它们不能通过“正文字符没有变化”这一条就自动迁移，因为正文自身可能已经是错误的模型输出。

准入 manifest 哈希：`9e66c91b737c5581a6d573ab27e7e204b9d9baef7898cad9efd84c1bc5d08ebf`

## 5. 整词读音基准

对 466 个不同相邻候选进行只读分析，当前结果如下：

| 结果 | 不同候选 | 出现次数 |
|---|---:|---:|
| 整词 accepted | 77 | 95 |
| 其中 analyzer 直接整词命中 | 76 | - |
| 其中本地词典命中 | 1 | - |
| 只能按组件处理 | 357 | - |
| 部分未决 | 32 | - |

按合格卡片中的出现次数计算，整词命中只有 83 次。也就是说，当前分析器不能兑现“任意复合词都自动显示整词读音”的承诺；整词读音必须依赖人工接受的词典/来源，不能把 Kuromoji 的分词结果直接当作产品事实。

典型结果：

- `勤務表` 仍会被分析成多个组件，除非走已接受的词典条目；
- `一人` 的通用分词结果可能不是产品需要的 `ひとり`；
- `掲示板`、`来月` 等部分词可以直接命中；
- 历史候选中存在 `汉字注音`、`限流验证`、`不要出现英文括号` 等中文/提示词残留，不能进入日语读音迁移。

复合候选 manifest 哈希：`4f639ab18f72f46ea7abe7ca02a901542faf0cdca6de67f57bfa67f575b7a0b1`

## 6. 迁移投影基准

612 张合格卡的只读 projection 结果：

| 状态 | 数量 |
|---|---:|
| ready | 195 |
| partial | 417 |
| unresolved token | 2,097 |

迁移 manifest 哈希：`ef8edf7512f2029785f0b9c48f57afb3ef80fe3fff330b7eb2bd14008a3790f6`

因此，当前只能证明“纯正文投影、token 偏移、未决状态和人工纠音链路可运行”，不能证明“历史全量迁移质量已经达到可接受标准”。

## 7. 已实现并通过的 P0 基础能力

- Ruby 解析和相邻组件候选生成；
- 只读历史准入审计；
- 当前分析器/词典的真实语料 benchmark；
- 纯正文 pronunciation document/token projection；
- code point offset 和内容哈希；
- 生成卡、教材表达和 Review 的统一读取接口；
- correction event 的 append-only、幂等和 revision guard；
- 12 个桌面原型状态 `pf-d1-pronunciation-overlay.html`；
- 真实 API 的读取、纠音和 feature flag fail-closed 测试。

## 8. 继续条件与阻塞项

PF-P0 不能翻 PASS，原因不是代码无法运行，而是以下业务前置尚未完成：

1. 人工审核 60 张 `needs-review` 卡，决定修复、隔离或排除；
2. 对 466 个复合候选建立 accepted 来源、词典或人工裁决；
3. 对整词读音的正确性进行抽样验收，尤其是同形异义和不规则读音；
4. 用户确认 PF-D1 原型中的 Tooltip、Popover、双击选词、纠音和降级行为；
5. 只有上述决策完成后，才允许执行 PF-P4 的历史 canary；
6. 在 PF-P4 canary 和至少 7 天运行观察完成前，不得删除生产 Ruby 读取链路。

## 9. 结论

PF-P0 的工程研究和只读工具已完成，结果明确支持继续做新卡纯正文链路和 CardModal overlay；历史全量迁移、Ruby 退役和生产切换仍然是阻塞状态。

本报告不批准任何真实历史写入，也不批准删除 Ruby。下一阶段必须保持 feature flag 可回退，并把人工决定作为版本化输入，而不是让 LLM 或分析器自动替用户接受读音。
