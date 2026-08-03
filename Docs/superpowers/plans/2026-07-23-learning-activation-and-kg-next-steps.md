# Three LANS 下一阶段执行计划：真实学习启用与知识图谱演进

> 状态：**Draft · 待确认**
>
> 日期：2026-07-23
>
> 角色：当前架构完成后的阶段路线与执行门禁，不替代 LA-D0/LA-D2、KG-D0/KG-D2 或各运行手册
>
> 执行约束：仅面向桌面端；不启动移动端设计；不使用合成学习行为替代真实用户数据；阶段内顺序执行，不使用 subagent 模式

## 1. 结论

下一阶段不是直接开启 DeepSeek 自动建图，而是先完成 **LA-R1：真实学习闭环启用与运行观察**。

原因：Cards Factory、教材课程、Learning Assistance 2.0、KG 确定性事实层、Graph Planning Canary 和 KG 增量 worker 已具备运行条件，但系统还没有真实学习计划、每日队列、Review Event 或 Schedule State。没有这些行为数据，就无法判断：

- 当前提示面与答案面是否真正帮助主动回忆；
- 20/5 的每日负担是否合理；
- FSRS 调度、队列恢复和四档评分在真实使用中是否顺畅；
- KG planning signal 是否对真实队列产生可解释且有价值的细排；
- 哪些 unresolved、近似词形和语义关系最值得优先处理。

因此执行顺序固定为：

```text
LA-R1 真实学习启用与运行验收
  -> LA-R2 14 学习日基线与参数复盘
  -> KG-R3 unresolved 分诊与人工评估集
  -> KG-D3 DeepSeek 异步 proposal ADR/POC
  -> KG-P4 受控 enrichment（仅在 POC 通过后）
```

## 2. 当前正式基线

### 2.1 已完成能力

- Cards Factory：三语卡、日语语法卡、场景表达、卡片弹窗、标红、TTS 与异步生成队列；
- 教材课程：Track Manifest、人工校对、官方音频、单句 EN/JA TTS、教材学习单元与派生卡；
- Learning Assistance 2.0：单计划、每日队列、可恢复会话、主动揭示、四档评分、FSRS-6 与学习历史；
- Knowledge Graph 2.0：确定性 KP/Surface/Evidence、unresolved、显式 lookup、Graph Planning Signal、手动加入学习；
- KG-R0/R1/R2：真实数据回填、Planning Canary、transaction-local outbox、增量 Evidence worker 与 reconciliation。

### 2.2 2026-07-23 真实 volume 快照

| 指标 | 当前值 |
|---|---:|
| Learning Plans | 0 |
| Daily Queues / Queue Entries | 0 / 0 |
| Review Events / Schedule States | 0 / 0 |
| KG Lookup Events | 2 |
| KG Planning Signals | 1 |
| Open Resolution Cases | 253 |
| KG outbox | succeeded 114；其他状态 0 |
| 默认范围学习单元 | 1122 |
| 已发布教材 Track | Track 01「朝の情景」，40 单元 |

这说明 KG-R2 已持续处理 R2 验收后的新增来源，但 Graph planning 仍没有真实持久化学习队列消费者。

## 3. 不属于当前阶段的工作

- 不让 LLM 实时参与 queue、rating 或 FSRS；
- 不让 DeepSeek 自动创建 active synonym、cross-language 或 prerequisite 关系；
- 不为了验收伪造计划、Review Event、lookup 或错误答案；
- 不调整 FSRS 参数或 Graph score 权重；
- 不建设全图可视化；
- 不恢复旧 Knowledge Hub/OPS、旧 SRS 或旧 schema；
- 不开发移动端页面；
- 不把教材官方原文发送到 KG LLM enrichment。

## 4. 阶段总览

| 阶段 | 目标 | 启动条件 | 退出条件 |
|---|---|---|---|
| LA-R1 | 建立第一个真实计划并完成真实学习闭环验收 | 当前即可开始 | 至少 7 个真实学习日；队列/评分/恢复/KG explanation 无阻塞缺陷 |
| LA-R2 | 建立前 14 学习日基线并调整负担 | LA-R1 通过 | 至少 14 学习日、70 条真实 Review Event；形成参数复盘报告 |
| KG-R3 | 分诊 253 个 unresolved，建立人工 gold set | LA-R1 通过，可与 LA-R2 后半段并行 | 原因分布清楚；至少 50 个代表性 case 完成人工裁决 |
| KG-D3 | 定义 DeepSeek 异步 proposal 契约和 POC | KG-R3 gold set 就绪 | ADR Accepted；离线 POC 达到门禁；零自动接受 |
| KG-P4 | 受控上线 enrichment proposal | KG-D3 通过 | 默认关闭、人工确认、可回滚、无学习路径耦合 |

## 5. LA-R1：真实学习闭环启用

### 5.1 LA-R1-0 前置确认

- [x] 确认当前 Compose 服务、`/api/health`、SQLite integrity 与外键状态正常；
- [x] 确认 KG outbox 没有 `queued/running/failed` 积压；
- [x] 记录创建计划前的 Plans/Queues/Review Events/Schedule States/KG Lookup 计数；
- [x] 创建一次 Git 外 SQLite backup，仅作灾难恢复，不用于抹除正常学习历史；
- [x] 学习时区已在第一份队列生成前确认为 `Asia/Tokyo`；代码、运行配置和 Accepted 基线同步修订，运行中不得静默切换。

运行前证据见 `Docs/TestReports/Learning_Assistance_LA_R1_Preflight_20260723.md`。

### 5.2 推荐的首个计划

通过现有 `/api/learning/plan/preview` 实测，推荐先使用一个受控范围：

```json
{
  "version": 2,
  "languages": ["en", "ja"],
  "cardTypes": ["grammar_ja", "textbook_track"],
  "dateRange": null,
  "tags": [],
  "textbookTrackIds": [1]
}
```

| 范围 | 单元数 |
|---|---:|
| 日语语法 | 185 |
| Track 01 英语 | 20 |
| Track 01 日语 | 20 |
| 合计 | 225 |

推荐参数：

- 每日行动目标：`20`；
- 每日新单元上限：`5`；
- 预计首次引入全部单元：约 `45` 个学习日；
- 第一轮不加入 888 个三语方向单元和 48 个场景单元，避免首次范围过大；
- 计划必须由用户在 `/learn/plan` 明确确认，系统或维护脚本不得替用户静默创建。

### 5.3 LA-R1-1 首日验收

- [x] 保存计划并生成第一份 Daily Queue；
- [x] 确认首次队列最多包含 5 个 fresh 单元，且没有伪造 due/overdue；
- [ ] 确认教材 EN/JA 与日语语法的提示面、答案面、ruby、音频和中文提示正确；
- [ ] 验证 reveal 前不能评分，提交中锁定，失败可重试且不会产生重复 Review Event；
- [x] 中途退出并恢复一次会话，确认 current/revealed entry 不漂移；
- [ ] 完成一次完整会话，检查 queue/session 状态闭合；
- [ ] 检查 Review Event 与 Schedule State 成对增长，FSRS metadata 与参数 hash 可追溯；
- [ ] 检查 KG worker 和 generation worker 无异常日志。

### 5.4 LA-R1-2 七个真实学习日观察

每天只记录聚合指标，不把答案好坏改造成测试数据：

- learning day、计划 revision、queue revision；
- fresh/due/overdue/manual 的计划数与完成数；
- Again/Hard/Good/Easy 分布；
- response time 中位数与 p95；
- session 中断、恢复、skip、提前结束次数；
- 当天 Review Event/Schedule State 增量；
- KG lookup、manual intent、open resolution case 增量；
- KG outbox queued/running/failed 与最终 drain 状态；
- 浏览器 console、API 5xx 和 worker error。

不得在 LA-R1 期间根据单日结果调整 FSRS 或 Graph score。产品缺陷可以修；算法参数保持冻结。

### 5.5 真实 KG planning 验收

首个真实 Daily Queue 产生后，补齐 KG-R1 尚未完成的持久化队列观察：

- [ ] queue snapshot 包含 `graph-contract` diagnostics；
- [ ] Graph provider 只改变相同 bucket/available/due 三键内的顺序；
- [ ] Study Item 集合、bucket、`availableAtUtc`、`dueAtUtc` 与无 Graph 基线一致；
- [ ] explanation 只暴露公开 reason、provider、rule version 与可追溯 source；
- [ ] reader 无数据或失败时精确回退基础顺序；
- [ ] 同步读取仍低于 10ms hard budget；
- [ ] Graph provider 不写 Review Event、Schedule State、FSRS 或 lookup。

如果当前唯一 planning signal 未进入首周真实范围，只记录“未覆盖”，不得伪造 lookup 或扩大计划范围来制造通过结果。等待自然用户行为产生可观察信号。

### 5.6 LA-R1 退出门禁

- [ ] 至少 7 个真实学习日；
- [ ] 每日队列、会话恢复、评分、历史页面无 P1/P2 缺陷；
- [ ] 无重复 Review Event、无孤立 Schedule State、无并发 active session；
- [ ] learning day 与确认时区一致；
- [ ] KG explanation 已在真实队列中验证，或明确记录“自然样本未覆盖”；
- [ ] KG outbox 无积压，SQLite integrity 与外键检查通过；
- [ ] 形成 `Docs/TestReports/Learning_Assistance_LA_R1_Real_Use_<date>.md`。

## 6. LA-R2：14 学习日基线与负担复盘

LA-R2 不是重新设计调度器，而是根据真实数据决定每日负担和产品摩擦。

### 6.1 数据门槛

- 至少 14 个真实学习日；
- 至少 70 条真实 Review Event；
- 至少包含新单元首次学习和一次以上自然到期复习；
- 不以测试 fixture、脚本补写或批量 API 调用填充数据。

### 6.2 复盘指标

- 每日完成率、计划内完成率、连续中断位置；
- Again/Hard 比例和 1/7/14 日重复失败单元；
- EN/JA/grammar/textbook 各类型 response time 与失败率；
- 新单元 5 是否导致 due 累积；
- daily action goal 20 是否经常无法完成；
- 教材官方音频、TTS、ruby 和中文 cue 对回忆的实际帮助；
- lookup 后再次错误的知识点；
- manual queue intent 是否被使用，以及是否真正完成评分。

### 6.3 允许的调整

- 每日新单元上限和每日行动目标；
- 学习范围、卡型和 Track；
- cue/answer 展示、音频入口和操作流程；
- 可解释的 Heuristic/Graph signal 显示问题。

FSRS 参数、Graph score 权重或知识关系语义若要修改，必须单独形成数据报告与 ADR amendment，不能作为普通 UI 调整夹带。

## 7. KG-R3：unresolved 分诊与人工评估集

当前有 253 个 open resolution cases。直接把它们全部交给 DeepSeek 不可接受；先建立人类可复核的质量基线。

### 7.1 只读盘点

- [ ] 按 `case_kind / language / source_kind / analyzer reason` 聚合；
- [ ] 区分 ambiguous kana、unsupported token/sequence、Evidence conflict 与 semantic proposal；
- [ ] 标记教材官方原文来源，保持 LLM denylist；
- [ ] 检查重复 case、已失效 Evidence 和应由 KG-R2 supersede 的 case；
- [ ] 输出 Git 可提交的聚合报告，不提交受版权约束的原文。

### 7.2 人工 gold set

- [ ] 选择至少 50 个代表性 case，覆盖 EN/JA、不同来源和主要失败原因；
- [ ] 每个 case 记录 accept/reject/abstain、目标 KP、关系类型和公开理由；
- [ ] 两次独立复核不一致的 case 保持 unresolved；
- [ ] 评估集保存匿名化 identity/hash 与裁决结果；教材原文继续留在本地数据库；
- [ ] 建立 deterministic analyzer 的 precision/coverage 基线。

### 7.3 可选 UI 工作

若单条 `/knowledge` 裁决效率不足，再设计桌面端 unresolved workbench：筛选、Evidence 预览、候选对比、单条确认、撤销与审计。不得增加“一键全部接受”。

## 8. KG-D3：DeepSeek 异步 proposal 设计与 POC

只有 KG-R3 gold set 完成后才启动。KG-D3 必须是新的 ADR/amendment，不能直接把 `KG_LLM_ENRICHMENT_ENABLED` 改为 `1`。

### 8.1 固定边界

- 复用现有 `deepseekService` 与 `DEEPSEEK_MODEL`，不新增第二套客户端；
- 只由异步 job 调用，不进入 API 同步读路径或 Planning Provider；
- 输出只写 `candidate-proposed` event / proposal，不创建 active link；
- 人工是 synonym、cross-language、义项拆分与语义关系的最终接受者；
- 记录 provider、model、prompt schema/version、输入/输出 hash 和公开解释；
- 教材官方原文默认禁止发送；
- feature flag 默认关闭，失败时不影响学习、KG 查询或队列。

### 8.2 离线 POC 门禁

- gold set 上 proposal precision 达到预先约定目标，建议不低于 90%；
- 错误 proposal 不得改变 active graph；
- 对证据不足 case 能稳定 abstain，而不是强行猜测；
- 同输入、同版本保持幂等；
- 模型/提示版本变化可并排重放和比较；
- token、耗时与失败率有报告；
- 人工审核界面能看到 Evidence、候选、公开理由和 provenance。

POC 未通过时保持确定性 KG v1，不影响 LA-R1/LA-R2 继续运行。

## 9. KG-P4：受控 enrichment proposal

仅在 KG-D3 Accepted 且 POC 通过后实施：

1. 新增独立 proposal outbox/worker 或复用经 ADR 明确允许的异步基础设施；
2. 对来源、case kind 和每日配额建立 allowlist；
3. 默认只处理人工点选的 case；
4. proposal 与人工 decision 分表/分事件，不混淆事实所有权；
5. 小样本启用，人工逐条确认；
6. 通过真实 acceptance/rejection 数据决定是否扩大；
7. 任何时候关闭 enrichment 都不影响确定性 KG、Planning 或 FSRS。

## 10. 后续候选，不进入当前承诺

- synonym 与 cross-language-equiv 的人工关系浏览；
- 基于真实学习错误的 confusion pair 与 prerequisite 候选；
- KP 层 mastery 只读聚合；
- 面向学习任务的局部关系视图，而非装饰性全图；
- 依据 30/60 日真实数据重新评估 Graph signal 权重；
- 更大范围的教材 Track 与三语卡学习计划。

## 11. 交付物

| 阶段 | 必须交付 |
|---|---|
| LA-R1 | 首个真实计划、7 学习日运行记录、真实 queue explanation 验收、测试报告 |
| LA-R2 | 14 学习日聚合报告、负担调整决定、算法保持或 amendment 结论 |
| KG-R3 | unresolved 分布报告、>=50 case gold set、人工裁决流程 |
| KG-D3 | Enrichment ADR、离线 POC、模型/提示版本与安全门禁 |
| KG-P4 | 默认关闭的 proposal worker、人工确认闭环、受控上线报告 |

## 12. 当前立即行动清单

- [x] 用户确认本文顺序和 LA-R1 推荐范围；
- [x] 用户已确认第一份队列使用 `Asia/Tokyo`；
- [x] 创建 LA-R1 运行前备份与基线快照；
- [x] 用户在 `/learn/plan` 创建 Track 01 + 日语语法计划（20/5）；
- [x] 生成第一份真实 Daily Queue；
- [ ] 完成首日功能验收；
- [ ] 开始 7 个真实学习日观察；
- [ ] LA-R1 通过后再启动 KG-R3，不提前开启 LLM enrichment。
