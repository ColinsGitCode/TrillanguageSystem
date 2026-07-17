# KG-R1 小范围观察与 Planning Canary 验收

> 日期：2026-07-17
> 环境：本地 Docker Compose `three_lans_system`
> 结论：通过；本地 Graph planning reader 已开启，LLM enrichment 保持关闭

## 1. 验收边界

本次只验证 KG planning 的同步只读路径，不创建学习计划、不生成持久化日队列、不提交评分，也不调用 DeepSeek。当前真实库没有 profile、plan、queue、Schedule State 或 Review Event，因此采用同一 SQLite snapshot 的代表性队列预览：baseline、真实 Graph reader 和强制 reader 失败三路使用完全相同的候选、scope、时间边界和数量上限。

## 2. 真实数据观察

| 指标 | 结果 |
|---|---:|
| Knowledge Point / Evidence | 855 / 1123 |
| Lookup Event | 2（resolved 1 / unresolved 1） |
| Open Resolution Case | 253（ambiguous 44 / unsupported 209） |
| Planning Signal | 1，score 8 |
| Study Item / 合格候选行 | 1141 / 1134 |
| Profile / Plan / Daily Queue | 0 / 0 / 0 |
| Schedule State / Review Event / Manual Intent | 0 / 0 / 0 |
| SQLite integrity / 外键违规 | `ok` / 0 |

已解析 lookup 为英语 `continuous integration (ci)`，产生 Study Item 7 的 `kg-lookup-signal-v1`；日语 `はし` 保持 unresolved，不生成 planning signal。

## 3. Canary 结果

代表性预览使用 `dailyActionGoal=20`、`dailyNewLimit=20`。Study Item 7 在 baseline 位于索引 6，Graph score 8 后位于索引 0；移动导致 7 个位置发生变化，但 20 个 Study Item 的集合及每项 bucket、`availableAtUtc`、`dueAtUtc` 完全一致。

| 门禁 | 关闭前 | 开启后 |
|---|---:|---:|
| overallPass | true | true |
| 集合一致 / base key 一致 | true / true | true / true |
| 强制失败精确回退 | true | true |
| PK 单点查询 | true | true |
| reader p95 | 0.0013ms | 0.0014ms |
| reader max / 超过 10ms 次数 | 0.0167ms / 0 | 5.8943ms / 0 |
| 网络调用 | 0 | 0 |
| 18 张观察表计数变化 | 0 | 0 |

Git 外报告：

- `/data/trilingual_records/kg-r1/kg-r1-canary-before-enable-20260717.json`，hash `c687c1fcdd071f8995d0191af97494593dcb8f123be1cc346800c9b61826eff2`；
- `/data/trilingual_records/kg-r1/kg-r1-canary-after-enable-20260717.json`，hash `49e46bbc50a546eb55401f3b55009a1cbaa44331fe17c865964da2ce75027fdc`。

## 4. 运行状态与诚实边界

本地环境现为 `KG_ENABLED=1`、`KG_PLANNING_ENABLED=1`、`KG_LLM_ENRICHMENT_ENABLED=0`。代码、Compose 与 `.env.example` 的 KG 默认值仍全部为 0。

`GET /api/learning/plan` 返回 `plan:null`，`GET /api/learning/queues/today` 返回 `emptyReason:not-created`。因此本次证明的是：真实数据库投影可被安全读取、同快照细排契约成立、失败可回退、运行开关可以安全开启；尚未声称验证真实持久化用户队列中的 explanation。用户未来创建计划并产生首个真实队列后，应补一次 queue snapshot 检查，确认 `graph-contract` diagnostics 与公开 explanation 正常。

## 5. 工程验证

| 检查 | 结果 |
|---|---:|
| ESLint / React typecheck | 通过 / 通过 |
| Unit / Integration | 334/334 / 62/62 |
| Smoke | 7/7 |
| 相关桌面 Playwright | 8/8 |
| React production build / npm audit | 通过 / 0 vulnerabilities |
| Docker runtime / `/api/health` | 4 服务运行 / overall online |

Playwright 仅运行 Knowledge 与 Learning Assistance 相关桌面流程；按当前产品边界未执行移动端设计或验收。

## 6. 回退条件

只要出现集合/base key 漂移、reader p95 超过 5ms、单次超过 10ms、健康异常或 Graph reader 导致队列失败，立即把本地 `KG_PLANNING_ENABLED` 设回 0 并重建 viewer。关闭 reader 不删除 lookup、projection 或 append-only 事实。
