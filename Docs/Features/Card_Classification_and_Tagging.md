# 卡片分类与标签系统（Card Tags）

> 状态：**T0 数据回填与在线增量打标已完成；T1 API / T2 UI 待实施** · 2026-07-13
> 领域归属：**Cards Factory 卡片组织域**（文件夹/历史/浏览/查询的补强），同时为学习辅助 2.0 的 Heuristic Provider 提供**可选信号**
> 上位文档：[学习辅助 2.0 设计基线](Learning_Assistance_2_0_Design_Baseline.md) · [CLAUDE.md](../../CLAUDE.md)
> 数据整备：[学习辅助 2.0 数据整备实施计划](Learning_Assistance_2_0_Data_Preparation_Plan.md)
> 影响面：`database/schema.sql`（新表 card_tags）· `services/storage/db/` 新模块 · `routes/tags.js` + `lib/httpRuntime.js` 挂载 · `app/features/factory`（筛选 UI）· `app/features/card-modal`（标签编辑）· 一次性回填脚本

## 0. 定位与权威边界

1. 本文属于**卡片组织域**：解决"636 张卡只有日期文件夹、无法按内容查询"的问题。它不是学习域 schema——不含复习状态、调度、评分，不预设学习计划的分组语义。
2. 对学习辅助 2.0：标签只是未来 `PlanningSignalProvider`（基线 §8）的**候选信号源之一**。计划引擎读标签，标签不拥有计划；provider 缺失或标签为空时，计划引擎必须照常工作（基线 §1 依赖方向）。
3. 与已退役分类法的关系：`fn:` / `topic:` 的**概念**源自旧两轴分类法（该概念被语料验证有效），但**实现全新**——一张简单标签表，无 clusters、无 knowledge jobs、无版本化聚类、无 LLM 管线。不复用旧表名、旧 API、旧代码（CLAUDE.md 退役边界；基线 §9.8）。

## 1. 语料勘察结论（2026-07-13，整备前 636 张，整备后 635 张）

| 发现 | 数据 | 设计含义 |
|---|---|---|
| 文件夹零语义 | 全部为 `YYYYMMDD` | 分类必须新建，不能依赖文件夹 |
| 历史输入语言字段不可靠 | 三语卡 445 按保守规则：unknown 243 / ja 98 / en 92 / mixed 12；旧字段有 499/636 会改变 | `lang:` 必须重新推导并保留规则证据，纯汉字不武断判为中文 |
| 语法卡自带功能注释 | 整备前 188 张中 148 张带中英文冒号注释（约 79%），其余需句式规则或留空 | `fn:` 可规则直提为主，无需 LLM，但覆盖率需以 dry-run 实测 |
| 测试垃圾卡混入 | ≥15 张（"限流验证A""压测""请注意今天的日期"等），同时存在含“二次验证”的真实场景卡 | `qa:test-artifact-candidate` 只能作为候选，人工确认后才隔离 |
| 三语卡主题聚类 | 软件工程/IT 最大簇；其余：保育园育儿(27+)、日本职场事务、AI/ML、中文网络语、金融、日常表达 | `topic:` 受控词表按此提炼 |

## 2. 标签体系

统一模型：**命名空间 + 值**。一张卡可有任意多个标签；受控命名空间的值来自固定词表，自由命名空间由用户任意创建。

| 命名空间 | 适用 | 词表 | 打标方式 |
|---|---|---|---|
| `topic:` 主题域 | 三语/场景卡为主 | `software-eng` 软件工程 · `ai-data` AI与数据 · `work-jp` 日本职场 · `childcare` 保育园育儿 · `finance-biz` 金融商务 · `net-slang` 网络流行语 · `daily` 日常表达 · `general` 通用（兜底） | 规则打底 + UI 批量确认 |
| `fn:` 交际功能 | 语法卡 | `question` 疑问确认 · `judgment` 判断推测 · `advice` 建议忠告 · `intent` 意愿目的 · `request` 请求许可 · `prohibit` 禁止义务 · `sequence` 顺序并列 · `compare` 比较程度 · `aspect` 时体变化 · `condition` 假设条件 · `cause` 因果 · `report` 转述引用 · `give-receive` 授受 · `colloquial` 接续口语 | 规则直提（短语注释） |
| `lang:` 输入语言 | 全部 | `zh` / `ja` / `en` / `mixed` / `unknown` | 自动判定；不确定时显式 unknown |
| `src:` 来源性质 | 全部 | `input` · `selection` · `ocr` · `manual` · `legacy-import` · `hoikuen-import` · `unknown` | 读取可信元数据；无证据时 unknown，不用日期冒充来源证据 |
| `qa:` 数据质量 | 全部 | `test-artifact-candidate` · `test-artifact` | 规则只产候选；人工确认或驳回 |
| `tag:` 自由标签 | 全部 | 用户任意值（如 `面试`、`N2`、`本周重点`） | 纯手动（用户自定义诉求落点） |

词表治理：受控词表在代码中作为常量（`services/` 下单一来源）；调整词表 = 改代码 + 迁移说明，不做运行时可编辑词表（单用户场景不值得）。

## 3. 数据模型

`database/schema.sql` 新增 **表 20：card_tags**（编号顺延，不复用已退役表名/编号）：

```sql
-- 表 20: card_tags（卡片标签：受控命名空间 + 用户自由标签）
CREATE TABLE IF NOT EXISTS card_tags (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  generation_id INTEGER NOT NULL,
  namespace     TEXT    NOT NULL,             -- topic | fn | lang | src | qa | tag
  value         TEXT    NOT NULL,             -- 展示值：受控词表值或用户自由值
  normalized_value TEXT NOT NULL,             -- 比较值：NFKC + trim，自由标签再做大小写折叠
  source        TEXT    NOT NULL DEFAULT 'user',  -- rule | user | import
  status        TEXT    NOT NULL DEFAULT 'active', -- active | suppressed
  rule_version  TEXT,                          -- source=rule 时记录规则版本（如 tagrules-v1）
  rule_key      TEXT,                          -- 具体规则，例如 topic.software-eng.keyword
  evidence_json TEXT,                          -- 匹配证据，不存放不可公开的 prompt/密钥
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  CHECK (namespace IN ('topic', 'fn', 'lang', 'src', 'qa', 'tag')),
  CHECK (source IN ('rule', 'user', 'import')),
  CHECK (status IN ('active', 'suppressed')),
  UNIQUE (generation_id, namespace, normalized_value),
  FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_card_tags_active_ns_value
  ON card_tags(namespace, normalized_value) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_card_tags_generation ON card_tags(generation_id);
```

要点：

- 仅以 `generations.id` 为外键（基线 §9.1）；`ON DELETE CASCADE` 随卡删除。
- `source` + `rule_version` + `rule_key` + `evidence_json` 满足基线 §9.7“来源、版本与解释”；规则集版本不是解释，必须保存具体规则和匹配证据。
- 受控标签的 `normalized_value=value`；自由标签保留 `value` 作为显示文本，使用 NFKC + trim + Unicode 大小写折叠后的 `normalized_value` 做比较和去重。
- 用户删除规则标签时不删行，而是把 `status` 改为 `suppressed`；规则重跑只处理不存在的组合并跳过 suppressed。用户重新添加同一标签时恢复 `active`、改为 `source='user'` 并更新时间。所有状态或来源变更都必须由写入服务显式更新 `updated_at`。
- 所有普通 list/count/filter 查询必须限定 `status='active'`；维护接口才可读取 suppressed。
- `lang:` 与 `src:` 每张卡最多一个 active 值；`topic:`、`fn:`、`qa:`、`tag:` 可以多值。写入服务在事务内维护该基数约束。
- SQL 域代码：`services/storage/db/cardTags.js`（list/set/remove/counts/backfill 事务），`databaseService` 薄委托，沿用现有模式。

## 4. 打标策略

### 4.1 自动规则（tagrules-v1）

- `lang:`：它表示**原始输入的主语言**，不是卡片包含的语言或学习目标语言。历史 `phrase_language` 来自“先检测汉字”的旧规则，不属于可信元数据；`grammar_ja` 固定为 ja，场景卡按原始场景语言，三语卡结合假名/拉丁/汉字保守判定。纯汉字且无其它可信证据时不得武断判为 zh，写入 `unknown`；`unknown` 计入覆盖率但不计入准确率。
- `fn:`：匹配语法卡短语中的"：表示…/提出…/请求…"注释与句式关键词（〜てください→request 等）。冒号注释直接覆盖约 79%，额外规则可以提高覆盖；未命中留空，不为达到指标强行兜底。
- `topic:`：关键词规则打底（勘察脚本的词表扩充版）；未命中**留空**，不自动打 `general`（`general` 留给人工确认，避免规则把长尾全部错误归通用）。
- `src:`：精确映射 `source_mode=input/selection/ocr/manual`；有明确导入批次 ID 清单时可写 `legacy-import`/`hoikuen-import`；`source_mode IS NULL` 且无批次证据时写 `unknown`。日期 + 卡型只能生成审计候选，不能直接断言来源。
- `qa:`：测试特征规则生成 `test-artifact-candidate`。禁止用“验证”等单一宽泛词直接确认，因为真实场景卡也可能包含该词；优先使用已知 fixture phrase/ID allowlist、明显压测模式和多特征组合。审核必须在单个事务中完成：确认时 suppress candidate 并 activate/upsert `test-artifact`；驳回时只 suppress candidate。任一时刻不得让 candidate 与 confirmed 同时 active。

### 4.2 一次性回填

`scripts/maintenance/backfillCardTags.js`：默认 dry-run 输出统计（各命名空间命中数、unknown/未命中清单、规则证据、测试卡候选清单），`--apply` 写入。幂等：重跑只补缺失组合，跳过 suppressed。

### 4.3 增量打标

新卡在文件发布后，由持久化 use case 把 generation、observability、音频登记以及 `lang:`、`src:` 和适用的 `fn:`/`topic:`/`qa:` 规则标签放入**同一个 SQLite 事务**。不通过 HTTP 自请求，不引入独立打标 job。任何标签 CHECK/UNIQUE/基数约束失败都必须回滚 generation 及其子记录，并由 application use case 精确补偿本次发布的文件，禁止产生“卡片成功但缺标签”的半成品。

`lang:` 与 `src:` 是在线准入的强制标签，持久化回读时必须各有且仅有一个 active 值；`fn:`、`topic:` 可以按规则留空。命中 `qa:test-artifact-candidate` 时卡片保留但准入状态为 `review-required`，未来学习资格视图在人工处理前将其归为 unresolved。

### 4.4 LLM 兜底（明确推迟）

`topic:` 长尾（勘察估计 300+ 张规则难覆盖）v1 靠 UI 批量确认解决；DeepSeek 批量辅助打标作为**可选后续**，必须显式命令触发，不进默认链路。

## 5. API

沿用现有 envelope 惯例（`{ success, ... }` / 错误 `{ error }`）：

```
GET    /api/tags                          → active 标签统计 { success, tags: [{ namespace, value, count }] }
GET    /api/records/:id/tags              → { success, tags: [...] }
PATCH  /api/records/:id/tags              → 增量编辑（body: { add?, remove? }）
POST   /api/tags/batch                    → 批量增删用户可编辑标签（body: { generationIds, add?, remove? }）
POST   /api/tags/test-artifacts/review    → 批量 confirm/reject 候选
```

查询集成：现有 `/api/history` 与 `/api/search` 增加可重复的 `tag` 参数，例如 `?tag=topic:software-eng&tag=fn:request`，不同参数采用 AND 语义。禁止逗号拼接，避免自由标签的逗号/冒号歧义；客户端必须逐项 URL encode。分页记录的 tags 用一次批量查询装配，禁止逐行 N+1 查询。

约束：

- `namespace`、受控值必须命中常量词表；自由 `tag:` 执行 Unicode NFKC、trim、Unicode 大小写折叠、空值拒绝和长度上限，保留 `value` 显示文本并生成 `normalized_value` 比较值；
- `lang:`/`src:` 对通用编辑 API 只读；`qa:` 只能通过 test-artifact review 动作完成 candidate -> confirmed/rejected 转换；
- 普通响应只返回 active 标签；所有 ID、数组长度和批量数量设置上限；
- 新建 `routes/tags.js` 后必须在 `lib/httpRuntime.createApp()` 显式挂载，并覆盖 API-only integration harness。

## 6. UI（桌面端，React Router）

- **卡片库筛选**（`app/features/factory` 库区）：标签筛选条——命名空间分组的下拉/chip，多选 AND；与现有文件夹/搜索并存。
- **卡片弹窗**（`card-modal`）：CONTENT 头部下方一行标签 chips；编辑入口允许增删 `topic:`/`fn:`/`tag:`（自由标签带输入建议=已有值去重）。
- **批量操作**：库列表多选 → 批量打/删用户可编辑标签；独立候选审核视图用于确认/驳回 `qa:test-artifact-candidate`，并确认 `topic:` 长尾。
- 保持既有 testid 约定新增：`tag-filter` / `card-tags` / `tag-editor` / `tag-batch-bar`。

## 7. 与学习辅助 2.0 的接缝

- 未来 Heuristic Provider（基线 §8）可用 active 标签实现 `group` 与 `explain`；服务端通过 `cardTags` storage adapter 读取，浏览器才使用 HTTP API，禁止内部 HTTP 自请求。`explain` 可以引用 `rule_key/evidence_json`，不能只复述标签名。
- 复习范围选择（基线 §7"按卡型、日期或文件夹选择范围"）自然扩展为"按标签选择范围"——但该扩展属于 LA 专题设计，本文只保证查询能力就绪。
- `qa:test-artifact` 是给未来队列的**默认排除建议**；candidate 不得自动排除，最终策略由 LA-D2 决定。

## 8. 测试

- Unit（`tests/unit/cardTags.test.js`）：db 模块 CRUD/counts/UNIQUE/级联删除；active/suppressed 转换与重跑不复活；规则证据；lang unknown；fn 提取；测试卡候选误伤样例；回填幂等。
- Integration：tags 路由 envelope、history 的 tags 过滤、只读命名空间拒写。
- E2E（`react-cards-factory.spec.js` 扩展）：筛选条过滤、弹窗标签编辑、批量打标。
- 回填脚本 dry-run 输出进入验收记录。

## 9. 分阶段

| 阶段 | 范围 | 门禁 |
|---|---|---|
| T0 | schema 表 20 + db 模块 + 规则引擎 + 回填脚本（dry-run 评审 → apply） | 单测全绿；来源 unknown 清单和规则证据评审；测试卡候选人工确认 |
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
- [ ] 回填后：`lang:`/`src:` 每卡一个 active 值且允许 unknown；报告准确率与 unknown 比例；`fn:` 以 ≥80% 为目标但不牺牲准确率；`topic:` 命中样本经人工确认
- [ ] `qa:test-artifact-candidate` 清单经人工确认；只有 confirmed `qa:test-artifact` 可被未来复习池排除
- [ ] 用户删除的自动标签在规则重跑后不复活
- [ ] `lang:`/`src:` API 层只读
- [ ] 库筛选、弹窗编辑、批量打标 E2E 全绿;Cards Factory 既有行为零回归
- [ ] lint / unit / integration / e2e 全绿
