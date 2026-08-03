# PF-P4 历史注音 Canary 准入报告

> 日期：2026-08-03
> 状态：**BLOCKED：只读证据已完成，历史 Canary 尚未获人工批准**

## 1. 报告边界

本报告只判断历史注音迁移是否具备进入 Canary 的条件，不代表已经修改真实 SQLite、
generation、Markdown 或 annotation。历史 Ruby 不能因为 dry-run 通过而自动退役。

## 2. 只读输入与结果

输入来自 Gate 0 的只读数据库快照和版本化维护脚本。所有摘要都不包含教材原文、卡片正文、
选区文本或完整读音。

| 项目 | 结果 |
|---|---:|
| generation 总数 | 675 |
| 含 Ruby 卡片 | 672 |
| Ruby 标签 | 13,528 |
| 迁移 eligibility：eligible | 612 |
| 迁移 eligibility：needs-review | 60 |
| 迁移 eligibility：excluded | 3 |
| 不同相邻复合候选 | 466 |
| manifest ready | 195 |
| manifest partial | 417 |
| manifest unresolved token 数 | 2,097 |
| manifest hash | `ef8edf7512f2029785f0b9c48f57afb3ef80fe3fff330b7eb2bd14008a3790f6` |

### Annotation shadow replay

| 指标 | 结果 |
|---|---:|
| active/orphaned canonical annotations | 28 |
| generation annotations | 28 |
| projection unchanged | 28 |
| projection changed | 0 |
| new projection resolved | 27 |
| newly orphaned | 0 |
| pre-existing orphaned | 1 |
| 连续运行 report hash | `bfcab5224107848f3c3ee8e4051a554b237c93cddff6ca78307b212c4bfab1cc` |

## 3. Canary 准入判断

| 门禁 | 状态 | 说明 |
|---|---|---|
| dry-run manifest 可重复 | PASS | manifest hash 已固定，输出排序稳定 |
| 不原地改写 generation | PASS | apply 工具默认 dry-run，代码路径无 generation update |
| annotation shadow replay | PASS | 没有新增 orphaned |
| 60 张历史结构问题卡决策 | BLOCKED | 还没有用户批准 repair/archive/exclude/false-positive |
| 466 种复合词 accepted 来源 | BLOCKED | Kuromoji 只能提供候选，不能自动视为权威整词读音 |
| Canary 子集与回滚批准 | BLOCKED | 尚未在真实 volume 执行 approved subset |
| PF-R1 观察窗口 | BLOCKED | 不是 PF-P4 的自动门禁，但仍是最终退役前置条件 |

## 4. 结论

当前结论为 **STOP**：可以继续评审候选和准备 Canary，但不能执行：

```text
npm run pronunciation:migration-apply -- --apply ...
```

只有在用户确认 60 张卡的处理清单、复合词来源策略、Canary 子集、备份位置和回滚动作后，
才能把本报告改为 PASS，并把批准清单的 hash 作为 apply 的输入。真实数据不进入 Git。
