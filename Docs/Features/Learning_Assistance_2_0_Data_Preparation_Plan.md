# 学习辅助 2.0 数据整备实施计划

> 状态：**DP0-DP7 已完成并通过最终验收**
> 日期：2026-07-13
> 上位产品基线：[学习辅助 2.0 设计基线](Learning_Assistance_2_0_Design_Baseline.md)
> 标签专题：[卡片分类与标签系统](Card_Classification_and_Tagging.md)
> 适用数据：Docker volume `three_lans_system_trilingual_records` 中的运行数据
> 边界：本文只负责 Cards Factory 现有数据整备；不定义复习算法，不创建 `study_items`，不恢复旧 SRS/Knowledge schema

## 0. 文档定位与权威边界

本文把“备份、审计、内容同步、异常修复、标签回填、人工确认和音频登记”固化为一条可执行、可回滚的数据整备流水线。它是卡片分类专题的实施前置，也是学习辅助 2.0 进入 LA-D2 数据 ADR 前的数据就绪门禁。

权威关系固定为：

1. 学习辅助 2.0 的产品边界、依赖方向和阶段顺序以上位产品基线为准；
2. `card_tags` schema、命名空间和 API 以标签专题为准；
3. 本文只定义如何安全加工现存数据，不得自行决定学习单元粒度、评分或调度；
4. LA-D2 通过前，禁止创建临时 `study_items`、复习状态表或每日队列表；
5. 任何数据写入必须满足“可恢复备份 + dry-run 报告 + 明确门禁”；任何删除还必须有人工决策记录。

### 0.1 本次执行记录

- Run ID：`20260713T161334+0900`；
- 备份目录：`/Users/xueguodong/WorkTechDir/Three_LANS_PJ_CodeX_Backups/data-preparation/20260713T161334+0900`；
- 审计产物：`.tmp/data-preparation/20260713T161334+0900/`；
- 决策基线：`scripts/maintenance/decisions/card-data-preparation-v1.json`；
- DP7 state hash（在线准入 schema 部署后）：`c14ae7872f2d614cb2171bdb09d60f04b9a7d0428da7a96284a9f59c4ef1461e`；部署前基线为 `1a0a71ec64e6e5be850860cdcef5507af27df101fe1e58cbde2a3598c8206fa1`。

执行后的数据结果：

| 项目 | 结果 |
|---|---:|
| 卡片 / FTS | 635 / 635 |
| Markdown 内容漂移 / 日期错位 / 缺失 Markdown | 0 / 0 / 0 |
| active 标签 | 1715 |
| 音频引用命中 | 2439/2439 |
| 音频登记 / 无引用历史音频 | 2381 / 283 |
| 标红记录 / mark | 8 / 49 |
| DP7 eligible / whole-card-only / quarantined / unresolved | 619 / 1 / 15 / 0 |

整备前基线为 636 张；唯一删除的是 #644。该记录没有 Markdown、HTML、meta 或音频文件，且版本化人工决策指定由完整的 #646 作为同短语 canonical 版本。其余测试卡、内容隔离卡和重复备选版本均保留原记录，只通过标签或 DP7 推荐资格排除。

最终工程验收（2026-07-13）：

- `npm run lint`：通过；
- `npm run test:unit`：246/246 通过；
- `npm run test:integration`：44/44 通过；
- `npm run typecheck:react`：通过；
- `npm run build:react`：通过；
- `npm run test:e2e`：Chromium 26/26 通过；
- `npm run smoke`：7/7 probes 通过；
- Compose 默认四服务已重建；DeepSeek、Kokoro、VOICEVOX、OCR 和 Storage 运行检查均在线；
- 在线准入部署引入 hash 触发器和音频唯一索引，因此 DP7 state hash 按预期变化；635 张历史卡的内容、资格和计数未变化，备份 SHA-256 再次校验通过。

### 0.2 新卡持续准入门禁

DP0-DP7 处理历史数据；新卡由 `executeCardGeneration` 中的在线准入门禁持续满足同一质量边界：

1. 在调用 LLM 前按“规范短语 + 卡型”查询历史卡，默认拒绝重复；只有调用方显式传入 `duplicate_policy=create-version` 才允许生成新版本；
2. DeepSeek 输出必须通过三类卡各自的 canonical Markdown 结构检查：三语卡包含英/日/中三段与英日例句，语法卡包含 3 条日语例句，场景卡包含 12 组中英日表达；
3. 内容与音频先写入目标日期目录下的同卷 `.staging`，不会提前暴露半成品；
4. 非测试环境中，只要 Markdown 含音频任务，就要求全部 TTS 调用成功、文件存在且非空；任何一项失败都拒绝整张卡；
5. 文件发布后，`generations`、observability、`audio_files` 和自动 `card_tags` 在同一个 SQLite 事务中写入；hash、标签或音频约束失败时整体回滚；
6. `content_hash` 使用规范化 Markdown 的 SHA-256。新库以 `NOT NULL` 定义，既有库由 INSERT/UPDATE trigger 强制 64 位 hash；`audio_files(generation_id, filename_suffix)` 唯一；
7. 提交后回读 generation、hash、音频登记和唯一 active `lang:`/`src:` 标签。回读失败会删除刚写入的数据库行和本次发布的精确文件集合；
8. 规则命中 `qa:test-artifact-candidate` 的新卡返回 `review-required`，在人工确认前不得进入未来的 `study_items`；DP7 把 active candidate 视为 unresolved，而不是静默放行；
9. 同步 `/api/generate` 与异步 `/api/generation-jobs` 共用同一 application use case，不存在绕过准入的第二条生产写入路径。

在线准入不是历史 DP 脚本的替代品：规则版本升级、人工 QA 决策和历史重新审计仍由 DP4-DP7 负责。

## 1. 运行数据审计快照

审计对象是运行中容器实际使用的数据，不是仓库内的旧 `.db` 文件：

- Compose project：`three_lans_system`；
- Docker volume：`three_lans_system_trilingual_records`；
- 容器内数据库：`/data/trilingual_records/trilingual_records.db`；
- 容器内卡片根目录：`/data/trilingual_records`；
- 审计时间：2026-07-13；
- 数据库完整性：`PRAGMA integrity_check = ok`，外键违规 0。

| 项目 | 当前值 | 数据整备含义 |
|---|---:|---|
| 卡片 | 636 | 本次整备基数 |
| 卡型 | 三语 445 / 语法 188 / 场景 3 | 三类规则必须分别验证 |
| FTS 行 | 636 | 当前索引数量一致 |
| 磁盘 Markdown 与 DB 内容不一致 | 298 | DP2 必须同步权威内容 |
| 缺失 `en_translation` / `ja_translation` / `zh_translation` | 208 / 634 / 209 | 旧派生列不可作为学习单元来源 |
| 可提取预期学习结构 | 629/636 | 98.9%，无需批量重新生成卡片 |
| 需内容结构复核 | 18 | 其中 7 张无法提取完整预期表达/例句 |
| `folder_name` 与 `generation_date` 不一致 | 132 | DP3 必须统一日期语义 |
| `source_mode` 为空 | 263 | 只能按可信证据回填，其余 unknown |
| 按保守语言规则会改变的历史值 | 499 | 旧 `phrase_language` 不可信 |
| 同卡型同规范短语重复 | 10 组 / 21 张 | 无完全相同 Markdown，不自动去重 |
| 三类卡片文件均缺失 | 1（ID 644） | 单独修复或人工确认删除 |
| 磁盘音频 / DB 音频登记 | 2664 / 259 | DP6 回填历史音频目录 |
| Markdown 音频引用可命中 | 2437/2439 | 只缺 2 个引用文件 |
| 音频完整卡片 | 627 | 现有播放数据总体健康 |
| 标红 | 8 张 / 49 处 | 全部可关联，无需迁移 |

该快照是实施估算基线，不是长期固定验收值。正式执行时必须生成新的只读 manifest，并以 manifest 的数据库哈希和计数作为本轮 run 基线。

## 2. 目标状态与不可破坏不变量

数据整备完成后的目标状态：

1. Docker volume 和 SQLite 都有独立、校验通过、实际演练过的恢复副本；
2. Markdown 文件是卡片内容权威源，`generations.markdown_content` 是与文件一致的查询投影；
3. 每张可用卡都有 `content_hash`，后续学习单元可识别内容版本变化；
4. `generation_date` 与用户可见日期文件夹语义一致，`created_at` 保留真实生成/导入时间；
5. 异常卡、测试卡和重复卡都有可审计决策，不依赖模糊字符串直接删除；
6. `card_tags` 的自动结果都保留 source、rule version、rule key 和 evidence；
7. 磁盘上被卡片引用的历史音频进入 `audio_files`，未知 provider 明确标记 unknown，不伪造来源；
8. 学习辅助可以获得“合格卡片集合”，但 LA-D2 前不存在任何 `study_items` 行。

必须保持：

- `generations.id` 不因内容同步或标签回填变化；
- `request_id`、`created_at`、生成模型和观测记录不重写；
- `generation_jobs` 的历史审计事件不因结果卡已删除而清理；
- `card_highlights` 的 8 条记录和 49 处标红不得丢失；
- 未经人工确认不得删除重复卡、测试候选或无文件卡；
- 不批量调用 DeepSeek 重新生成现存内容；
- 不删除 285 个未被当前 Markdown 引用的音频，先只进入审计清单。

## 3. 阶段总览

| 阶段 | 内容 | 是否写运行数据 | 完成门禁 |
|---|---|---|---|
| DP0 | 备份 Docker volume 和 SQLite | 否 | 两类备份校验并完成恢复演练 |
| DP1 | 生成只读审计 manifest | 否 | manifest 可重复、零数据写入 |
| DP2 | 文件内容同步到 DB，建立 `content_hash` | 是 | 298 个差异归零，FTS 与文件一致 |
| DP3 | 修复日期、异常卡和缺失文件 | 是，按决策执行 | 日期一致；异常卡均有 disposition |
| DP4 | 创建 `card_tags`，执行标签 dry-run | 只建表；不写标签 | dry-run 统计、unknown 和 evidence 通过评审 |
| DP5 | 人工确认并应用测试卡、重复卡、主题长尾决策 | 是 | 决策文件全部可追溯、幂等应用 |
| DP6 | 回填历史音频登记 | 是 | 引用音频与 DB 登记一致，未知来源不伪造 |
| DP7 | LA-D2 前置验收 | 否 | 只输出合格卡集合，不创建 `study_items` |

阶段必须顺序执行。DP1 可以反复运行；DP2-DP6 每个 apply 前都必须重新验证 DP0 备份仍可用，并保存该阶段的 before/after manifest。

## 4. DP0：备份 Docker volume 和 SQLite

### 4.1 备份原则

- 备份目录必须位于仓库外或明确的本地备份根目录，不进入 Git；
- 不直接依赖 Docker Desktop VM 内部的 `/var/lib/docker/volumes/...` 宿主路径；
- 暂停 `viewer` 写入后再做 volume 归档；OCR/TTS 不挂载该数据卷，无需纳入数据备份；
- SQLite 使用 SQLite backup API 生成一致性副本，不能只在运行时直接 `cp` 主 `.db` 而忽略 WAL；
- volume 归档保留 Markdown、HTML、meta、音频、SQLite 及可能存在的 WAL/SHM；
- 所有产物生成 SHA-256，写入同一份备份 manifest。

### 4.2 每次备份产物

```text
<backup-root>/three-lans-data-prep/<run-id>/
  volume.tar.gz
  trilingual_records.sqlite
  backup-manifest.json
  SHA256SUMS
  restore-runbook.md
```

`backup-manifest.json` 至少包含：run ID、时间、Compose project、volume 名、镜像 ID、数据库 schema、表计数、文件数量、数据库哈希、归档哈希和执行命令版本。

### 4.3 验证与恢复演练

1. 对 SQLite 副本运行 `integrity_check` 和 `foreign_key_check`；
2. 解包 volume 到临时 volume，不覆盖生产 volume；
3. 用临时 DB 启动 API-only harness 或一次性容器；
4. 校验卡片数、FTS 数、随机 20 张文件哈希、音频文件数和标红计数；
5. 保存恢复演练结果，完成后删除临时 volume。

没有恢复演练的备份不算 DP0 完成。

## 5. DP1：只读审计 manifest

### 5.1 执行约束

审计器必须以 SQLite readonly 连接和 volume readonly mount 运行；不得执行 `UPDATE`、`INSERT`、`DELETE`、schema migration、HTML 重渲染或 FTS rebuild。

建议实现 `scripts/maintenance/auditLearningData.js`，默认输出到已被 Git 忽略的：

```text
.tmp/data-preparation/<run-id>/
  manifest.json
  summary.md
  records.csv
  content-drift.csv
  date-mismatch.csv
  content-review.csv
  duplicate-groups.csv
  test-artifact-candidates.csv
  audio-reconciliation.csv
```

### 5.2 manifest 内容

每张卡至少记录：

- `generation_id`、卡型、短语、文件夹、日期、来源、模型；
- Markdown/HTML/meta 是否存在及其 SHA-256；
- DB Markdown SHA-256、文件 Markdown SHA-256和是否漂移；
- Markdown 结构解析结果、标题、章节和表达/例句数量；
- 推导的保守语言、规则版本和证据；
- 音频引用、磁盘存在性、DB 登记情况；
- 标红关联状态；
- 重复组、测试候选和异常原因。

manifest 顶层记录 DB hash。DP2-DP6 的 apply 命令必须带 `--expected-manifest=<path>`；如果运行 DB hash 或记录 `content_hash` 与决策文件不一致，立即拒绝执行，防止 stale decision。

## 6. DP2：同步权威内容并建立 `content_hash`

### 6.1 权威源决策

当前 Cards Factory 弹窗读取磁盘 Markdown；2026-07 的样式迁移也只更新了文件，因此：

```text
Markdown 文件 = 内容权威源
generations.markdown_content = 数据库查询投影
HTML 文件 = Markdown 的可重建渲染产物
```

禁止用数据库中 298 份旧 Markdown 反向覆盖现有文件。

### 6.2 schema 与同步行为

迁移阶段先为既有 `generations` 增加可空 `content_hash TEXT` 并完成回填；最终新建 schema 使用 `content_hash TEXT NOT NULL`。SQLite 既有表无法原地收紧列定义，因此运行库另由 INSERT/UPDATE trigger 强制非空且长度为 64。hash 格式固定为规范化 Markdown 的 SHA-256，后续新卡必须在同一事务中写入 Markdown 投影和 hash。

建议实现 `scripts/maintenance/syncCanonicalMarkdown.js`：

1. 默认 dry-run，列出文件/DB hash 差异和预期更新字段；
2. ID 644 因文件缺失必须跳过，不得用 DB 自动重建；
3. apply 时读取文件 Markdown，规范化换行但不改写正文；
4. 更新 `markdown_content`、`content_hash` 和 `updated_at`；
5. 三语卡使用统一 parser 重建可可靠提取的翻译投影；语法卡和场景卡不强行塞入不匹配的三语投影列；
6. 依赖现有 update trigger 更新 FTS，随后验证 FTS 行数和搜索样本；
7. 每 50 张一个事务批次，任一批失败则该批全部回滚；
8. 输出 before/after hash，不删除任何文件。

### 6.3 验收

- 除人工未决 ID 644 外，文件 Markdown hash 与 DB `content_hash` 一致；
- 当前 298 个内容漂移归零；
- FTS 行数仍等于 generations 行数；
- 随机 20 张卡经 Cards Factory 打开后内容、ruby、音频按钮和标红无回归；
- 新生成卡片不会再次产生文件/DB 漂移。

## 7. DP3：日期、异常卡和缺失文件

### 7.1 日期语义

正式定义：

- `created_at`：实际生成或导入发生时间，保持不变；
- `generation_date`：用户可见的卡片归档日期；
- 八位日期 `folder_name`：归档分组键，必须与 `generation_date` 一致；
- `target_folder` 指定日期文件夹时，持久化逻辑必须由目标文件夹生成 `generation_date`；未指定时按 `RECORDS_TIMEZONE` 计算，禁止裸 UTC `date`。

一次性修复 132 个不一致记录：只把 `generation_date` 改为有效日期文件夹对应日期，不改 `created_at`。保育园 30 张保持归档日 2026-07-13，原始创建时间继续保留。

### 7.2 内容结构复核

当前需要进入人工复核的 18 张：

```text
300, 328, 346, 383, 411, 412, 413, 416, 425,
438, 459, 471, 600, 601, 699, 709, 743, 836
```

允许的 disposition：

- `repair`：删除 LLM 推理前言、补齐标题或修正既有 Markdown 结构，不重新生成语义内容；
- `keep-as-whole-card`：结构不能拆分但整卡仍可学习；
- `quarantine`：暂不进入未来学习池；
- `delete`：只在明确无学习价值且有人工理由时执行。

修复必须产生新的 `content_hash`，并重新运行 DP2 同步和解析验收。

### 7.3 缺失文件

ID 644 的 Markdown、HTML、meta 均缺失，数据库仍有内容，且同短语存在 ID 646。默认不自动重建或删除，人工在以下两种决策中选择：

- 保留 ID 646，确认删除 ID 644；
- 从 ID 644 的数据库内容重建三类文件，并继续保留两个版本。

### 7.4 重复短语

当前 10 个重复组：

```text
[380,382] [404,653] [424,856] [477,478] [509,510]
[521,549] [610,611] [639,640] [644,646] [883,912,954]
```

这些组没有完全相同的 Markdown，禁止按短语自动删重。人工选择 `keep-all`、`canonical + quarantine-alternates` 或逐张删除；选择 canonical 时必须记录理由、模型、日期和 hash。

## 8. DP4：创建 `card_tags` 并执行 dry-run

### 8.1 schema 落地边界

按标签专题创建表 20 `card_tags`、约束和索引。该步骤允许创建空表，但在 dry-run 与人工评审通过前不得写入自动标签。

数据库启动兼容迁移、测试 reset 和 API-only harness 必须同步认识新表；不得恢复任何旧 knowledge/SRS 表。

### 8.2 语言回填

旧 `phrase_language` 来自“先检测汉字”的历史规则，不可直接当真值。保守 `tagrules-v1` 预期：

| 范围 | `lang:` | 数量 | 证据 |
|---|---|---:|---|
| 语法卡 | `ja` | 188 | card_type 固定语义 |
| 场景卡 | `zh` | 3 | 当前原始场景均为中文 |
| 三语卡 | `ja` | 98 | 含假名且无拉丁混合 |
| 三语卡 | `en` | 92 | 拉丁文本 |
| 三语卡 | `mixed` | 12 | 汉字/假名与拉丁混合 |
| 三语卡 | `unknown` | 243 | 纯汉字，中日语无法仅凭字符可靠区分 |

这会使 499 张卡的结果不同于旧字段。v1 不覆盖旧字段，写入带 rule/evidence 的 `lang:` 标签；学习辅助不得直接消费旧 `phrase_language`。

### 8.3 来源回填

可信回填预期：

| `src:` | 数量 | 依据 |
|---|---:|---|
| `input` | 162 | 原 `source_mode=input` |
| `selection` | 51 | 原 `source_mode=selection` |
| `manual` | 160 | 原 `source_mode=manual` |
| `hoikuen-import` | 30 | 固定导入清单 + generation ID/hash，不只看文件夹 |
| `unknown` | 233 | 无可信来源证据 |

日期、模型或卡型不能单独证明来源。233 张 unknown 是正常结果，不为追求覆盖率伪造 `legacy-import`。

### 8.4 `fn:`、`topic:` 和 `qa:`

- `fn:`：188 张语法卡中 148 张可由中英文冒号注释直接提取；额外句式规则只提高高置信覆盖，未命中留空；
- `topic:`：关键词只产高置信候选，长尾留给 DP5 批量确认，不默认写 `general`；
- `qa:`：规则只能写 `test-artifact-candidate`，不能直接确认测试卡；
- 当前高置信测试候选为 ID `402, 467, 477, 478, 493, 496`；
- ID 929 含“二次验证”但是真实场景卡，必须作为防误伤回归样例。

### 8.5 dry-run 产物与门禁

`backfillCardTags.js` 默认只输出：命中数、unknown 清单、未命中清单、规则版本、rule key、evidence、测试候选、topic 候选和预计 SQL 操作数。

DP4 通过条件：

- 同一张卡的 `lang:`/`src:` 只有一个预计 active 值；
- 243 个语言 unknown 和 233 个来源 unknown 不被隐式兜底；
- ID 929 未被确认为测试卡；
- dry-run 重复两次输出相同；
- `card_tags` 仍为空或只含显式人工标签。

## 9. DP5：人工确认与决策应用

### 9.1 决策文件

人工结果保存为版本化 JSON，不把临时 UI 状态当唯一事实。建议路径：

```text
scripts/maintenance/decisions/card-data-preparation-v1.json
```

每条决策必须包含：`generation_id`、决策类型、decision、reason、reviewed_at、reviewed_by、审计时 `content_hash`。允许的决策域：

- 测试候选：`confirm` / `reject`；
- 重复组：`keep-all` / `canonical` / `delete-selected`；
- 内容异常：`repair` / `keep-as-whole-card` / `quarantine` / `delete`；
- topic 长尾：零个或多个受控 `topic:` 值；
- ID 644：`rebuild` / `delete`。

### 9.2 应用规则

建议实现 `applyDataPreparationDecisions.js`，默认 dry-run。apply 前逐条比较当前 `content_hash`；hash 变化则拒绝旧决策。

- 测试确认：suppress candidate，activate `qa:test-artifact`；
- 测试驳回：只 suppress candidate；
- candidate 与 confirmed 不得同时 active；
- topic 人工确认写 `source=user`；
- 删除必须在同一事务中删除 DB 行，并调用既有文件清理能力；
- quarantine 不等于删除，保留卡片和审计记录；
- 所有操作写入 before/after 报告并可重复执行。

人工确认不是一次“全部点通过”。测试候选、重复组、异常内容和 topic 长尾分别评审，任何一类未完成不得阻挡其它类别保存，但 DP7 要求所有影响学习资格的决策已关闭。

## 10. DP6：回填历史音频登记

### 10.1 当前差异

- 磁盘音频 2664 个：WAV 1748、MP3 916；
- `audio_files` 仅登记 259 个；
- 2405 个磁盘音频尚未登记；
- Markdown 共引用 2439 次，对应 2381 个不同路径；
- 2437 次引用文件存在，缺失 2 次；
- 627 张卡引用完整，1 张部分缺失，8 张无音频引用；
- ID 485“哈希”缺少两个日语引用文件；
- 285 个物理音频未被当前 Markdown 引用，可能是旧扩展名或历史版本，禁止自动删除。

### 10.2 回填策略

建议实现 `backfillAudioRegistry.js`：

1. 只登记能通过 `folder_name + base_filename + suffix` 稳定关联到 generation 的物理文件；
2. 已登记的 259 行保持原 provider/model/voice；
3. 历史未知来源统一 `tts_provider='legacy-unknown'`，model/voice 保持 NULL；
4. 从 suffix 推导 `language`，从文件获取格式和大小；时长/采样率仅在可靠解析时填写；
5. `status='generated'` 只用于文件实际存在的记录；
6. apply 前检查 `(generation_id, filename_suffix)` 无重复，再增加唯一索引或采用幂等 upsert；
7. 缺失的两个日语文件单独确认是否重建，不把回填脚本变成批量 TTS 任务；
8. 285 个未引用文件只输出清单，后续另立清理任务。

DP6 不要求所有卡都有音频。无音频卡仍可作为整卡学习对象；是否要求特定学习单元具备音频，由 LA-D2 决定。

## 11. DP7：LA-D2 前置验收与 `study_items` 门禁

DP7 只生成“学习资格视图/报告”，不建表。每张 generation 给出：

- canonical content hash；
- 文件和结构状态；
- active 标签及 evidence；
- 测试/隔离/重复决策；
- 音频可用性；
- 推荐资格：eligible / whole-card-only / quarantined / unresolved。

只有以下 LA-D2 决策完成后，才允许设计和生成 `study_items`：

1. 三类卡的学习单元粒度；
2. 卡片删除与历史事件保留策略；
3. 内容 hash 变化后的学习状态迁移；
4. 学习日时区和跨午夜规则；
5. 场景卡 12 个表达是否拆分；
6. 无音频或结构不完整卡片的资格规则；
7. 重复版本是独立学习对象还是只保留 canonical；
8. 评分与调度算法的输入边界。

未来 materialize 时必须幂等，建议身份键至少包含 `generation_id + unit_key`，内容变化由 `content_hash` 触发显式迁移；不得以知识图谱节点作为必需外键。

## 12. 预计代码与产物清单

| 文件/目录 | 作用 |
|---|---|
| `scripts/maintenance/backupLearningData.js` | SQLite 一致性备份与备份 manifest |
| `scripts/maintenance/auditLearningData.js` | readonly 数据审计 |
| `scripts/maintenance/syncCanonicalMarkdown.js` | 文件到 DB 内容同步与 hash 回填 |
| `scripts/maintenance/repairCardCatalogData.js` | 日期及已确认目录数据修复 |
| `scripts/maintenance/backfillCardTags.js` | 标签 dry-run/apply |
| `scripts/maintenance/applyDataPreparationDecisions.js` | 幂等应用人工决策 |
| `scripts/maintenance/backfillAudioRegistry.js` | 历史音频登记 |
| `scripts/maintenance/buildLearningEligibilityReport.js` | DP7 只读学习资格报告 |
| `scripts/maintenance/decisions/card-data-preparation-v1.json` | 版本化人工决策 |
| `services/storage/db/cardTags.js` | 标签存储域 |
| `database/schema.sql` | `content_hash` 与表 20 |
| `.tmp/data-preparation/<run-id>/` | 不入 Git 的审计和执行报告 |

脚本命名是实施基线；若实现时沿用更符合仓库现状的命名，必须保持职责分离、默认 dry-run 和 expected manifest 防护。

## 13. 测试与验收

### 13.1 自动测试

- Unit：hash 规范化、语言/source/fn/topic/qa 规则、suppressed 行为、决策 stale hash 拒绝、音频路径解析、重复策略、三类卡结构准入、严格 TTS、staging 发布与失败补偿；
- Integration：schema migration、FTS 更新、级联删除、标签事务、在线生成/队列的重复策略与准入回读、API-only harness；
- Migration fixture：构造文件/DB 漂移、日期错位、缺失文件、重复短语、未知来源和未登记音频；
- E2E：随机卡片打开、音频播放、ruby、标红和标签筛选不回归；
- Restore test：从备份恢复到临时 volume 后运行 smoke。

### 13.2 最终验收清单

- [x] volume 和 SQLite 双备份存在，SHA-256 正确，恢复演练通过
- [x] DP1 readonly manifest 已保存，重复运行结果稳定
- [x] 文件与 DB Markdown hash 一致，ID 644 有明确 disposition
- [x] 132 个日期错位已关闭，新增链路使用目标文件夹/配置时区
- [x] 18 个内容复核项都有决策，7 个结构不完整项不被误拆
- [x] 10 个重复组均有人工结论，无自动误删
- [x] `card_tags` schema 落地，dry-run 和 evidence 通过评审
- [x] 测试候选全部确认或驳回，ID 929 保持非测试卡
- [x] topic 长尾决策可追溯；unknown 未被强制兜底
- [x] 被 Markdown 引用的历史音频完成登记或明确缺失
- [x] 8 条标红、49 个 mark、636 基线卡片的增删变化均有解释
- [x] lint、unit、integration、E2E、smoke 和恢复测试全绿
- [x] 新卡生成使用 staging、严格 TTS、事务标签/hash/音频、持久化回读和精确失败补偿
- [x] 默认拒绝历史重复；显式 `create-version` 才允许建立新版本
- [x] LA-D2 前没有创建 `study_items` 或其它学习领域临时表

## 14. 回滚策略

| 失败点 | 回滚方式 |
|---|---|
| DP2 内容同步 | 用 before manifest 反向恢复 DB 字段；必要时恢复 SQLite 副本 |
| DP3 日期/文件修复 | 恢复 SQLite；文件操作从 volume 归档恢复 |
| DP4 schema | 无标签数据时可删除新表/列；优先恢复 DB 副本 |
| DP5 人工决策应用 | 非删除操作按 before 报告回放；删除操作必须从双备份恢复 |
| DP6 音频登记 | 只删除本 run 新增的 registry 行，不删除物理音频 |

回滚后必须重新运行 DP1，确认数据库完整性、文件 hash、FTS、音频和标红计数回到目标快照。不得用 `git checkout`、容器重建或镜像回退替代数据恢复。

## 15. 明确非目标

- 不重新生成 636 张卡；
- 不批量重跑 DeepSeek、OCR 或 TTS；
- 不自动删除测试候选、重复卡或未引用音频；
- 不在数据整备阶段实现复习页面、学习计划或调度算法；
- 不构建知识图谱、聚类或关系抽取；
- 不创建旧 SRS/Knowledge 表的兼容层；
- 不开展移动端设计或验收；
- 不在 LA-D2 前创建 `study_items`。

完成本文 DP0-DP7 后，系统得到的是一套一致、可审计、可筛选的卡片语料和合格卡集合。学习辅助 2.0 再基于 LA-D2 的正式领域决策创建学习单元，而不是让数据清理脚本暗中决定产品模型。
