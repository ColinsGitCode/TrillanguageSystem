# 复合词读音人工确认批次报告

> 日期：2026-08-03
> 状态：**只读批次已生成；未接受任何候选，未执行历史迁移**

## 1. 目的

把真实语料中的复合词候选拆成可追踪的人工确认批次，解决“候选已盘点但没有可执行审阅入口”的问题。
批次文件只作为 review manifest，不是 accepted 词典，也不授权 `--apply`。

## 2. 生成命令

```bash
npm run pronunciation:compound-batches -- \
  --db /tmp/pronunciation-gate0.db \
  --output /tmp/pronunciation-compound-review-batches.json \
  --batch-size 25 \
  --minutes-per-candidate 1
```

输出文件位于 `/tmp`，不进入 Git，也不包含数据库写入。

## 3. 当前批次摘要

| 项目 | 结果 |
|---|---:|
| 不同候选 | 466 |
| 候选出现次数 | 598 |
| 合格卡片中的出现次数 | 479 |
| 批次大小 | 25 |
| 批次数 | 19 |
| 初始估算人工时间 | 466 分钟 |
| 初始状态 | 466 个候选全部 `unreviewed` |

时间是可配置的计划估算，不是实测承诺。每个候选都保留 surface、组件、候选读音、出现次数、
generation ids 和 `acceptedSource=null`；分析器结果不会自动升级为 accepted。

## 4. 人工确认字段

每个候选需要人工填写：

- `status`：accepted / reject / unresolved；
- `acceptedSource`：dictionary / textbook / manual；
- `acceptedReadingRaw` 与 `acceptedReadingHiragana`；
- reviewer、时间和理由。

只有完成批次确认并产生稳定 manifest hash 后，才允许进入历史 Canary 评审。60 张结构问题卡
仍由独立的 eligibility manifest 管理，不与复合词批次混合。
