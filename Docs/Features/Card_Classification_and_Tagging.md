# 卡片分类与标签系统（Card Tags）

> 状态：**专题设计（待评审）** · 2026-07-13
> 领域归属：**Cards Factory 卡片组织域**（文件夹/历史/浏览/查询的补强），同时为学习辅助 2.0 的 Heuristic Provider 提供**可选信号**
> 上位文档：[学习辅助 2.0 设计基线](Learning_Assistance_2_0_Design_Baseline.md) · [CLAUDE.md](../../CLAUDE.md)
> 影响面：`database/schema.sql`（新表 card_tags）· `services/storage/db/` 新模块 · `routes/` 新路由 · `app/features/factory`（筛选 UI）· `app/features/card-modal`（标签编辑）· 一次性回填脚本

## 0. 定位与权威边界

1. 本文属于**卡片组织域**：解决"636 张卡只有日期文件夹、无法按内容查询"的问题。它不是学习域 schema——不含复习状态、调度、评分，不预设学习计划的分组语义。
2. 对学习辅助 2.0：标签只是未来 `PlanningSignalProvider`（基线 §8）的**候选信号源之一**。计划引擎读标签，标签不拥有计划；provider 缺失或标签为空时，计划引擎必须照常工作（基线 §1 依赖方向）。
3. 与已退役分类法的关系：`fn:` / `topic:` 的**概念**源自旧两轴分类法（该概念被语料验证有效），但**实现全新**——一张简单标签表，无 clusters、无 knowledge jobs、无版本化聚类、无 LLM 管线。不复用旧表名、旧 API、旧代码（CLAUDE.md 退役边界；基线 §9.8）。

## 1. 语料勘察结论（2026-07-13，636 张）

| 发现 | 数据 | 设计含义 |
|---|---|---|
| 文件夹零语义 | 全部为 `YYYYMMDD` | 分类必须新建，不能依赖文件夹 |
| 输入语言混合 | 三语卡 445 中：zh 243 / ja 99 / en 92 / mixed 11 | `lang:` 维度必须有且可全自动 |
| 语法卡自带功能注释 | 188 张大多含"〜：表示疑问/提出建议/礼貌的请求"式注释 | `fn:` 可规则直提，无需 LLM |
| 测试垃圾卡混入 | ≥15 张（"限流验证A""压测""请注意今天的日期"等） | `src:test-artifact` 隔离，否则未来会进复习队列 |
| 三语卡主题聚类 | 软件工程/IT 最大簇；其余：保育园育儿(27+)、日本职场事务、AI/ML、中文网络语、金融、日常表达 | `topic:` 受控词表按此提炼 |

## 2. 标签体系

统一模型：**命名空间 + 值**。一张卡可有任意多个标签；受控命名空间的值来自固定词表，自由命名空间由用户任意创建。

| 命名空间 | 适用 | 词表 | 打标方式 |
|---|---|---|---|
| `topic:` 主题域 | 三语/场景卡为主 | `software-eng` 软件工程 · `ai-data` AI与数据 · `work-jp` 日本职场 · `childcare` 保育园育儿 · `finance-biz` 金融商务 · `net-slang` 网络流行语 · `daily` 日常表达 · `general` 通用（兜底） | 规则打底 + UI 批量确认 |
| `fn:` 交际功能 | 语法卡 | `question` 疑问确认 · `judgment` 判断推测 · `advice` 建议忠告 · `intent` 意愿目的 · `request` 请求许可 · `prohibit` 禁止义务 · `sequence` 顺序并列 · `compare` 比较程度 · `aspect` 时体变化 · `condition` 假设条件 · `cause` 因果 · `report` 转述引用 · `give-receive` 授受 · `colloquial` 接续口语 | 规则直提（短语注释） |
| `lang:` 输入语言 | 全部 | `zh` / `ja` / `en` / `mixed` | 纯自动（字符集判定） |
| `src:` 来源性质 | 全部 | `feishu-import` · `hoikuen-import` · `ocr` · `manual` · `test-artifact` | 自动推断 + 一次性人工清理 |
| `tag:` 自由标签 | 全部 | 用户任意值（如 `面试`、`N2`、`本周重点`） | 纯手动（用户自定义诉求落点） |

词表治理：受控词表在代码中作为常量（`services/` 下单一来源）；调整词表 = 改代码 + 迁移说明，不做运行时可编辑词表（单用户场景不值得）。

## 3. 数据模型

`database/schema.sql` 新增 **表 20：card_tags**（编号顺延，不复用已退役表名/编号）：

```sql
-- 表 20: card_tags（卡片标签：受控命名空间 + 用户自由标签）
CREATE TABLE IF NOT EXISTS card_tags (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  generation_id INTEGER NOT NULL,
  namespace     TEXT    NOT NULL,             -- topic | fn | lang | src | tag
  value         TEXT    NOT NULL,             -- 受控词表值或用户自由值
  source        TEXT    NOT NULL DEFAULT 'user',  -- rule | user | import
  rule_version  TEXT,                          -- source=rule 时记录规则版本（如 tagrules-v1）
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (generation_id, namespace, value),
  FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_card_tags_ns_value ON card_tags(namespace, value);
CREATE INDEX IF NOT EXISTS idx_card_tags_generation ON card_tags(generation_id);
```

要点：

- 仅以 `generations.id` 为外键（基线 §9.1）；`ON DELETE CASCADE` 随卡删除。
- `source` + `rule_version` 满足基线 §9.7"自动分组保留来源、版本与解释"——解释即规则名。
- 用户手动删除自动标签 = 删行；规则重跑**不得**重新写入用户已删除的组合（重跑前记录用户显式删除的 (generation_id, namespace, value) 到 `source='user-removed'` 哨兵行，规则跳过）。这是自动与手动共存的唯一微妙点，必须实现。
- SQL 域代码：`services/storage/db/cardTags.js`（list/set/remove/counts/backfill 事务），`databaseService` 薄委托，沿用现有模式。

## 4. 打标策略

### 4.1 自动规则（tagrules-v1）

- `lang:`：字符集判定（含假名→ja；汉字+拉丁→mixed;仅汉字→zh;仅拉丁→en）。已在勘察中验证。
- `fn:`：匹配语法卡短语中的"：表示…/提出…/请求…"注释与句式关键词（〜てください→request 等）。预计覆盖 188 张中的大多数；未命中不打，不强行兜底。
- `topic:`：关键词规则打底（勘察脚本的词表扩充版）；未命中**留空**，不自动打 `general`（`general` 留给人工确认，避免规则把长尾全部错误归通用）。
- `src:`：`test-artifact` 用模式清单（"验证/压测/测试/OCR test/请注意今天的日期"等）；`hoikuen-import` 按 2026-07-13 保育园批次短语清单；`feishu-import` 按 grammar_ja + 20260529/0530 文件夹；其余按 `source_mode`（ocr/manual）。

### 4.2 一次性回填

`scripts/maintenance/backfillCardTags.js`：默认 dry-run 输出统计（各命名空间命中数、样例、未命中清单），`--apply` 写入。幂等：重跑只补缺失组合，跳过 `user-removed`。

### 4.3 增量打标

新卡生成成功后（`executeCardGeneration` 持久化阶段）自动打 `lang:` 与 `src:`；`fn:`/`topic:` 规则同步执行。不引入后台 job。

### 4.4 LLM 兜底（明确推迟）

`topic:` 长尾（勘察估计 300+ 张规则难覆盖）v1 靠 UI 批量确认解决；DeepSeek 批量辅助打标作为**可选后续**，必须显式命令触发，不进默认链路。

## 5. API

沿用现有 envelope 惯例（`{ success, ... }` / 错误 `{ error }`）：

```
GET    /api/tags                          → { success, tags: [{ namespace, value, count }] }
GET    /api/records/:id/tags              → { success, tags: [...] }
PUT    /api/records/:id/tags              → 全量替换该卡用户可编辑标签（body: { tags: [{namespace, value}] }）
POST   /api/tags/batch                    → 批量打/删标签（body: { generationIds, add?, remove? }）
```

查询集成：`/api/history`、`/api/history/search` 增加 `tags=<ns:value,...>` 过滤参数（AND 语义），`records` 行返回 `tags` 数组。不新建独立查询端点。

约束：`lang:`/`src:` 对用户只读（UI 不提供编辑入口；API 拒绝写入这两个命名空间，防止破坏自动语义）。

## 6. UI（桌面端，React Router）

- **卡片库筛选**（`app/features/factory` 库区）：标签筛选条——命名空间分组的下拉/chip，多选 AND；与现有文件夹/搜索并存。
- **卡片弹窗**（`card-modal`）：CONTENT 头部下方一行标签 chips；编辑入口允许增删 `topic:`/`fn:`/`tag:`（自由标签带输入建议=已有值去重）。
- **批量操作**：库列表多选 → 批量打/删标签（消费 `/api/tags/batch`）；首个用途就是人工清理 `src:test-artifact` 与确认 `topic:` 长尾。
- 保持既有 testid 约定新增：`tag-filter` / `card-tags` / `tag-editor` / `tag-batch-bar`。

## 7. 与学习辅助 2.0 的接缝

- 未来 Heuristic Provider（基线 §8）可用标签实现 `group`（如按 `topic:` 分组）与 `explain`（"因为该卡属于 topic:软件工程"）；读取方式为普通 SQL/API，不新增依赖方向。
- 复习范围选择（基线 §7"按卡型、日期或文件夹选择范围"）自然扩展为"按标签选择范围"——但该扩展属于 LA 专题设计，本文只保证查询能力就绪。
- `src:test-artifact` 是给未来队列的**默认排除建议**，最终排除策略由 LA-D2 决定。

## 8. 测试

- Unit（`tests/unit/cardTags.test.js`）：db 模块 CRUD/counts/UNIQUE/级联删除;规则引擎（lang 判定、fn 注释提取、test-artifact 模式、user-removed 跳过）;回填幂等。
- Integration：tags 路由 envelope、history 的 tags 过滤、只读命名空间拒写。
- E2E（`react-cards-factory.spec.js` 扩展）：筛选条过滤、弹窗标签编辑、批量打标。
- 回填脚本 dry-run 输出进入验收记录。

## 9. 分阶段

| 阶段 | 范围 | 门禁 |
|---|---|---|
| T0 | schema 表 20 + db 模块 + 规则引擎 + 回填脚本（dry-run 评审 → apply） | 单测全绿;回填统计人工确认;`test-artifact` 清单确认 |
| T1 | API + history 过滤集成 | 集成测试全绿;既有端点无回归 |
| T2 | 库筛选 UI + 弹窗编辑 + 批量操作 | E2E 全绿;light/dark 视觉基线更新 |
| T3（可选，随 LA） | Heuristic Provider 消费标签;DeepSeek 批量辅助 | 归属 LA-P2/P4，另行评审 |

## 10. 非目标

- 不做聚类、同义网络、关系抽取、图可视化（知识图谱 2.0 边界）。
- 不做运行时可编辑受控词表、标签层级/树、标签别名。
- 不做后台打标 job 队列;不默认调用 LLM。
- 不在本文定义复习/计划如何使用标签（只保证信号可用）。

## 11. 验收清单

- [ ] 表 20 card_tags 落地;不复用任何退役表名;仅 FK generations
- [ ] 回填后：`lang:` 覆盖 100%;`src:` 覆盖 100% 且 test-artifact 清单经人工确认;`fn:` 覆盖 ≥80% 语法卡;`topic:` 规则命中部分全部正确（准确率优先于覆盖率）
- [ ] 用户删除的自动标签在规则重跑后不复活
- [ ] `lang:`/`src:` API 层只读
- [ ] 库筛选、弹窗编辑、批量打标 E2E 全绿;Cards Factory 既有行为零回归
- [ ] lint / unit / integration / e2e 全绿
