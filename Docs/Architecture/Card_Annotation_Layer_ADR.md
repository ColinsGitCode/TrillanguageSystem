# 学习卡片注解层领域与数据 ADR（CA-D2）

> 状态：**Accepted · CA-P7 Review 消费者切换已完成**
>
> 日期：2026-07-27
>
> 产品与评估输入：[学习卡片选区交互与注解层 UX 评估](../Features/Card_Annotation_and_Selection_UX_Evaluation.md)
>
> 当前正式主线：Markdown 卡片内容不可变；注解是非破坏性附加层；Cards Factory、教材课程和学习复习是三个既有消费者。
>
> 本文角色：当前主线的专题 ADR，也是 CA-P3 及后续注解实现的技术权威。

## 0. 决策摘要

| 项目 | 决策 |
|---|---|
| 内容所有权 | Markdown / 教材修订仍拥有正文；注解层不修改正文 |
| 注解身份 | 稳定 `annotation_id`，不使用文件夹或文件名作身份 |
| 目标身份 | `target_kind + target_id`；路径只作 legacy 展示信息 |
| 内容修订 | `target_revision` 保存创建或最近重锚时的内容版本 |
| 选择器 | W3C `TextQuoteSelector` + `TextPositionSelector` 双选择器 |
| 投影版本 | `card-visible-text-v1`，排除 ruby 读音、音频按钮和外来语标签 |
| 重锚顺序 | quote+上下文 → 唯一 quote → 经 exact 校验的位置 → `orphaned` |
| 注解类型 | `highlight` / `note`；颜色使用有界枚举，不接受任意 CSS |
| Recogito | **不引入生产 v1**；吸收 W3C 模型，使用自有投影和渲染 |
| 新表 | 表 53 `card_annotations`；表 54 `card_annotation_migration_events` |
| migration | `007_card_annotations.sql`，同时进入 `database/schema.sql` |
| 旧表 | `card_highlights` 在双读和回滚窗口内保留，不立即 DROP |
| 上线方式 | 默认关闭，按 Cards Factory → 教材 → Review 顺序切换 |
| 学习边界 | 不写 FSRS、Study Item、Review Event、Schedule State 或队列 |

## 1. 当前事实与问题

当前 `card_highlights` 保存整份带 `<mark>` 的渲染 HTML，身份键是：

```text
folder_name + base_filename + source_hash
```

这同时承担了展示、存储和部分数据恢复职责：

- Cards Factory 从该 HTML 恢复标红；
- 教材课程复用同一张表保存 Track 标红；
- Review answer face 解析教材 highlight HTML 还原 EN/JA/ZH 表达；
- 删除、改期、统计和数据审计都直接依赖该表。

因此不能用“一次换表”替代。新模型必须先提供兼容读写，再逐消费者迁移。

## 2. CA-P2 POC 证据

### 2.1 双向锚定合同

隔离 POC 位于 `experiments/card-annotation-poc/`，使用与生产一致的可见文本投影。11 个合同测试已通过：

1. 重复 quote 使用 prefix/suffix 唯一定位；
2. ruby 只把汉字和送假名计入 selector，`rt/rp` 不计入；
3. 跨 `<strong>` 等 DOM 节点的选区可往返；
4. 前方增加无关内容后，quote 能跨 revision 重锚；
5. 文件夹、文件名和日期改变不影响实体锚点；
6. 目标文本真实改变时进入 `orphaned`，不附着到附近文本；
7. 历史 annotation ID 可确定性重放；
8. 不同逻辑区间不会复用同一历史 ID；
9. Recogito 原生 selector 会把 ruby 读音计入 quote；
10. 通过 `.not-annotatable` 包装后可拆出正确的 ruby 多 Range。
11. `TextPositionSelector` 对 emoji 等补充字符使用 DOM/JavaScript UTF-16 偏移。

### 2.2 真实历史数据

对在线 SQLite 的一致性备份执行只读 dry-run，正文不输出、备份不进 Git：

| 指标 | 结果 |
|---|---:|
| `card_highlights` 行 | 10 |
| 原始 `<mark>` | 51 |
| 推断连续注解区间 | 26 |
| 可重锚 | 25 / 26（96.2%） |
| 唯一 quote | 19 |
| 上下文消歧 | 6 |
| 内容漂移 / orphaned | 1 |

本轮为 26 个区间生成了确定性 ID，identity digest 为
`38c60ac906f6e9036359021453e1a39b94c65ce627096d69ac6f68614d3c4084`。
该 digest 只证明同一快照可重复生成同一身份集合，不包含卡片正文。

### 2.3 Recogito 取舍

验证版本：`@recogito/text-annotator@4.2.5`，BSD-3-Clause。

- 核心包独立构建为 82,772 B，gzip 24,520 B；
- React 18/19 均在其官方 peer dependency 范围内；
- DOMPurify 后的 ruby 和音频按钮结构可保留；
- 但原生 selector 会把 `<rt>` 注音计入 quote；
- 把 `rt/rp`、音频按钮设为 `not-annotatable` 后，会得到多个 selector，并可能产生需要过滤的空 selector；
- 渲染器会在正文根节点内部追加 `.r6o-span-highlight-layer`。

当前 Cards Factory 会保存阅读根节点的 `innerHTML`。若直接接入 Recogito，该临时渲染层可能进入旧 `card_highlights`。同时，本项目仍必须维护自己的 canonical projection 和 selector 包装。引入包不能减少核心复杂度，反而增加 24.52 KiB gzip 和一套 DOM 生命周期。

因此 v1 **不引入 Recogito 生产包**。采用其所遵循的 W3C selector 思路，自行维护锚点和有界渲染；若未来彻底停止 HTML compatibility write，可另开 POC 重评其只读 overlay。

## 3. 可见文本投影合同

### 3.1 版本

```text
projection_version = card-visible-text-v1
```

注解创建、重锚、迁移和渲染必须使用同一版本。未知版本不得猜测，应返回
`projection-version-mismatch` 并进入人工处理。

### 3.2 投影规则

- Unicode 固定使用 NFKC；
- 连续空白折叠为一个空格；
- CJK 字符之间及 CJK 与中文/日文标点之间的布局空格不计入；
- `rt`、`rp`、`audio`、`button`、`source`、`script`、`style` 不计入；
- `.audio-btn`、`.card-selection-toolbar` 和 `loanword-*` 标签不计入；
- ruby 汉字主体和送假名计入；
- block boundary 只贡献规范化空格，不以 CSS selector 作锚点。
- `position_start` / `position_end` 使用 DOM/JavaScript 的 UTF-16 code unit，
  不是 Unicode code point 数量。

### 3.3 持久化选择器

每条注解保存：

```json
{
  "projectionVersion": "card-visible-text-v1",
  "textQuote": {
    "type": "TextQuoteSelector",
    "exact": "食べる",
    "prefix": "朝ご飯を",
    "suffix": "前に"
  },
  "textPosition": {
    "type": "TextPositionSelector",
    "start": 42,
    "end": 45
  }
}
```

数据库采用列存储，而不是把整个 selector 只塞入不可校验 JSON：

- `projection_version`
- `quote_exact`
- `quote_prefix`
- `quote_suffix`
- `position_start`
- `position_end`

API 可以映射为上面的 W3C 形态。

### 3.4 重锚算法

1. projection version 必须受支持；
2. exact+prefix+suffix 唯一命中 → `quote-context`；
3. exact 在全文唯一命中 → `quote-unique`；
4. 多处 exact 且原 position 当前仍对应相同 exact → `position-confirmed`；
5. 其它情况 → `orphaned`。

`TextPositionSelector` 不能在文字不同的情况下“就近兜底”，否则会把旧批注错误贴到新内容。

## 4. 目标身份

| `target_kind` | `target_id` | `target_revision` |
|---|---|---|
| `generation` | `generations.id` | `content_hash` |
| `textbook_track` | `textbook_tracks.id` | 当前 `textbook_track_revisions.id` |
| `textbook_expression` | `textbook_expressions.id` | 当前 EN/JA unit hash 的稳定组合 SHA-256 |

`target_kind + target_id` 是逻辑身份；`target_revision` 是内容陈旧检测，不参与主身份。

新表不对多态目标建立伪外键。服务层必须在写入时验证目标存在和 revision；目标删除时把注解转为 `orphaned`，保留历史，不级联删除。路径只保存在 `legacy_payload_json`，不能再参与主查询。

## 5. 数据模型

### 5.1 表 53：`card_annotations`

建议字段：

```text
id TEXT PRIMARY KEY
target_kind TEXT NOT NULL
target_id INTEGER NOT NULL
target_revision TEXT NOT NULL
projection_version TEXT NOT NULL
quote_exact TEXT NOT NULL
quote_prefix TEXT NOT NULL DEFAULT ''
quote_suffix TEXT NOT NULL DEFAULT ''
position_start INTEGER NOT NULL
position_end INTEGER NOT NULL
annotation_kind TEXT NOT NULL
color TEXT
note_text TEXT
status TEXT NOT NULL
source_content_hash TEXT
legacy_highlight_id INTEGER
legacy_payload_json TEXT
version INTEGER NOT NULL DEFAULT 1
created_at_utc TEXT NOT NULL
updated_at_utc TEXT NOT NULL
```

约束：

- `annotation_kind IN ('highlight', 'note')`；
- `status IN ('active', 'orphaned', 'deleted')`；
- `color IN ('red', 'yellow', 'green', 'blue')` 或 NULL；
- `position_start >= 0 AND position_end > position_start`；
- `length(quote_exact) BETWEEN 1 AND 1000`；
- `length(note_text) <= 4000`；
- 同一 target、投影版本、position、kind 只能有一条 active 注解；
- UI 新建 ID 使用 `crypto.randomUUID()`；历史迁移使用
  `ca_legacy_<sha256-prefix>` 确定性 ID。

### 5.2 表 54：`card_annotation_migration_events`

迁移事实只追加，不承担在线显示：

```text
id INTEGER PRIMARY KEY AUTOINCREMENT
migration_plan_hash TEXT NOT NULL
legacy_highlight_id INTEGER NOT NULL
legacy_run_ordinal INTEGER NOT NULL
annotation_id TEXT
outcome TEXT NOT NULL
reason_code TEXT
source_fingerprint TEXT NOT NULL
created_at_utc TEXT NOT NULL
```

`outcome IN ('migrated', 'orphaned', 'skipped', 'failed')`，唯一键为
`migration_plan_hash + legacy_highlight_id + legacy_run_ordinal`。

### 5.3 schema 真源

接受本文后，CA-P3 必须在同一个提交中完成：

- `database/migrations/007_card_annotations.sql`；
- `database/schema.sql` 表 53–54；
- `migrationRunner` postcondition；
- 新库 / 存量库 schema parity 测试。

CA-P2 不创建表，也不写生产数据库。

## 6. 服务与 API

CA-P3 已新增 `AnnotationService`，所有消费者只能经过该服务，不得直接 SQL。
HTTP route 按 CA-P4/CA-P5 的 shadow read 和消费者切换需要再挂载；CA-P3
不提前暴露尚未接入 UI 的写接口。

### 6.1 查询

```http
GET /api/annotations?targetKind=generation&targetId=42
```

返回 active/orphaned 注解、当前 target revision、重锚结果和公开原因。默认不返回
`legacy_payload_json`。

### 6.2 创建

```http
POST /api/annotations
```

请求包含 target、expected target revision、selector、kind、color/note 和客户端生成的
annotation ID。服务端重新加载当前内容、重算 selector 并校验 exact，不信任客户端偏移。

### 6.3 更新与删除

```http
PATCH /api/annotations/:id
DELETE /api/annotations/:id
```

必须带 `expectedVersion`。删除转 `status=deleted`，不物理删除；取消标记和删除批注使用同一领域动作。

### 6.4 错误码

- `ANNOTATION_TARGET_NOT_FOUND`
- `ANNOTATION_TARGET_REVISION_CONFLICT`
- `ANNOTATION_SELECTOR_INVALID`
- `ANNOTATION_PROJECTION_UNSUPPORTED`
- `ANNOTATION_VERSION_CONFLICT`
- `ANNOTATION_NOT_FOUND`

## 7. 渲染边界

- 注解查询结果经 selector 恢复为 DOM Range；
- 同一逻辑注解可渲染为多个 `<mark data-annotation-id>` 片段，以适配 ruby；
- 多个片段共享同一 annotation ID，不被统计为多条注解；
- class 只由 `kind + color` 枚举映射，禁止存任意 class/style；
- `note_text` 只按纯文本显示；
- `readOnly=true` 可展示注解，但不得创建、更新或删除；
- 注解渲染节点不得被写回 Markdown 或参与 `content_hash`。

v1 继续使用本项目自己的 Range 包装渲染，不引 Recogito overlay。

## 8. 双读、切换与回滚

### 8.1 开关

```env
CARD_ANNOTATIONS_ENABLED=0
CARD_ANNOTATIONS_COMPAT_WRITE_ENABLED=1
```

代码、Compose 和示例环境默认关闭新注解读路径。兼容写在迁移期间保持开启。

### 8.2 阶段

1. **CA-P3 schema/storage**：只加表、repository、service、只读迁移 plan；运行行为不变；
2. **CA-P4 shadow read**：旧表继续为 UI 真源；后台比较新旧投影，不影响页面；
3. **CA-P5 Cards Factory**：新表为写入真源，同时生成旧 HTML compatibility projection；
4. **CA-P6 Textbook**：教材改读新注解，旧 Track HTML 继续同步；
5. **CA-P7 Review**：答案面直接读取规范内容+注解，不再解析旧 HTML 获取表达；
6. **CA-P8 cleanup**：删除/改期/统计切换；完成观察期后停止旧表 compatibility write；
7. 另开 ADR 决定是否 DROP `card_highlights`，不得在本系列中顺手删除。

### 8.3 回滚

任何阶段发现问题：

1. 设 `CARD_ANNOTATIONS_ENABLED=0`；
2. 保持 `CARD_ANNOTATIONS_COMPAT_WRITE_ENABLED=1`；
3. 重建 viewer；
4. 页面继续从已同步的 `card_highlights` 读取；
5. 不 DROP 新表、不删除 migration event、不把 orphaned 伪装成 active。

## 9. 历史迁移

1. 备份 Docker volume 和 SQLite；
2. 对一致性副本生成不含正文的 dry-run summary；
3. 以 visible projection 合并 ruby 碎片；
4. 为每个逻辑区间生成确定性 annotation ID；
5. quote+context 可重锚者写 active；
6. 内容漂移者写 orphaned，并保留 quote、旧 HTML 片段和原因；
7. 每个区间追加 migration event；
8. apply 前重新生成 plan，要求 expected plan hash 一致；
9. apply 后再次 dry-run，要求新增/重复/遗漏均为 0。

2026-07-27 对运行中 SQLite 的一致性备份执行 CA-P3 正式只读计划，结果仍为
25 条可 active 迁移、1 条 orphaned，plan hash 为
`359f4469ec5203c6cacf0616a9b5d1e88e3f1566e731a3dd0a6c711f530ed55b`。
该数字与 hash 只适用于本次快照；正式 apply 必须重新备份并重新计算。

## 10. 安全与领域边界

- selector 和 note 均有长度上限；
- 不接受任意 HTML、class、style 或脚本；
- 不把绝对路径返回前端；
- migration report 不包含教材或卡片正文；
- 注解不能触发 LLM、TTS、KG 写入或学习调度；
- KG 查词是显式用户动作，由 KG API 自己记录 lookup event；注解只保存用户标记；
- 朗读选区仍是独立 TTS 能力，不混进本 ADR；
- 当前只验收桌面端，不新增移动端交互。

## 11. 验收门禁

- [x] 五类锚定场景 + orphaned 防误附着通过；
- [x] 历史 ID 确定性通过；
- [x] Recogito ruby/DOMPurify 浏览器 POC 与体积实测完成；
- [x] 真实 SQLite 只读审计保持 25/26 可重锚；
- [x] 用户确认本文的身份、selector、Recogito 和双读决策；
- [x] migration 007 与 schema parity；
- [x] AnnotationService 的目标版本、并发冲突、长度边界和 append-only 测试；
- [x] 三消费者 shadow read 差异为 0；
- [x] 真实迁移备份、plan hash、apply 和 orphaned 人工确认；
- [x] 1280/1440 桌面 E2E、readOnly 和回滚验收。

## 12. 非目标

- 不编辑卡片 Markdown 或教材官方原文；
- 不在 CA-P2 修改数据库；
- 不把 annotation 当作 Study Item；
- 不根据标红自动改变 FSRS；
- 不用 LLM 猜测 orphaned 应附着的位置；
- 不在本阶段加入多色 UI、批注编辑器或移动端页面。

## 13. CA-P3 实施记录（2026-07-27）

本阶段只建设底层能力，运行时页面仍以 `card_highlights` 为唯一真源：

- 新增 migration 007，并在 `database/schema.sql` 同步表 53–54；
- migration runner 对新库和存量库执行 schema parity 与 postcondition；
- 新增 repository、`AnnotationService`、乐观版本冲突、软删除和 append-only
  migration event；
- 将 ruby-aware 锚点合同下沉到生产模块，位置统一使用 UTF-16；
- 新增 `CARD_ANNOTATIONS_ENABLED=0` 和
  `CARD_ANNOTATIONS_COMPAT_WRITE_ENABLED=1`，代码、Compose、示例环境默认保持
  新读路径关闭、旧写路径开启；
- 新增 `npm run cards:annotations:migration-plan`。脚本只读 SQLite，默认只输出
  数量、plan hash 和版本，不输出卡片正文；
- POC 11/11、全量 unit 359/359、integration 63/63、lint 与 typecheck
  通过；真实一致性备份 dry-run 为 25 migrated、1 orphaned、0 skipped。

**未发生的事**：未写入 `card_annotations` 生产数据，未追加生产 migration event，
未挂载新 annotation API，未切换 Cards Factory、教材或 Review，未重建容器。

## 14. CA-P4 实施记录（2026-07-27）

本阶段在不改变页面真源的前提下完成真实迁移和影子比较：

- 新增 `CARD_ANNOTATIONS_SHADOW_READ_ENABLED`，代码、Compose 与示例环境默认
  关闭；本次 viewer 运行实例设为 `1`。`CARD_ANNOTATIONS_ENABLED` 仍为 `0`，
  `CARD_ANNOTATIONS_COMPAT_WRITE_ENABLED` 仍为 `1`；
- 新增 hash-gated apply 脚本。写入前同时生成 SQLite 在线一致性备份和完整
  Docker volume 压缩包，存于 Git 外的
  `~/Library/Application Support/ThreeLANS/Backups/ca-p4-20260727-140450/`；
  SQLite `PRAGMA integrity_check` 返回 `ok`；
- apply 前重新生成计划，结果为 10 个旧 highlight row、51 个 `<mark>`、26 个
  推断连续区间、25 migrated、1 orphaned、0 skipped；plan hash 为
  `359f4469ec5203c6cacf0616a9b5d1e88e3f1566e731a3dd0a6c711f530ed55b`；
- 首次 apply 写入 26 条 annotation 与 26 条 append-only migration event；
  以相同 hash 重放返回 `idempotent: true`，未生成重复记录；
- 唯一 orphaned 项经人工复核：旧 quote 已不存在于 generation 503 的当前
  canonical Markdown，因此继续保留 orphaned，不猜测、不自动附着到相似文本；
- shadow read 在真实 volume 上观察 21 次：Cards Factory 10/10 matched、Review
  10/10 matched、Textbook 1 次因生产库没有教材标红而返回 noLegacy；
  mismatched 0、errors 0。诊断只记录数量、目标 ID 和原因码，不记录正文；
- `routes/files.js`、`textbookHighlightService.js` 和 `LearningService.getItem()`
  都在旧读取完成后异步触发比较；异常被隔离，HTTP 响应和 UI 仍只使用
  `card_highlights`；
- lint、typecheck、architecture、unit 362/362、integration 65/65、smoke 7/7
  通过；Cards Factory、Textbook、Learning 三套桌面 E2E 共 25/25 通过，
  覆盖 1280/1440、复习 CardModal `READ ONLY` 禁删除/禁标红和旧路径回滚。

**仍未发生的事**：Cards Factory、教材和 Review 均未切换为新表真源；未修改
卡片 Markdown 或教材官方原文；未 DROP `card_highlights`。下一阶段从 CA-P5
开始，只切换 Cards Factory，并继续生成旧 HTML compatibility projection。

## 15. CA-P5 实施记录（2026-07-27）

本阶段只将 Cards Factory 切换到新注释真源，Textbook 与 Review 继续读取旧
HTML：

- 新增 `/api/annotations` 的 Cards Factory CRUD。开关关闭时返回稳定 404；
  `textbook_track` / `textbook_expression` 仍返回阶段门禁错误，不提前切换；
- 浏览器在用户完成划选时立即保存 W3C selector，不依赖 React 重渲染后可能
  失效的 DOM Range；服务端再以当前规范 Markdown 重渲染并重锚，无法唯一定位
  时拒绝写入；
- 新表写入与 `card_highlights` compatibility projection 在同一个 SQLite 事务
  完成。旧 HTML 重建失败时，新注释同步回滚；软删除也会重建无该标记的旧
  HTML；
- Cards Factory 开启新路径后只读 `card_annotations`。新 API 不可用时自动退回
  旧 HTML，因此将 `CARD_ANNOTATIONS_ENABLED=0` 并重建 viewer 即可回滚；
- Textbook 仍使用教材旧标红接口；Review 的 `readOnly` CardModal 仍使用旧
  `card_highlights`，未出现第二套评分或编辑入口；
- ruby 跨节点渲染会拆成多个同 ID `<mark>`，但不包裹 `<rt>`；orphaned 项不
  渲染、不猜测；
- lint、typecheck、unit 369/369、integration 69/69 通过；Cards Factory +
  Learning 20/20、Textbook 5/5 桌面 E2E 通过。
- viewer 已以 `CARD_ANNOTATIONS_ENABLED=1`、shadow read `=1`、compat write
  `=1` 重建；四容器均运行、health online、smoke 7/7。真实 generation 503
  通过新 API 返回 1 active + 1 orphaned，页面只渲染 1 个带 annotation ID 的
  标红，`rt` 内标红为 0。

**未发生的事**：未切换教材与 Review 真源，未停止 compatibility write，未
DROP `card_highlights`，未修改卡片 Markdown 或教材官方原文，未新增移动端
工作。

## 16. CA-P6 实施记录（2026-07-27）

本阶段只将 Textbook Courses 切换到新注释真源；Review 继续读取旧 Track
HTML：

- `/api/annotations` 新增 `textbook_track` 消费者分发；
  `textbook_expression` 仍保持阶段门禁，不扩大本次身份粒度；
- 抽出浏览器和 Node 共用的教材 Track 规范 HTML 生成器。浏览器先在当前表达
  内生成局部 selector，再映射到完整 Track canonical projection，服务器以
  `current_revision_id` 重验并重锚，避免重复句子跨表达误附着；
- 教材注释写入、软删除与旧 `card_highlights` Track HTML 投影在同一个
  SQLite 事务内完成；旧投影失败时新注释整体回滚；
- `/textbooks` 正常情况下只读 `card_annotations` 并从规范教材内容重建显示；
  新 API 返回 404/阶段门禁时自动回退旧教材 highlight API，因此关闭
  `CARD_ANNOTATIONS_ENABLED` 并重建 viewer 即可回滚；
- compatibility projection 保留教材 Track 身份、官方 EN/JA/ZH 文本和 ruby，
  Review 现有 `expressionFragmentsFromHighlight()` 无需改动即可继续恢复答案
  面；
- 未修改教材 revision、官方原文、Manifest、Study Item、FSRS 或学习计划；
  正式范围仍仅为桌面端；
- lint、typecheck、unit 372/372、integration 69/69 通过；Textbook Courses
  桌面 E2E 6/6 通过，覆盖新注释保存、刷新恢复、派生卡、关闭开关后的旧接口
  回退和官方/单句音频互斥；全量桌面 E2E 46/46 与架构门禁通过。
- `three_lans_system` 全栈已重建；viewer 运行开关为 annotation `=1`、
  shadow read `=1`、compat write `=1`，四容器运行、health online、smoke
  7/7。真实教材 Track 1 的新注释 API 返回 200/空集合；桌面页面无控制台错误、
  无横向溢出，且未对真实教材执行写操作。

**下一阶段**：CA-P7 只切换 Review 答案面，让其从规范教材内容和注释直接构建
显示；在 CA-P7 完成前不得停止 Track HTML compatibility write。

## 17. CA-P7 实施记录（2026-07-27）

本阶段只切换 Review 消费者，Cards Factory、Textbook 与 Review 至此均以
`card_annotations` 为读取真源；旧 HTML compatibility write 继续保留到
CA-P8：

- 教材复习答案面不再查询或解析存储的 Track `card_highlights`。服务端使用
  当前教材 revision 的规范 EN/JA/ZH 内容，叠加当前 `textbook_track` 注释后，
  只提取目标 expression 的答案片段；
- 普通卡复习接口不再读取旧 highlight 元数据；只读“查看完整卡片”仍禁止删除
  和标红，但显示内容改读 `/api/annotations`；
- `CARD_ANNOTATIONS_ENABLED=0` 时保留原有旧 HTML 读取路径；新接口不可用时
  CardModal 也会自动回退，因此回滚不需要改数据库；
- API 新增 `annotationReference` 作为“含个人标红”的新来源标识；
  `highlightReference` 仅在旧开关路径返回。评分、FSRS、Study Item、Review
  Event、队列和会话所有权均未修改；
- 教材答案投影按 expression 统计注释，同一 Track 其它表达的标红不会误报到
  当前答案面；
- compatibility write 仍保持开启，本阶段不 DROP `card_highlights`，也不修改
  卡片 Markdown、教材官方原文或移动端范围。

测试特意将旧 Track HTML 中的标红清空，教材复习接口仍从新注释表恢复标红；
关闭新开关时旧读取也通过。lint、typecheck、architecture、unit 375/375、
integration 69/69、桌面 E2E 47/47 全部通过。CA-P8 才评估停止双写、删除旧读
代码与统计切换。`three_lans_system` viewer/ocr 已重建，四容器运行、health
online、smoke 7/7；真实教材 Study Item 的只读 API 返回
`highlightReference: null`，未对真实教材或学习记录执行写操作。
