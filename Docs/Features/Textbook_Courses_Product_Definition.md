# 教材课程产品定义（TC-D0）

> 状态：**TC-D0、TC-D1 已确认（2026-07-14）；TC-D2 ADR 已完成，待用户确认后进入 TC-P0**
> 日期：2026-07-14
> 当前运行基线：[CLAUDE.md](../../CLAUDE.md)
> 学习产品基线：[学习辅助 2.0 产品定义](Learning_Assistance_2_0_Product_Definition.md)
> 学习领域基线：[学习辅助 2.0 领域与数据 ADR](../Architecture/Learning_Assistance_2_0_Domain_and_Data_ADR.md)
> 当前边界：本文定义一个位于 `generations` 上游的教材内容域；不实现 schema、API、页面或 Skill，不恢复旧 Knowledge/OCR/SRS 产品

## 0. 文档定位与权威边界

本文是教材课程（Textbook Courses）的 TC-D0 产品定义，负责回答：用户如何把本地教材截图和官方 Track 音频转成可校对、可浏览、可派生卡片、可进入学习辅助 2.0 的课程内容。

本文属于新的产品专题，不替代当前正式架构，也不修改学习辅助 2.0 已确认的调度、评分和事件语义。权威关系固定为：

1. 当前运行架构、文件访问安全和 Markdown 渲染约束以根目录 `CLAUDE.md` 与实际代码为准；
2. 本文是教材课程用户任务、产品术语、内容边界和 v1 行为的权威来源；
3. LA-D0/LA-D2 继续拥有 Study Item、计划、队列、评分、Review Event 和调度语义；
4. TC-D1 只把本文转换为桌面交互原型，不得发明未确认的产品能力；
5. TC-D2 决定实体、表、迁移、Manifest schema、API、文件根和版本策略，但不得改变本文的用户承诺；
6. `import-textbook-track` Skill 负责本地识别与结构化，不拥有正式业务数据，也不得直接写 SQLite；
7. 知识图谱 2.0 不是教材课程 v1 的依赖，未来只能作为可选分析或排序信号接入。

## 1. 产品结论

教材课程 v1 是面向单个本地学习者的**桌面教材学习工作台**。它既不是 Cards Factory 的第四种自由生成模板，也不是把教材截图交给应用内 OCR 后直接生成一张场景卡。

核心承诺是：

> 用户定期提供一个 Track 的本地截图和官方音频后，系统能够在人工确认原文的前提下，形成按原顺序浏览的英日中教材页面，并把需要长期掌握的表达安全地接入现有卡片生产和学习辅助 2.0。

产品闭环固定为：

```text
本地截图 + 官方 Track 音频
  -> Codex 调用专用 Skill 生成本地 draft Manifest
  -> 用户校对英日原文、中文释义、ruby、重点和音频绑定
  -> 确认并生成 textbook_track generation 投影
  -> 浏览、播放、标红和派生学习卡
  -> 用户显式“加入学习”
  -> 物化 textbook_en / textbook_ja Study Item
  -> 复用学习辅助 2.0 的队列、评分、调度和历史
```

## 2. 目标用户与使用情境

### 2.1 目标用户

- 单个本地用户；
- 中文母语，同时学习教材中的英语与日语；
- 拥有合法购买的纸质教材及配套本地音频；
- 使用桌面浏览器，希望保持教材顺序学习，又需要系统的发音、标红、派生卡和间隔复习能力；
- 会持续按 Track 提供截图，而不是一次性导入整本书。

### 2.2 主要使用情境

1. **新增 Track**：把一组截图和一个官方音频路径交给 Codex，由专用 Skill 生成待确认草稿；
2. **校对导入**：逐条确认英日配对、中文释义、ruby、重点词组、语法提示和编辑备注；
3. **跟随教材学习**：按原顺序播放官方 Track，逐条阅读英日中表达并播放合成语音；
4. **精读与跟读**：重复播放单句英语或日语合成音频，比较官方整轨和独立发音；
5. **形成个人重点**：标红选区，或把一个单词、短语、语法结构派生为普通学习卡；
6. **进入长期学习**：确认整个 Track 后显式加入学习计划，由现有 SRS 控制每日节奏；
7. **后续纠错**：发现识别或解释问题时保留教材原文和修订历史，不静默覆盖来源。

### 2.3 非目标用户

v1 不面向教材出版、内容分发、多人课堂、教师作业、云端书库、DRM 绕过、移动端学习或公开分享教材内容。

## 3. 用户任务

| ID | 用户任务 | 完成标准 |
|---|---|---|
| TC-J1 | 建立教材与 Track | 能以稳定课程标识、Track 编号和显示标题组织本地教材 |
| TC-J2 | 通过 Skill 导入截图 | 多张截图按页序形成一个本地 draft，应用内 OCR 不参与 |
| TC-J3 | 校对结构化内容 | 每组表达有一个官方英文、一个官方日文、一个派生中文及独立置信度 |
| TC-J4 | 绑定官方音频 | Track 页面可播放受控本地官方音频，原文件不被修改或覆盖 |
| TC-J5 | 浏览教材表达 | 能按原顺序查看英日中内容，日语 ruby 只标注对应汉字 |
| TC-J6 | 核对发音 | 每组表达可分别播放 English/Japanese 合成音频，且不会与官方音频同时播放 |
| TC-J7 | 标记个人重点 | 选区可持久化标红，重开页面后仍可见 |
| TC-J8 | 派生学习卡 | 可从选区生成三语卡或日语语法卡，并保留永久来源关系和去重约束 |
| TC-J9 | 加入学习辅助 | Track 经显式发布后形成可预览规模的 English/Japanese 学习单元 |
| TC-J10 | 追溯与修订 | 能区分教材原文、AI 派生内容、用户修订、官方音频和 TTS 资产 |

## 4. 已确认的产品与架构方向

### 4.1 教材识别不使用应用内 OCR

- 截图识别由 Codex 根据专用 `import-textbook-track` Skill 执行；
- Skill 可以使用 Codex 图像理解能力，但不得调用产品现有 `/api/ocr` 形成正式教材数据；
- v1 页面不增加“上传截图并自动 OCR”的产品入口；
- 用户通过当前 Codex 任务提供本地截图路径，Skill 产出待确认草稿；
- 现有 OCR 继续只服务 Cards Factory，不承担教材配对、ruby 或内容校对职责。

### 4.2 教材域位于 `generations` 上游

教材课程是独立的来源、编排和校对域，但不是与 `generations`、`study_items` 平行的第二套内容和学习系统。

每个已确认 Track 形成一条 canonical 投影：

```text
generations.card_type = textbook_track
```

一个 Track 对应一个 generation，不按每个句子创建 generation。教材实体拥有官方原文、顺序、来源资产和修订信息；generation 提供兼容现有 Markdown、音频、标红和学习准入的投影身份。

这项复用不表示 Track 可以直接套用所有 per-generation 行为。TC-D2 必须解决两个由该选择产生的边界：

1. generation 的 Track 级 `content_hash` 只用于投影完整性和准入，不得直接复制给全部 40 个 Study Item；
2. `textbook_track` 必须默认从 Cards Factory 的卡片库、历史、最近记录、统计和全文搜索中排除，教材浏览与搜索由教材域拥有。

### 4.3 一个表达形成两个学习方向

Track 发布到学习辅助时，每组表达形成两个稳定单元：

```text
expr:01:en -> textbook_en
expr:01:ja -> textbook_ja
```

英文与日文必须独立评分，因为用户可能只掌握其中一个方向。重点词组、语法说明和编辑备注默认不自动形成额外 Study Item；用户通过选区派生卡后才进入学习域。

`textbook_track`、`textbook_en`、`textbook_ja` 和 `expr:NN:{lang}` 都是对已接受 LA-D2 §4.1 固定 card type/unit kind/unit key 表的协同修订。TC-D2 必须显式 amend LA-D2，并同步扩展 materializer、locator、计划范围、Study Item view-model 和测试；不得以“原样复用 LA”掩盖该变更。

### 4.4 官方音频与 TTS 音频分离

- 官方 Track 音频是教材来源资产，不进入 TTS 专用 `audio_files`；
- English/Japanese 单句合成音频继续使用现有 `audio_files` 和实际 provider/model/voice 元数据；
- 官方音频绝不被 TTS 生成过程覆盖、改名或替代；
- UI 明确使用“官方 Track”“EN 合成”“JA 合成”三种来源标签；
- 全站同一时间只允许一个音频源播放。

### 4.5 教材原文不进入 Git

- Git 只保存代码、schema、通用 Manifest schema、Skill、校验脚本、测试合成数据和设计文档；
- 英日原文、派生中文、ruby、编辑备注和实际 Manifest 保存于本地 SQLite/教材数据目录；
- 截图和官方音频保存于受控本地媒体目录；
- D1 原型和自动测试必须使用合成语料，不得复制真实教材 Track 内容；
- 不在日志、测试快照、异常堆栈或 Git fixture 中输出完整教材原文。

## 5. Track 01 验证基线

首个实际样本只作为本地 POC 和验收数据，不写入本文或 Git：

| 指标 | 本地样本值 |
|---|---:|
| Track | 01 |
| 截图资产 | 2 |
| 英日对应表达 | 20 |
| 重点词组 | 7 |
| 官方音频 | 1 |
| 目标合成音频 | 40（20 EN + 20 JA） |
| 发布后候选 Study Item | 40（20 EN + 20 JA） |

TC-P0 必须使用该本地样本验证完整工作流，但验收报告只记录数量、hash、错误类型和通过/失败，不复制教材正文。

## 6. `import-textbook-track` Skill 契约

### 6.1 Skill 定位

该 Skill 是重复执行教材导入的操作规程，不是应用运行时服务。它应保持精简，把易错、可重复的校验放入确定性脚本，把 Manifest schema 和字段说明放入按需加载的 reference。

建议结构：

```text
import-textbook-track/
  SKILL.md
  agents/openai.yaml
  scripts/validate-manifest.mjs
  scripts/hash-assets.mjs
  references/track-manifest-schema.md
```

不创建额外 README、变更日志或与 Skill 执行无关的说明文件。

### 6.2 输入

- `course_key`：稳定、非版权正文的课程标识；
- `track_number`：用户可见编号；
- `image_paths[]`：按页面顺序排列的本地截图绝对路径；
- `official_audio_path`：可选的本地官方音频绝对路径；
- 可选的用户备注，例如书名显示值、页码、已知句数。

### 6.3 处理步骤

1. 校验输入文件存在、类型允许、图片页序明确；
2. 计算截图和官方音频 SHA-256，不修改源文件；
3. 使用 Codex 图像理解识别版面、词组块及有序英日表达；
4. 分离教材官方字段与 AI 派生字段；
5. 为每组表达生成一个中文释义；
6. 为日语生成只覆盖汉字的 ruby 表达；
7. 提取重点词组、语法、语气、使用域和需要人工注意的非直译；
8. 为字段记录置信度、模型/Skill 版本和证据页；
9. 运行确定性 schema、编号、重复、ruby、hash 和路径校验；
10. 输出本地 draft Manifest 和 dry-run 摘要，等待用户确认；
11. 用户确认后调用正式导入 use case/API，不直接访问 SQLite。

### 6.4 输出与幂等

Manifest 至少包含：schema 版本、课程/Track 身份、来源资产、表达数组、重点数组、编辑备注、置信度、生成元数据、校对状态和内容 hash。

幂等身份基于：

```text
(course_key, track_number, ordered_source_asset_hashes)
```

相同资产重跑只更新同一个 draft 或产生明确 revision，不得静默创建重复 Track。不同截图 hash 视为新导入候选，必须展示与当前 revision 的差异。

## 7. 内容诚信与校对规则

### 7.1 字段来源分离

每个表达至少区分：

| 字段角色 | 例子 | 可否由模型静默改写 |
|---|---|---|
| 官方原文 | English/Japanese 教材文字 | 不可 |
| 派生内容 | 中文释义、ruby、语法和语气说明 | 可重新生成，但必须带版本 |
| 编辑备注 | 非直译、教材疑点、自然替代表达 | 不得覆盖官方原文 |
| 用户修订 | 人工纠正的识别结果 | 必须记录修订来源和时间 |

模型怀疑教材有拼写、翻译或语义问题时，只能创建 `editorial_note` 或建议修订，不得把建议直接写回官方字段。

### 7.2 日语 ruby

- 仅标注对应汉字，不给平假名、片假名或标点重复注音；
- ruby 的可见正文必须与已确认日语原文一致；
- TTS 输入必须移除 `<ruby>/<rt>`，只传原始日语正文；
- 自动校验至少检查 ruby 闭合、正文保持和无纯假名 ruby；
- 人名、地名或多音字低置信时必须进入人工确认。

### 7.3 中文释义

- 每组表达只有一个主要中文释义，作为英日两种目标语共享提示；
- 中文是 AI 派生学习提示，不得标记为教材官方内容；
- 英日含义不完全重合时，主要中文优先表达共同语义，差异写入编辑备注；
- 中文不生成 TTS。

### 7.4 重点与语法

重点项可以是 `vocabulary`、`phrase`、`grammar`、`register` 或 `editorial`。每项必须引用至少一个表达 ID 或 Track 全局范围，不允许出现无法追溯来源的“AI 推荐重点”。

## 8. 内容生命周期

Track 状态固定为：

```text
draft -> verified -> published -> archived
```

| 状态 | 用户可见行为 | 学习域行为 |
|---|---|---|
| draft | 可进入校对，不进入正式课程列表 | 不创建 generation 或 Study Item |
| verified | 可完整浏览、播放和检查；内容已人工确认 | 创建/更新 textbook_track generation 投影，不进入活动学习范围 |
| published | 正式课程内容，可派生卡并显示学习进度 | 显式物化/激活 textbook_en 与 textbook_ja |
| archived | 只读查看历史和来源 | Study Item 不再进入自动队列，历史 Review Event 保留 |

状态跃迁必须显式触发。导入完成不得自动从 draft 跳到 verified；verified 不得因打开页面自动变成 published。

内容修订必须形成 revision 和新 hash。TC-D2 需要决定是更新当前 generation 投影，还是创建 replacement generation 并使用 LA-D2 的 identity anchor/adopt-existing 语义；有 Review Event 后不得用删除重建伪造“从未学习”。

### 8.1 Track hash 与 Study Item hash

现有 materializer 把同一 generation 的 `content_hash` 复制给其全部 Study Item；该规则不能直接用于教材 Track。TC-D2 必须引入可重放的教材单元 hash 规则，并满足：

- `learning_source_admissions.content_hash` 可以继续记录 Track generation 的完整投影 hash；
- `study_items.content_hash` 必须按 expression + language direction 计算，不能使用整个 Track hash；
- `textbook_en` 至少由稳定中文提示与 English 官方目标内容决定；
- `textbook_ja` 至少由稳定中文提示、Japanese 官方目标内容和 ruby 决定；
- 补充对照或编辑备注是否进入调度相关 hash，由 TC-D2 明确，不能由渲染 HTML 偶然决定；
- 修改某个 expression 的 English 只更新对应 `textbook_en`；修改 Japanese/ruby 只更新对应 `textbook_ja`；修改共享中文提示才更新该 expression 的两个方向；
- 其它 expression 的 `content_hash`、`content_revision` 和“内容已更新”状态必须保持不变。

TC-D2 的 materializer POC 必须证明：只修改第 07 个 expression 的 ruby 时，仅 `expr:07:ja` 被判定更新，其余 39 个 Study Item 保持不变。

## 9. 概念数据所有权

TC-D2 决定最终表名和数量，但必须覆盖以下实体职责：

| 概念实体 | 所有权与职责 |
|---|---|
| Textbook Course | 稳定课程身份、显示信息和本地来源声明 |
| Textbook Track | Track 编号、标题、状态、revision、当前 generation 投影 |
| Track Asset | 截图、官方音频的相对路径、hash、格式、大小和可用状态 |
| Textbook Expression | 稳定 ordinal、官方英日原文、派生中文、ruby 和字段来源 |
| Textbook Note | 重点、语法、语气、编辑备注及表达引用 |
| Card Derivation | 教材选区到派生 generation 的永久关系和去重身份 |

结构化教材数据是来源真相，Markdown 是兼容学习辅助和安全渲染的可重建投影。不得从已渲染 HTML 反向解析教材结构。

TC-D2 必须定义 Track projection 文件的存储位置和读取 contract。`generations` 当前要求 folder/base/Markdown/HTML 路径，但教材投影不得因此自动进入 Cards Factory 的 `RECORDS_PATH` 列表。可选实现可以是受控隐藏投影目录或教材专用读取 adapter；无论采用哪种方式，都必须保持路径安全、现有普通卡行为和教材默认隔离。

## 10. 媒体与播放设计

### 10.1 官方音频存储

- 官方音频登记为 Track Asset，不复用 `audio_files`；
- 容器通过单一受控媒体根访问宿主机教材目录，默认只读挂载；
- 数据库和 Manifest 只保存媒体根下相对路径，不保存或回传宿主机绝对路径；
- 文件读取必须校验 `path.resolve` 仍位于媒体根，拒绝 `..`、符号链接逃逸和不允许的扩展名；
- 不使用 `express.static` 暴露媒体根；
- 专用 API 支持 HTTP Range、正确的 MIME、长度与缓存验证，便于拖动进度；
- 官方音频缺失、移动或 hash 变化时，Track 文字内容仍可浏览，但 UI 明确显示资产异常。

### 10.2 合成音频

- 每个 expression 生成一个 English 和一个 Japanese 音频；
- English 使用 Kokoro/MP3，Japanese 使用 VOICEVOX/WAV，实际 provider/model/voice 按现有规则持久化；
- TTS 失败不阻止 Track 进入 verified，但发布前必须明确列出缺失音频并由用户确认；
- 重新生成单句 TTS 不影响官方音频 hash 或路径。

### 10.3 播放器行为

Track 页顶部提供官方音频的播放/暂停、进度、时长、音量和倍速；表达行提供独立 EN/JA 合成语音按钮。

新增统一 `AudioSessionController` 概念：任何新音频开始时暂停当前音频，页面切换或 Track 关闭时停止播放。v1 不自动把整轨切成句级官方片段；未来只有在存在已确认时间戳时才增加“跳到官方原声位置”。

## 11. 桌面信息架构与页面

### 11.1 主导航

现有侧栏“学习”区域新增“教材课程”，与“今日学习 / 学习计划 / 学习记录”并列；Cards Factory 继续位于“生产”区域。教材详情不是 Cards Factory 卡片弹窗的替代品。

建议路由由 TC-D2 最终确认，概念上包括：

```text
/textbooks
/textbooks/:courseKey/tracks/:trackNumber
/textbooks/imports/:importId/review
```

### 11.2 教材课程首页

- 当前课程及 Track 数量；
- Track 状态、表达数量、官方音频状态和学习发布状态；
- 最近学习位置与 Track 学习进度；
- 教材自己的课程/Track/表达搜索，不借用 Cards Factory 的默认搜索结果页；
- 空状态引导用户在 Codex 中运行导入 Skill，而不是提供应用内 OCR 上传框。

### 11.2.1 Cards Factory 默认作用域

`textbook_track` 虽然拥有 generation 投影，但不是 Cards Factory 生产出的普通卡片。以下 Cards Factory read model 默认排除 `card_type = textbook_track`：

- 卡片历史与分页总数；
- 最近生成记录；
- Cards Factory 全文搜索；
- Cards Factory 生成统计和卡型汇总；
- 文件夹/卡片库列表。

TC-D2 必须选择“共享 FTS 但查询强制作用域”或“教材独立 FTS/read model”，并证明无过滤参数的现有 `/api/history`、`/api/recent`、`/api/search` 和统计查询不会返回教材内容。显式教材 API 可以读取教材数据，但不得把真实教材原文泄漏到 Cards Factory、测试 fixture、日志或可观测性 payload。

### 11.3 Track 学习页

桌面端采用紧凑三栏工作台：左侧 Track 导航，中间有序表达列表，右侧显示当前表达的重点、语法、语气和来源信息。顶部是固定 Track 标题、状态、学习进度和官方音频播放器。

每个表达块至少包含：

- 固定序号；
- 带 kanji-only ruby 的 Japanese 官方原文与 JA 合成音频；
- English 官方原文与 EN 合成音频；
- 一条中文派生释义；
- 重点/语法存在性提示；
- 标红和选区派生入口；
- 官方、派生、用户修订的来源标识只在需要时展开，不淹没学习主界面。

### 11.4 校对页

校对页按截图证据和结构化表达并排显示，支持：低置信度筛选、原文修正、页序调整、表达拆分/合并、中文/ruby 重生成、编辑备注和 verified 确认。

校对页不得伪装模型结果为官方内容；所有待确认字段都有明确状态。

### 11.5 桌面范围

TC-D1/TC-P 阶段只设计和验收桌面端。已有移动代码不要求删除，但不制作移动稿、不新增移动断点、不执行移动专项验收。

## 12. 标红与派生卡

### 12.1 标红

复用现有安全 Markdown/ruby 渲染与 `card_highlights` 行为，但 TC-D2 必须明确 Track 投影的 folder/base/sourceHash 身份。标红是用户笔记，不自动进入学习队列、不改变调度。

### 12.2 选区操作

表达中的有效文本选区提供：

- 标红；
- 生成三语卡；
- 对日语选区生成日语语法卡；
- 取消选区。

生成表单预填选区、所在完整句、语言、Track 和 expression 身份。用户仍可修改输入并确认，系统不得仅因选择文本就自动调用 DeepSeek。

### 12.3 永久溯源与去重

`generation_jobs.source_context_json` 只作为任务期间的上下文，不是永久内容关系。TC-D2 必须引入规范化的 Card Derivation 关系，至少保留：

```text
track_id
expression_id
selection_text
selection_hash
target_card_type
generation_id
```

去重身份至少覆盖：

```text
(expression_id, selection_hash, target_card_type)
```

同一选区、同一卡型再次生成时，UI 优先打开现有派生卡或要求用户明确创建新 revision，不静默重复。

## 13. 学习辅助 2.0 集成

### 13.1 发布门禁

Track 从 verified 进入 published 时，UI 必须预览：表达数、将新增的 English/Japanese 单元数、当前计划是否包含教材卡型、按当前 `dailyNewLimit` 计算的理论最短引入天数。

发布是 Track 级 opt-in。发布后可以一次性物化全部稳定 Study Item，但每日进入队列的数量仍由现有新单元上限控制。发布不得静默提高目标或新单元上限，也不得修改当天已生成队列。

### 13.2 回忆方向

| 单元 | 提示面 | 回忆目标 | 答案面 |
|---|---|---|---|
| textbook_en | AI 派生中文释义和 Track/表达上下文 | 产出教材官方 English | English 官方原文、Japanese 对照、中文、重点和 EN 合成音频 |
| textbook_ja | AI 派生中文释义和 Track/表达上下文 | 产出教材官方 Japanese | Japanese 官方原文+ruby、English 对照、中文、重点和 JA 合成音频 |

中文是共享提示，不是教材官方字段。答案揭示前不得显示或播放目标语言。官方整轨播放器属于 Track 浏览页；v1 的单项复习默认使用对应单句合成音频，避免整轨定位不明确。

### 13.3 计划、队列与历史

- 学习计划增加教材卡型及课程/Track 范围，不用通用标签代替稳定课程身份；
- 发布或范围变化需要走现有计划 revision/影响确认，不静默改队列；
- FSRS、四档评分、Review Event、Schedule State 和幂等提交保持不变；
- PlanningSignalProvider 可以在基础集合选定后读取 Track 顺序等可选信号，但不能改变到期优先级或新单元上限；
- 学习记录可按教材课程、Track、English/Japanese 查看真实评分和完成情况；
- 教材域不得直接更新学习调度表。

### 13.4 对 LA-D2 的协同修订

教材课程复用的是 LA-D2 的计划、队列、评分、事件、调度和历史闭环，不是“无需改动 LA-D2”。TC-D2 必须作为 LA-D2 的显式增补，至少修订：

- card type：增加 `textbook_track`；
- unit kind/key：增加 `textbook_en`、`textbook_ja` 与 `expr:NN:{lang}`；
- locator：通过稳定 expression ID/ordinal 定位，禁止从 DOM 顺序猜测；
- materializer：允许 unit 级 content hash，不再强制把 generation hash 复制给每个教材单元；
- plan scope：增加教材卡型、课程和 Track 范围；
- item view-model：返回教材来源、方向、官方目标内容、中文派生提示和对应 TTS；
- content update：只标记真实受影响的 expression direction；
- history/metrics：允许教材维度聚合，但不得建立第二套 Review Event。

TC-D2 被接受时，LA-D2 文档、完整 schema、versioned migration 和实现测试必须在同一变更中同步，不能让两份 ADR 描述不同的当前不变量。

## 14. 服务降级与异常状态

| 异常 | v1 行为 |
|---|---|
| Codex/Skill 暂不可用 | 已导入 Track 正常浏览和学习；只阻止新导入 |
| Manifest 校验失败 | 保持 draft，显示字段级错误，不写正式数据 |
| 官方音频缺失或 hash 改变 | 禁用官方播放并提示重新绑定；TTS 与文字仍可用 |
| English/Japanese TTS 失败 | 单句按钮显示不可用；不伪装为官方音频 |
| DeepSeek 不可用 | 已有教材和学习不受影响；派生卡生成排队或失败可重试 |
| 媒体路径越界 | 统一返回受控错误，不回显宿主机绝对路径 |
| Track 已修订 | 显示内容 revision；学习身份与历史按 TC-D2 策略保留 |
| 派生卡重复 | 打开已有卡或要求显式新 revision |

## 15. 成功指标

### 15.1 导入质量

- 人工确认前不得产生正式 Track；
- Track 01 的表达和重点数量与人工核对一致；
- verified 内容中 English/Japanese 配对完整率为 100%；
- verified 日语 ruby 仅标注汉字且正文保持率为 100%；
- 官方原文被模型静默改写的次数为 0；
- 重跑相同输入产生重复 Track 的次数为 0。

### 15.2 学习体验

- 官方音频与单句 TTS 不会同时播放；
- 官方音频支持开始、暂停、续播和进度跳转；
- 所有可用表达能播放对应 EN/JA 合成音频；
- 标红重开后仍存在；
- 派生卡能从卡片返回教材 Track 和原表达；
- 发布前能看见 40 个候选单元及当前新单元上限影响；
- 教材 Review Event 与普通学习单元使用同一幂等和调度保证。

首个 Track 上线后的前 14 个实际教材学习日只建立基线，不使用留存或正确率指标评价用户。

## 16. v1 非目标

- 应用内截图上传、OCR 或自动版面识别页面；
- 自动导入整本书或扫描文件夹；
- 未经人工确认就发布教材内容；
- 官方音频自动句级切分、强制对齐或语音识别；
- AI 口语评分、发音打分或麦克风录音；
- 知识图谱、语义网络或自动前置关系；
- 教材内容云同步、公开分享、导出或多人协作；
- DRM 规避、音频抓取或教材版权管理；
- 中文 TTS；
- 移动端页面、移动端断点和移动端验收；
- 第二套计划、队列、评分、调度或历史系统。

## 17. 风险与取舍

| 风险 | 当前取舍 | 后续验证 |
|---|---|---|
| Codex 图像识别仍可能错配 | 必须经过字段级人工确认，verified 前不进入正式域 | Track 01 校对差异与低置信度命中率 |
| 一个 Track 形成 40 个单元 | Track 级 opt-in + 计划影响预览 + dailyNewLimit 限流 | 实际引入天数、跳过率和评分分布 |
| 中文提示由 AI 派生 | 标明来源，允许重生成和人工修订 | 用户修订率与英日语义偏差 |
| 官方整轨无法精确对应单句 | v1 只做整轨播放，单项复习使用 TTS | 后续是否值得人工维护时间戳 |
| 教材域叠加 generation 投影 | 接受双层模型，换取来源诚信与 LA 全套复用 | revision/替换 POC 与查询复杂度 |
| 媒体在容器外的本地目录 | 单一只读媒体根 + 相对路径 + Range API | 文件移动、hash 改变和重绑定流程 |
| 派生卡数量增长 | 用户显式选择、规范化去重、普通计划限流 | 重复率与派生卡实际学习率 |

## 18. TC-D1 原型输入

TC-D1 必须使用合成语料逐页展示以下桌面状态：

1. 侧栏新增“教材课程”后的完整信息架构；
2. 无课程/无 Track 的空状态及 Codex Skill 操作提示；
3. 单课程 Track 列表、教材独立搜索、状态、音频和学习进度，并展示 Cards Factory 默认不出现教材记录；
4. draft 校对页默认态；
5. 低置信度、英日错配、拆分/合并、编辑备注，以及单句修订只影响对应方向的更新状态；
6. Track 学习页及顶部官方音频播放器；
7. 单个表达的英日中、kanji-only ruby、EN/JA TTS 和右侧重点 Inspector；
8. 标红、选区工具栏和持久化后的状态；
9. 派生卡确认、生成中、失败和重复命中状态；
10. verified -> published 的 40 单元影响预览与确认；
11. 官方音频缺失/hash 变化、TTS 缺失和媒体越界错误；
12. textbook_en / textbook_ja 的提示面、答案面、来源解释及 per-unit 内容更新提示。

原型不得连接真实教材资产，不得复制 Track 01 正文，不得伪造已经实现的 API。原型确认后，TC-D2 才能锁定 schema 和 contract。

### 18.1 TC-D1 原型实施记录（2026-07-14）

桌面原型已落地于 [`prototypes/tc-d1-prototype.html`](prototypes/tc-d1-prototype.html)，使用与真实 Track 01 无关的合成课程和表达，不连接 API、数据库、媒体目录或 TTS 服务。

原型在同一文件内提供 12 个可切换状态，并实现以下交互：

- 教材独立搜索与 Cards Factory 作用域隔离说明；
- Draft 字段编辑、低置信度/英日错配提示、拆分/合并预览、编辑备注和 Verified 确认；
- 单句 ruby 修订的 per-unit hash 影响预览；
- 官方整轨与 EN/JA 合成语音的共享互斥播放状态；
- kanji-only ruby、表达 Inspector、标红、选区和派生卡确认；
- 派生卡确认、生成中、失败重试和重复命中四态；
- 40 个 Study Item、`dailyNewLimit` 与最短引入周期的动态预览；
- `textbook_en` / `textbook_ja` 独立提示面、答案面、来源、unit hash 和单方向内容更新提示。

技术验收记录：

- 1280x720 与 1440x900 两个桌面视口，12 个状态共 24 次水平溢出检查全部通过；
- 官方音频 -> EN TTS 切换会停止前一来源；
- 派生卡四态、失败重试、重复命中与永久来源提示可交互；
- `dailyNewLimit` 从 5 调整到 10 时，40 个单元的最短引入周期从 8 学习日更新为 4 学习日；
- EN/JA 切换会同步更新 Study Item key、官方目标来源、per-unit hash 和内容更新提示；
- 浏览器控制台为 0 error / 0 warning。

用户已于 2026-07-14 确认 TC-D1 的 12 个页面/状态和关键交互。TC-D1 产品门禁通过；后续实现必须保持已确认的桌面信息架构、内容诚信、音频互斥、派生卡、发布预览和学习单元语义。

## 19. 实施阶段

| 阶段 | 目标 | 主要门禁 |
|---|---|---|
| TC-D0 | 产品定义 | 用户确认本文推荐决策 |
| TC-D1 | 桌面交互原型 | 12 个页面/状态逐项确认 |
| TC-D2 | 领域、数据、Manifest、API 与媒体 ADR，并显式增补 LA-D2 | migration、unit hash、Cards Factory 作用域、unit kind、revision、Range、安全和回滚策略闭环 |
| TC-P0 | `import-textbook-track` Skill + Track 01 本地 dry-run | 数量、配对、ruby、hash、幂等和人工确认通过 |
| TC-P1 | 教材存储、导入 use case、官方媒体服务 | schema/迁移双真源、路径安全、Range 和事务测试通过 |
| TC-P2 | 教材首页、校对页、Track 学习页 | 真实本地 Track 浏览、播放器、标红和降级状态通过 |
| TC-P3 | 派生卡与学习辅助集成 | 去重溯源、40 单元预览、发布、复习和历史通过 |
| TC-P4 | 完整验收与文档封板 | lint/unit/integration/desktop E2E/visual/Docker/真实本地 smoke 全绿 |

## 20. TC-D0 完成门禁

- [x] 教材识别由专用 Skill 执行，不使用应用内 OCR
- [x] 官方音频与 TTS 音频分离，官方资产不进入 `audio_files`
- [x] 教材域位于 `generations` 上游，一个 Track 投影为一个 `textbook_track` generation
- [x] 学习辅助继续使用 generation 身份模型，不建立平行复习系统
- [x] Manifest、教材原文、截图和官方音频不进入 Git
- [x] 派生卡需要规范化永久关系和唯一去重身份
- [x] Track 级 opt-in 与 `dailyNewLimit` 的职责已分离
- [x] 中文是派生提示，英日是官方目标语原文
- [x] Track generation hash 与教材 per-unit Study Item hash 必须解耦
- [x] `textbook_track` 默认从 Cards Factory 历史、最近、统计、搜索和卡片库排除
- [x] TC-D2 必须显式增补 LA-D2 的 unit kind、materializer、locator、plan scope 和 view-model
- [x] 知识图谱、移动端、口语评分和自动音频切分保持非目标
- [x] TC-D1 的 12 个原型输入页面/状态清单已确认
- [x] 用户确认本文全部推荐决策（2026-07-14）

TC-D0 与 TC-D1 已确认：

- [x] 用户确认 TC-D1 的 12 个页面/状态和关键交互（2026-07-14）

TC-D2 的领域、数据、Manifest、API 与媒体 contract 已落地于 [`../Architecture/Textbook_Courses_Domain_Data_and_Media_ADR.md`](../Architecture/Textbook_Courses_Domain_Data_and_Media_ADR.md)。该 ADR 被用户确认前，不创建教材运行时表、不增加 `textbook_track` 卡型、不修改 `study_items`、不挂载真实媒体目录，也不导入 Track 01。
