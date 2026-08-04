# Three LANS 日语按需注音浮层与 Ruby 退役实施计划

> 状态：**In implementation · PF-P0/P1/P2/P3 代码与只读证据已落地；历史迁移、Ruby 删除和 PF-R1 观察仍待门禁**
>
> 日期：2026-08-03
>
> 任务规模：76 个可独立验证任务
>
> 执行顺序：Gate 0 -> PF-D1 -> PF-D2 -> PF-P0 -> PF-P1 -> PF-P2 -> PF-P3 ->
> PF-P4 -> PF-P5 -> PF-R1 -> Final
>
> 上位设计：
> [日语按需注音浮层与 Ruby 退役设计](../../Features/Japanese_Pronunciation_Overlay_and_Ruby_Retirement_Design.md)

## 0. 计划定位与权威边界

本计划把 PF-D0 设计拆成可实施任务，不重新定义产品语义。发生冲突时按以下顺序裁决：

1. 根 `CLAUDE.md`、实际代码、`database/schema.sql` 和 Accepted ADR；
2. `Japanese_Pronunciation_Overlay_and_Ruby_Retirement_Design.md`；
3. Card Annotation、Selection TTS、KG、LA、Textbook 已接受文档；
4. 本任务表；
5. 旧 Ruby 代码和历史实现只代表迁移输入，不具有新设计权威性。

本计划的核心目标不是换一个视觉组件，而是完成四项结构变化：

1. 活动正文只保留纯日语文本；
2. 读音和词语边界进入独立结构化 pronunciation 域；
3. Tooltip 负责快速读音，Popover 负责完整学习动作；
4. 历史 Ruby 经受控迁移退出运行链路，不能原地破坏 generation hash。

## 1. 不可突破的硬边界

- 仅设计、开发和验收桌面端；
- PF-D2 Accepted 前不创建 pronunciation schema、route 或生产写入；
- PF-P0 只读，不改真实 SQLite、Markdown、annotation、KG、LA 或教材数据；
- 不原地改写已有 generation；
- 不让 LLM 直接产生 accepted 读音或整词边界；
- hover 不记为 KG lookup；
- pronunciation 不拥有 Study Item、Review Event、FSRS 或计划队列；
- Tooltip 不包含按钮，交互动作只能进入 Popover；
- 读音服务失败时正文仍可读、可选、可复制；
- 不使用 `git add -A`，每次只暂存当前任务明确文件；
- 不删除 Docker volume，不使用 `docker compose down -v`；
- 不把教材原文、用户选区或完整读音内容写入普通运行日志；
- schema 变更必须同一提交更新 `database/schema.sql`、顺延 migration、migration runner
  测试和 fresh/migrated schema 等价测试。

## 2. 已核实的真实基线

| 项目 | 当前事实 |
|---|---|
| generation | 675 |
| 含 Ruby 卡片 | 672 |
| Ruby 标签 | 13,528 |
| 不同 Ruby 基文 | 2,829 |
| 严格相邻 Ruby 组 | 598 组，涉及 1,321 个标签 |
| 不同相邻组合 | 466 种 |
| 历史结构破损候选 | 60 张，全部为 2026-02-09 至 2026-02-10 的 `gemini-2.5-flash` |
| 当前日语分析 | Kuroshiro + Kuromoji，reading 输出为片假名 |
| 当前渲染 | `normalizeJapaneseRuby()` -> marked -> DOMPurify -> `dangerouslySetInnerHTML` |
| 当前选区投影 | `card-visible-text-v1` 排除 `rt/rp`、音频按钮和工具标签 |
| 当前注解真源 | `card_annotations` |
| 当前即时朗读 | Selection TTS，日语 VOICEVOX，共享播放 owner |
| 当前 KG | 显式 lookup 才写事件，reader 可降级 |
| 当前 migration 最新版本 | `011_preserve_card_engagement_history.sql` |

这些数字必须由 PF-P0 的版本化只读脚本重新生成；本计划中的数字不能替代执行证据。

## 3. 阶段总览

| 阶段 | 任务 | 退出条件 |
|---|---:|---|
| Gate 0 | 1-6 | 真实数据、现有交互、破损卡与 PF-D0 决策均冻结 |
| PF-D1 | 7-13 | 12 个桌面状态原型通过逐页确认 |
| PF-D2 | 14-21 | 内容身份、schema、API、事件、迁移和回滚 ADR Accepted |
| PF-P0 | 22-31 | 只读 POC 量化 466 种候选、60 张坏卡和前端交互可行性 |
| PF-P1 | 32-40 | 新生成卡使用纯正文和 pronunciation 数据，零新 Ruby |
| PF-P2 | 41-51 | CardModal Tooltip/Popover、选区、TTS、KG、LA、生成卡闭环 |
| PF-P3 | 52-57 | 教材和 Review 两个消费者切换并回归 |
| PF-P4 | 58-65 | 历史内容只读迁移、shadow replay、canary 和回滚通过 |
| PF-P5 | 66-71 | 全量切换并删除生产 Ruby 链路，Compose 验收通过 |
| PF-R1 | 72-75 | 真实运行观察、纠音、未决项和退役复核通过 |
| Final | 76 | 全套门禁、文档、提交与运行态封板 |

依赖关系：

```text
Task 1-6 Gate 0
  -> Task 7-13 PF-D1
  -> Task 14-21 PF-D2 Accepted
  -> Task 22-31 PF-P0 read-only
  -> Task 32-40 PF-P1 new cards
  -> Task 41-51 PF-P2 CardModal
  -> Task 52-57 PF-P3 Textbook + Review
  -> Task 58-65 PF-P4 historical canary
  -> Task 66-71 PF-P5 decommission
  -> Task 72-75 PF-R1 observation
  -> Task 76 Final
```

## 4. 通用执行约定

每个任务必须遵循：

1. 开始前执行 `git status --short --branch`；
2. 读取任务涉及文件，不依据过期计划猜实现；
3. 先补失败测试、审计样本或 contract，再改实现；
4. 手工编辑使用 `apply_patch`；
5. 运行该任务列出的最小测试；
6. 执行 `git diff --check`；
7. 只暂存明确文件；
8. 每个阶段至少形成一份 TestReport；
9. 阶段门禁失败时停止，不跳到后续阶段；
10. 文档、代码、测试和运行配置必须在同一阶段同步。

建议提交粒度：每个 Task 一个提交；确需合并时只能合并同阶段、同回滚边界的小任务，并在
计划的实施实况中记录偏差。

计划中以 `20260803` 命名的报告表示当前基线日期；若任务在之后执行，文件名应改用真实
执行日期并同步本计划，不得让报告文件名伪装成更早完成。Task 32 的 migration `012` 也是
当前顺延预期；执行时如仓库已出现新的 migration，必须使用当时下一个可用版本并更新本文。

---

## Gate 0：现状、数据与产品门禁

### Task 1：冻结 Git、Compose 与数据基线

**目标**：建立实施前可恢复快照，不写真实数据。

**文件**：

- Create: `Docs/TestReports/Pronunciation_PF_Gate0_Baseline_20260803.md`
- Read: `docker-compose.yml`、`.env.example`

**步骤**：

- [ ] 记录分支、本地 SHA、远端 SHA 和未提交文件；
- [ ] 记录 `docker compose ps`、镜像、容器健康和 volume 名称；
- [ ] 只读执行 SQLite `PRAGMA integrity_check`；
- [ ] 记录 generations、annotations、study_items、review events 和教材记录数量；
- [ ] 记录数据目录大小与备份可用空间；
- [ ] 不在 Gate 0 创建备份副本，只验证备份命令和目标位置。

**验证**：`git status --short --branch`、`docker compose ps`、SQLite integrity `ok`。

**完成标准**：报告可让后续人员判断“变更前真实状态”，且零业务数据写入。

**建议提交**：`docs(pronunciation): capture PF Gate 0 runtime baseline`

### Task 2：固化 Ruby 规模只读审计

**目标**：把 672/13,528/2,829/598/466 变成可重复证据。

**文件**：

- Create: `scripts/maintenance/auditPronunciationRubyInventory.js`
- Create: `tests/unit/pronunciationRubyInventory.test.js`
- Update: Gate 0 报告

**步骤**：

- [ ] 支持 `--db`、`--records`、`--output`，默认只读；
- [ ] 使用结构化 Ruby 匹配器，不跨任意 HTML 贪婪合并；
- [ ] 输出卡片数、标签数、不同基文、相邻组和不同组合；
- [ ] 每条结果包含 generation id 与 content hash，不输出宿主机绝对路径；
- [ ] 输出稳定排序 JSON/CSV manifest；
- [ ] 同一快照连续运行输出 hash 一致。

**验证**：单元测试 + 对真实 volume 只读运行两次。

**完成标准**：数字可复现，脚本无 UPDATE/INSERT/DELETE，manifest 可审计。

**建议提交**：`test(pronunciation): add read-only Ruby inventory audit`

### Task 3：建立历史结构破损卡审计

**目标**：识别 60 张无 H1 或含模型规划叙述的历史卡，不与 Ruby 迁移混写。

**文件**：

- Create: `scripts/maintenance/auditPronunciationMigrationEligibility.js`
- Create: `tests/unit/pronunciationMigrationEligibility.test.js`
- Create: `Docs/TestReports/Pronunciation_Historical_Content_Eligibility_20260803.md`

**步骤**：

- [ ] 规则覆盖无 H1、规划叙述、工具调用残留、测试标签、quarantined 和缺文件；
- [ ] 将结构问题与语义问题分开，不用单一正则直接判删除；
- [ ] 复用现有 card-data-preparation decisions 和 `qa:` 标签；
- [ ] 输出 `eligible / needs-review / excluded`，附规则版本与理由；
- [ ] 逐张列出 60 个候选的 id/hash/model/date；
- [ ] 明确本任务只产清单，不执行修复。

**验证**：60 个候选全部来自预期旧模型与日期；近期正常卡不被误判。

**完成标准**：自动迁移默认只接收 `eligible`，人工清单完整可追溯。

**建议提交**：`test(data): audit pronunciation migration eligibility`

### Task 4：冻结当前 Ruby 选区与注解行为

**目标**：在删除 Ruby 前锁定用户真正依赖的行为。

**文件**：

- Modify: `tests/e2e/react-cards-factory.spec.js`
- Modify: `tests/e2e/textbooks.spec.js`
- Modify: `tests/e2e/learning-assistance.spec.js`
- Update: desktop snapshots

**步骤**：

- [ ] 固定 Ruby 汉字拖动、复制、右键、双击和工具条预览；
- [ ] 固定四色标记、改色、软删除和 annotation 重放；
- [ ] 固定 Selection TTS 请求文本不含读音；
- [ ] 固定教材 EN/JA/ZH 与 Review cue/answer 文本；
- [ ] 记录 Ruby 当前选区困难作为已知缺陷，不把缺陷写成期望行为；
- [ ] 只生成 1280/1440 桌面基线。

**验证**：目标 E2E 连续两次稳定通过。

**完成标准**：后续能证明“删除 Ruby 改善选区，同时没有破坏业务动作”。

**建议提交**：`test(ui): freeze pre-retirement Ruby selection behavior`

### Task 5：建立消费者与所有权矩阵

**目标**：完整列出 Ruby 的生成者、存储点和消费者。

**文件**：

- Modify: PF-D0 设计文档
- Create: `Docs/TestReports/Pronunciation_Ruby_Dependency_Inventory_20260803.md`

**步骤**：

- [ ] 盘点 prompt、`japaneseFurigana.js`、`htmlRenderer.js`、Markdown 与 HTML 输出；
- [ ] 盘点 CardModal、TextbookPublishedBrowser、ReviewSessionPage；
- [ ] 盘点 annotation projection、TTS、KG、learning、sandbox fixtures；
- [ ] 盘点数据库 `ja_ruby_html`、records 文件和测试 fixture；
- [ ] 标明“需迁移 / 保留审计 / 可直接删除 / PF-D2 待决”；
- [ ] 确认没有隐藏消费者后才能通过。

**验证**：`rg` 结果全部映射进报告，无未解释生产引用。

**完成标准**：任何 Ruby 删除都能定位到对应消费者回归任务。

**建议提交**：`docs(pronunciation): inventory Ruby producers and consumers`

### Task 6：确认 PF-D0 产品门禁

**目标**：获得进入可视化原型的明确产品授权。

**文件**：

- Modify: PF-D0 设计文档 §17
- Modify: `Docs/README.md`

**步骤**：

- [ ] 确认活动系统最终零 Ruby；
- [ ] 确认默认只按需显示读音；
- [ ] 确认 Tooltip/Popover 分工；
- [ ] 确认最长 accepted 规则当前仍受 PF-P0 来源门禁阻塞；
- [ ] 确认 hover 零 lookup 写入；
- [ ] 确认历史 generation 禁止原地改写；
- [ ] 确认仅桌面端；
- [ ] 将文档状态改为 Accepted，但不得提前勾实施门禁。

**验证**：用户逐项确认，README 状态与正文一致。

**完成标准**：Gate 0 报告为 PASS，允许进入 PF-D1，不允许直接进 schema 开发。

**建议提交**：`docs(pronunciation): accept PF-D0 product baseline`

---

## PF-D1：桌面可视化原型

### Task 7：建立隔离原型骨架

**目标**：不改生产代码，建立 12 状态桌面原型。

**文件**：

- Create: `Docs/Features/prototypes/pf-d1-pronunciation-overlay.html`
- Modify: `Docs/README.md`

**步骤**：

- [ ] 完整 HTML5/UTF-8 文档，可由普通静态服务器打开；
- [ ] 使用项目 tokens 的静态副本，不加载生产 JS；
- [ ] 只覆盖 1280/1440 桌面；
- [ ] 提供 S1-S12 状态导航；
- [ ] 使用合成日语示例，不复制受版权保护教材原文；
- [ ] 初始所有状态标为 prototype，不伪装真实 API 数据。

**验证**：浏览器零 console 错误，12 个 section 与按钮齐全。

**完成标准**：原型可独立打开，生产依赖零变化。

**建议提交**：`docs(pronunciation): scaffold PF-D1 desktop prototype`

### Task 8：设计纯正文与轻量 Tooltip 状态

**目标**：确认无常驻假名时仍具备读音可发现性。

**状态**：S1 默认正文、S2 hover/focus Tooltip。

**步骤**：

- [ ] 正文使用自然日语字距与行高；
- [ ] 不给所有 token 加框或高饱和底色；
- [ ] Tooltip 只显示整体读音与类型；
- [ ] 展示 250ms 延迟、Escape 和离开关闭；
- [ ] 显示 Tooltip 零写入说明仅放在原型评审注释，不进入生产页面。

**验证**：`勤務表` 视觉上是一个词，Tooltip 不出现按钮。

**完成标准**：用户能理解按需读音且阅读面不嘈杂。

**建议提交**：`docs(pronunciation): prototype plain reading and tooltip states`

### Task 9：设计完整 Popover 状态

**目标**：确认高信息密度但不臃肿的学习浮层。

**状态**：S3 复合词 Popover、S4 单字详情。

**步骤**：

- [ ] 展示表层词、平假名、词性、辞书形、组成；
- [ ] 朗读、查知识点、加入学习、生成卡、修正读音使用图标+文字命令；
- [ ] 单字详情放在整词 Popover 内，不与正文争夺命中区域；
- [ ] 固定宽度、最大高度、滚动和碰撞方向；
- [ ] 禁止卡片嵌套卡片式布局。

**验证**：Popover 在左右边缘与长内容状态均不溢出。

**完成标准**：操作清晰，正文仍是主舞台。

**建议提交**：`docs(pronunciation): prototype compound and kanji popovers`

### Task 10：设计词形与 unresolved 状态

**目标**：原型诚实表达自动分析能力边界。

**状态**：S5 活用词、S6 unresolved、S7 人工修正。

**步骤**：

- [ ] 展示 `食べました -> 食べる` 的词形关系；
- [ ] 展示 `一人` 自动读音冲突；
- [ ] unresolved 不显示伪确定整体读音；
- [ ] 人工修正包含范围、读音、理由与来源；
- [ ] LLM proposal 显式标为提案，不使用“已确认”视觉。

**验证**：三种状态在颜色、文案和可执行动作上能区分。

**完成标准**：用户可理解“系统不知道”与“系统已确认”的差别。

**建议提交**：`docs(pronunciation): prototype inflection and unresolved states`

### Task 11：设计选区冲突与键盘状态

**目标**：验证 Tooltip/Popover 不阻碍原生选区。

**状态**：S8 拖动选择、S9 双击整词、S10 注音键盘导航。

**步骤**：

- [ ] 拖动后只出现现有选区工具条；
- [ ] 单击与拖动有清晰状态差异；
- [ ] 双击选择完整 accepted token；
- [ ] 注音导航使用 roving tabindex，不把每个词都放进 Tab 序列；
- [ ] Escape 返回阅读区，焦点位置可见。

**验证**：真实浏览器点击、拖动、双击和键盘脚本通过。

**完成标准**：原型交互可操作，不只是静态画面。

**建议提交**：`docs(pronunciation): prototype selection and keyboard arbitration`

### Task 12：设计跨域动作与降级状态

**目标**：表达 TTS、KG、LA 与生成卡的边界。

**状态**：S11 动作成功/加载/失败、S12 服务降级。

**步骤**：

- [ ] TTS 显示 loading/playing/error/retry；
- [ ] KG 只有显式点击才产生查询；
- [ ] 加入学习使用现有 LA 命令，不在 Popover 自建队列；
- [ ] 生成卡复用当前三类生成菜单；
- [ ] KG/TTS 关闭时保留读音、正文和选区；
- [ ] 展示 stale revision 时 fail closed 为纯正文。

**验证**：每个动作可追溯到已存在领域或 PF-D2 待建 contract。

**完成标准**：原型没有发明新的调度或搜索事实。

**建议提交**：`docs(pronunciation): prototype actions and graceful degradation`

### Task 13：完成 PF-D1 逐状态确认

**目标**：在写 ADR 前锁定用户看得见的结果。

**文件**：

- Modify: PF-D0 设计文档
- Modify: PF-D1 原型
- Create: `Docs/TestReports/Pronunciation_PF_D1_Prototype_Review_20260803.md`

**步骤**：

- [ ] 用户逐项确认 S1-S12；
- [ ] 记录被否决方案和修改理由；
- [ ] 明确 Tooltip 延迟、Popover 内容、单字入口和键盘模式；
- [ ] 确认 PF-P0 来源门禁仍有效；
- [ ] 原型状态从 Draft 改为 Accepted。

**验证**：DOM 12 section、零 stub、零 console 错误。

**完成标准**：PF-D1 Accepted，允许进入 PF-D2。

**建议提交**：`docs(pronunciation): accept PF-D1 desktop interaction prototype`

---

## PF-D2：领域、数据与迁移 ADR

### Task 14：裁决历史内容身份方案

**目标**：在“活动投影”和“copy-on-write 修订”中做正式选择。

**文件**：

- Create: `Docs/Architecture/Japanese_Pronunciation_Overlay_and_Ruby_Retirement_ADR.md`

**步骤**：

- [ ] 对照 generation immutability、content hash、Study Item 和 Review Event；
- [ ] 定义原始内容、活动纯 Markdown 与 pronunciation document 的身份；
- [ ] 定义替换后 source generation 与当前内容指针；
- [ ] 禁止同一逻辑内容双重物化；
- [ ] 定义原 Ruby 审计保留位置与访问权限；
- [ ] 明确回滚时恢复哪个投影，不恢复 Ruby 长期方案。

**验证**：用一张已复习卡和一张教材卡走完整身份示例。

**完成标准**：不存在静默改 hash 或重复 Study Item 的路径。

**建议提交**：`docs(pronunciation): decide immutable content migration model`

### Task 15：定义 pronunciation schema

**目标**：确定文档、token、证据和修正事件结构。

**步骤**：

- [ ] 定义 `pronunciation_documents`；
- [ ] 定义 `pronunciation_tokens`；
- [ ] 定义 append-only correction events；
- [ ] 定义 target kind/id/revision hash；
- [ ] 定义 accepted/unresolved/rejected/superseded；
- [ ] 定义 source、rule/analyzer version 和 evidence；
- [ ] 定义索引、唯一键、删除与归档语义；
- [ ] 表号从当前 schema 最大值顺延，不复用退役表名。

**验证**：fresh install 与 migrated install 可表达同一实体。

**完成标准**：所有 PF-D1 状态有持久化或可派生来源。

**建议提交**：与 Task 21 ADR 接受一并提交。

### Task 16：定义正文投影和 offset contract

**目标**：解决 code point、UTF-16、DOM Range 与 annotation 的转换。

**步骤**：

- [ ] 定义 pronunciation plain-text projection 版本；
- [ ] 定义 block key 与 Markdown block 身份；
- [ ] 定义 code point start/end；
- [ ] 定义到 `card-visible-text-v1` UTF-16 selector 的 adapter；
- [ ] 定义 NFKC、空白和标点规则；
- [ ] 定义 token 被 annotation 分裂后的稳定 id；
- [ ] 定义 revision hash 不匹配的 fail-closed 行为。

**验证**：用 emoji、假名、汉字、跨节点和多行样本手算并测试 offset。

**完成标准**：两套 offset 不再被描述为同一单位。

**建议提交**：与 Task 21 ADR 接受一并提交。

### Task 17：定义 accepted 来源与裁决规则

**目标**：防止“相邻 token 自动拼接”等于事实。

**步骤**：

- [ ] 固定教材/人工/特例词典/确定性分析/LLM proposal 优先级；
- [ ] 定义最长 accepted 仅为展示选择规则；
- [ ] 定义冲突时降级和 unresolved；
- [ ] 定义合并、拆分、component 和 superseded；
- [ ] 定义 analyzer 片假名原始证据与平假名规范值；
- [ ] 定义词典版本与重跑不复活用户否决项。

**验证**：`勤務表`、`一人`、`取り扱い説明書` 三个决策表完整。

**完成标准**：每个 accepted token 可回答“谁确认、根据什么、哪个版本”。

**建议提交**：与 Task 21 ADR 接受一并提交。

### Task 18：定义 correction event 与并发 contract

**目标**：人工修正可审计、幂等且可重建。

**步骤**：

- [ ] 定义 event key、payload hash 和冲突 409；
- [ ] 定义 reading/boundary/unit kind/component 修正；
- [ ] 定义 optimistic version 或 revision 条件；
- [ ] 定义重复提交和失败重试；
- [ ] 定义重新分析后人工修正优先；
- [ ] 定义日志不记录完整私有上下文。

**验证**：同 key 同 body 幂等；同 key 不同 body 冲突；stale revision 拒绝。

**完成标准**：修正历史可重放，投影可从事件恢复。

**建议提交**：与 Task 21 ADR 接受一并提交。

### Task 19：定义 HTTP 与 view-model contract

**目标**：前端不直接读取 SQLite，也不自行发明状态。

**步骤**：

- [ ] 定义 document/token read API；
- [ ] 定义 correction/unresolved resolve API；
- [ ] 定义 CardModal 所需紧凑 view-model；
- [ ] 定义错误码、feature disabled 404 和 stale 409；
- [ ] 定义分页、缓存、ETag 或 revision hash；
- [ ] 定义 KG/TTS/LA 动作仍调用各自现有 API；
- [ ] 明确 hover 不调用 lookup route。

**验证**：PF-D1 每个状态能映射到响应或降级分支。

**完成标准**：Popover 没有“仅存在于前端 state 的正式业务事实”。

**建议提交**：与 Task 21 ADR 接受一并提交。

### Task 20：定义 feature flag、回滚与删除门禁

**目标**：允许小范围切换，不一次性硬切 672 张卡。

**步骤**：

- [ ] 定义 overlay、actions、legacy reader、LLM proposal 四个 flag；
- [ ] 明确代码默认关闭、Compose 是否显式开启的阶段；
- [ ] 定义新卡、教材、Review、历史 canary 的分批范围；
- [ ] 定义 legacy reader 删除前零未迁移活动内容门禁；
- [ ] 定义回滚数据不删除 correction events；
- [ ] 定义 migration 产生事件后的不可 DROP 规则。

**验证**：开关矩阵覆盖 0/1 组合和依赖冲突。

**完成标准**：任一阶段可回到纯正文可用状态。

**建议提交**：与 Task 21 ADR 接受一并提交。

### Task 21：接受 PF-D2 ADR

**目标**：在任何 schema 写入前完成正式架构确认。

**文件**：

- Modify: PF-D2 ADR
- Modify: PF-D0 设计文档
- Modify: `Docs/README.md`

**步骤**：

- [ ] 逐条核实代码事实；
- [ ] 完成 D1 S1-S12 到领域 contract 映射；
- [ ] 用户确认所有 ADR 门禁；
- [ ] 状态翻为 Accepted；
- [ ] 登记下一阶段只允许 PF-P0 read-only。

**验证**：无未决的内容身份、accepted 来源、offset、事件或回滚问题。

**完成标准**：PF-D2 Accepted，允许进入 PF-P0，但仍未创建生产表。

**建议提交**：`docs(pronunciation): accept PF-D2 domain and data ADR`

---

## PF-P0：真实语料与交互可行性 POC

### Task 22：建立隔离 POC 目录与 fixture

**目标**：所有实验在生产外运行。

**文件**：

- Create: `experiments/pronunciation-overlay/README.md`
- Create: `experiments/pronunciation-overlay/package.json`
- Create: `experiments/pronunciation-overlay/fixtures/`

**步骤**：

- [ ] 不修改根依赖；
- [ ] fixture 使用合成文本和去标识化真实结构；
- [ ] 保存 analyzer 版本与运行命令；
- [ ] 输出目录加入 `.gitignore`；
- [ ] 不复制真实教材原文。

**验证**：全新安装可运行，根 build 不受影响。

**完成标准**：任何人可重复 POC，不依赖当前浏览器会话。

**建议提交**：`test(pronunciation): scaffold isolated PF-P0 harness`

### Task 23：实现结构化 Ruby 解析器 POC

**目标**：安全提取基文、读音和相邻关系。

**步骤**：

- [ ] 使用 HTML/Markdown parser，不用全库替换正则；
- [ ] 解析正常、嵌套异常、跨节点、缺 rt、旧 rp；
- [ ] 输出 base projection 和 source offsets；
- [ ] 记录无法解析项，不静默跳过；
- [ ] 对 13,528 个标签给出 parse success rate。

**验证**：合成边界单测 + 真实只读扫描。

**完成标准**：解析失败项可定位，不修改原文。

**建议提交**：`test(pronunciation): parse legacy Ruby into structured spans`

### Task 24：完成 60 张历史卡逐张决策 manifest

**目标**：为结构破损卡指定修复、归档或排除决策。

**文件**：

- Create: `scripts/maintenance/decisions/pronunciation-content-eligibility-v1.json`
- Update: 历史内容资格报告

**步骤**：

- [ ] 每条绑定 generation id + content hash；
- [ ] 决策限定 `repair / archive / exclude / false-positive`；
- [ ] 可机械修复项声明策略与结果 hash；
- [ ] 不可恢复项不进入 pronunciation migration；
- [ ] false-positive 保留原因和回归样本；
- [ ] 本任务仍不 apply。

**验证**：60/60 有唯一决策，hash 与当前卷一致。

**完成标准**：迁移 eligibility 不再依赖运行时猜测。

**建议提交**：`data(pronunciation): review historical migration eligibility`

### Task 25：建立 Kuromoji 真实语料分析报告

**目标**：量化单 token 正确率、拆分和明显错误。

**步骤**：

- [ ] 运行 2,829 个不同基文；
- [ ] 保存 surface、reading、basic form、POS 和 analyzer version；
- [ ] 分组单 token、多 token、无 reading、语言误判；
- [ ] 固定 `勤務表`、`一人`、`掲示板`、`来月` 等基准；
- [ ] 不把 analyzer 输出直接写数据库。

**验证**：同版本两次运行输出稳定。

**完成标准**：PF-P0 报告能量化“自动能力到哪里为止”。

**建议提交**：`test(pronunciation): benchmark Kuromoji on real card surfaces`

### Task 26：实现片假名到平假名规范化 POC

**目标**：明确 `reading_raw` 与 `reading_hiragana` 的可重建关系。

**步骤**：

- [ ] 实现确定性转换函数；
- [ ] 处理长音、片假名外来词、小假名和非假名；
- [ ] 保留原始 analyzer reading；
- [ ] 不改变表层正文；
- [ ] 补 Unicode 边界测试。

**验证**：`キンム -> きんむ`、`ケイジバン -> けいじばん` 等通过。

**完成标准**：转换无 LLM、无环境差异、可单测。

**建议提交**：`test(pronunciation): normalize analyzer readings deterministically`

### Task 27：生成 466 种复合词候选裁决表

**目标**：把整词承诺转成有边界的人工与规则工作清单。

**步骤**：

- [ ] 按频次、卡型、来源和 analyzer 拆分排序；
- [ ] 每项展示组件、组件读音、原整体 Ruby 证据和上下文摘要；
- [ ] 分类为 deterministic merge、dictionary、manual、proposal、unresolved；
- [ ] 估算人工分钟数和批次数；
- [ ] 不在 Git 保存受版权保护教材长句；
- [ ] 形成稳定 hash 的 review manifest。

**验证**：466/466 有分类槽位，重复项只裁决一次。

**完成标准**：人工工作量和自动覆盖率可计算。

**建议提交**：`data(pronunciation): prepare compound candidate review manifest`

### Task 28：建立版本化特例词典 POC

**目标**：让裁决结果成为可复用事实，不停留在一次性表格。

**文件**：

- Create: `services/pronunciation/dictionaries/ja-pronunciation-v1.json`
- Create: `tests/unit/pronunciationDictionary.test.js`

**步骤**：

- [ ] 定义 surface、reading、unit kind、components、source 和 reason；
- [ ] 首批加入人工确认的高频/高风险项；
- [ ] 包含 `一人` 等 analyzer 明显错误；
- [ ] 定义冲突、删除和版本升级；
- [ ] 不把 LLM proposal 直接放进 accepted 字典。

**验证**：schema 校验、重复键检查、读音格式检查。

**完成标准**：字典可被后续 service 确定性读取。

**建议提交**：`feat(pronunciation): add versioned Japanese exception dictionary`

### Task 29：验证 accepted 合并规则

**目标**：评估哪些相邻组合可以不经逐项人工处理。

**步骤**：

- [ ] 只实现 PF-D2 允许的确定性规则；
- [ ] 每次命中输出 rule id/version/evidence；
- [ ] 对名词连续、连续汉字等宽泛规则设置反例；
- [ ] 与教材/人工/字典冲突时禁止自动接受；
- [ ] 对自动合并结果做分层人工抽样。

**验证**：精确率门槛由 PF-D2 定义并达到；错误不得静默。

**完成标准**：自动规则覆盖率和人工剩余量有真实数字。

**建议提交**：`test(pronunciation): validate deterministic compound merge rules`

### Task 30：完成浮层与选区技术 POC

**目标**：验证单例控制器、多片段锚点和拖动冲突。

**步骤**：

- [ ] 对比 Radix custom anchor 与 Floating UI virtual element；
- [ ] 模拟 token 被 annotation 分成两个 span；
- [ ] 验证多行 token、视口边缘、滚动和 Portal；
- [ ] 验证 pointer movement threshold；
- [ ] 验证 Selection 非空时不打开 Popover；
- [ ] 验证 roving tabindex 与 Escape 焦点恢复；
- [ ] 测量依赖 gzip 增量。

**验证**：Playwright 真实鼠标和键盘，不使用只派发合成事件的伪验证。

**完成标准**：形成“Radix 包装 / Floating UI 包装 / 保持自研”的采用表。

**建议提交**：`test(pronunciation): validate overlay anchoring and selection arbitration`

### Task 31：PF-P0 验收与继续/停止决策

**目标**：决定是否能诚实进入生产开发。

**文件**：

- Create: `Docs/TestReports/Pronunciation_PF_P0_Feasibility_20260803.md`
- Modify: PF-D0 与 PF-D2 实施记录

**步骤**：

- [ ] 汇总解析成功率、自动 token、合并、字典、人工和 unresolved；
- [ ] 汇总 466 种候选工作量；
- [ ] 汇总 60 张坏卡决策；
- [ ] 汇总 UI POC、性能、体积和无障碍；
- [ ] 明确“可以全量整词 / 只能部分整词 / 暂停”结论；
- [ ] 用户确认后才允许 PF-P1。

**验证**：报告数字由脚本生成，未人工手抄漂移。

**完成标准**：PF-P0 PASS，accepted 来源足够；否则停止在原型/研究阶段。

**建议提交**：`docs(pronunciation): accept PF-P0 feasibility gate`

---

## PF-P1：新卡片纯正文与 pronunciation 写入

### Task 32：创建 pronunciation schema migration

**目标**：按 PF-D2 落地数据结构。

**文件**：

- Modify: `database/schema.sql`
- Create: `database/migrations/012_pronunciation_overlay.sql`
- Modify: `services/storage/db/migrationRunner.js`
- Modify: `services/storage/db/testReset.js`
- Modify: `tests/unit/migrationRunner.test.js`

**步骤**：

- [ ] 创建 ADR 接受的表、索引、FK 和 CHECK；
- [ ] migration 与 fresh schema 等价；
- [ ] 不复用旧表名；
- [ ] 不删除 Ruby 数据；
- [ ] test reset 顺序满足 FK。

**验证**：fresh/migrated schema 对比、rollback dry-run、unit。

**完成标准**：migration 012 可重复应用，旧数据库无数据损失。

**建议提交**：`feat(pronunciation): add PF-P1 schema and migration`

### Task 33：实现 pronunciation repository

**目标**：集中数据库访问，不在 route 拼 SQL。

**文件**：

- Create: `services/storage/db/pronunciation.js`
- Modify: database service wiring
- Create: `tests/unit/pronunciationRepository.test.js`

**步骤**：

- [ ] document/token read/write；
- [ ] correction event append；
- [ ] unresolved 查询；
- [ ] revision/hash 条件写入；
- [ ] 幂等键和 payload 冲突；
- [ ] transaction helper。

**验证**：repository 单测覆盖并发、stale、唯一键和重建。

**完成标准**：所有 SQL 归属明确，service 不依赖表细节。

**建议提交**：`feat(pronunciation): add persistence repository`

### Task 34：实现 pronunciation application service

**目标**：封装分析、来源优先级、投影和修正。

**文件**：

- Create: `services/pronunciation/pronunciationService.js`
- Create: `services/pronunciation/pronunciationPorts.js`
- Create: `tests/unit/pronunciationService.test.js`

**步骤**：

- [ ] analyzer port、dictionary reader、optional proposal port；
- [ ] accepted 来源优先级；
- [ ] raw reading 与 hiragana 规范化；
- [ ] merge/split 和 unresolved；
- [ ] revision hash stale；
- [ ] 不调用 KG/LA/FSRS 写路径。

**验证**：表驱动单测覆盖 PF-P0 基准词。

**完成标准**：领域逻辑可在无 HTTP、无真实 DB 环境测试。

**建议提交**：`feat(pronunciation): implement deterministic pronunciation service`

### Task 35：实现 pronunciation HTTP route

**目标**：提供读取、修正和 unresolved API。

**文件**：

- Create: `routes/pronunciation.js`
- Modify: `lib/httpRuntime.js`
- Create: `tests/integration/pronunciation.test.js`
- Create: `tests/integration/pronunciationDisabled.test.js`

**步骤**：

- [ ] GET document/token；
- [ ] POST correction/resolve；
- [ ] feature disabled 404+code；
- [ ] stale、validation、idempotency 错误码；
- [ ] 日志只记 id、状态、耗时和长度；
- [ ] API-only harness 可启动。

**验证**：integration 覆盖成功、关闭、冲突、stale 和降级。

**完成标准**：前端无需直接访问 SQLite。

**建议提交**：`feat(pronunciation): expose controlled pronunciation API`

### Task 36：修改生成 Prompt 为纯日语正文

**目标**：新 LLM 输出不再要求 Ruby。

**文件**：

- Modify: `services/generation/promptEngine.js`
- Modify: prompt contract tests

**步骤**：

- [ ] 删除生成 `<ruby>` 的可能性；
- [ ] 明确 Markdown 正文只含自然日语；
- [ ] 过渡期结构化 reading proposal 与正文分离；
- [ ] audio task 保持纯正文；
- [ ] 三语、语法、场景 20 句全部更新；
- [ ] 不改变英文解释产品合同。

**验证**：snapshot/contract 测试不含 Ruby 标签。

**完成标准**：新 Prompt 不能把读音 HTML 混入正文。

**建议提交**：`feat(generation): request plain Japanese card content`

### Task 37：替换生成后 Ruby 正规化

**目标**：新卡保存前不再调用 `normalizeJapaneseRuby()`。

**文件**：

- Modify: `services/generation/htmlRenderer.js`
- Modify: `services/generation/japaneseFurigana.js`
- Modify: `services/generation/contentPostProcessor.js`
- Modify: generation tests

**步骤**：

- [ ] 新路径保存纯 Markdown；
- [ ] analyzer 产结构化 token，不产 HTML；
- [ ] 旧 `toRuby()` 暂时只留 legacy reader；
- [ ] 防止文件名、audio src 和中文段落被注音；
- [ ] 保持 TTS task 文本不变。

**验证**：生成结果 Markdown 与 rendered DOM 均无新 Ruby。

**完成标准**：新卡活动正文零 Ruby，旧卡仍可读。

**建议提交**：`feat(generation): persist structured pronunciation without Ruby`

### Task 38：将 generation 与 pronunciation 写入接入 use case

**目标**：新卡成功后可靠写入读音文档，失败可降级。

**文件**：

- Modify: `services/application/executeCardGeneration.js`
- Modify: generation ports/storage wiring
- Modify: tests

**步骤**：

- [ ] generation 写入后生成 target revision/hash；
- [ ] pronunciation 写入使用同一明确事务边界；
- [ ] 分析失败时 generation 成功、document 标 partial/unresolved；
- [ ] 不重复创建 document；
- [ ] retry 幂等；
- [ ] KG outbox 和 learning materialization 行为不变。

**验证**：成功、分析失败、DB 失败、重复 job 测试。

**完成标准**：读音失败不丢卡，重试不产生重复 token。

**建议提交**：`feat(generation): persist pronunciation projection for new cards`

### Task 39：增加零新 Ruby 架构门禁

**目标**：防止未来又把 Ruby 写回生产链。

**文件**：

- Modify: `scripts/tests/architectureCompletion.js`
- Create/Modify: architecture tests

**步骤**：

- [ ] 扫描新 generation fixture 和 prompt；
- [ ] 禁止生产 Prompt 输出 `<ruby>/<rt>/<rp>`；
- [ ] 允许 legacy migration 工具中的显式白名单；
- [ ] 禁止新 CardModal DOM 依赖 Ruby；
- [ ] 报错指出具体文件和白名单规则。

**验证**：故意注入 Ruby 时门禁失败，移除后通过。

**完成标准**：零 Ruby 是自动化合同，不依赖人工记忆。

**建议提交**：`test(architecture): prevent new production Ruby markup`

### Task 40：PF-P1 新卡真实冒烟与验收

**目标**：用当前 DeepSeek、VOICEVOX 和真实 volume 验证新卡路径。

**文件**：

- Create: `Docs/TestReports/Pronunciation_PF_P1_New_Cards_20260803.md`

**步骤**：

- [ ] 生成三语卡、语法卡、20 句场景卡各一张；
- [ ] 检查 Markdown、DB、DOM 无 Ruby；
- [ ] 检查 pronunciation document/token；
- [ ] 检查 EN/JA TTS、保存、标签、KG outbox 和 Study Item；
- [ ] 检查分析失败降级；
- [ ] 旧卡仍可打开。

**验证**：lint、typecheck、unit、integration、generation E2E。

**完成标准**：PF-P1 PASS，允许进入 CardModal UI。

**建议提交**：`test(pronunciation): accept PF-P1 new-card pipeline`

---

## PF-P2：CardModal Tooltip/Popover 与选区闭环

### Task 41：引入并锁定浮层原语

**目标**：按 PF-P0 采用表引入最小依赖。

**文件**：

- Modify: `package.json`、lockfile
- Create: `app/components/pronunciation/`

**步骤**：

- [ ] 引入 Radix Tooltip/Popover 或 PF-P0 选定组合；
- [ ] 若使用 Floating UI，只引入所需包；
- [ ] 不加载 global styles；
- [ ] 记录 gzip 增量；
- [ ] 建受控 wrapper，禁止业务代码直接依赖私有 DOM。

**验证**：build、frontend budget、dependency audit。

**完成标准**：依赖选择与 POC 一致，预算未超门禁。

**建议提交**：`feat(ui): add bounded pronunciation overlay primitives`

### Task 42：实现前端 pronunciation API 与 query

**目标**：为 CardModal 提供类型化读音 view-model。

**文件**：

- Modify/Create: `app/features/card-modal/factory-api.ts`
- Create: `app/features/card-modal/pronunciation.ts`
- Modify: types/tests

**步骤**：

- [ ] document query；
- [ ] correction mutation；
- [ ] unresolved mutation；
- [ ] stale/disabled/error 归一化；
- [ ] abort 和缓存 key 绑定 revision；
- [ ] 不把 hover 连接到 KG lookup。

**验证**：hook 单测或 E2E fixture API 断言。

**完成标准**：组件只消费类型化 view-model。

**建议提交**：`feat(ui): add pronunciation API client and state`

### Task 43：实现纯正文 token range mapper

**目标**：把 pronunciation offsets 映射为安全 span。

**文件**：

- Create: `app/features/card-modal/pronunciation-render.mjs`
- Create: `.d.mts` 与 unit tests
- Modify: `markdown.ts` 或 render transforms

**步骤**：

- [ ] 在 DOMPurify 后只处理日语文本节点；
- [ ] 按 block key + code point offset 切分；
- [ ] span 只含原正文文本；
- [ ] annotation 切分后保留 token id；
- [ ] revision mismatch 不渲染 token；
- [ ] 不使用 button 包裹正文。

**验证**：跨节点、emoji、多行、annotation 重叠单测。

**完成标准**：文本投影与未加 span 前逐字符一致。

**建议提交**：`feat(card-modal): map pronunciation tokens onto plain text`

### Task 44：实现单例 Overlay Controller

**目标**：每个 Modal 只管理一个 Tooltip 与 Popover。

**文件**：

- Create: `PronunciationOverlayController.tsx`
- Modify: `CardModal.tsx`

**步骤**：

- [ ] 事件委托定位 token id；
- [ ] 管理 hover、focus、click、open token；
- [ ] 合并相同 token id 的多个 rect；
- [ ] 页面滚动与 resize 自动更新；
- [ ] Modal 关闭清理 timer/listener/request；
- [ ] 无数据时零额外 Portal。

**验证**：React 严格模式重复 mount/unmount 无泄漏。

**完成标准**：长卡片不会为每词创建独立 controller。

**建议提交**：`feat(card-modal): add singleton pronunciation overlay controller`

### Task 45：实现 Tooltip

**目标**：提供快速、不可交互的整体读音。

**步骤**：

- [ ] 250ms 可配置延迟；
- [ ] 显示 hiragana + unit kind；
- [ ] hover/focus 打开，leave/blur/Escape 关闭；
- [ ] 不包含按钮；
- [ ] 不调用 KG/LA/TTS；
- [ ] unresolved 使用保守文案或不显示伪读音。

**验证**：键盘与鼠标 E2E，网络请求断言为零。

**完成标准**：Tooltip 是预览，不是隐藏的业务入口。

**建议提交**：`feat(card-modal): add on-demand pronunciation tooltip`

### Task 46：实现 Popover 内容与状态

**目标**：承载完整读音和学习操作。

**步骤**：

- [ ] 表层词、读音、词性、辞书形、组件；
- [ ] loading/ready/partial/unresolved/stale/error；
- [ ] 固定宽度与视口内最大高度；
- [ ] 非模态 dialog、标题、关闭按钮、Escape；
- [ ] 焦点进入与关闭恢复；
- [ ] 不出现卡片套卡片。

**验证**：axe/ARIA contract、视觉截图、边缘碰撞。

**完成标准**：PF-D1 状态全部由真实 view-model 驱动。

**建议提交**：`feat(card-modal): add pronunciation learning popover`

### Task 47：实现指针与 Selection 仲裁

**目标**：解决当前 Ruby 选中困难并避免新浮层抢操作。

**步骤**：

- [ ] pointerdown 记录起点；
- [ ] movement threshold 判定拖动；
- [ ] pointerup 后 rAF 同步 Selection；
- [ ] Selection 非空优先工具条；
- [ ] contextmenu 同步重捕获选区；
- [ ] 不依赖陈旧 `hasSelection` state；
- [ ] 浮层和选区工具条互斥。

**验证**：真实鼠标拖动与右键 E2E，多次快速选择无抖动。

**完成标准**：正文选择比 Ruby 版本更稳定。

**建议提交**：`fix(card-modal): arbitrate selection before pronunciation overlays`

### Task 48：实现双击整词与键盘注音导航

**目标**：提供精确整词选择与可访问入口。

**步骤**：

- [ ] 双击 accepted token 选择完整 surface；
- [ ] unresolved 不越权扩大选择；
- [ ] 注音导航模式使用 roving tabindex；
- [ ] 方向键在当前句 token 间移动；
- [ ] Enter/Space 打开 Popover；
- [ ] Escape 返回正文且不关闭 CardModal。

**验证**：键盘 E2E、焦点顺序、selection preview 精确。

**完成标准**：不新增几十个默认 Tab stop。

**建议提交**：`feat(card-modal): add word selection and pronunciation navigation`

### Task 49：接入 TTS、KG、LA 与生成卡动作

**目标**：充分发挥 Popover，但不混淆领域所有权。

**步骤**：

- [ ] 朗读复用 Selection TTS 与共享 playback owner；
- [ ] 查知识点显式点击后才调用 lookup；
- [ ] 加入学习复用 manual intent contract；
- [ ] 生成卡复用现有菜单与 concrete phrase；
- [ ] 每个动作独立 loading/error/retry；
- [ ] 一项失败不关闭其它内容。

**验证**：API request body 与数据库零越界写入断言。

**完成标准**：Popover 是协调器，不拥有 TTS/KG/LA 状态。

**建议提交**：`feat(card-modal): integrate pronunciation learning actions`

### Task 50：实现人工纠音与范围修正 UI

**目标**：允许用户修正分析器和词典错误。

**步骤**：

- [ ] 修正读音、范围、类型和 component；
- [ ] 显示原值、来源和理由；
- [ ] 失败不丢输入；
- [ ] stale version 提示刷新，不覆盖他人修改；
- [ ] 成功后更新当前 token 投影；
- [ ] 不编辑卡片正文。

**验证**：幂等、409、失败重试和重开页面保持。

**完成标准**：`一人` 可被纠正且重分析后不复活错误值。

**建议提交**：`feat(card-modal): add auditable pronunciation corrections`

### Task 51：PF-P2 桌面验收

**目标**：完成 CardModal 全流程回归。

**文件**：

- Modify: Cards Factory E2E/visual
- Create: `Docs/TestReports/Pronunciation_PF_P2_CardModal_20260803.md`

**步骤**：

- [ ] S1-S12 真实实现映射；
- [ ] 1280/1440 截图与无溢出；
- [ ] 选区、标记、复制、TTS、KG、LA、生成卡；
- [ ] stale、unresolved、disabled 和失败；
- [ ] 性能、Portal 数和 listener 泄漏；
- [ ] frontend budget。

**验证**：lint、typecheck、unit、integration、Cards Factory E2E、visual、architecture。

**完成标准**：PF-P2 PASS，才允许迁移其它消费者。

**建议提交**：`test(pronunciation): accept PF-P2 CardModal overlay`

---

## PF-P3：教材与 Review 消费者

### Task 52：扩展教材 view-model 的 pronunciation 数据

**目标**：教材官方/人工读音成为最高优先来源。

**文件**：

- Modify: textbook application/view-model/types/API tests

**步骤**：

- [ ] 从表达 revision 映射 pronunciation document；
- [ ] 官方/人工来源标记 accepted；
- [ ] 不复制教材全文到普通日志；
- [ ] Track 未发布时不创建学习项；
- [ ] 旧 `ja_ruby_html` 保留迁移读取，不再作为新真源。

**验证**：draft/verified/published/revised 状态集成测试。

**完成标准**：教材页面不自行分析或猜读音。

**建议提交**：`feat(textbooks): expose authoritative pronunciation view-model`

### Task 53：切换 TextbookPublishedBrowser

**目标**：教材发布浏览改用纯正文和共享浮层。

**文件**：

- Modify: `TextbookPublishedBrowser.tsx`
- Modify: `textbooks.css`
- Modify: textbooks E2E

**步骤**：

- [ ] 不再把 `ja_ruby_html` 直接塞进活动 DOM；
- [ ] 复用共享 token renderer/controller；
- [ ] 保留官方 Track、单句 TTS、中文 cue、标红和派生卡；
- [ ] 人工校对入口只修 pronunciation 数据；
- [ ] 页面密度保持 SaaS workflow 基线。

**验证**：教材 E2E/visual 与 audio owner。

**完成标准**：教材活动 DOM 零 Ruby，功能无回归。

**建议提交**：`feat(textbooks): adopt pronunciation overlay renderer`

### Task 54：扩展 Review answer view-model

**目标**：复习答案面读取稳定纯正文和 pronunciation token。

**文件**：

- Modify: learning application service/types/API tests

**步骤**：

- [ ] 普通卡与教材方向都返回 pronunciation 引用；
- [ ] cue 面与 answer 面所有权不变；
- [ ] reveal 前不泄露读音；
- [ ] pronunciation 缺失不阻塞评分；
- [ ] 不修改 SchedulerPort、Review Event 或 FSRS。

**验证**：learning unit/integration 覆盖 reveal 与评分。

**完成标准**：读音是答案辅助，不是评分条件。

**建议提交**：`feat(learning): expose pronunciation on revealed answers`

### Task 55：切换 ReviewSessionPage

**目标**：复习答案面接入共享浮层而不产生第二套评分 UI。

**步骤**：

- [ ] 只在 reveal 后激活 token；
- [ ] 不在 cue 面提前显示 Tooltip；
- [ ] Popover 不覆盖 sticky 评分区；
- [ ] TTS 与现有 review audio 共用 playback owner；
- [ ] 评分快捷键与 Popover 键盘不冲突；
- [ ] 评分提交中关闭或冻结浮层。

**验证**：Review E2E、四档评分、失败重试、低视口桌面。

**完成标准**：学习调度行为逐条一致。

**建议提交**：`feat(learning): adopt pronunciation overlays after reveal`

### Task 56：完成三消费者共享回归

**目标**：证明 CardModal、Textbook、Review 使用一个交互合同。

**步骤**：

- [ ] 共享 controller/hook 不复制；
- [ ] TTS owner 互斥；
- [ ] KG lookup 只有显式点击；
- [ ] annotation 在三页面重放；
- [ ] feature flag 关闭统一降级；
- [ ] 不新增移动端测试。

**验证**：三套目标 E2E + architecture duplicate audit。

**完成标准**：跨页面行为一致，领域动作仍归各自服务。

**建议提交**：`test(pronunciation): verify three desktop consumers`

### Task 57：PF-P3 验收报告

**目标**：记录消费者迁移证据与遗留范围。

**文件**：

- Create: `Docs/TestReports/Pronunciation_PF_P3_Consumers_20260803.md`

**步骤**：

- [ ] 记录测试数字、截图和 API；
- [ ] 记录 `ja_ruby_html` 仍存在但已退出哪些运行路径；
- [ ] 记录 annotation/TTS/KG/LA 零越界；
- [ ] 记录历史卡仍由 legacy reader 处理；
- [ ] 用户确认后允许 PF-P4。

**验证**：报告与代码/feature flags 一致。

**完成标准**：PF-P3 PASS。

**建议提交**：`docs(pronunciation): accept PF-P3 consumer migration`

---

## PF-P4：历史只读迁移与 Canary

### Task 58：创建并验证迁移前备份

**目标**：在任何真实 apply 前建立可恢复副本。

**步骤**：

- [ ] SQLite online backup；
- [ ] records 与相关 Docker volume 备份；
- [ ] 输出 checksum、大小、时间和源 SHA；
- [ ] 在隔离目录恢复并运行 integrity check；
- [ ] 不覆盖现有备份；
- [ ] 不备份 TTS cache 作为业务真源。

**验证**：恢复副本可启动只读审计。

**完成标准**：备份和恢复均有证据，不只是文件存在。

**建议提交**：运行产物不进 Git，只提交脱敏报告。

### Task 59：独立处理 60 张历史结构破损卡

**目标**：先清理迁移输入，不与 pronunciation apply 混写。

**步骤**：

- [ ] 对 Task 24 决策做 hash-gated dry-run；
- [ ] 用户批准修复/归档/排除清单；
- [ ] 独立 apply，保存前后 hash；
- [ ] 运行现有学习 eligibility 与 annotation 审计；
- [ ] 修复失败立即停止，不继续 Ruby 迁移；
- [ ] 生成独立数据清理报告。

**验证**：60/60 结果明确，近期卡零误伤。

**完成标准**：pronunciation eligible 集合不含结构破损正文。

**建议提交**：`data(cards): resolve historical pronunciation migration blockers`

### Task 60：生成历史 pronunciation dry-run manifest

**目标**：对合格卡生成不写库的完整迁移计划。

**步骤**：

- [ ] 绑定 generation id/content hash；
- [ ] 生成纯正文投影与 token；
- [ ] 应用字典、规则和 accepted 来源；
- [ ] 输出 unresolved、parse error 和 stale；
- [ ] 输出目标 document/token 数与 hash；
- [ ] 同快照两次运行 manifest hash 一致。

**验证**：无数据库与 records 写入，稳定排序。

**完成标准**：每张 eligible 卡都有明确结果或阻塞理由。

**建议提交**：`test(pronunciation): build historical migration dry-run manifest`

### Task 61：实现活动投影或 copy-on-write apply 工具

**目标**：按 PF-D2 身份方案实现受控写入。

**文件**：

- Create: `scripts/maintenance/applyPronunciationMigrationPlan.js`
- Create: unit/integration tests

**步骤**：

- [ ] 默认 dry-run，必须显式 `--apply`；
- [ ] 校验 manifest hash 与 generation content hash；
- [ ] 使用 transaction/batch checkpoint；
- [ ] 已应用结果幂等；
- [ ] stale 任一项不静默覆盖；
- [ ] 不原地改 generation；
- [ ] 保存审计事件和结果摘要。

**验证**：临时 DB apply/reapply/stale/rollback 测试。

**完成标准**：apply 只能执行已批准 manifest。

**建议提交**：`feat(pronunciation): add hash-gated migration apply tool`

### Task 62：执行 annotation shadow replay

**目标**：证明去 Ruby 后现有标记仍能重锚。

**步骤**：

- [ ] 对所有 active/orphaned annotation 运行旧/新投影对比；
- [ ] quote selector 优先，position selector 备用；
- [ ] 输出 exact/prefix/suffix 与 offset 差异；
- [ ] 不修改真实 annotation；
- [ ] 任一新增 orphaned 进入人工清单；
- [ ] 连续两次结果 hash 一致。

**验证**：shadow report 与 CA-R1 基线对照。

**完成标准**：新增 orphaned 为零或全部有明确批准决策。

**建议提交**：`test(annotations): replay anchors against plain pronunciation projection`

### Task 63：执行跨域只读回归

**目标**：确认历史投影不破坏教材、Review、TTS、KG 和派生卡。

**步骤**：

- [ ] 普通卡与教材内容投影；
- [ ] Review cue/answer；
- [ ] selection TTS 文本；
- [ ] KG evidence/lookup；
- [ ] Study Item content hash 与 Review Event；
- [ ] 派生卡 source context；
- [ ] 数据前后计数和不可变表 hash。

**验证**：专用只读审计脚本 + integration。

**完成标准**：pronunciation migration 零调度和历史事件漂移。

**建议提交**：`test(pronunciation): verify cross-domain migration invariants`

### Task 64：执行小范围历史 Canary

**目标**：先在可回滚子集启用，不全量切 672 张卡。

**步骤**：

- [ ] 选取不同卡型、日期、复杂度和 annotation 状态的代表集；
- [ ] 记录 canary generation ids/hash；
- [ ] apply approved manifest 子集；
- [ ] 打开 overlay，保留 legacy reader；
- [ ] 运行页面、API、selection、TTS、KG、LA 回归；
- [ ] 回滚一次并再次前进，验证双向操作。

**验证**：canary 前后不变量和截图。

**完成标准**：Canary PASS，回滚可用。

**建议提交**：仅提交报告和必要修复，不提交真实数据。

### Task 65：PF-P4 全量迁移准入评审

**目标**：决定能否扩大历史迁移范围。

**文件**：

- Create: `Docs/TestReports/Pronunciation_PF_P4_Historical_Canary_20260803.md`

**步骤**：

- [ ] 汇总 eligible/excluded/unresolved/failed；
- [ ] 汇总 annotation replay；
- [ ] 汇总读音正确性抽样；
- [ ] 汇总 canary 回滚；
- [ ] 列出未迁移活动内容；
- [ ] 用户确认后才允许 PF-P5。

**验证**：报告数字来自 manifest 与审计脚本。

**完成标准**：PF-P4 PASS 或明确停止，不允许模糊进入全量退役。

**建议提交**：`docs(pronunciation): accept PF-P4 historical migration canary`

---

## PF-P5：全量切换与生产 Ruby 退役

### Task 66：全量应用批准的历史迁移

**目标**：将合格历史内容切到纯正文活动投影。

**步骤**：

- [ ] 使用 Task 58 备份后的已批准 manifest；
- [ ] 分批 apply 并 checkpoint；
- [ ] 每批运行 integrity、annotation 和跨域不变量；
- [ ] unresolved 保持 legacy reader 或纯正文降级；
- [ ] 不修改排除项；
- [ ] 输出最终迁移结果 hash。

**验证**：全量计数、重跑幂等、数据库 integrity。

**完成标准**：所有 eligible 活动内容使用 pronunciation projection。

**建议提交**：真实数据不进 Git，提交脱敏结果报告。

### Task 67：切换所有运行消费者

**目标**：运行时不再从 Ruby 获取读音。

**步骤**：

- [ ] CardModal；
- [ ] TextbookPublishedBrowser；
- [ ] ReviewSessionPage；
- [ ] server-rendered card HTML 或其它报告页；
- [ ] sandbox seed；
- [ ] API view-model；
- [ ] 测试 fixtures。

**验证**：生产路径 `rg` 无未解释 Ruby reader。

**完成标准**：legacy reader 只服务明确未迁移审计项。

**建议提交**：`feat(pronunciation): switch all active consumers to plain content`

### Task 68：清零 legacy reader 活动依赖

**目标**：满足删除 Ruby 兼容代码的硬门禁。

**步骤**：

- [ ] 查询仍调用 legacy reader 的 target；
- [ ] 区分活动、归档、排除和 stale；
- [ ] 活动项必须迁移或明确降级成纯正文；
- [ ] 归档项不能从正常 UI 打开；
- [ ] 结果数量为零并连续两次一致；
- [ ] feature flag 关闭演练。

**验证**：运行日志和审计报告均无活动 legacy hit。

**完成标准**：`PRONUNCIATION_LEGACY_RUBY_READER_ENABLED=0` 后功能正常。

**建议提交**：`test(pronunciation): prove zero active legacy Ruby reads`

### Task 69：删除生产 Ruby 生成与渲染代码

**目标**：完成真正的技术退役。

**文件**：

- Modify/Delete: `toRuby()`、`normalizeJapaneseRuby()` 生产调用
- Modify: `htmlRenderer.js`、`japaneseFurigana.js`、CSS、projection、tests

**步骤**：

- [ ] 删除生产 Ruby 生成；
- [ ] 删除 `rt/rp` CSS；
- [ ] 删除 selection 的 Ruby fallback；
- [ ] 简化 text projection 的 `rt/rp` 排除；
- [ ] 旧解析器移到只读 migration/archive 工具；
- [ ] 删除不再需要的 fixture；
- [ ] 保留架构白名单最小化。

**验证**：故意恢复生产 Ruby 时 architecture gate 失败。

**完成标准**：活动代码与 DOM 零 Ruby。

**建议提交**：`refactor(pronunciation): retire production Ruby rendering`

### Task 70：更新配置、架构和运行手册

**目标**：让运行与故障处理方式可维护。

**文件**：

- Modify: `.env.example`、`docker-compose.yml`、`CLAUDE.md`、`Docs/README.md`
- Create: `Docs/Operations/Pronunciation_Overlay_Runbook.md`

**步骤**：

- [ ] 记录 feature flags；
- [ ] 记录 analyzer、dictionary、unresolved 和 correction；
- [ ] 记录 KG/TTS 降级；
- [ ] 记录 migration/rollback 与备份；
- [ ] 记录隐私日志边界；
- [ ] 标注 Ruby 为历史迁移格式。

**验证**：运行手册命令在当前 Compose 可执行。

**完成标准**：无需阅读实现代码即可启停和诊断。

**建议提交**：`docs(pronunciation): document operation and Ruby retirement`

### Task 71：PF-P5 生产验收与容器重建

**目标**：在真实本地栈证明完整退役成立。

**步骤**：

- [ ] `docker compose up -d --build`，不删除 volume；
- [ ] health 200，四容器状态正常；
- [ ] 新卡三类真实生成；
- [ ] 历史卡、教材、Review、Tooltip、Popover、TTS、KG、LA；
- [ ] DOM 扫描零 Ruby；
- [ ] SQLite integrity 与业务计数；
- [ ] 全套质量门禁。

**文件**：Create `Docs/TestReports/Pronunciation_PF_P5_Ruby_Retirement_20260803.md`

**完成标准**：PF-P5 PASS，Ruby 仅存在于只读档案/迁移工具。

**建议提交**：`test(pronunciation): accept PF-P5 Ruby retirement`

---

## PF-R1：真实运行观察

### Task 72：增加不含正文的运行观测

**目标**：观察可靠性，不记录学习内容。

**步骤**：

- [ ] 指标只记录 token source/status、耗时、错误码和长度；
- [ ] Tooltip open 不写内容和 KG lookup；
- [ ] 记录 Popover action 成功/失败的类别计数；
- [ ] 记录 stale、unresolved、legacy hit 和 correction；
- [ ] 记录 controller/listener/请求泄漏信号；
- [ ] 提供关闭开关。

**验证**：日志中搜索不到完整 surface、reading 或卡片正文。

**完成标准**：能判断健康度，不泄露用户学习内容。

**建议提交**：`feat(observability): add content-free pronunciation telemetry`

### Task 73：完成真实使用期观察

**目标**：至少覆盖 7 个实际使用日或 PF-D2 约定窗口。

**步骤**：

- [ ] 每日记录 Tooltip/Popover、unresolved、correction 和失败；
- [ ] 检查 selection 工具条出现与右键失败；
- [ ] 检查 TTS/KG 降级；
- [ ] 检查内存、长任务和 Portal 残留；
- [ ] 检查 legacy hit 保持零；
- [ ] 不以空闲日冒充真实使用日。

**验证**：原始观测摘要与最终报告数字一致。

**完成标准**：观察窗口满足，未出现 P1 数据或交互缺陷。

**建议提交**：运行数据不进 Git，只提交脱敏报告。

### Task 74：处理纠音与 unresolved 批次

**目标**：用真实使用反馈完善词典与规则。

**步骤**：

- [ ] 汇总人工 correction，不直接复制私有句子；
- [ ] 将可泛化项升级为版本化词典或规则；
- [ ] 保留只适用于单卡的 manual override；
- [ ] 复测 `一人`、复合词和人名地名；
- [ ] 重分析不复活已否决结果；
- [ ] 更新 analyzer/dictionary version。

**验证**：修正前后 diff、回归样本和事件重放。

**完成标准**：真实错误率下降，未引入宽泛错误规则。

**建议提交**：`fix(pronunciation): refine reviewed readings and merge rules`

### Task 75：PF-R1 退役复核

**目标**：确认 Ruby 不需要作为运行时回退重新启用。

**文件**：

- Create: `Docs/TestReports/Pronunciation_PF_R1_Observation_20260803.md`

**步骤**：

- [ ] 汇总真实使用日和关键指标；
- [ ] 汇总 correction/unresolved；
- [ ] 证明 legacy hit 为零；
- [ ] 证明 KG/TTS/LA/annotation 边界；
- [ ] 列出剩余风险和下一阶段建议；
- [ ] 用户确认退役长期成立。

**验证**：报告数字可从观测数据复算。

**完成标准**：PF-R1 PASS。

**建议提交**：`docs(pronunciation): accept PF-R1 runtime observation`

---

## Final：完整封板

### Task 76：执行最终工程、运行与文档验收

**目标**：确认 76 项终态真实存在，不只勾选任务框。

**代码门禁**：

```bash
npm run lint
npm run typecheck:react
npm run test:unit
npm run test:integration
npm run test:architecture
npm run test:e2e
npm run test:textbooks:acceptance
npm run smoke
```

**运行门禁**：

- [ ] Compose 全量重建成功，volume 保留；
- [ ] `/api/health` 200；
- [ ] 三类新卡、历史卡、教材和 Review 全绿；
- [ ] 活动 DOM、Prompt、生成 Markdown 和生产代码零 Ruby；
- [ ] SQLite integrity `ok`；
- [ ] annotation、KG、learning、FSRS 和教材事实计数无异常漂移；
- [ ] frontend budget 与 npm audit 满足当前仓库门禁；
- [ ] 本地/远端 SHA 对账；
- [ ] 工作树干净。

**文档门禁**：

- [ ] PF-D0、PF-D1、PF-D2 状态与事实一致；
- [ ] PF-P0-P5、PF-R1 报告齐全；
- [ ] README、CLAUDE、runbook 和 feature flags 同步；
- [ ] 本计划记录实际提交映射和任何阶段合并偏差；
- [ ] 历史 Ruby 文档明确标为迁移背景，不误导新开发。

**完成标准**：Final 报告为 PASS，76 项有代码、测试、文档或运行证据；无法验证的项不能
标为完成。

**建议提交**：`docs(pronunciation): complete Ruby retirement program`

## 5. 每阶段最小回滚点

| 阶段 | 回滚方式 |
|---|---|
| Gate 0 / D1 / D2 / P0 | 仅文档和 POC，删除隔离产物即可，生产零变化 |
| PF-P1 | 关闭 pronunciation 写入，新卡继续纯正文；不删除已写数据 |
| PF-P2 | 关闭 overlay/actions，CardModal 降级纯正文和现有选区工具条 |
| PF-P3 | 关闭教材/Review 消费者开关，保留 CardModal 已验收路径 |
| PF-P4 | 按 manifest/canary 回滚活动投影，不改原 generation |
| PF-P5 | 回到上一稳定纯正文投影，不恢复 Ruby 作为长期方案 |
| PF-R1 | 关闭 telemetry 或 proposal，不删除 correction facts |

## 6. 实施记录模板

每完成一个阶段，在本节追加：

```text
阶段：PF-Px
日期：YYYY-MM-DD
提交：<sha...>
任务：Task N-M
验证：<test counts and runtime evidence>
偏差：<none or exact deviation>
回滚点：<flag/sha/manifest>
结论：PASS / BLOCKED
```

## 7. 本轮实施快照（2026-08-03）

本节是执行事实，不替代前面各任务的产品确认框。用户要求完成本计划的开发后，已经先落地
可自动化、可回滚、不会改写历史内容的部分；人工确认和真实时间窗口不能由代码执行伪造。

| 阶段 | 当前事实 | 结论 |
|---|---|---|
| Gate 0 | 只读备份、SQLite integrity、Ruby inventory、坏卡 eligibility、消费者盘点报告已生成 | 自动证据完成；产品门禁未代用户确认 |
| PF-D1 | `pf-d1-pronunciation-overlay.html` 有 S1-S12 静态状态和桌面交互参考 | 原型存在；逐状态人工确认待完成 |
| PF-D2 | schema/repository/service/API/flag/offset/correction contract 已落地到 ADR 与代码 | 实现基线存在；ADR Accepted 状态与用户确认仍需同步 |
| PF-P0 | 466 候选、60 张坏卡、Kuromoji 真实语料 benchmark、迁移 dry-run、前端 POC 已实跑 | 研究完成；无法承诺“全量整词自动接受”，历史 apply 被阻塞 |
| PF-P1 | 新卡纯正文、pronunciation document/token、失败降级、零 Ruby 架构扫描已落地 | 代码、单元/集成、架构和构建门禁通过；Compose 运行态健康已通过，但未把 health 当作真实三类 LLM/TTS 生成冒烟 |
| PF-P2 | CardModal Tooltip/Popover、整词选择、键盘导航、TTS/KG/LA/纠音边界已落地 | 完整桌面 E2E **82/82**，视觉回归和前端预算通过 |
| PF-P3 | Textbook/Review 共享 `PronunciationText`，reveal/官方来源/播放所有权边界已落地 | 教材 acceptance gates passed；消费者 E2E 已包含在完整 **82/82** 中 |
| PF-P4 | 只读历史 manifest、copy-on-write dry-run、annotation shadow replay 已落地；shadow 28 条中 27 条可定位、0 条新增 orphaned | 只读通过；60 张人工决策、approved Canary 和回滚待完成 |
| PF-P5 | legacy reader 仍保留，生产 Ruby 删除未执行 | **阻塞**：不能在没有历史批准和 Canary 的情况下删除 |
| PF-R1 | content-free telemetry 已落地，默认关闭、Compose 验收开启 | **阻塞**：7 个真实使用日尚未发生 |
| Final | 代码、自动化门禁、Compose 重建、health 和 smoke 已完成本轮复核 | 自动化与运行态 PASS；因历史迁移、Ruby 删除和 PF-R1 观察未完成，最终封板仍 BLOCKED |

### 已验证的自动化结果

- `npm run lint`、`npm run typecheck:react`、`npm run test:architecture`：通过。
- Unit：**456/456**；Integration：**89/89**。
- Desktop E2E：`npm run test:e2e -- --workers=1`，**82/82**。
- `npm run test:textbooks:acceptance`：完成，TC-P4 acceptance gates passed。
- `npm audit --omit=dev --audit-level=high`：0 vulnerabilities。
- Compose 四服务运行态健康，`/api/health` overall online，`npm run smoke`：**7/7**。
- 新增 telemetry/shadow replay 单元与集成测试：6/6 通过。
- 新增 `pronunciation-quality-v1` 中文残留保护：纯汉字、无读音且 `basic_form=*` 的分析器 token
  不进入可见日语注音投影，并由单元测试覆盖；该规则不改写原始正文或任何业务数据。
- 新增复合候选人工评审批次 manifest：466 个不同候选、598 次出现、479 次合格出现，按每批 25 个
  拆成 19 批；manifest hash 为 `e0ba515763676dd64546f61cee43a87f32ed23c21453ca1b076e6b5a1886354c`。
  所有候选仍为 `unreviewed`，没有 accepted 来源，不得据此执行历史迁移。
- Shadow replay 连续两次 `reportHash`：
  `bfcab5224107848f3c3ee8e4051a554b237c93cddff6ca78307b212c4bfab1cc`。
- Shadow replay 不写真实 annotation、Ruby 或 generation；1 条原有 orphaned 保持原状。

### 尚未完成且不能自动代签的门禁

1. 用户逐项确认 PF-D0/PF-D1/PF-D2 产品与交互决策。
2. 60 张历史结构问题卡的 `repair/archive/exclude/false-positive` 人工决策。
3. 466 种复合词候选的 accepted 来源与人工抽样。
4. approved historical Canary、回滚、再次前进和全量 apply。
5. PF-P5 删除生产 Ruby 生成/渲染链路后的容器验收。
6. 至少 7 个真实使用日的 PF-R1 观察与最终退役确认。

因此，本计划当前不能把 76 项全部标为完成，也不能把最终报告写成 PASS。自动化质量门禁和
容器运行复核已经完成；下一步是由用户批准历史 Canary 前置清单，再按 PF-P4 → PF-P5 → PF-R1
顺序推进，不得跳过人工决策、回滚演练和真实观察期。
