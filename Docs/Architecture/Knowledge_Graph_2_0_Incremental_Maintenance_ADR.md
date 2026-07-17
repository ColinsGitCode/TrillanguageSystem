# 知识图谱 2.0 增量事实维护 ADR（KG-R2）

> 状态：Accepted · 2026-07-17
>
> 上位基线：[KG-D2 领域与数据 ADR](Knowledge_Graph_2_0_Domain_and_Data_ADR.md)

## 1. 问题

KG-R0 只允许在事实库为空时执行一次受控回填。其后在线生成的新卡片、教材 Track 新发布/修订、卡片删除和教材表达退役，都可能让 `study_items` / `textbook_expressions` 与 KG Evidence 发生漂移。单纯在 HTTP 请求结束后调用脚本不可靠：进程可在业务事务提交后、KG 调用前退出，导致内容已存在但 KG 永久漏同步。

KG-R2 必须保证：

1. 内容事务成功后，增量任务不会丢失；
2. KG 失败不回滚已经成功的卡片或教材发布；
3. 每个任务重验 source revision 与 SHA-256，拒绝把过期分析写入当前事实；
4. 内容替换/删除有 append-only 裁决事件，可重建读模型；
5. 不写 FSRS、Review Event、Schedule State、学习计划或队列；
6. v1 仍只用确定性规则与 Kuromoji，不调用 DeepSeek 建图。

## 2. 决策摘要

| 项目 | 决策 |
|---|---|
| 可靠投递 | transaction-local outbox：`kg_source_sync_jobs` |
| 表编号 / migration | 表 49 / `005_kg_incremental_sync.sql` |
| 来源粒度 | 一个 Study Item 一个任务；教材表达按 `en` / `ja` 各一个任务 |
| 业务事务职责 | 只写 outbox，不做解析、不写 KG 事实 |
| 消费者 | 独立 `KgSourceSyncService`，不复用生成队列所有权 |
| 失败隔离 | 最多三次指数退避；失败任务保留，不回滚内容域 |
| 启动恢复 | 回收超时 `running`，再执行只读 reconciliation |
| 内容变更 | 旧 Evidence 写 `evidence-detached` 后转 `superseded` |
| 内容删除 | 旧 Evidence 写 `evidence-detached` 后转 `orphaned` |
| 投影 | 只重建受影响 point；Study Item 信号先失效再按 active Evidence 重算 |
| 上线开关 | `KG_INCREMENTAL_SYNC_ENABLED`，代码/Compose/示例默认 `0` |
| 首次启用 | Git 外 dry-run plan -> hash-gated apply -> 报告验收 -> 开 worker |

## 3. Outbox 契约

`kg_source_sync_jobs` 不对多态来源建立伪 FK。身份键为：

```text
(operation, source_kind, source_ref_id, source_revision, language, source_content_hash)
```

`operation` 仅有：

- `active`：来源当前有效，应存在对应 active Evidence；
- `absent`：来源已删除、归档或退役，应使对应 active Evidence 失效。

状态为 `queued -> running -> succeeded|failed|superseded`。`attempts` 在 claim 时递增；`retry_after_ts` 使用 epoch milliseconds，只负责 worker 唤醒，不承担学习日语义。任务保留 plan hash、错误码、错误摘要和有界 JSON 结果。

## 4. 原子写入点

### 4.1 在线卡片

`services/storage/db/generations.js` 在 generation、admission 与 Study Item 同一 SQLite 事务内，为每个新 Study Item 写 `active` 任务。删除卡片时，先把 Study Item 归档并写 `absent` 任务，再删除 generation；Study Item 的稳定身份仍保留。

### 4.2 教材发布

`publishTrack()` 在 Track、revision、generation、admission 与 Study Item upsert 同一事务内：

- 当前 Study Item 写 `active`；
- 被归档的 Study Item 写 `absent`；
- 当前教材表达按 EN/JA 写两个 `active`；
- 已退役且仍有 active Evidence 的教材表达写 `absent`。

这些写入不依赖 KG worker 是否开启，因此开关关闭期间也不会丢变化。

## 5. 消费流程

1. FIFO claim 一条到期任务并标为 `running`；
2. 从当前数据库重新加载来源，校验 kind/ref/revision/language/hash；
3. 在事务外执行确定性文本准备与日语 Kuromoji 分析；
4. 进入 KG 事务后再次加载来源并比较完整 source bundle 指纹；
5. 若来源已漂移，按 absent 处理并把任务记为 `superseded`；
6. 若为新 revision，先为旧 Evidence 写 append-only `evidence-detached`，再转 `superseded`；
7. 物化 resolved KP/Surface/Evidence 或可追溯 unresolved case；
8. 增量重建受影响 point stats / planning signals；
9. 标记任务成功。进程若在第 8、9 步之间退出，重跑仍由事件键和 Evidence 键保持幂等。

## 6. Reconciliation

`buildKnowledgeSyncPlan()` 是只读 backstop：

- 比较当前 active/admitted Study Item 来源与 active Evidence；
- 比较当前 published 教材表达 EN/JA 与 active Evidence；
- 为缺失或存在旧 revision 的来源生成 `active` 描述；
- 为已经没有当前来源的 active Evidence 生成 `absent` 描述；
- `whole_card` 无可靠正文 extractor，继续显式跳过，不伪造 Evidence。

plan 使用稳定排序并计算 SHA-256；时间不参与 hash。生产 apply 必须重新生成 plan 并匹配 `--expected-plan-hash`。

## 7. 运行时与降级

新增开关：

```env
KG_INCREMENTAL_SYNC_ENABLED=0
```

worker 只有在 `KG_ENABLED=1 && KG_INCREMENTAL_SYNC_ENABLED=1` 且非 E2E 模式时启动。关闭时：

- 内容事务仍持续写 outbox；
- `/knowledge` 与 planning reader 继续按现有事实运行；
- 不消费任务、不改变 Evidence；
- 可通过维护 CLI 受控 dry-run/apply。

`KG_LLM_ENRICHMENT_ENABLED` 与本阶段无关，必须保持 `0`。

## 8. 安全与验收

必须满足：

- migration 新库/存量库对象 parity；
- outbox 幂等、FIFO、重试、restart recovery；
- 新卡片与教材发布事务原子入队；
- source drift 不写过期 active Evidence；
- revision 替换产生 `superseded`，删除产生 `orphaned`；
- 每次 detach 均有 append-only `evidence-detached`；
- Review Event、Schedule State、Manual Intent 与 FSRS 计数不变；
- dry-run 报告、SQLite backup、apply report 位于 Git 外且不可覆盖；
- `integrity_check=ok`、外键违规为 0；
- worker 关闭时系统行为保持现状。

## 9. 回滚

运行异常时先设 `KG_INCREMENTAL_SYNC_ENABLED=0` 并重建 viewer。已排队或失败任务保留，不 DROP、不清空。若错误规则已经改变 Evidence，按运行手册停 viewer、备份当前卷、恢复 apply 前 SQLite backup；不得删除 append-only 事件来伪造回滚。

## 10. 非目标

- 不新增 LLM 自动建图；
- 不改变 KP 身份、split/merge 或 unresolved 人工裁决契约；
- 不改变 Graph planning score、10ms budget 或基础队列集合；
- 不增加移动端页面；
- 不用轮询替代业务事务内 outbox。

## 11. 实施与运行记录

KG-R2 已于 2026-07-17 完成实现和真实 Compose volume 验收：

- migration 005 与 schema 真源同步交付表 49，在线 generation / Study Item 与教材发布均在原事务中写 outbox；
- worker、restart recovery、只读 reconciliation、hash-gated apply、不可覆盖 report/backup CLI 已落地；
- Evidence 替换/删除执行 append-only detach + `superseded/orphaned`，确定性 skip 也形成终态，避免无限重试；
- 运行审计发现并修复场景 EN/JA Evidence identity collision，Evidence identity 升级为 `kg-evidence-v2` 并包含语言；
- 最终 reconciliation 为零任务，outbox 为 86 条 succeeded、失败 0，active Evidence 1159，来源语言重复和场景语言缺失均为 0；
- Review Event、Schedule State、Manual Intent、Learning Plan、Daily Queue 均保持 0；SQLite integrity 为 `ok`，外键违规为 0；
- 本地运行环境开启 worker；代码、Compose 和示例环境默认仍关闭。完整命令、hash、备份与测试证据见运行手册 §8.5 和 `Docs/TestReports/Knowledge_Graph_KG_R2_Incremental_Maintenance_20260717.md`。
