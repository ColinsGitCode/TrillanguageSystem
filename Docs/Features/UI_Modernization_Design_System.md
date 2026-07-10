# 全站 UI 现代化：设计系统 + App Shell（专业克制 SaaS）

> 状态：**设计方案（待实施）** · 2026-07
> 决策：风格 = **专业克制 SaaS**（Linear / Vercel / Notion 路线）· 布局 = **左侧边栏 App Shell** · 内建**暗色模式**
> 关联：[Modern Card UI](Modern_Card_UI_Design.md) · [Knowledge Hub UI Redesign](Knowledge_Hub_UI_Redesign.md)
> 影响文件：`public/*.html`（4 页）· `public/styles.css` · `public/modern-card.css` · `public/css/dashboard.css` · `public/css/observability.css` · 新增 `public/css/tokens.css`

核心判断：**当前 UI 的问题不是"不够好看"，而是"没有设计系统 + 没有 App Shell"**。换皮肤解决不了——三套 `:root` 各自定义同一语义且**颜色值互相冲突**，四个页面各写各的 header。本文先把地基（token）统一，再收编布局（shell），最后组件化。

---

## 1. 现状审计（实测证据）

全站 CSS ~7,900 行跨 4 个文件；HTML 4 页。

### 1.1 ⚠️ Token 三套分裂 —— 同一语义，**不同颜色值**

| 语义 | `styles.css` | `modern-card.css` | `css/dashboard.css` | 冲突 |
|------|-------------|-------------------|---------------------|------|
| 页面底色 | `--bg` **#f5f7fb** | `--bg-canvas` **#f5f7fb** | `--bg-page` **#f8f9fa** | ⚠️ **值冲突** |
| 主文本 | `--text` **#111827** | `--text-ink` **#111827** | `--text-primary` **#1f2937** | ⚠️ **值冲突** |
| 边框 | `--border` **#e2e8f0** | `--border-subtle` **#e5e7eb** | `--border-color` **#e5e7eb** | ⚠️ **值冲突** |
| 主色 | `--accent` **#2563eb** | `--accent-en` **#2563eb** | `--color-accent` **#3b82f6** | ⚠️ **值冲突** |
| 卡片底 | `--card` | `--bg-card` | `--bg-card` | 命名不一 |
| 次要文本 | `--muted` | `--text-muted` | `--text-secondary` | 命名不一（值同） |

**这解释了为什么全站视觉不一致**：页面底色、主文本、边框、主色——四个最基础的 token 全都有值冲突。改一处改不动全站。

### 1.2 🐛 字体的一对镜像 bug（引用未引入 / 引入未引用）

**① `--font-ui: 'Inter'` 但 Inter 从未引入**
`dashboard.css` 定义 `--font-ui: 'Inter', sans-serif`，但四个 HTML 引入的 Google Fonts 只有 **JetBrains Mono / Noto Serif SC / Noto Serif / Space Grotesk**——**没有 Inter**。dashboard 家族三页的字体一直在静默 fallback 到系统 sans，从来不是设计意图的 Inter。

**② `Noto Serif` / `Noto Serif SC` 引入了却从未被引用**（已核实）
两者由 `index.html` 引入，但**全站 CSS 无任何 `font-family` 引用它们**。卡片的 serif 排版实际由 `--font-serif` / `--font-display` 的**系统栈**（`Hiragino Mincho ProN` / `Songti SC`）提供。⇒ 这是两次**纯浪费的字体网络请求**。

### 1.3 🐛 命名陷阱：`--font-display` 在两个文件里语义**相反**

- `styles.css`：`--font-display` = SF Pro / PingFang（**sans-serif** 栈）
- `modern-card.css`：`--font-display` = Hiragino Mincho / Songti（**serif** 栈）

同名变量、相反字形。任何跨文件复用都会踩雷。

### 1.4 废弃残留（赛博皮肤的尸体）

`styles.css` 内部还有**第二套影子 token**：
- `--sci-bg` `--sci-card-bg` `--sci-border` `--sci-text-main` `--sci-text-muted` —— 其值恰好 == `dashboard.css` 那套
- `--neon-blue/purple/green/amber/red` —— 就是 `dashboard.css` 的 `--color-accent/purple/success/warning/error`，两套命名体系
- `--glass-blur: none`（玻璃拟态**已被关掉**，变量还留着）、`--glow-shadow`

### 1.5 语义冲突：`--accent-cn` == `--color-success`（都是 #10b981）

`modern-card.css` 用 `--accent-en/jp/cn`（蓝/橙/绿）给三语卡片配色——这是**有意义的领域 token，应保留**。但中文绿 `#10b981` 与语义色「成功」同值，改主题或做暗色时会互相污染，必须在 token 层分离。

### 1.6 缺失的基础尺度

- **无间距尺度**：三个文件都没有 `--space-*`，间距全部硬编码
- **无暗色模式**：全站 0 处 `prefers-color-scheme` / `data-theme`
- **圆角只有 dashboard.css 有** `--radius-sm/md/lg`，另两个文件全硬编码
- **阴影**：`--shadow`（styles）与 `--shadow-card`（modern-card）值相同、两个名字；dashboard 无 shadow token

### 1.7 App Shell 缺失：三页 header 逐字复制

- `dashboard.html:34` 与 `knowledge-ops.html:16` 的 `<header>` 是**一模一样的内联 style 字符串**（复制粘贴），`knowledge-hub.html` 同构
- `<h1>` 内联硬编码 `font-family: 'Space Grotesk'; color: #1f2937`
- 两套导航：`index.html` 用 `.dashboard-links`（带 🚀🧠🕸️ emoji），另三页用 `.dashboard-page-nav`
- 内联样式债：`dashboard.html` **43 处**、`knowledge-ops.html` 12 处（`index.html` / `knowledge-hub.html` 已是 0，说明清零可行）

---

## 2. L1 · 设计系统层（`public/css/tokens.css` 单一真源）

新建 `tokens.css`，**所有页面第一个引入**，成为唯一 token 来源；三个旧文件的 `:root` 全部删除、改为消费统一 token。

### 2.1 值冲突裁决（落地必须先定）

| 语义 | 候选 | **裁决** | 理由 |
|------|------|---------|------|
| 页面底 | #f5f7fb / #f8f9fa | **#f8fafc** | 中性冷灰，slate-50，克制 |
| 主文本 | #111827 / #1f2937 | **#111827** | 对比度更高（WCAG AA+） |
| 边框 | #e2e8f0 / #e5e7eb | **#e5e7eb** | 与多数现存代码一致，改动面小 |
| 主色 | #2563eb / #3b82f6 | **#2563eb** | blue-600 更沉稳，符合「克制」；#3b82f6 偏亮 |

### 2.2 Token 体系

```css
:root {
  /* 中性阶（原始色，不直接用于组件） */
  --gray-50:#f8fafc; --gray-100:#f1f5f9; --gray-200:#e5e7eb; --gray-300:#cbd5e1;
  --gray-500:#6b7280; --gray-600:#4b5563; --gray-700:#374151; --gray-900:#111827;

  /* 语义层（组件只消费这一层） */
  --color-bg-canvas:  var(--gray-50);
  --color-bg-surface: #ffffff;
  --color-bg-elevated:#ffffff;
  --color-bg-subtle:  rgba(148,163,184,.12);
  --color-text-primary:   var(--gray-900);
  --color-text-secondary: var(--gray-500);
  --color-text-tertiary:  var(--gray-300);
  --color-border:        var(--gray-200);
  --color-border-strong: var(--gray-300);

  /* 品牌 + 语义色 */
  --color-primary:#2563eb; --color-primary-hover:#1d4ed8;
  --color-primary-subtle:rgba(37,99,235,.08);
  --color-success:#059669; --color-warning:#d97706;
  --color-danger:#dc2626;  --color-info:#2563eb;

  /* 领域色：三语卡片（与语义色解耦，见 §1.5） */
  --color-lang-en:#2563eb; --color-lang-ja:#f97316; --color-lang-zh:#0d9488;

  /* 尺度 */
  --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px;
  --space-6:24px; --space-8:32px; --space-12:48px;
  --radius-sm:6px; --radius-md:8px; --radius-lg:12px; --radius-full:999px;
  --shadow-sm:0 1px 2px rgba(15,23,42,.06);
  --shadow-md:0 4px 12px rgba(15,23,42,.08);
  --shadow-lg:0 18px 40px rgba(15,23,42,.12);
  --duration-fast:120ms; --duration-base:200ms;

  /* 字体（收敛，见 §2.4） */
  --font-sans: -apple-system, "PingFang SC", "Noto Sans CJK SC", sans-serif;
  --font-mono: "JetBrains Mono", "SF Mono", Menlo, monospace;
  --font-ja:   "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", sans-serif;
  --font-serif:"Hiragino Mincho ProN", "Songti SC", serif;  /* 仅卡片正文排版 */
}
```

### 2.3 暗色模式（双轨）

语义层**重映射**，中性阶不变。`prefers-color-scheme` 作默认信号，`data-theme` 由主题切换按钮显式覆盖（两个方向都要能赢）：

```css
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { /* 语义层覆盖 */ } }
:root[data-theme="dark"] {
  --color-bg-canvas:#0b0f17; --color-bg-surface:#111827; --color-bg-elevated:#1f2937;
  --color-text-primary:#f1f5f9; --color-text-secondary:#94a3b8;
  --color-border:#1f2937; --color-primary:#3b82f6;   /* 暗底上用亮一档的蓝 */
}
```

> 前置条件：**必须先清掉 55 处内联样式**（§1.7），否则硬编码颜色在暗色下不会跟随。

### 2.4 字体收敛（4 个 Google Fonts → 1）

| 字体 | 现状 | 处置 |
|------|------|------|
| **Inter** | dashboard.css 引用但**从未引入**（§1.2） | 二选一：真正引入，或改用系统栈 `-apple-system`（**推荐系统栈**，省一次网络请求） |
| **Space Grotesk** | 仅用于四个 `<h1>` 的内联 display 字体 | **删除**——装饰性，与「克制」相悖，标题改用 `--font-sans` + 字重/字距 |
| **Noto Serif / Noto Serif SC** | ✅ 已核实：引入了但 **CSS 从未引用**（§1.2②） | **直接删除引入**——卡片 serif 排版实际由系统栈（Hiragino Mincho / Songti SC）提供，删除不影响外观 |
| **JetBrains Mono** | 数字 / 计数 / 时间戳 | **保留**，仅用于数字与代码，不用于正文 |

### 2.5 迁移映射表（旧 → 新，可机械替换）

| 旧变量（所在文件） | 新 token |
|---|---|
| `--bg`(styles) · `--bg-canvas`(card) · `--bg-page`(dash) · `--sci-bg` | `--color-bg-canvas` |
| `--card` · `--bg-card` · `--sci-card-bg` · `--bg-elevated` | `--color-bg-surface` |
| `--text`(styles) · `--text-ink` · `--text-primary` · `--sci-text-main` | `--color-text-primary` |
| `--muted` · `--text-muted` · `--text-secondary` · `--sci-text-muted` | `--color-text-secondary` |
| `--border` · `--border-subtle` · `--border-color` · `--sci-border` | `--color-border` |
| `--accent`(styles) · `--color-accent` · `--neon-blue` | `--color-primary` |
| `--neon-green`/`--color-success` · `--neon-amber`/`--color-warning` · `--neon-red`/`--color-error` | `--color-success` / `--warning` / `--danger` |
| `--accent-en` / `--accent-jp` / `--accent-cn` | `--color-lang-en` / `-ja` / `-zh` |
| `--shadow` · `--shadow-card` | `--shadow-lg` |
| `--bg-accent-soft` | `--color-primary-subtle` |
| `--glass-blur` · `--glow-shadow` · `--neon-purple` · 全部 `--sci-*` | **删除**（废弃残留 §1.4） |
| `--font-display`（两义，§1.3） | 拆解：标题走 `--font-sans`；卡片正文走 `--font-serif` |

---

## 3. L2 · App Shell（左侧边栏）

四页收进同一骨架，导航**一处维护**（消灭三份复制的 header）。

```html
<div class="app-shell">
  <aside class="app-sidebar" data-collapsed="false">
    <div class="app-brand">Three LANS</div>
    <nav class="app-nav">
      <a href="/"                  data-nav="workspace">工作台</a>
      <a href="/dashboard.html"    data-nav="overview">概览</a>
      <a href="/knowledge-hub.html"data-nav="hub">知识库</a>
      <a href="/knowledge-ops.html"data-nav="ops">知识运维</a>
    </nav>
    <div class="app-sidebar-footer">
      <button data-theme-toggle>主题</button>
      <span class="app-status" data-status="online">运行正常</span>
    </div>
  </aside>
  <div class="app-main">
    <header class="app-topbar"><!-- 页面标题 / 全局搜索 / 队列状态 --></header>
    <main class="app-content"><!-- 各页原有内容 --></main>
  </div>
</div>
```

- **实现方式**：无框架、无构建，四页各自保留静态 HTML，shell 结构以 partial 形式复制**一次**并由 `--nav` 的 `data-nav` + JS 一行标记 active；或抽 `app-shell.js` 渲染侧栏（**推荐后者**，真正单点维护）。
- **响应式**：`≤1024px` 侧栏折叠为图标条；`≤768px` 变抽屉（汉堡触发）。
- **首页特殊性**：`index.html` 的 `.hero` 队列状态条移入 topbar；卡片弹窗（`#modalOverlay`）与 `?embed=1` 嵌入模式**必须保持不受 shell 影响**（Knowledge Hub iframe 依赖它）。

---

## 4. L3 · 组件层

抽出统一组件，消灭 55 处内联样式：

`Button`(primary/secondary/ghost/danger × sm/md) · `Input`/`Select` · `Card` · `Table` · `Modal` · `Toast`（统一现在 knowledge-ops 自带的那套）· `Badge`/`Pill` · `Tabs` · **`Skeleton`** · `EmptyState`（统一现在各页各写的 `Loading terms…` / `.empty-hint`）。

---

## 5. L4 · 体验层 & 去装饰清单

**去装饰**（专业克制 SaaS 的直接含义）：

| 位置 | 现状 | 改为 |
|------|------|------|
| `index.html:53-55` | `🚀 Mission Control` `🧠 Knowledge OPS` `🕸️ Knowledge Hub` | 侧栏文字 + 线性图标，**去 emoji** |
| `dashboard.html:37,40` | `← TERMINAL` · `MISSION CONTROL // BRIDGE` | 侧栏导航 + topbar 标题 `概览` |
| `knowledge-hub.html:19,22` | `← TERMINAL` · `KNOWLEDGE HUB // EXPLORER` | topbar 标题 `知识库` |
| `knowledge-hub.html:34` | `SYSTEM ONLINE`（全大写 mono） | 状态点 + `运行正常` |

**体验**：统一 `hover/active/focus-visible`（focus ring 用 `--color-primary`）；过渡走 `--duration-*`；加载态用 `Skeleton` 替代裸文字；对比度达 WCAG AA；键盘可达。

---

## 6. 落地范围与分阶段

| 阶段 | 范围 | 风险 |
|------|------|------|
| **P1 · 地基** | 新建 `tokens.css`；按 §2.5 机械替换三个文件的变量；删废弃残留；定 §2.1 裁决值；字体收敛；**暗色模式** | 低（不动结构） |
| **P2 · 清内联** | `dashboard.html` 43 处 + `knowledge-ops.html` 12 处内联样式抽到 class | 低—中（暗色模式的前置） |
| **P3 · App Shell** | `app-shell.js` + 侧栏/topbar，四页收编；去装饰清单 | **高**（结构性，e2e 受影响） |
| **P4 · 组件层** | Button/Input/Card/Toast/Skeleton/EmptyState 抽取 | 中（逐页迁移） |

> P2 必须先于暗色模式生效；P3 依赖 P1 的 token。**推荐顺序 P1 → P2 → P3 → P4。**

---

## 7. 测试影响

- **E2E**：`frontend-regression.spec.js` / `knowledge-hub.spec.js` / `pages` 类用例依赖现有 header、`.dashboard-page-nav`、`data-testid`。P3 收编 shell 时：
  - 保留所有既有 `data-testid`（`mission-control-title` / `knowledge-hub-title` / `knowledge-hub-page` 等）
  - 新增 `data-testid`：`app-shell` / `app-sidebar` / `app-nav` / `theme-toggle`
  - `?card=<id>&embed=1` 嵌入模式**必须仍能隐藏 shell**（`html.kh-embed` 规则要覆盖 `.app-shell`）
- **视觉回归**：P1 改色值会让所有截图基线失效，建议 P1 完成后一次性更新基线。

---

## 8. 验收清单

- [ ] 全站仅 `tokens.css` 一处定义 `:root`；其余文件 0 个 `:root`
- [ ] §2.1 四个冲突值统一；`--sci-*` / `--neon-*` / `--glass-blur` / `--glow-shadow` 全部删除
- [ ] `--font-ui: 'Inter'` 的幽灵引用消除（引入或改系统栈）；Space Grotesk 移除
- [ ] `--accent-cn` 与 `--color-success` 在 token 层分离
- [ ] 内联样式：四页均为 **0 处**
- [ ] 暗色模式：`prefers-color-scheme` + `data-theme` 双轨，切换即时生效，无硬编码色残留
- [ ] 四页共用一份侧栏导航（改一处，四页生效）
- [ ] emoji 导航 / `TERMINAL` / `// BRIDGE` / `// EXPLORER` / `SYSTEM ONLINE` 全部清除
- [ ] `?embed=1` 卡片嵌入模式不受 shell 影响（Knowledge Hub iframe 正常）
- [ ] `npm run test:e2e` 全绿；无新增 console error
