# PF-P5 Ruby 退役验收报告

> 日期：2026-08-03
> 状态：**BLOCKED：历史迁移准入和 Canary 尚未完成，生产 Ruby 未删除**

## 1. 当前可确认的事实

- 新生成卡已经使用纯正文和独立 pronunciation document/token，不新增 Ruby。
- CardModal、教材和 Review 已接入按需注音组件，并保留纯正文降级路径。
- 生产配置仍保留 `PRONUNCIATION_LEGACY_RUBY_READER_ENABLED=true`，用于未迁移历史内容。
- 60 张历史结构问题卡、466 种复合词候选和 2,097 个 unresolved token 尚未完成批准处理。
- 因此不能声称“活动代码和 DOM 零 Ruby”，也不能删除 `toRuby()`、`normalizeJapaneseRuby()`
  的历史输入/兼容路径。

## 2. 未执行的不可逆步骤

下列步骤本报告没有执行，避免在没有批准清单时修改真实数据：

1. 历史 manifest 的 approved subset apply；
2. Canary 回滚和再次前进；
3. 全量历史 apply；
4. `PRONUNCIATION_LEGACY_RUBY_READER_ENABLED=0` 的真实 volume 验收；
5. 删除生产 Ruby 生成、渲染和旧 projection fallback；
6. PF-R1 至少 7 个真实使用日观察。

## 3. 进入 PF-P5 的前置条件

| 条件 | 必须证据 |
|---|---|
| PF-P4 PASS | 用户批准的历史处理清单、Canary 清单和回滚记录 |
| 历史数据稳定 | apply 前后 generation/content hash、业务计数和 SQLite integrity |
| 注解稳定 | shadow replay 无新增 orphaned，Canary 回滚后再次 replay 一致 |
| 活动 legacy hit 为零 | 两次独立审计和运行观测均为零 |
| 运行观察通过 | PF-R1 观察窗口和纠音/unresolved 处理报告 |

## 4. 结论

PF-P5 当前为 **NOT RUN / STOP**。关闭 legacy reader 或删除 Ruby 代码会违反本计划的历史
数据保护边界，不能通过“代码已经没有新 Ruby”来替代历史迁移验收。
