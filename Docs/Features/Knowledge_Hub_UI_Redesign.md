# Knowledge Hub UI 重设计方案（学习者友好 · 三栏空间重排）

> 状态：**设计方案（待实施）** · 2026-06
> 调性决策：**学习者友好** · 第一阶段：**三栏空间重排**
> 关联：[Knowledge Hub 与语义分类](Knowledge_Hub_and_Semantic_Classification.md) · [Modern Card UI](Modern_Card_UI_Design.md)
> 影响文件：`public/knowledge-hub.html` · `public/css/dashboard.css` · `public/js/modules/dashboard.js` · `tests/e2e/knowledge-hub.spec.js`

本文是 `knowledge-hub.html`（三栏知识浏览器）一次 UI 重设计的真源说明。先固化方案与样式规范，再落地代码，避免结构大改后返工。

---

## 1. 背景与现状诊断

当前 Knowledge Hub 是一个三栏 `glass-panel.kh-explorer` 布局，栅格 `252px / 400px / minmax(0,1fr)`：左栏导航/筛选、中栏词条列表、右栏 Relation Inspector。基于线上真实数据（579 词条 / 25 聚类 / 18 个语义分类）走查，识别出 5 个问题：

| # | 问题 | 证据 | 影响 |
|---|------|------|------|
| ① | **空间分配错配** | 最宽的右栏(~650px)给了默认空的 Relation Inspector（"点击词条查看关系"），高频词条列表只有 400px | 最大画布留给利用率最低的面板 |
| ② | **左栏功能过载** | 252px 窄列纵向塞 8 组控件：轴切换 / 复习 / 计划 / 搜索 / 4 个筛选 / 18 个语义分类 / 标签 / 4 个洞察 | 分类树要内部滚动；学习主线淹没在筛选器中间 |
| ③ | **信息层级扁平** | 统计条 `terms 579 · grammar 4 · clusters 25 · synonyms 1 · open issues 156` 是等大纯文字 tag；词条行每条同视觉权重、无卡型锚点 | 扫读 187 条吃力，抓不到重点 |
| ④ | **调性混搭** | 浅色商务卡片 + `TERMINAL // EXPLORER` 极客 mono 文案 + 三种字体（Inter / JetBrains Mono / Space Grotesk） | "学习者工具" 与 "运维数据台" 两种气质都沾，未收敛 |
| ⑤ | **内联样式债** | 顶部 `<header>` 全部硬编码颜色（`#6b7280` `#1f2937` `#3b82f6`），未用已定义的 `--text-secondary` 等 token | 主题不可维护 |

**根因判断**：这是给**学习者**用的知识库浏览器，却长成了**数据分析后台**的信息密集风。

---

## 2. 设计目标与原则

**调性**：学习者友好 —— 降低信息密度、增加呼吸感、词条卡片化、学习动作（复习 / 计划）前置；弱化（不删除）极客 mono 风。

**第一阶段聚焦**：三栏空间重排 —— 修正 ① 空间错配，连带 ③ 的词条卡片化。

四条原则：

1. **主舞台优先** —— 把最大画布给高频动作（词条浏览），而非低频面板。
2. **按需出现** —— Relation Inspector 仅在用户主动查看关系时出现，不常驻占栏。
3. **卡片化扫读** —— 每个词条是一张有锚点的卡（phrase 放大 + 难度色 + 卡型 pill + 释义）。
4. **Token 化** —— 所有颜色/圆角/间距走 CSS 变量，内联硬编码归一。

---

## 3. 布局方案

### 3.1 栅格：重排前 → 重排后

```
重排前（三栏，Inspector 常驻空栏）
┌───────────────────────────────────────────────┐
│ 统计条（纯文字 tag）                             │
├──────────┬─────────────┬──────────────────────┤
│ 左栏导航  │  词条列表    │  Relation Inspector   │
│ 252px    │  400px      │  1fr（~650px，常空）   │
│（过载）   │（夹在中间）  │                       │
└──────────┴─────────────┴──────────────────────┘

重排后（两栏主体 + Inspector 按需第三列）
┌───────────────────────────────────────────────┐
│ 指标条（metric 卡 + 操作）                       │
├──────────┬────────────────────────────────────┤
│ 左栏导航  │  主舞台（词条卡片，占满）            │
│ 248px    │  ┊ 点「关系」→ Inspector 滑入第三列 ┊ │
│          │                          (360px)    │
└──────────┴────────────────────────────────────┘
```

栅格规则：

```css
.kh-explorer {                       /* 默认：两栏 */
  grid-template-columns: 248px minmax(0, 1fr);
}
.kh-explorer.has-inspector {         /* 激活：第三列滑入 */
  grid-template-columns: 248px minmax(0, 1fr) 360px;
  transition: grid-template-columns .22s ease;
}
```

> 选型说明：用「动态第三列」而非「浮层抽屉遮罩」。第三列展开时词条网格自适应收窄、**不遮挡内容**，纯 CSS grid + 一个 class 切换即可，过渡动画走 `grid-template-columns` transition。这比 `position: fixed` 浮层更稳、与现有 grid 布局一致。

### 3.2 区域职责

| 区域 | 内容 | 模式相关 |
|------|------|---------|
| **指标条** | 词条 / 语义分类 / 今日待复习 等关键数字做成 metric 卡；右侧 刷新 / 重建索引 / 重建分类 | 常驻 |
| **左栏导航** | 轴切换 → 复习卡（强调）→ 学习计划卡 → 搜索 + 筛选 → 语义分类（带计数）→ 标签（折叠）→ 洞察 | 常驻 |
| **主舞台** | browse=词条卡片网格 + 分页；insight=洞察聚合列表；review=复习队列；plan=学习计划阶段 | 四模式互斥（`setKhMode`） |
| **Relation Inspector** | 关系详情。browse 模式默认隐藏，点词条「关系」滑入；insight 模式默认展开 | 按需第三列 |

---

## 4. UI 样式规范

### 4.1 设计 token（沿用 + 补全）

沿用 `:root`（`public/css/dashboard.css` 顶部）已有：

```
--bg-page #f8f9fa   --bg-card #ffffff   --border-color #e5e7eb
--text-primary #1f2937   --text-secondary #6b7280
--color-accent #3b82f6   --color-success #10b981
--color-warning #f59e0b  --color-error #ef4444   --color-purple #8b5cf6
--font-ui 'Inter'   --font-mono 'JetBrains Mono'
```

补全（消除散落的 `var(--bg-elevated, #fff)` 默认值 fallback、统一软强调与圆角）：

```css
:root {
  --bg-elevated:    #ffffff;              /* 正式定义，去掉各处 fallback */
  --bg-accent-soft: rgba(59,130,246,.08); /* hover / 选中软底 */
  --bg-muted:       rgba(148,163,184,.12);/* segmented / 分组底 */
  --radius-sm: 6px;  --radius-md: 8px;  --radius-lg: 12px;
}
```

**字体策略（学习者友好）**：词条 phrase、释义、分类标签一律用 `--font-ui`（Inter）；`--font-mono` 仅保留给**数字/计数/时间戳**。顶部 `TERMINAL` / `// EXPLORER` 等极客文案降权（缩小、降低对比度），不在第一阶段删除。

### 4.2 语义色编码（≤2 维，避免彩虹）

| 维度 | 取值 | 底色 / 文字 |
|------|------|------------|
| **难度**（沿用 `.kh-diff`） | easy | `rgba(16,185,129,.14)` / `#047857` |
| | medium | `rgba(245,158,11,.16)` / `#b45309` |
| | hard | `rgba(239,68,68,.14)` / `#b91c1c` |
| **卡型** pill | grammar_ja | accent soft / `#1d4ed8` |
| | trilingual | `rgba(148,163,184,.16)` / `#475569`（中性） |
| 标签 pill | tag（general 等） | `--bg-muted` / `--text-secondary` |

原则：颜色只编码「难度」一个语义维度（绿/黄/红）；卡型与标签用中性/弱色 pill，靠文字+图标区分，避免一行内多种强调色打架。

### 4.3 关键组件样式草案

**指标 metric 卡**（替换纯文字 tag）：

```css
.kh-metric { background: var(--bg-muted); border-radius: var(--radius-md); padding: 10px 12px; }
.kh-metric .label { font-size: .75rem; color: var(--text-secondary); }
.kh-metric .value { font-size: 1.4rem; font-weight: 600; font-family: var(--font-mono); }
.kh-metric.is-due  { background: var(--bg-accent-soft); }      /* 待复习高亮 */
.kh-metric.is-due .value, .kh-metric.is-due .label { color: var(--color-accent); }
```

**复习入口卡**（学习动作强化，左栏）：

```css
.kh-review-entry {
  background: var(--bg-accent-soft);
  border: 1px solid rgba(59,130,246,.25);
  border-radius: var(--radius-lg);
  padding: 11px 12px; width: 100%; text-align: left; cursor: pointer;
}
.kh-review-entry-label { font-weight: 600; color: var(--color-accent); display:flex; gap:7px; align-items:center; }
.kh-review-badge { font-size: .72rem; font-family: var(--font-mono); color: var(--color-accent); opacity:.85; }
```

**词条卡片**（主舞台，取代纯文字行）：

```css
.kh-term-card {
  display: flex; align-items: center; gap: 10px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 11px 13px;
  cursor: pointer; transition: border-color .15s, background .15s;
}
.kh-term-card:hover { border-color: var(--color-accent); background: var(--bg-accent-soft); }
.kh-term-head  { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.kh-term-phrase{ font-size: 1rem; font-weight: 600; }              /* 放大成锚点 */
.kh-term-gloss { font-size: .82rem; color: var(--text-secondary);
                 overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kh-term-rel   { /* 「关系」入口，hover 显形 */
  font-size: .76rem; color: var(--text-secondary); opacity: 0; flex-shrink: 0; }
.kh-term-card:hover .kh-term-rel { opacity: 1; }
.kh-pill { font-size: .68rem; padding: 1px 7px; border-radius: 999px; }
.kh-pill.card-grammar { background: var(--bg-accent-soft); color: #1d4ed8; }
.kh-pill.card-trilingual { background: rgba(148,163,184,.16); color: #475569; }
```

**Relation Inspector 抽屉**（第三列）：

```css
.kh-inspector {                       /* 默认折叠：不在 grid 占位 */
  display: none; min-width: 0;
}
.kh-explorer.has-inspector .kh-inspector {
  display: flex; flex-direction: column; gap: 12px;
}
.kh-inspector-close { /* ✕ 收起；点空白/Esc 也收 */ }
```

### 4.4 响应式降级

- `≤ 1100px`：第三列改为**浮层抽屉**（贴右滑入，半透明遮罩），避免主舞台被挤过窄。
- `≤ 760px`：左栏折叠为顶部抽屉/汉堡；词条网格单列；指标条横向滚动。

---

## 5. 交互行为

**Relation Inspector 开合**（核心行为变化）：

| 触发 | 结果 |
|------|------|
| browse 模式点词条本身 | 仍弹**嵌入式卡片弹窗**（`/?card=<id>&embed=1`，不变） |
| browse 模式点词条「关系」按钮 | `.kh-explorer` 加 `has-inspector` → 第三列滑入，填充该词条关系 |
| 点 Inspector ✕ / 主舞台空白 / Esc | 移除 `has-inspector` → 第三列收起 |
| 切到 insight 模式 | 默认 `has-inspector`（洞察天然要看关系）；点洞察项填充 Inspector |
| 切到 review / plan 模式 | 强制移除 `has-inspector`（这两模式无关系视图） |

`dashboard.js` 改动点：

- `initKnowledgeBaseBrowse()` —— Inspector 由「常驻渲染」改为「`toggleKhInspector(on)` 控制 `has-inspector` class + 焦点管理」。
- 词条行渲染（`renderKnowledgeBaseTerms`）—— 输出 `.kh-term-card` 结构，加卡型 pill + 「关系」按钮（带 `data-generation-id`）。
- `setKhMode(mode)` —— 进入 review/plan 时调 `toggleKhInspector(false)`；进入 insight 时 `toggleKhInspector(true)`。

---

## 6. 落地范围（文件级清单）

| 文件 | 改动 |
|------|------|
| `public/knowledge-hub.html` | `.kh-explorer` 三栏→两栏结构；`<header>` 内联样式抽到 class；指标条改 metric 卡容器；Inspector 容器加折叠态标记 |
| `public/css/dashboard.css` | 补全 §4.1 token；新增 §4.3 组件样式；`.kh-explorer` 栅格 + `has-inspector` 过渡；响应式 §4.4；删冗余 inline fallback |
| `public/js/modules/dashboard.js` | §5 的 `toggleKhInspector` 开合逻辑；词条卡片化渲染；`setKhMode` 联动 |
| `tests/e2e/knowledge-hub.spec.js` | 见 §7 |

不动后端、不动数据层、不动其它页面 —— 改动闭环在此单页。

---

## 7. 测试影响

`knowledge-hub.spec.js` 现有 8 个用例（见[语义分类文档](Knowledge_Hub_and_Semantic_Classification.md) §测试），受影响项：

- **04 洞察面板 + Relation Inspector** —— Inspector 默认隐藏；断言改为「切 insight 模式后可见」「点洞察项后含 CLUSTER 文本」。
- **05 词条点击弹卡片** —— 词条卡点击仍弹 embed 弹窗（不变）；**新增**「点词条『关系』按钮 → 第三列出现 `has-inspector`」用例。
- **06 难度徽标** —— 选择子由 `.kh-diff` 调整为 `.kh-term-card .kh-diff`（卡片化后层级变化）。
- 其余（01 三栏结构 / 02 轴切换 / 03 分类筛选 / 07 计划 / 08 复习）—— 断言基本不变，仅个别 testid 选择子随结构微调。

新增 testid：`kh-inspector`（抽屉容器）、`kh-term-rel`（关系入口）。验证逻辑：默认 `kh-explorer` 无 `has-inspector`，点关系后有。

---

## 8. 分阶段实施

| 阶段 | 范围 | 本次 |
|------|------|------|
| **P1 空间重排** | 三栏→两栏 + Inspector 抽屉化 + 栅格/过渡 | ✅ 本次 |
| **P2 词条卡片化** | `.kh-term-card` + 卡型 pill + 难度锚点 + 指标条 metric | ✅ 本次（与 P1 同改一处 DOM，合并做） |
| **P3 调性收敛** | 配色/字体统一、`<header>` 内联样式归一 token、极客文案降权 | 随手做（低风险） |
| **P4 左栏精简** | 筛选器折叠收纳、分组重排 | 后续单独一轮（问题②，独立验证） |

> 第一阶段交付 = P1 + P2 + P3（同一处 DOM/CSS 改动，自然合并）；P4 左栏过载是独立问题，留作下一轮，避免一次改动面过大。

---

## 9. 验收清单

- [ ] browse 模式：Inspector 不占栏，词条网格占满主舞台
- [ ] 点词条「关系」→ 第三列平滑滑入；✕/Esc/空白收起
- [ ] insight 模式：Inspector 默认展开并随洞察项更新
- [ ] review / plan 模式：无 Inspector 残留
- [ ] 词条卡片：phrase 放大、难度色徽标、卡型 pill、释义单行省略
- [ ] 指标条：关键数字 metric 化，待复习高亮
- [ ] `<header>` 无内联硬编码色，全部走 token
- [ ] `≤1100px` / `≤760px` 两档响应式不破版
- [ ] `npm run test:e2e`（knowledge-hub.spec.js）全绿
- [ ] 无新增 console error；lint 0 警告
