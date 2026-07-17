# KG-R2 增量事实维护验收报告

> 日期：2026-07-17
>
> 分支：`SaaS_Modify`
>
> Compose project：`three_lans_system`
>
> 运行地址：`http://127.0.0.1:3010`

## 1. 验收范围

本轮验证 migration 005、表 49 transaction-local outbox、在线内容事务原子入队、确定性 KG worker、restart recovery、只读 reconciliation、hash-gated apply、Evidence 生命周期和学习调度零写入边界。LLM enrichment 保持关闭，不验证或启用 DeepSeek 自动建图。

## 2. 备份与恢复点

migration 005 进入真实 volume 前已归档整个业务卷：

- archive：`/Users/xueguodong/Library/Application Support/ThreeLANS/Backups/kg-r2-20260717/trilingual-records-before-kg-r2.tar.gz`
- SHA-256：`2fec2dd72117106173e159f2850ae81fc8064f655826715c055a0565259df145`

两次受控 apply 均另外创建 SQLite backup：

- `/data/trilingual_records/kg-r2/backups/sqlite-before-kg-r2-apply-20260717.db`
- `/data/trilingual_records/kg-r2/backups/sqlite-before-evidence-v2-20260717.db`

## 3. Reconciliation 与 apply

初始只读 plan：

| 项目 | 数值 |
|---|---:|
| active eligible Study Items | 1134 |
| current Study Item sources | 1169 |
| current textbook sources | 40 |
| active Evidence | 1123 |
| active jobs / absent jobs | 86 / 0 |
| trilingual_en / trilingual_ja / grammar_ja / scenario | 45 / 4 / 1 / 36 |
| plan hash | `b1ae4289e8217b236607b237a21b6829c686420477c30f14793545b723f77478` |

首次 apply 插入 86 个 outbox job，全部 succeeded、失败 0；report hash 为 `1b197f54ac742dcea556bce14e37042f626b4e748e0027613a7ffedca953af5e`。

## 4. 场景卡 Evidence 身份修复

首次 apply 后没有直接宣告完成，而是再次运行 reconciliation。复核发现 36 个场景 Study Item 仍缺少一个语言方向。根因是旧 `kg-evidence-v1` 的 Evidence identity 只包含来源与 revision/hash，没有包含 `language`；同一场景单元的 EN/JA Evidence 因此碰撞。

修复措施：

1. Evidence identity 升级为 `kg-evidence-v2`；
2. 把 `language` 纳入稳定 identity key；
3. processor 按活动 Evidence 的精确语言判断缺失方向；
4. 重新生成 hash-gated plan，不手工写库。

修复 plan 为 36 项，hash 为 `73d5792c0dc104c8c407ffba0757a1d453e71c66bc3b215958e8d50b1825c4cb`。第二次 apply 重排 36 个终态任务并全部 succeeded；report hash 为 `1a2089782739093711e7bf4659f92b5d3546ffb3f1ee1861659db3d6cde2f419`。

最终只读 plan 为零任务，hash 为 `b32314357ab3a46d7f37e3d3eb50506a92d46b68f63233254e5a5b4a37c2bfc0`。

## 5. 最终数据库审计

| 检查 | 结果 |
|---|---:|
| migration 005 | 1 |
| outbox | succeeded 86；其他状态 0 |
| KG Evidence / active Evidence | 1159 / 1159 |
| duplicate active source-language | 0 |
| scenario EN/JA missing Evidence | 0 |
| `PRAGMA integrity_check` | `ok` |
| foreign-key violations | 0 |
| Review Events | 0 |
| Schedule States | 0 |
| Manual Intents | 0 |
| Learning Plans | 0 |
| Daily Queues | 0 |

上述零值来自真实业务 volume，证明 KG-R2 没有通过回填或 worker 制造学习行为、计划、队列或 FSRS 状态。

## 6. 自动化验证

| 检查 | 结果 |
|---|---:|
| ESLint | 通过 |
| React typecheck | 通过 |
| unit | 338/338 通过 |
| integration | 62/62 通过 |
| smoke | 7/7 通过 |
| Docker React production build | 通过 |
| npm audit | 0 vulnerabilities |

单元测试覆盖 outbox 幂等/重排、稳定 plan、active/absent 处理、语言维度 Evidence 和 worker 降级；集成测试覆盖迁移与既有 Cards Factory、教材发布、媒体、学习功能回归。

## 7. 运行态

最终本地环境：

```text
KG_ENABLED=1
KG_PLANNING_ENABLED=1
KG_LLM_ENRICHMENT_ENABLED=0
KG_INCREMENTAL_SYNC_ENABLED=1
```

viewer 启动日志：`KG incremental source sync enabled`，`recovered=0`、`planned=0`、`queued=0`。代码、Compose 与 `.env.example` 的 KG-R2 默认值仍为关闭；仅本机 `.env` 明确开启。

## 8. 结论

KG-R2 通过。在线卡片与教材发布现在具备事务内可靠投递，worker 可重启恢复，Evidence 可按 revision/hash/language 增量维护；首次真实数据 reconciliation 已归零。场景 EN/JA 身份碰撞在验收中被发现、通过版本化 identity 与第二次 hash-gated apply 修复，未以手工补库掩盖。学习调度所有权边界保持不变。
