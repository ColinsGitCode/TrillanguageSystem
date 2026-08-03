# PF-P4 注音注解 Shadow Replay 报告

> 日期：2026-08-03
> 状态：**只读通过；历史 Canary / apply 仍阻塞**
> 脚本：`npm run pronunciation:shadow-replay -- --db=<readonly-db> --output=<outside-workspace>.json`

## 目的

在任何历史写入前，对现有 canonical annotation 的旧 Ruby 可见投影与新纯正文投影做
shadow replay。脚本只打开 SQLite 只读连接，输出不含选区原文、卡片正文或读音的摘要，
不会修改 `generations`、`card_annotations`、`card_highlights` 或 migration events。

## 本次证据

输入：Gate 0 的只读备份 `/tmp/pronunciation-gate0.db`。
报告 hash：`bfcab5224107848f3c3ee8e4051a554b237c93cddff6ca78307b212c4bfab1cc`。
连续两次运行的结构化结果一致；时间字段不参与 `reportHash`。

| 指标 | 结果 |
|---|---:|
| active/orphaned canonical annotations | 28 |
| generation annotations | 28 |
| unsupported targets | 0 |
| projection unchanged | 28 |
| projection changed | 0 |
| old projection resolved | 27 |
| new plain projection resolved | 27 |
| newly orphaned | 0 |
| pre-existing orphaned | 1 |

## 结论

- Ruby 的 `rt/rp` 被排除后，当前 28 条 annotation 的可见正文投影没有变化；这是
  **投影兼容性证据**，不是历史数据已经迁移的证明。
- 新投影没有新增 orphaned annotation；原有 1 条 orphaned 仍保持 orphaned，脚本没有
  擅自修复或写入。
- 该结果允许继续做**人工批准后的 Canary 设计**，不允许跳过 60 张历史结构问题卡的
  人工决策，也不允许执行全量 migration `--apply`。

## 未完成门禁

1. 60 张历史结构问题卡仍只有模板清单，没有用户批准的 `repair/archive/exclude` 决策。
2. 466 种复合词候选还没有全部获得 accepted 来源。
3. 尚未在真实数据库上执行 approved subset Canary、回滚和再次前进。
4. 尚未完成 7 个实际使用日的 PF-R1 观察。
