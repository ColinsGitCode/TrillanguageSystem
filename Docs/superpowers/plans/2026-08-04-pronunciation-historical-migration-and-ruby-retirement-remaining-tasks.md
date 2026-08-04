# 日语历史注音迁移与 Ruby 运行时退役剩余任务表

> 日期：2026-08-04（Asia/Tokyo）
> 状态：**Draft · 仅定义剩余执行任务，不授权历史 `--apply`、关闭 legacy reader 或删除 Ruby**
> 角色：这是现有 76 项总计划的收尾执行清单，不重新定义产品、数据模型或 API。
> 上位基线：`Japanese_Pronunciation_Overlay_and_Ruby_Retirement_Design.md`、对应 ADR、总实施计划和运行手册。

## 0. 结论与范围

本清单只处理四件事：

1. 完成历史内容的人工准入；
2. 执行可回滚的 PF-P4 Canary；
3. 分批建立历史 pronunciation 投影并退役生产 Ruby 读取/渲染链路；
4. 完成至少 7 个真实使用日的 PF-R1 观察。

“Ruby 退役”在本文中表示：**活动生成、页面、Review、选区和 API 不再读取或渲染 Ruby**。
历史 Markdown 中原有的 Ruby 继续作为不可变审计/迁移输入保存，不物理清洗 672 张原卡，不重算
generation `content_hash`，不重写 annotation、Study Item 或 Review Event。

## 1. 当前真实基线

以下数字于 2026-08-04 从运行中的 `three_lans_system` 真实卷只读复核：

| 项目 | 数量 |
|---|---:|
| generation 总数 | 675 |
| 含 Ruby 的历史卡 | 672 |
| Ruby 标签 | 13,528 |
| 不同 Ruby 基文 | 2,829 |
| 相邻复合词候选 | 466 |
| eligible | 612 |
| ready | 487 |
| partial | 125 |
| unresolved token | 340 |
| needs-review | 60 |
| excluded | 3 |
| 目标 pronunciation token | 31,837 |
| records 目录 | 约 846 MB |
| SQLite | 约 37 MB |

当前 `pronunciation_documents`/`pronunciation_tokens` 中未经批准的 5 条旁路投影已经备份并清理；
`GET /api/pronunciation` 已验证为零写入。当前仍维持 PF-P4、PF-P5、PF-R1 **BLOCKED**。

## 2. 不可突破的执行规则

1. analyzer、Kuromoji、LLM 和脚本输出只能是候选，不能自动成为人工接受事实。
2. 任何真实写入前必须有 SQLite online backup、records/volume 备份、SHA-256 和恢复验证。
3. 所有 apply 必须绑定 generation id、content hash、manifest hash 和批准人。
4. 60 张结构问题卡的处理与 pronunciation 迁移分开提交、分开报告、分开回滚。
5. GET、Review、Tooltip、Popover 和普通浏览不得创建历史 pronunciation document。
6. 迁移不修改 generation Markdown、content hash、annotation、KG、LA、FSRS 或教材原文。
7. Canary 必须真实执行一次回滚，再重新前进；没有回滚证据不得扩大范围。
8. 关闭 legacy reader 前，活动 legacy hit 必须连续两次为零。
9. PF-R1 只统计真实使用日；空闲日、自动化测试日不能冒充实际观察日。
10. 当前只做桌面端，不新增移动端设计、实现或验收。

## 3. 角色与状态标记

| 标记 | 含义 |
|---|---|
| `AUTO` | Codex 可按既有工具自动执行并产出证据 |
| `HUMAN` | 必须由用户逐项确认或批准 |
| `READ` | 严格只读，不允许修改真实 SQLite/records |
| `WRITE` | 会修改真实业务数据或活动代码，必须满足前置门禁 |
| `TIME` | 需要真实日历时间，不能用测试替代 |

任务状态统一使用 `[ ] pending`、`[~] in progress`、`[x] completed`、`[!] blocked`。

---

## Gate A：人工准入与迁移输入冻结（A01-A08）

### A01 `[ ]` 冻结源快照（AUTO / READ）

- **输入**：当前真实 SQLite、records volume、Git SHA、Compose 服务状态。
- **动作**：记录 generation 数、Ruby inventory、eligibility、annotation 和学习域计数；保存源 SHA。
- **输出**：Git 外只读 snapshot manifest 和脱敏摘要。
- **完成标准**：同一快照连续两次审计 hash 一致；`GET /api/pronunciation` 前后 document/token 计数不变。

### A02 `[ ]` 创建并恢复验证备份（AUTO / READ）

- **动作**：SQLite online backup；备份 records/volume；计算 SHA-256、大小和时间；恢复到隔离目录。
- **验证**：恢复副本 `integrity_check=ok`、`foreign_key_check=[]`，可运行 inventory/eligibility。
- **回滚证据**：记录恢复命令和恢复副本 hash，不覆盖既有备份。
- **完成标准**：不仅“文件存在”，还必须证明恢复副本可读。

### A03 `[ ]` 重新生成 eligibility 与迁移候选（AUTO / READ）

- **动作**：运行 Ruby inventory、eligibility、compound candidates、migration manifest 和 shadow replay。
- **输出**：612 eligible、60 needs-review、3 excluded 等当前数字；变化必须解释。
- **完成标准**：两个独立运行结果排序稳定、manifest hash 一致；无 SQLite/records 写入。

### A04 `[ ]` 裁决 60 张结构问题卡（HUMAN / READ）

- **允许决策**：`repair`、`archive`、`exclude`、`false-positive`。
- **动作**：逐张查看标题、模型规划残留、工具残留、卡型与当前学习价值。
- **输出**：填充 `pronunciation-content-eligibility-v1` decisions manifest；每条绑定 generation id/content hash。
- **完成标准**：60/60 有决定、理由和批准记录；不得以默认值批量通过。

### A05 `[ ]` 独立处理获批的异常卡决定（AUTO + HUMAN / WRITE）

- **前置**：A02、A04 完成，用户批准精确清单。
- **动作**：先 dry-run；按清单修复、归档或排除；保存前后 hash。
- **验证**：近期正常卡零误伤；annotation、学习 eligibility 和 generation 计数变化符合清单。
- **回滚**：从 A02 恢复或按结果 manifest 逐项还原。
- **完成标准**：结构问题处理报告 PASS；pronunciation 迁移尚未开始。

### A06 `[ ]` 审核 466 个复合词候选（HUMAN / READ）

- **输入**：19 个批次，默认每批 25 项；展示组件、原 Ruby 证据、上下文和 analyzer 提案。
- **允许结果**：接受整词、保持分词、需要词典证据、单卡 manual override、拒绝候选。
- **输出**：版本化 accepted-source manifest；不得把 analyzer proposal 直接升级成 dictionary fact。
- **完成标准**：466/466 状态明确，且每个 accepted 整词有人工或权威词典来源。

### A07 `[ ]` 复核剩余 unresolved token（AUTO + HUMAN / READ）

- **前置**：A06 的 accepted 词典/规则在临时副本重放。
- **动作**：重新计算 340 个 unresolved；剔除已被复合词裁决解决的重叠项。
- **输出**：剩余 unresolved 分类：可接受待确认、单卡纠音、内容残留、必须阻塞。
- **完成标准**：所有活动卡都有 `ready`、批准的 `partial` 或明确排除状态。

### A08 `[ ]` 批准 Canary 范围与回滚方案（HUMAN / READ）

- **建议范围**：20-30 张，覆盖三种卡型、不同年代、ready/partial、含/不含 annotation。
- **输出**：精确 generation id/content hash 列表、manifest hash、预期 document/token 数、回滚步骤。
- **批准点 1**：用户明确批准后，才允许进入 Gate B 的首次真实 pronunciation 写入。

---

## Gate B：PF-P4 小范围 Canary（B01-B06）

### B01 `[ ]` 生成锁定的 Canary manifest（AUTO / READ）

- **前置**：A01-A08 全部完成。
- **动作**：只从批准范围裁剪 manifest；重新校验当前 generation content hash。
- **完成标准**：范围、数量、hash 与 A08 完全一致；stale 任一项立即停止。

### B02 `[ ]` 执行 Canary dry-run（AUTO / READ）

- **动作**：运行 apply 工具但不传 `--apply`；输出 would-create 和零写入证据。
- **验证**：documents/tokens、generation、annotation、Review Event、schedule states 前后不变。
- **完成标准**：dry-run 结果可由 B01 manifest 精确复算。

### B03 `[ ]` 应用获批 Canary（AUTO / WRITE）

- **前置**：B02 PASS；再次确认 A02 备份可恢复。
- **动作**：只对 B01 清单显式 `--apply`；写 pronunciation document/token，不改 generation。
- **输出**：document id、revision、status、result hash 和耗时。
- **完成标准**：写入数量与 manifest 一致；SQLite integrity 和外键检查通过。

### B04 `[ ]` 执行 Canary 跨域验收（AUTO + HUMAN / READ）

- **范围**：Cards Factory、Review、教材、Tooltip、Popover、选区、标红、TTS、KG、LA、派生卡。
- **验证**：annotation shadow replay 新增 orphaned 为零；学习调度与 Review Event hash 不变。
- **人工检查**：逐张观察词语边界、读音、整词选择和“读音待确认”状态。
- **完成标准**：没有 P1 数据污染、错位注音或交互阻断。

### B05 `[ ]` 回滚并重新应用 Canary（AUTO / WRITE）

- **动作**：删除/撤销本次 Canary 活动投影或恢复副本；证明页面回到 legacy fallback；再次应用同一 manifest。
- **验证**：回滚后和重应用后的计数/hash 与预期一致；重复 apply 幂等。
- **完成标准**：双向操作真实成功，不接受纸面回滚方案。

### B06 `[ ]` PF-P4 准入评审（HUMAN / READ）

- **输出**：Canary 数据、截图、正确性抽样、回滚、annotation 和跨域报告。
- **批准点 2**：用户明确确认 PF-P4 PASS 后，才允许 Gate C 全量迁移。
- **失败处理**：保留 legacy reader，修复问题后重新从 B01 开始，不模糊进入 PF-P5。

---

## Gate C：PF-P5 全量迁移与生产 Ruby 退役（C01-C06）

### C01 `[ ]` 全量迁移前重新锁定快照（AUTO / READ）

- **动作**：重新生成完整 manifest；对比 B06 后新增卡、内容 hash、词典版本和 analyzer 版本。
- **前置**：创建新的全量迁移备份并恢复验证，不能复用过期备份代替当前快照。
- **完成标准**：全部 eligible 状态可解释，manifest 未 stale。

### C02 `[ ]` 分批应用历史 pronunciation 投影（AUTO / WRITE）

- **建议批次**：每批 50-100 张；每批保存 checkpoint 和 result hash。
- **目标规模**：当前约 612 documents / 31,837 tokens，实际以 C01 为准。
- **动作**：每批校验 content hash、幂等、冲突和 status；失败立即停止后续批次。
- **完成标准**：全部批准 eligible 项已迁移；排除项和历史原文未修改。

### C03 `[ ]` 全量数据与跨域不变量验收（AUTO / READ）

- **验证**：SQLite integrity、foreign keys、generation/annotation/KG/LA/FSRS/教材 hash、shadow replay。
- **要求**：普通 GET 连续读取仍零写入；无未批准 correction event；迁移重跑幂等。
- **完成标准**：所有差异都能由批准 manifest 解释。

### C04 `[ ]` 关闭 legacy reader 的运行演练（AUTO + HUMAN / WRITE）

- **动作**：在保留可回退配置的前提下设置 `PRONUNCIATION_LEGACY_RUBY_READER_ENABLED=0`。
- **验证**：连续两次活动审计 legacy hit 为零；历史卡、教材和 Review 可读。
- **批准点 3**：用户确认体验和数据均正常后，才允许物理删除生产兼容代码。
- **回滚**：重新开启 flag，不回滚 correction fact，不修改历史原卡。

### C05 `[ ]` 删除生产 Ruby 生成与渲染依赖（AUTO / WRITE CODE）

- **范围**：`toRuby()`、`normalizeJapaneseRuby()` 的生产调用、`rt/rp` CSS、selection/text projection fallback、活动 fixture。
- **保留**：只读 inventory、ruby parser、迁移/档案工具和最小架构白名单。
- **验证**：生产路径无未解释 Ruby reader；故意恢复生产 Ruby 时 architecture gate 必须失败。
- **完成标准**：活动生成 Markdown、API view-model 和 DOM 均零 Ruby。

### C06 `[ ]` PF-P5 完整生产验收（AUTO + HUMAN / READ）

- **动作**：全量 lint、typecheck、unit、integration、E2E、visual、architecture、smoke、真实三类生成。
- **运行态**：重建 `three_lans_system`，不删除 volume；四容器正常、health 200。
- **人工验收**：历史卡、教材、Review、注音、标红、TTS、KG、LA。
- **完成标准**：PF-P5 报告 PASS；Ruby 只存在于历史数据和只读迁移工具。

---

## Gate D：PF-R1 真实运行观察与最终封板（D01-D04）

### D01 `[ ]` 冻结无正文 telemetry 基线（AUTO / READ）

- **指标**：token source/status、耗时、错误码、长度、stale、unresolved、correction、legacy hit。
- **隐私**：不得记录完整 surface、reading、卡片正文或教材原文。
- **完成标准**：指标可复算，telemetry 可关闭，测试访问不计为真实学习日。

### D02 `[ ]` 完成至少 7 个真实使用日（HUMAN / TIME）

- **每日检查**：Tooltip/Popover、整词选择、右键/工具条、TTS/KG 降级、Portal/请求泄漏、legacy hit。
- **记录**：当天是否真实学习、使用页面、异常类别和处理状态。
- **完成标准**：7 个实际使用日，无未解决 P1；空闲日不计数。

### D03 `[ ]` 处理真实纠音与 unresolved 反馈（AUTO + HUMAN / WRITE）

- **动作**：区分可泛化词典/规则和单卡 manual override；重放 correction event。
- **重点样本**：`一人`、复合词、人名、地名和纯汉字内容残留。
- **验证**：规则升级不复活已 reject 结果，不把私有句子写入通用词典。
- **完成标准**：错误率下降，analyzer/dictionary version 与变更证据同步。

### D04 `[ ]` PF-R1 与 Ruby 退役最终确认（HUMAN / READ）

- **输出**：真实使用日、legacy hit、correction/unresolved、跨域边界、剩余风险和回滚结论。
- **批准点 4**：用户确认 PF-R1 PASS，更新总计划、设计、ADR、运行手册和 Docs 索引为正式退役状态。
- **完成标准**：可以诚实声明“活动系统零 Ruby”；不得声明历史档案已物理删除。

---

## 4. 推荐工期与关键路径

| 工作 | 人工/工程估算 |
|---|---:|
| A01-A08 人工准入 | 2.5-5 人日 |
| B01-B06 Canary | 1-2 人日 |
| C01-C06 全量迁移与退役 | 2.5-4 人日 |
| D01-D04 观察与封板 | 0.5-1 人日 + 至少 7 个真实使用日 |
| **合计** | **约 7-11 人日，日历时间约 2-3 周** |

关键路径是 `A04/A06 人工裁决 -> A08 批准 -> B05 真实回滚 -> B06 批准 -> C04 legacy hit 清零
-> C06 PF-P5 -> D02 七个真实使用日 -> D04 最终确认`。

## 5. 执行进度总表

| Gate | 任务 | 当前状态 | 允许的下一步 |
|---|---:|---|---|
| A 人工准入 | A01-A08 | Pending | 只读审计、备份、人工 decisions |
| B PF-P4 Canary | B01-B06 | Blocked by A08 | 不允许 `--apply` |
| C PF-P5 | C01-C06 | Blocked by B06 | 不允许关闭 legacy reader 或删 Ruby |
| D PF-R1 | D01-D04 | Blocked by C06 | 不允许提前累计观察日 |

## 6. 完成后的文档治理

每个 Gate 完成后更新对应测试报告，不新建互相竞争的架构基线：

- Gate A/B 更新 `Pronunciation_PF_P4_Historical_Canary_20260803.md`；
- Gate C 更新 `Pronunciation_PF_P5_Ruby_Retirement_20260803.md`；
- Gate D 更新 `Pronunciation_PF_R1_Observation_20260803.md` 和 Final Acceptance；
- 总实施计划仅同步任务状态和最终数字；
- `Docs/README.md` 始终标明当前是否仍 BLOCKED。

在 D04 之前，本文件和上位计划均不得写成“Ruby 退役完成”。
