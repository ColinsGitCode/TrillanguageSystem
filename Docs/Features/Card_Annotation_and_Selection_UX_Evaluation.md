# 学习卡片选区交互与注解层 UX 评估（CA-D0）

> 状态：**Accepted 专题基线 · CA-P1–P8、CA-R1 与 CA-I1 已完成。运行时只读写规范注解层；旧 HTML 表已冻结**
>
> 日期：2026-07-23；复审修订：2026-07-26；迁移 POC、菜单库 POC、CA-P1 生产接入与 CA-I1 交互补齐：2026-07-27
>
> 上位约束：根 `CLAUDE.md` 的 Markdown-first 卡片契约与不可变内容边界；[DS-W1 Cloudscape 采用表](../TestReports/Cloudscape_Workflow_POC_Assessment_20260723.md) 的「原则复用 + 自研有界包装」口径与三档决策法（直接使用 / 包装使用 / 保持自研）
>
> 决策范围：选区交互丰富度（A 层）、注解层持久化模型（B①）、第三方 UI 框架采用边界
>
> **不在范围**：修改卡片正文（B②）。若将来要做，必须独立 ADR，并复用教材域已验证的 copy-on-write 修订机制，不得就地改写。
>
> 文档治理：本文已登记进 [Docs/README.md](../README.md) 作为当前专题评估入口；技术权威为已接受的 [Card Annotation Layer ADR](../Architecture/Card_Annotation_Layer_ADR.md)。正文仍不可变；CA-P8 后 Cards Factory、教材课程与 Review 只使用 `card_annotations`，旧 HTML 表只作冻结迁移/审计快照。

## 复审修订记录（2026-07-26）

外部复审对本文初稿提出 4 个 P1 + 2 个 P2,均经代码核实成立,已在下文修订:

- **P1-1**：`card_highlights` 是**跨域共享表**,非 CardModal 局部存储 → 新增 §3.1 消费者迁移矩阵与双读/切换/回滚顺序。
- **P1-2**：注解身份不能用可变文件路径 → §6.1 改为 `target_kind + target_id + target_revision/hash`。
- **P1-3**：缺规范化「可见基文投影」契约 → 新增 §6.2 projection 契约。
- **P1-4**：存量迁移不是「一行转一行」→ §7 迁移单位改为**逐 mark**,并纳入真实审计数字。
- **P2-5**：Base UI 非 v1.0 稳定(npm latest `1.0.0-rc.0`);删除静态体积估算 → §2.3。
- **P2-6**：能力描述过绝对 → §1 精确化键盘可达与「可查询性」。

---

## 0. 需求重述

学习卡片弹窗当前的选区能力「编辑性」不足。经确认,目标是**在不可变卡片内容之上**做得更厚:标记、批注、查词——**不是**编辑卡片正文。

因此本文要回答:**该不该引入成熟的学习/笔记类 UI 框架与组件?引入哪一层?**

## 1. 当前实现事实（已核实）

| 事实 | 位置 |
|---|---|
| CA-I1 后，选区工具条支持四色标记、取消标记、复制、知识点查询与生成三类卡片；下拉与右键菜单由 Radix 接管 | `app/features/card-modal/CardModal.tsx` |
| 阅读区已有 `onContextMenuCapture` 边界：有有效选区才打开应用菜单，无选区放行浏览器原生菜单 | 同上 |
| CA-P8 前标红把**整份渲染 HTML 连 mark 一起存**；该旧 repository/HTTP 链路现已删除 | 冻结表 `card_highlights` |
| 标记支持 red / yellow / green / blue 四种语义颜色；历史标记可点击改色或软删除 | `app/styles/card-modal.css`、`factory-api.ts` |
| 净化器已允许 `mark` 标签与 `class` 属性 | `app/features/card-modal/markdown.ts` |
| 已有 **ruby-aware 选区提取**(剔除 `rt/rp`、音频按钮、外来语标签),但**只作用于当前选中片段,不产出整卡线性文本** | `app/features/card-modal/selection.ts:91` |
| **不存在任何修改卡片内容的 API**;卡片事实上不可变 | `routes/*.js` |
| 不可变是**有下游原因**的:`content_hash` 钉进 `study_items` 与 `learning_review_events`,物化对 hash 漂移直接 `throw` | `materializeStudyItems.js` |
| KG 已启用(`KG_ENABLED=1`),`/api/kg/search`、`/api/kg/lookups`、`points/:id` 就绪 | `routes/kg.js`、`.env` |
| **无「任意文本按需 TTS」接口**(仅教材域 TTS) | `routes/textbooks.js` |

**键盘可达(精确)**：CA-I1 已补齐键盘选区监听。用户使用 Shift +
方向键、Home/End 或 PageUp/PageDown 扩展选区后，工具条自动出现并把焦点移到
首个可用动作；工具条内部支持 Left/Right/Home/End 循环导航，Escape 依次关闭
知识点面板、工具条或弹窗。鼠标选区、点击历史标记与右键菜单继续可用。

**可查询性(精确)**:数据库已具备跨卡标红统计(审计脚本在用);缺的是**高亮文本本身不能被结构化查询或索引**——正文与 mark 一起烤在 HTML 里。

## 2. 候选评估

### 2.1 编辑器框架(TipTap / Lexical / ProseMirror / BlockNote)——**不采用**

- 核心价值是**拥有文档模型**,与「Markdown-first + DOMPurify 渲染 + 内容不可变」正面冲突;
- 且**答非所问**:已确认不改卡片正文。将来若做 B②,正确路径是结构化字段 copy-on-write(教材域已验证),不需要富文本编辑器。

### 2.2 注解库(Recogito text-annotator)——**v1 不引包；直接吸收数据模型**

CA-P2 使用 `@recogito/text-annotator@4.2.5` 完成真实浏览器 POC。DOMPurify 后的 ruby 与音频按钮可保留，但原生 selector 会把 `<rt>` 注音计入 quote；排除 `rt/rp` 与音频节点后又会拆成多个 selector，并产生需包装层过滤的空 selector。其渲染器还会在正文根节点内部追加临时 highlight layer，而当前兼容链路仍会保存该根节点的 `innerHTML`。

因此引包不能替代本项目必须维护的 ruby-aware canonical projection，反而增加一套 DOM 生命周期和 **24,520 B gzip**。v1 不引入生产包，只吸收 W3C Web Annotation 的 `TextQuoteSelector + TextPositionSelector` 模型，锚定与渲染由项目自己控制。未来完全停止旧 HTML compatibility write 后，可另开 POC 重评只读 overlay。

### 2.3 无头 UI 原语(Radix / Base UI / React Aria / Ark)——**包装使用**

A 层所需的上下文菜单、分组/子菜单、浮层定位、键盘导航、焦点管理、ARIA 语义,正是该类库本职,也是当前手写且缺失最严重的部分。

**澄清先例误用**:DS-W1 否决 Cloudscape 的主因是**解包体积 + global styles 覆盖字体与 tokens**。无头库**不发样式、按组件 tree-shake**,该否决理由不成立,不得据此一票否决。但**「无样式」不等于「体积可忽略」**——依赖体积仍需 POC 用 gzip 增量量化。

选型特征(**以 POC 实测为准,不引静态数字**):Radix 生态最大(shadcn 基于其上);**Base UI(Radix/Floating UI/MUI 原班人马)截至 2026-07-26 npm latest 仍为 `1.0.0-rc.0`,尚非稳定版**;React Aria(Adobe)a11y 最严格;Ark UI 跨框架 + 状态机。TipTap/Lexical 的体积此前引用的静态 KB 数缺少 min/gzip/单包口径,**已删除**,统一由 POC 报告 JS/CSS gzip 增量。

### 2.3.1 POC 实测(2026-07-27,`experiments/menu-primitives/`)

同一份选区工具条实现三遍(手写基准 / Radix / React Aria),**共用从 `card-modal.css` 原样抽出的工具条样式**,各自独立打包比对。

| 方案 | JS gzip 增量 | 版本 | License | 稳定性 |
|---|---:|---|---|---|
| 手写基准 | — | — | — | 现状 |
| **Radix**(dropdown-menu + context-menu) | **+29.4 KiB** | 2.1.24 / 2.3.7 | MIT | 稳定 |
| React Aria Components(仅下拉菜单对比) | +45.1 KiB | 1.19.0 | Apache-2.0 | 稳定 |
| Base UI | 未测 | 1.0.0-rc.0 | MIT | **仍为 RC** |

**视觉保真度(自动化样式/布局契约)**:

- **工具条本体:同一份 class 与 token 下样式/布局契约一致**。POC 用 Playwright 比对菜单面板的背景、边框、圆角、阴影、最小宽度及菜单项字体/内边距；这不是像素级截图结论;
- **菜单面板:初次接入会完全失去样式**。根因:两库均把菜单 **Portal 到 document.body**,而现有 CSS 写作 `.card-selection-toolbar .csa-gen-menu {...}` 的**后代选择器**,菜单一旦移出工具条即全部失配(实测 computed style:`position:static`、背景透明、无边框无阴影、菜单项回落浏览器默认按钮样式)。
- **补救成本明确**:去嵌套 **3 处规则**(菜单面板、菜单项按钮、按钮基础重置扩展到菜单项)后**恢复与基准几乎无差别**。即代价是 CSS 选择器改写,不是重做界面。

**行为收益**:两库均自动施加正确 ARIA(`aria-haspopup`、`aria-expanded`、`data-state`、受管 id),这部分现为手写且易错。Radix 的实测构建同时引入 `dropdown-menu` 与 `context-menu`：基准 60,603 B、Radix 90,679 B，增量 **30,076 B = 29.4 KiB gzip**。React Aria 的下拉菜单对比增量为 46,150 B = 45.1 KiB gzip。

**可信交互验证(已完成)**:隔离 POC 的 `npm --prefix experiments/menu-primitives run verify` 使用 Playwright 的真实点击与键盘事件，已验证 Radix / React Aria 的下拉菜单开合、方向键、Escape；Radix 还验证了右键菜单和 Escape 后焦点返回触发按钮。此前失败的是页面内手工派发的合成事件，不能推出“浏览器自动化做不到”。

**生产接入注意**:现有工具条对所有 `mousedown` 调用了 `preventDefault()`，会干扰菜单库的默认焦点恢复。Radix 包装层必须保留其 `onCloseAutoFocus` 适配，显式把焦点还给触发按钮；同时单独验证不丢失阅读文本选区。

### 2.3.2 CA-P1 生产接入记录（2026-07-27）

已在真实 `CardModal` 接入 **Radix Dropdown Menu 2.1.24** 与 **Context Menu 2.3.7**。现有的选区工具条外观、三个生成卡片动作及其请求契约均保持不变；Radix 只接管菜单、焦点、键盘和 ARIA 行为。

- **右键边界已实现**：阅读区只有在存在有效选区时才打开应用菜单；无选区右键不拦截，仍交给浏览器原生菜单；
- **键盘与焦点已实现**：工具条“生成卡片”可用 Enter 打开，方向键进入菜单，Escape 关闭菜单并返回该触发按钮；右键菜单关闭后焦点返回阅读区；
- **Portal 样式已修复**：菜单脱离工具条 DOM 后，原有 3 条后代选择器不再命中；生产 CSS 已改为显式菜单 class，继续使用既有 token，未改变阅读区字体或全局样式；
- **Modal Escape 冲突已修复**：菜单在 Portal 中接收 Escape 时，卡片弹窗不会被提前关闭；
- **三消费者验证**：Cards Factory E2E 15/15、Textbook Courses E2E 5/5、Learning Assistance E2E 5/5 均通过。

**本阶段未做的事**：键盘选择正文后自动弹出工具条、多色标记/取消标记、KG 查词、复制、注解持久化和存量迁移都不属于 CA-P1，仍按本文后续门禁推进。

### 2.4 学习产品交互范式——**吸收模式,不引代码**

LingQ「点词 → 词状态 + 查词」几乎是本项目 KG 知识点的现成范式;Readwise/Kindle「多色标记 + 批注汇总成复习流」可作注解层形态参考。

## 3. 关键发现:`card_highlights` 是跨域共享契约,不是局部存储

这是本文最重要的修正。现行「mark 烤进 HTML、按可变路径作键」不仅有质量硬伤,而且**这张表被多个领域直接依赖**,迁移影响面远超单页。

现行三个硬伤依旧成立:①内容一变哈希即变 → 历史标红失联;②高亮文本不能结构化查询/索引;③无稳定锚点 → 笔记无处可挂。

但**新增的承重约束是**:`learningService.js:1870` 的教材复习答案面**主动解析存储的 highlight HTML**(`expressionFragmentsFromHighlight`)来还原表达的 EN/JA/ZH。也就是说——**存储的 HTML 不是纯展示,是被学习系统当数据解析的**。任何改动 HTML 存储形态的迁移,必须先满足这条消费。

### 3.1 消费者迁移矩阵(P1-1)

| 领域 | 消费点 | 用途 | 迁移影响 |
|---|---|---|---|
| Cards Factory | `CardModal.tsx`、`highlight.ts`、`factory-api.ts`、`routes/files.js` | 普通卡读写标红 | 主改造面 |
| Textbook Courses | `textbookHighlightService.js`(`get/upsert/deleteCardHighlightByFile`)、`TextbookCoursesPage.tsx`、`TextbookPublishedBrowser.tsx`、`textbook-api.ts`、`textbook-highlight.ts`、`routes/textbooks.js` | 整轨标红存**同一张表** | 必须同步迁移,否则教材标红断裂 |
| Review Session | `learningService.js:1870`(教材答案面**解析 HTML** 还原 EN/JA/ZH)、`:1947`(普通卡返回 highlightReference) | 复习内容恢复 | **最硬依赖**:迁移不能破坏答案面 |
| 删除卡片 | `services/application/deleteCard.js` | 删卡联动标红 | FK 级联 + 路径键双重清理需保序 |
| 改期脚本 | `scripts/migrations/reassignFolderDate.js:166`(`UPDATE ... folder_name`) | 迁移文件夹 | 证明路径可变;新身份用 `generation_id` 后此更新不再影响锚定 |
| 统计/审计 | `auditLearningData.js`、`buildLearningEligibilityReport.js` | 跨卡标红计数 | 查询口径需随新表更新 |
| 存储基础 | `databaseService.js`、`db/highlights.js`、`db/testReset.js`、`routes/_shared.js` | 表访问/复位 | 兼容适配器落点 |

**切换顺序(必须定义,不得一次性硬切)**:

1. 新增注解表 + **兼容适配器**(把旧 `card_highlights` 行按需投影成新模型读出);
2. **双读期**:新表为写入真源,旧表保留;所有消费者经适配器读,答案面解析优先走新模型、回退旧 HTML;
3. **逐消费者切换**:Cards Factory → Textbook → Review answer face → 删除/改期/统计;
4. 全部切换且验证后再退役旧表;**保留回滚**:退役前任一步可切回旧表读路径。

## 4. 采用表（沿用 DS-W1 三档口径）

| 候选 | 决策 | 落点 |
|---|---|---|
| TipTap / Lexical / BlockNote 等编辑器 | **不采用** | 与不可变 Markdown 契约冲突,且非本次需求 |
| 无头菜单原语 → **建议 Radix** | **包装使用** | 替换手写选区工具条的菜单/浮层/键盘/焦点;保留现有 pill 视觉与 tokens。已验证下拉 + 右键菜单、MIT、稳定版、生态最大;接入需去嵌套 3 处 CSS 规则及显式焦点返回适配(§2.3.1)，完整双菜单增量 **+29.4 KiB gzip**。React Aria(+45.1 KiB)仅完成下拉菜单对比;Base UI 仍 RC,暂不选 |
| Recogito text-annotator（包） | **v1 不采用** | POC 证明原生 selector 不符合 ruby-aware 投影，overlay 还可能进入旧 HTML；引包不能减少核心复杂度 |
| **W3C Web Annotation 数据模型** | **直接吸收原则** | selector 锚定,取代「mark 烤进 HTML」 |
| LingQ / Readwise 交互范式 | **吸收模式** | 查词入口、多色标记 + 批注汇总 |

**禁止映射**:覆盖 `tokens.css`、改动阅读区字体、引入全局 body reset;依赖第三方私有 class/DOM;移动端专属交互。

## 5. 已确认决策

1. **注解持久化统一改为 selector 锚定,并迁移存量标红**(不采用新旧两套并存)。迁移**尽力而为 + 兜底**,无法重锚的条目按 §7 定义降级保留,不丢数据。**前置条件**:必须先完成 §3.1 消费者矩阵与双读/切换/回滚设计,尤其保住教材复习答案面。
2. **引入 Radix 无头菜单原语作为生产依赖**,仅取行为(键盘、焦点、ARIA、浮层),**页面外观不变**。POC 及 CA-P1 已确认 Radix 在现有 pill 视觉下的覆盖量最小，完整双菜单增量为 +29.4 KiB gzip；Base UI 目前仍是 RC，不采用。

## 6. 注解数据模型（已进入 Accepted ADR）

### 6.1 身份:不用可变路径(P1-2)

新表定位键改为:

```text
target_kind   : generation | textbook_track | textbook_expression
target_id     : 对应实体主键(普通卡 = generation_id)
target_revision / target_hash : 教材需锚到 Track 修订或表达修订;普通卡可用 content_hash 做陈旧检测
legacy_locator: 仅对无数据库记录的历史文件,用 folder/base 作 fallback
```

- 普通卡以 **`generation_id`** 为身份(表已有该 FK,[schema.sql:342](../../database/schema.sql));
- 教材必须明确身份层级(Track / 表达修订 / generation),不能与普通卡混用一个键;
- `folder_name/base_filename` **降级为展示信息与历史 fallback,不再是身份**——改期脚本 `UPDATE folder_name` 后锚定不受影响。

### 6.2 规范化「可见基文投影」契约(P1-3)

`TextPositionSelector` 的字符偏移必须对应一份**稳定、完整的整卡线性文本**。生产侧已把 `selection.ts` 与审计脚本收敛到共享 `text-projection.mjs`；CA-P2 隔离 POC 已实现并验证 DOM Range 与整卡 offset 的双向映射。Accepted ADR 将该合同命名为 `card-visible-text-v1`，并固定：

- `projection_version`:投影算法版本;
- **排除规则**:`rt`/`rp` 读音、`.audio-btn`、外来语 `loanword-*` 标签一律不计入可见基文;
- **空白与 Unicode 规范化**:折叠连续空白 + 固定 **NFKC** 口径，且已由共享 `text-projection.mjs` 同时供 `selection.ts` 与审计脚本使用;
- **DOM Range ↔ canonical offset 双向映射**：能从 Range 得偏移，也能从偏移复原 Range；POC 已覆盖 ruby 与跨 DOM 节点；
- **重锚顺序**:renderer 版本升级后,先按 `TextQuoteSelector`(quote+prefix/suffix),失败再按 `TextPositionSelector`,再失败降级 orphaned。

CA-P3 已把同一合同下沉为生产 `annotation-anchor.mjs`，并用 POC 与根目录单测共同验证；`TextPositionSelector` 的 UTF-16 数字因此可稳定重放，而非另复制一套算法。

### 6.3 字段与硬边界

- `anchor_json`:主用 `TextQuoteSelector`(`exact`+`prefix`/`suffix`),备用 `TextPositionSelector`(基于 §6.2 投影);
- `kind`:`highlight | note`;`color`:多色;`note_text`:批注(可空);
- `source_hash` / `content_hash`:**仅作陈旧检测,不再参与身份**;
- `status`:`active | orphaned`(重锚失败降级,不删除);
- 时间戳。

**硬边界**:注解层是**非破坏性附加层**,**不参与 `content_hash`**,不写 `study_items`、不写 `learning_review_events`、不影响 FSRS——与 KG「不拥有调度状态」同一纪律;锚定基于**可见基文**(ruby 读音不计入);schema 变更须同时更新 `database/schema.sql` 与顺延 migration(同一提交)。

## 7. 存量迁移:单位是「推断连续标红区间」,不是 mark 元素,更不是行(P1-4)

**复审只读审计(生产 volume,10 条 `card_highlights`)**:

- 共 **51 个独立 `<mark>`**,单条记录最多 **17** 个 mark;
- 仅 **2/10** 是 renderer v2;
- 现有 `source_hash` 与 generation `content_hash` **0/10 相同**。这两个字段使用不同算法/口径(前端短 FNV 与后端 SHA-256)，所以该比较只能说明**它们不可直接比较**，不能证明路径三元组的身份语义；现行路径三元组身份来自 schema 唯一键与读写代码。

### 7.1 POC 实测结论(2026-07-27,只读 dry-run)

对生产库副本执行只读重锚 dry-run，且改为走**生产一致的渲染链路**（`normalizeLoanwordAnnotations → marked → audio button → DOMPurify → visibleTextProjection`）。结论：统计单位既不是行，也不是 `<mark>` 元素，而是**推断出的连续标红区间**。

**碎片化是本次最重要的发现**:日语汉字的 `<ruby>` 注音会把**一次连续划选切成多个 `<mark>`**。真实样本:

```text
<ruby><mark>吹</mark><rt>ふ</rt></ruby><mark>き</mark><ruby><mark>出</mark><rt>だ</rt></ruby>…
```

该行 12 个 `<mark>` 实为**一条**注解「吹き出し口から多くの水が漏れます。」。全库合并后:

| 指标 | 数值 |
|---|---|
| 原始 `<mark>` 元素 | 51 |
| **推断连续标红区间** | **26**(碎片压缩 ≈2.0x) |
| **可重锚** | **25 / 26 = 96.2%** |
| 其中 quote 唯一命中 | 19(73.1%),高置信 |
| 其中需 prefix/suffix 消歧 | 6(23.1%) |
| 需降级 orphaned | 1(3.8%) |

**合并是正确性前提,不是优化项**。未合并时 quote 中位长度仅 3 字、出现 28 个 ≤3 字的单字碎片(「が」「終」「話」),定位不可靠;合并后中位长度 8 字、≤3 字者仅 2 个。

**边界说明**：旧 HTML 没有“用户第几次划选”的动作 ID，所以相邻 `<mark>` 只能按可见基文连续性**推断**为同一条区间；它不能区分“因 ruby 被切碎的一次划选”和“用户恰好连续做了两次相邻划选”。因此 26 不是经过人工逐条确认的历史注解数。迁移实施前须输出不含正文的 JSON 审计摘要并进行人工抽检；脚本支持 `--json`，不把生产原文或 SQLite 副本提交进 Git。

**唯一失败案例已归因**:行#20 的「もう少しで終わる」在当前卡片内容中**整句不存在**(连子串「もう少し」「終わる」均无),属**真实内容漂移**,降级 orphaned 是正确行为,非算法缺陷。

**实现注意(实测踩到)**:合并算法在空白归一时必须**保留空格自身的 marked 标记**,否则 `a short burst of` 这类含空格短语会被空格切断成多条注解(初版即因此把 1 条误算为 4 条)。

### 7.2 迁移必须定义

- **碎片合并**:先在可见基文投影上按「连续 marked 区间」还原推断区间,再锚定;
- **重复 quote 消歧**:同文本多处,用 `TextPositionSelector` 偏移 + 出现序号区分;
- **稳定 annotation ID**:迁移可重放幂等;
- **失败 payload**:重锚失败时保留原始 quote + legacy HTML 片段 + 审计记录;
- **orphaned 展示**:「保留原样」= 保留 quote 与 legacy HTML 只读展示 + 审计记录,**不静默丢弃**,也不伪装成 active。

稳定 ID、迁移事件、双读阶段和回滚开关已由 Accepted ADR 定义。CA-P3 已完成
正式 schema、repository、service 和只读 migration plan；页面切换与真实 apply
仍按 CA-P4–P8 门禁推进。

## 8. POC 计划与门禁

按 DS-W1 隔离纪律:POC 期间**不修改根 `package.json`**,产物可整体删除。必须用数据回答:

- [x] **迁移率**:已完成(§7.1)。真实数据 51 个 `<mark>` → **26 个推断连续标红区间**,**可重锚 96.2%**,1 条因内容漂移降级。统计不等同于人工确认的历史划选数;
- [x] **三消费者同验**:普通卡、教材 Track、**复习只读答案面**均不破；CA-P1 实跑 Cards Factory 15/15、Textbook Courses 5/5、Learning Assistance 5/5;
- [x] **锚定鲁棒性**：重复 quote、ruby、跨 DOM 节点、内容修订、文件移动/改期、UTF-16 补充字符及真实内容漂移 orphaned 均通过，合同测试 11/11；
- [x] **交互补齐**：CA-I1 已完成键盘选区触发工具条、四色标记、历史标记改色、
      取消标记、复制和显式确认后的 KG 查询；CA-P1 的右键边界、菜单方向键、
      Escape 与焦点返回继续保持；
- [x] **切换安全设计**：Accepted ADR 已定义并执行旧表保留、shadow read、逐消费者切换和 compatibility write；CA-P8 已停止旧读写。当前开关只负责临时禁用注解，不再回退旧 HTML；
- [x] **依赖体积 + 视觉保真**:完整双菜单的 Radix **+29.4 KiB gzip**，React Aria 下拉菜单 +45.1 KiB；
      菜单面板因 Portal 需去嵌套 3 处 CSS 规则后恢复样式/布局契约;
- [x] **Recogito 取舍**：v1 不引生产包，只吸收 W3C selector 模型并自研 ruby-aware 锚定与渲染。

## 9. 门禁与后续

- [x] CA-P2 POC 技术项已形成可复现实验与 Accepted ADR；交互功能项仍按后续阶段实施
- [x] 注解数据模型 + 消费者迁移矩阵经 ADR 接受(含双读/切换/回滚、orphaned 语义)
- [x] CA-P3 已完成 migration 007、表 53–54、AnnotationService、默认关闭的 feature flag 和只读迁移计划；未切换页面、未 apply 生产数据
- [x] CA-P4 已完成 Git 外双备份、hash-gated apply、25 active + 1 orphaned、幂等复跑、三消费者 shadow read 与真实 volume 验收；页面仍读旧表
- [x] 无头库已选 Radix 并在 CA-P1 生产接入；版本、license、按需 import 与体积已记录
- [x] A 层交互已在 CA-I1 完成：右键边界、四色标记、取消标记、复制、
      显式确认的 KG 查询与键盘选区/工具条导航均已实施
- [x] B① 注解层消费者切换 + 存量标红按逻辑区间迁移 + 教材/复习答案面回归；
      CA-P5–P7 已依次切换 Cards Factory、教材课程与 Review，CA-P8 已删除旧读、
      旧写、shadow 和兼容 API，并将删除、改期、统计切到规范注解；
- [x] 桌面 E2E 覆盖，1280/1440 无溢出，`readOnly` 模式禁删除、禁标红

**待定项**:

- **朗读选区**当前无「任意文本 TTS」接口,需新增后端表面;本期是否纳入未定。
- **右键接管边界**已按「有选区才接管，无选区放行原生菜单」在 CA-P1 落地；全面接管不在当前范围。

### 9.1 CA-P8 收口说明

`card_highlights` 没有在本阶段 DROP。它继续承载离线迁移可重放与历史审计证据，
但不再是回滚副本，也不再有生产 repository、HTTP API 或 UI 消费者。最终保留
期限和删除动作必须另开数据保留 ADR。

CA-P8 终验已覆盖 unit 368/368、integration 62/62、desktop E2E 47/47、
smoke 7/7、生产构建、架构门禁、真实 Compose 重建和真实 volume 只读检查。

### 9.2 CA-I1 交互补齐说明

CA-I1 只扩展选区与已存在标记的操作面，不修改卡片 Markdown、教材官方原文、
Study Item、FSRS 或注解 schema：

- 新选区可以选择红、黄、绿、蓝四种颜色；点击已有标记可以改色或取消标记，
  分别复用规范注解 API 的 PATCH 与软删除语义；
- 复制直接使用浏览器剪贴板，不创建服务端记录；
- 知识点查询在提交前必须确认 English / 日本語与单词 / 短语 / 语法类型。
  纯汉字选区不自动猜语言；确认后才调用 append-only KG lookup，KG 信号不得
  直接修改 FSRS；
- 鼠标、键盘和右键三种入口共用同一选区合同。键盘扩展选区后工具条自动出现并
  聚焦首个动作；工具条会在桌面视口内同时做横向和纵向收口；
- `readOnly` 卡片仍不能新增、改色或删除标记；移动端和任意文本 TTS 均未纳入
  本阶段。

验收包括 lint、typecheck、architecture、unit 372/372、integration 62/62、
desktop E2E 49/49 与 smoke 7/7。真实 Compose 页面在 1440×900 桌面视口完成
只读视觉检查：新选区工具条、知识点确认面板和历史标记编辑状态均无横向溢出、
无控制台错误；检查没有写入真实注解或 KG lookup。完整记录见
[CA-I1 交互补齐验收报告](../TestReports/Card_Annotation_CA_I1_Acceptance_20260727.md)。
