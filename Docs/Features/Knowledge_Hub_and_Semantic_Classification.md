# 知识库语义分类 与 Knowledge Hub 浏览器

知识分析子系统的「语义分类（semantic classification）」特性，以及 `knowledge-hub.html`
重构后的三栏「知识浏览器」。本文是该特性的真源说明，配合 `CLAUDE.md` 的 Subsystems 段落阅读。

## 1. 目标

把历史生成的卡片按**语义**组织起来，让学习者能按「这是用来表达什么」来浏览，而不是只按文件夹/时间。
设计参考飞书「日语句式索引」base —— 它按交际功能（疑问 / 因果 / 假设 …）而非主题来归类日语句式。

## 2. 两轴分类法 (`services/knowledge/taxonomy.js`)

固定策展（curated），不是开放生成，保证类目稳定可控。按 `card_type` 分轨：

- **功能轴 `function`** —— 用于 `grammar_ja` 语法卡，按交际功能分 19 类（含兜底 `fn_other`）：
  疑问 / 判断推测评价 / 建议忠告 / 意愿目的计划 / 请求邀请 / 禁止允许 / 顺序并列 / 比较对照 /
  时体变化 / 假设条件 / 因果 / 频率数量 / 转述传达 / 授受 / 转折让步 / 动词语态 / 范围限定 / 接续口语。
- **主题轴 `topic`** —— 用于三语词汇卡，按主题领域分 8 类（含兜底 `tp_general`）：
  工程技术 / AI与数据 / 沟通表达 / 商务职场 / 学术研究 / 日常生活 / 社会时事 / 通用其他。

每个类目是 `{ key, label, desc, axis, keywords[] }`。`key` 全局唯一（`fn_*` / `tp_*`），因为它就是
`knowledge_clusters.cluster_key` 的查询句柄，不能跨轴撞名。

## 3. `cluster` 任务：规则打底 + LLM 补未命中 (`services/knowledge/tasks/cluster.js`)

`run(cards, opts)`（已改为 async）：

1. 按 `card_type` 给每张卡选轴（`axisForCardType`）。
2. **规则 pass**：卡片文本（phrase + 三语释义 + markdown）对该轴各类目的 `keywords` 做关键词匹配，
   命中分最高的类目胜出；按命中数给 `score`。
3. **LLM 兜底**：规则未命中的卡片批量交给 Gemini（默认开，`KNOWLEDGE_CLUSTER_LLM_ENABLED`，
   预算 `KNOWLEDGE_CLUSTER_MAX_LLM_CARDS` / 批大小 `KNOWLEDGE_CLUSTER_LLM_BATCH_SIZE`），
   模型从可选 keys 中给每卡选一个；解析失败或 key 非法的卡落该轴兜底桶。
4. 产出 `{ clusters: [{ clusterKey, label, description, keywords, taxonomy, confidence, cards: [{generationId, score}] }], meta }`。

> 单测：`tests/unit/knowledgeTasks.test.js`（分轨 / 规则 / LLM 兜底 via 注入 `llmInvoke` / 未知 key 回落）。
> 测试通过 `opts.llmInvoke` 注入 stub，避免真实网络；生产从不设此项。

## 4. 数据模型

- `knowledge_clusters` 增加 additive 列 **`taxonomy`**（`function` / `topic`；`ensureTableColumns` 迁移 + `schema.sql`）。
- `knowledge_cluster_cards`（`cluster_id` × `generation_id`，`UNIQUE`）是卡 → 类目映射；按 job 版本化（`is_active`）。
- 写路径 `knowledgeClusters.replaceData`（事务：停用旧 active 版 → 清本 job 行 → 重插）。
- 读：`listClusters` 带 `taxonomy`；新增 `listCategories(db, {taxonomy})` 给左栏导航（按轴聚合 + 计数，空类目剔除）。

## 5. API

- `GET /api/knowledge/base/categories?taxonomy=function|topic|all` —— 语义分类导航（类目 + 计数）。
- `GET /api/knowledge/base/terms` —— 词条浏览，支持 `category=<clusterKey>` 与 `uncategorized=1`
  （未归入任何 active cluster 的卡，配合 `cardType` 按轴 scope）+ 既有 `query/langProfile/cardType/tag/sort/page`。
- 触发：`POST /api/knowledge/jobs/start { jobType: 'cluster' | 'index' }`（`index` 纯转换免配额；`cluster` 用 Gemini 兜底）。

## 6. Knowledge Hub 三栏浏览器 (`knowledge-hub.html` + `dashboard.js`)

`initKnowledgeBaseBrowse()` 驱动，三栏：

- **左栏导航**：轴切换（句式功能 / 主题领域 / 全部，默认 function）→ 联动语义分类纵向树 + `cardType`；
  搜索 / 语言 / 卡型 / 排序；标签（折叠）；**洞察 Insights**（同义边界 / 语法模式 / 聚类 / 问题）。
  分类树底部有「未分类 N」桶（`uncategorized`），点击筛出未归类卡。
- **中栏列表**：浏览态 = 词条卡片 + 分页；洞察态 = 对应聚合列表（互斥切换，`setKhMode`）。
- **右栏 Relation Inspector**：常驻，词条/洞察项点击都喂给它（复用 `renderKnowledgeRelationInspector`）。
- **统计条 + 数据动作**：`刷新` / `重建索引`（index job）/ `重建分类`（cluster job）——从 Hub 直接起 job、
  轮询完成后刷新；陈旧徽标在「生成卡数 > 已索引数」时提示该重建索引。

## 7. 卡片嵌入弹窗（embed mode）

点中栏词条 → 打开**主界面原生卡片弹窗**（CONTENT/INTEL/KNOWLEDGE 标签、振假名、音频），
而非另写一套。机制：Hub 的 modal `iframe` 指向 `/?card=<generationId>&embed=1`；`app.js`
`init()` → `initEmbeddedCard()` 只挂载弹窗所需（跳过 folders 加载与 queue/health 轮询），
`<html class="kh-embed">`（head 内联脚本先于绘制设置，避免闪屏）+ 把 overlay 重挂到 `<body>` +
CSS 隐藏其余 body 子节点。Hub 侧提供浮动 ✕ 关闭。

## 8. 运维要点

- 新生成的卡要先跑 `index` 才进词条浏览；要进语义分类树要再跑 `cluster`。两步都可从 Hub 一键触发。
- `cluster` 的 LLM 兜底**默认开**，会消耗 Gemini 配额；规则能覆盖的卡不调用 LLM。配额耗尽时
  兜底失败的卡安全落兜底桶（不报错），补配额后重跑即可归类。
- 分类是**按 job 版本化**的：每次 `cluster` 重建会停用旧版、以本次结果为准。

## 9. 间隔复习（SRS）

把卡片库变成可复习的学习系统。每张卡有一份间隔重复调度状态，Knowledge Hub 提供每日复习队列。

### 9.1 算法 (`services/srs/srsScheduler.js`)

SM-2 变体，纯函数 `schedule(state, grade) → nextState`（无 DB / 无 Date 副作用，便于单测）。
4 键评分映射到 SM-2 质量分：`again`(q2，未达通过线→lapse)、`hard`(q3)、`good`(q4)、`easy`(q5)。
- 通过：interval 基数按 repetitions 走（0→1、1→6、其后 `round(interval×ease)`），再乘一个档位系数
  `hard×0.6 / good×1 / easy×1.3`，使同一次复习 hard < good < easy。
- lapse（again）：repetitions 归零、interval=1、lapses+1。
- ease 按 SM-2 公式调整，下限 1.3。

### 9.2 数据 (`services/storage/db/cardSrs.js`)

- `card_srs`（`generation_id` UNIQUE）：ease_factor / interval_days / repetitions / lapses / due_date /
  last_grade / last_reviewed_at。`due_date` 用 `date('now', '+N days')` 计算、与队列的 `due_date <= date('now')`
  比较同走 SQLite UTC，避免时区错配。
- `card_reviews`：复习日志（grade / interval_before / interval_after / ease_after / reviewed_at），供「今日已复习」统计。
- `review()` 事务内：跑调度 → upsert card_srs → 追加 card_reviews。

### 9.3 API (`routes/srs.js`)

- `GET /api/srs/queue?limit&cardType` —— 到期（已跟踪且 due 过期）+ 新卡（未跟踪）队列，到期优先。
- `POST /api/srs/review { generationId, grade }` —— 推进调度，返回新状态 + stats。
- `GET /api/srs/stats` —— dueCount / newCount / reviewedToday / trackedTotal。

### 9.4 UI

Knowledge Hub 左栏「复习 Review」入口（带 `due N · new M` 徽标）→ 中栏切到第三种模式（browse / insight / review）：
进度行 + 当前卡（phrase / 卡型 / NEW 标记 / 「查看卡片」复用嵌入弹窗）+ 4 个评分按钮。评分后推进下一张，
本地队列耗尽自动再拉；队列清空显示「今日复习完成」。

## 10. 难度分级（`services/srs/difficulty.js`）

给每张卡评 `easy / medium / hard`（0–100 分分桶），用于 Hub 浏览的筛选/排序/徽标。

### 10.1 信号

- **SRS 实证**（已复习卡）：ease_factor 越低、lapses 越多 = 越难。score = ease 部分（ease 2.6→1.3 映射 0→78）
  + lapses 部分（每次 +11，封顶 22）。
- **启发式**（未复习卡）：base 28 + grammar_ja(+22) + 语言画像(ja +16 / mixed +8) + 短语长度(≥12 +12 / ≥6 +6)。
- 分桶：`<34 easy / <67 medium / 否则 hard`。

### 10.2 单一来源、零漂移

打分常量只定义一份，被两处共用：
- 纯 JS `gradeDifficulty(card)` —— 逐行打分（如 search() 路径、SRS 卡）。
- `buildDifficultyScoreSql(t, s)` —— 生成等价 SQLite 表达式，供 `knowledgeTermsIndex.list` 在
  `card_srs` LEFT JOIN 上做**分页正确**的筛选/排序。单测断言两者在样例行上一致。

### 10.3 集成

- `GET /api/knowledge/base/terms` 每条返回 `difficulty` + `difficultyScore`；支持 `difficulty=easy|medium|hard`
  过滤与 `sort=difficulty`（最难优先）。
- Hub 工具条加「Diff」筛选 + 「难度↓」排序；词条行 phrase 前显示难度徽标（简单/中等/困难，绿/黄/红）。
