# 全站 UI 现代化设计系统与 App Shell

> 状态：**历史实施基线 · 视觉原则继续有效，旧静态页面与 Shell 实施路径已失效** · 2026-07
> 当前增补：[SaaS App Shell 与复杂长流程设计及开发规范](SaaS_App_Shell_and_Complex_Workflow_Design_Guidelines.md)
> 产品定位：**学习优先的三语学习工作台**，系统运维能力降为二级入口
> 视觉方向：**专业、克制、清晰的现代 SaaS**，保留 Three LANS 的语言与卡型识别
> 布局决策：**左侧边栏 App Shell** · 响应式抽屉 · 明暗主题
> 关联：[Modern Card UI](Modern_Card_UI_Design.md) · [Knowledge Hub UI Redesign](Knowledge_Hub_UI_Redesign.md) · [Engagement and Retention](Engagement_and_Retention_System.md)
> 影响文件：`public/*.html`（4 页）· `public/styles.css` · `public/modern-card.css` · `public/css/dashboard.css` · `public/observability.css` · `public/js/modules/app.js` · `public/js/modules/dashboard.js` · 新增共享设计系统文件

核心判断：当前 UI 的主要问题不是单个页面不够好看，而是缺少统一的产品信息架构、设计 token、组件原语和 App Shell。实施必须先统一视觉语义和 DOM 契约，再改变页面结构；暗色模式不能早于颜色迁移完成。

---

## 0. 文档角色与权威边界

2026-07-23 治理说明：本文形成于 React Router 全栈迁移前。本文关于 token、领域色、视觉克制、可见焦点和安静学习工作台的原则继续有效；其中 `public/*.html`、旧命令式模块、Mission Control、Knowledge Hub/OPS、旧 SRS 导航和旧 Shell DOM 属于历史实施路径，不再代表当前运行系统。当前运行事实以 `CLAUDE.md`、实际 `app/` 代码和 `Docs/README.md` 为准；React Router 时代的 App Shell 与复杂长流程横向规范以上述增补文档为准。

本文曾作为 **Three LANS 全站 UI 的正式横向基线**，当前继续负责保留以下视觉决策的历史来源：

- 产品级导航和 App Shell；
- 全站颜色、字体、间距、圆角、阴影与动效 token；
- 主题切换、响应式和无障碍约束；
- 跨页面共享组件与测试门禁。

既有专题文档继续负责页面内部业务设计：

- `Knowledge_Hub_UI_Redesign.md` 负责 Knowledge Hub 内部浏览、复习、计划、筛选和 Inspector；其 P4 左栏精简继续有效，但不得再创建第二套全站导航或 token。
- `Modern_Card_UI_Design.md` 负责学习卡内容结构和弹窗阅读体验；卡片内部可以使用领域字体和语言色，但必须消费本文定义的全局/领域 token。
- `Engagement_and_Retention_System.md` 负责今日学习、连续学习和复习数据语义；本文只决定其在 App Shell 工作台中的展示层级。

冲突裁决：全局导航、主题、token、响应式和组件规范以本文为准；页面内部业务结构以对应专题文档为准。

---

## 1. 产品与视觉方向

### 1.1 主要用户与核心任务

主要用户是使用中文界面学习英语和日语的个人学习者。最重要的闭环是：

```
描述学习内容或场景 -> 生成学习卡 -> 浏览/播放 -> 今日复习 -> 回到卡片库
```

Mission Control 和 Knowledge OPS 是维护该闭环的系统能力，不与学习动作争夺一级导航权重。

### 1.2 视觉原则

1. **学习动作优先**：生成、复习、卡片库和知识浏览优先于系统指标。
2. **安静但不匿名**：主体使用中性冷灰和清晰分隔，领域色只用于语言、卡型和状态编码。
3. **结构表达意义**：分组、标题、边栏和状态条负责说明层级，不依赖装饰性渐变或大面积发光。
4. **一个识别符号**：品牌区使用由蓝、橙、青三个离散色段组成的 `LANS Rail`，分别对应英语、日语和中文；不在全站重复铺设彩色装饰。
5. **内容密度可控**：学习页面保留呼吸感；Mission Control 可以更密集，但必须沿用相同的字体、控件和导航语法。

### 1.3 明确不采用

- 不复制 Linear、Vercel 或 Notion 的外观，仅参考其层级克制和操作一致性。
- 不新增营销式首页、超大 Hero、装饰性渐变球或玻璃拟态。
- 不在本阶段引入 SPA 框架、构建工具或新路由框架。
- 不把尚无跨域搜索接口的“全局搜索”塞进 topbar；搜索继续由各业务页负责。

---

## 2. 现状审计与修正

### 2.1 已核实的结构问题

- 全站 4 个 CSS 文件约 7,900 行，存在多套同义 token。
- `styles.css` 自身包含两个 `:root`，加上 `modern-card.css` 和 `dashboard.css`，实际共有四个根变量块。
- 页面底色、主文本、边框和主色存在不同命名与不同值。
- `dashboard.html` 有 43 个 `style` 属性，`knowledge-ops.html` 有 12 个；首页和 Knowledge Hub 已为 0。
- 首页使用 emoji 导航，另外三页使用 `.dashboard-page-nav`，导航实现和视觉语言不一致。
- `dashboard.css` 引用未加载的 Inter；Space Grotesk 不只用于页面标题，还用于 Dashboard、复习和计划等多个组件；删除时必须全量迁移。
- 首页引入的 Noto Serif / Noto Serif SC 未被实际字体栈消费。
- `--font-display` 在不同文件中分别代表 sans 和 serif，存在语义冲突。

### 2.2 暗色模式的真实迁移面

HTML 的 55 个内联样式只是问题的一部分。当前 CSS 仍有大量直接颜色值，主要分布在：

- `styles.css`：页面、队列、OCR、进度、卡型和旧 sci/neon 皮肤；
- `modern-card.css`：卡片头部、面板、删除确认和音频按钮；
- `dashboard.css`：Dashboard、Knowledge Hub、图表和状态；
- `observability.css`：几乎完整的独立深色视觉体系。

因此暗色模式必须建立在“主题敏感颜色完成 token 化”之后，不能与第一轮变量改名同时宣告完成。

### 2.3 必须保留的领域视觉

- 中英日语言色是内容语义，不是装饰色。
- 三语卡、日语语法卡和场景卡是不同卡型，必须保持可辨识。
- 场景卡已确认使用爱马仕黄相关配色：`#f2b84b / #f37021 / #9a4f00 / #fff0c2`，现有单测继续作为回归约束。
- Observability 的高对比技术面板可以保留为系统页面中的上下文例外，但必须改为显式 `--color-obs-*` token，而不是散落颜色字面量。

---

## 3. 信息架构与 App Shell

### 3.1 导航分组

侧栏按用户任务分为两组：

```
Three LANS

学习
  工作台       /                         生成 + 今日学习
  今日复习     /knowledge-hub.html?mode=review
  卡片库       /?view=library            文件夹 + 历史记录 + 卡片列表
  知识库       /knowledge-hub.html

系统
  Mission Control  /dashboard.html
  Knowledge OPS    /knowledge-ops.html

底部
  主题设置
  系统状态
```

`/?view=library` 是首页已有资源区的深链接状态，不新增业务页面。`app.js` 解析该参数后聚焦资源区并保留文件夹/历史记录现有行为。

### 3.2 桌面结构

```html
<body data-page="workspace" data-page-title="工作台">
  <div class="app-shell" data-testid="app-shell">
    <aside id="appSidebarMount" class="app-sidebar"></aside>
    <div class="app-main">
      <header class="app-topbar">
        <button class="app-nav-trigger" aria-label="打开导航"></button>
        <h1 class="app-page-title">工作台</h1>
        <div class="app-topbar-actions" data-shell-actions>
          <!-- 页面静态提供；首页在这里保留队列状态 DOM -->
        </div>
      </header>
      <main class="app-content" data-page-content>
        <!-- 页面原有业务内容，保持静态 DOM -->
      </main>
    </div>
  </div>
</body>
```

- 桌面侧栏宽度 `232px`，内容区 `minmax(0, 1fr)`。
- `769px..1024px` 收为 `64px` 图标栏；文字通过 tooltip 和可访问名称保留。
- `<=768px` 使用遮罩抽屉；支持菜单按钮、点击遮罩、Escape 关闭，并把焦点归还触发按钮。
- 页面正文不做浮动卡片外框；卡片只用于重复项目、真实工具区、弹窗和独立状态单元。

### 3.3 图标策略

使用固定版本、随仓库提供的 Lucide 浏览器包，不从 CDN 运行时加载：

- 新增 `public/vendor/lucide.min.js` 及许可说明；
- 导航、主题、关闭、刷新、删除、播放等使用 Lucide 图标；
- 图标按钮必须有 `aria-label`，不熟悉的图标必须有 tooltip；
- 不再用 emoji 充当导航或操作图标。

---

## 4. 设计 Token

### 4.1 文件与加载顺序

新增 `public/css/tokens.css`，成为唯一 `:root` 和主题重映射来源。所有页面按以下顺序加载：

1. 主题预初始化脚本；
2. `css/tokens.css`；
3. `css/components.css`；
4. `css/app-shell.css`；
5. 页面专属 CSS；
6. `modern-card.css`（仅加载学习卡的页面）。

旧 CSS 文件删除自己的 `:root`，只消费共享 token。原始色值原则上只允许出现在 `tokens.css`、图片/SVG 资产以及明确获批的测试夹具中。

### 4.2 浅色主题

```css
:root {
  color-scheme: light;

  --color-bg-canvas: #f8fafc;
  --color-bg-surface: #ffffff;
  --color-bg-elevated: #ffffff;
  --color-bg-subtle: #f1f5f9;

  --color-text-primary: #111827;
  --color-text-secondary: #475569;
  --color-text-tertiary: #64748b;
  --color-text-disabled: #94a3b8;
  --color-text-inverse: #ffffff;

  --color-border: #e2e8f0;
  --color-border-strong: #cbd5e1;
  --color-focus: #2563eb;
  --color-overlay: rgba(15, 23, 42, .42);
  --color-skeleton: #e2e8f0;

  --color-primary: #2563eb;
  --color-primary-hover: #1d4ed8;
  --color-primary-subtle: #eff6ff;
  --color-success: #047857;
  --color-warning: #b45309;
  --color-danger: #b91c1c;
  --color-info: #1d4ed8;
  --color-data-purple: #7c3aed;

  --color-lang-en: #2563eb;
  --color-lang-ja: #f97316;
  --color-lang-zh: #0d9488;

  --color-card-trilingual-surface: #eff6ff;
  --color-card-trilingual-border: #93c5fd;
  --color-card-trilingual-text: #1d4ed8;
  --color-card-grammar-surface: #ecfdf5;
  --color-card-grammar-border: #5eead4;
  --color-card-grammar-text: #0f766e;
  --color-card-scenario-surface: #fff0c2;
  --color-card-scenario-border: #f2b84b;
  --color-card-scenario-strong: #f37021;
  --color-card-scenario-text: #9a4f00;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;

  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-modal: 12px;
  --radius-full: 999px;

  --shadow-sm: 0 1px 2px rgba(15, 23, 42, .06);
  --shadow-md: 0 8px 24px rgba(15, 23, 42, .10);
  --shadow-modal: 0 24px 64px rgba(15, 23, 42, .18);

  --duration-fast: 120ms;
  --duration-base: 200ms;
  --ease-standard: cubic-bezier(.2, 0, 0, 1);

  --font-sans: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Yu Gothic UI", "Microsoft YaHei", sans-serif;
  --font-mono: ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, monospace;
  --font-ja: "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif;
  --font-serif: "Hiragino Mincho ProN", "Songti SC", serif;
}
```

`--color-text-tertiary` 在白底上的对比度必须不低于 4.5:1；更浅的 `--color-text-disabled` 只能用于禁用态或非文字装饰，不能承载普通说明文字。

圆角值的收紧是有意的现代化决策，但不得通过同名 token 替换静默扩散。P1 必须逐组件做语义映射：

| 旧值 / 用途 | 新 token | 迁移规则 |
|---------------|------------|----------|
| `6px` 紧凑控件 | `--radius-md` (`6px`) | 保持视觉尺度 |
| `8px` 常规面板 | `--radius-lg` (`8px`) | 保持视觉尺度 |
| `12px` 弹窗/重点工具区 | `--radius-modal` (`12px`) | 不得直接改为 `--radius-lg` |
| 本轮明确要收紧的旧 `12px` 卡片 | `--radius-lg` (`8px`) | 在截图审批中单独标记为预期差异 |

Gate 0 截图是迁移前证据，不是“一像素不变”的要求。P1 只允许经文档确认的 token/圆角变化更新基线；其他差异均视为回归。

### 4.3 暗色主题

暗色模式只重映射语义 token，不改变组件选择器。系统偏好由首屏主题脚本解析为最终的 `data-theme="light|dark"`，因此 CSS 只维护一份暗色值：

```css
:root[data-theme="dark"] {
  color-scheme: dark;
  --color-bg-canvas: #0b0f17;
  --color-bg-surface: #111827;
  --color-bg-elevated: #182233;
  --color-bg-subtle: #1f2937;
  --color-text-primary: #f8fafc;
  --color-text-secondary: #cbd5e1;
  --color-text-tertiary: #94a3b8;
  --color-text-disabled: #64748b;
  --color-border: #273449;
  --color-border-strong: #3b4a60;
  --color-focus: #60a5fa;
  --color-overlay: rgba(0, 0, 0, .64);
  --color-skeleton: #273449;
  --color-primary: #60a5fa;
  --color-primary-hover: #93c5fd;
  --color-primary-subtle: rgba(96, 165, 250, .14);
  --color-success: #34d399;
  --color-warning: #fbbf24;
  --color-danger: #f87171;
  --color-info: #60a5fa;
  --color-data-purple: #a78bfa;

  --color-card-trilingual-surface: rgba(37, 99, 235, .16);
  --color-card-trilingual-border: #3b82f6;
  --color-card-trilingual-text: #93c5fd;
  --color-card-grammar-surface: rgba(13, 148, 136, .16);
  --color-card-grammar-border: #14b8a6;
  --color-card-grammar-text: #5eead4;
  --color-card-scenario-surface: rgba(242, 184, 75, .14);
  --color-card-scenario-border: #f2b84b;
  --color-card-scenario-strong: #fb923c;
  --color-card-scenario-text: #fde68a;

  --shadow-sm: 0 1px 2px rgba(0, 0, 0, .28);
  --shadow-md: 0 12px 28px rgba(0, 0, 0, .34);
  --shadow-modal: 0 28px 80px rgba(0, 0, 0, .52);
}
```

系统主题发生变化时，主题控制器仅在用户偏好为 `system` 时重新解析并更新 `data-theme`。这样 `tokens.css` 中每个暗色 token 只有一个权威值，不存在媒体查询和显式选择器两份映射漂移的问题。

### 4.4 字体决策

- 删除所有 Google Fonts 请求，避免本地模式依赖网络并提高视觉回归稳定性。
- Inter 和 Space Grotesk 全量迁移到 `--font-sans`，不是只替换页面标题。
- 数字、时间、状态码使用 `--font-mono`；普通英文和中文不使用 mono。
- 日语正文使用 `--font-ja`；学习卡长篇正文允许使用 `--font-serif`。

---

## 5. 主题控制器

### 5.1 状态与优先级

- 存储键：`three-lans-theme-v1`。
- 合法偏好：`system`、`light`、`dark`。
- 优先级：用户显式选择 > 系统 `prefers-color-scheme`。
- `<html data-theme-preference>` 保存当前偏好；`<html data-theme>` 始终保存解析后的 `light` 或 `dark`。
- 偏好为 `system` 时监听 `matchMedia('(prefers-color-scheme: dark)')`，系统主题变化后立即更新解析结果。
- 监听 `storage` 事件，使多个页面或标签页同步主题。

### 5.2 防止主题闪烁

每个页面在加载 `tokens.css` 前执行最小预初始化脚本：读取偏好，非法或缺失时使用 `system`，根据 `matchMedia` 解析最终明暗值，并同时写入 `data-theme-preference` 与 `data-theme`。脚本不得创建 DOM、发请求或依赖 `app-shell.js`。

主题选择是三项菜单“跟随系统 / 浅色 / 深色”，不是含义不明的单按钮循环。菜单项显示当前选中状态，并支持键盘操作。

---

## 6. App Shell 技术契约

### 6.1 明确采用的实现方式

采用“**静态挂载点 + JS 注入共享导航和行为**”，不在运行时移动页面业务 DOM：

- 四个 HTML 保留相同的 `.app-shell / .app-main / .app-content` 静态骨架。
- `app-shell.js` 只向 `#appSidebarMount` 注入共享品牌、导航、主题菜单和状态区域。
- 页面标题由 `body[data-page-title]` 提供。
- 页面专属 topbar 操作保留为静态 `[data-shell-actions]`；首页队列 DOM 必须在 `app.js` 加载前已经存在。
- `app-shell.js` 不创建、重命名或移动 `app.js` / `dashboard.js` 当前依赖的业务 ID。
- active 导航按确定顺序解析：`/?view=library` 优先于工作台；`/knowledge-hub.html?mode=review` 优先于知识库；其余按 pathname 精确匹配。

### 6.2 加载顺序

1. `kh-embed` 与主题预初始化脚本；
2. CSS；
3. 本地 Lucide 脚本；
4. 页面业务所需的本地 vendor（首页的 `marked.min.js` / `purify.min.js`、Dashboard 图表依赖等）；
5. `app-shell.js`；
6. 当前页面业务模块。

所有 module script 不使用 `async`，保持文档顺序执行。`DOMPurify` 必须在 `app.js` 之前可用；净化器缺失时卡片渲染 fail closed，禁止把未净化 HTML 原样写入 DOM。

### 6.3 状态与轮询所有权

- 新增 `shell-health.js` 单例模块，统一负责 `/api/health` 的首次请求、30 秒轮询和可见性恢复刷新。
- 模块暴露 `startHealthMonitor()`、`getHealthSnapshot()` 与 `subscribeHealth(listener)`；订阅时立即回放当前 snapshot，避免首次请求早于页面订阅造成状态丢失。
- `app-shell.js`、`app.js` 与 `dashboard.js` 消费同一单例；后两者删除自己的重复健康轮询。
- snapshot 结构固定为 `{ state, label, services, updatedAt }`；首页继续根据 critical service 状态决定生成按钮是否可用。
- 生成队列仍由首页和 Mission Control 各自现有业务模块负责；Shell 不新增第二套队列轮询。

### 6.4 嵌入卡片模式

`/?card=<id>&embed=1` 必须保持当前行为：

- 预初始化阶段添加 `html.kh-embed`；
- `app-shell.js` 检测后立即退出，不注入侧栏、不发健康请求；
- `app.js` 继续把 `#modalOverlay` 移到 `body`；
- CSS 继续隐藏除 `#modalOverlay` 外的 body 直系元素；
- Knowledge Hub 外层提供关闭按钮，嵌入卡内部关闭/删除按钮保持隐藏。

### 6.5 已确认的页面视觉设计

2026-07 可视化评审确认采用 **A · 安静学习工作台**。该方向是后续实现的页面级目标，不再混入紧凑生产工具或深色技术 Studio 风格。

通用 App Shell：

- 桌面默认 `232px` 浅色侧栏，品牌区使用 `LANS Rail`。
- 导航分为“学习”和“系统”，学习入口优先，系统入口降级。
- 顶部栏保留页面标题、页面局部操作和队列状态；队列弹窗仍由用户点击队列栏触发。
- 主体背景为冷灰画布，页面区域不套大卡片；真实卡片只用于可点击项目、工具面板和弹窗。

工作台首页：

- 顶部显示“今日学习”条：连续学习、今日目标、待复习/已掌握。
- 主工作区是“创建学习卡”，三种卡型并列：三语卡、日语语法、场景表达。
- 场景表达卡使用爱马仕黄体系，并显示“标题不超过 10 字”的产品约束。
- 右侧保留今日复习与最近卡片入口，形成“生成 -> 保存 -> 复习”的闭环。

今日复习：

- 左侧为 SRS 复习队列，右侧为当前卡片专注复习区。
- 音频播放、显示答案和四档评分按钮位置固定，避免卡片内容变化导致操作跳动。
- 场景卡进入复习时使用同一框架，但卡体切换为表达组列表，仍使用爱马仕黄标签。

卡片库：

- 顶部提供搜索、类型筛选、视图切换和统计条。
- 主区使用卡片网格，右侧固定选中卡预览和筛选面板。
- 卡型颜色固定：三语卡蓝色，语法卡青绿色，场景卡爱马仕黄。

Knowledge Hub：

- 三栏结构：知识空间/文件夹、卡片浏览、当前卡片预览。
- 保留“文件夹/知识空间”心智，但右侧预览必须提供打开学习卡和加入复习入口。
- 不再把 Knowledge Hub 做成独立视觉系统；它消费全站 Shell、token 和卡型颜色。

Mission Control：

- 面向系统运行：健康摘要、服务健康、最近任务、事件时间线和队列容量。
- 显示当前运行边界：Gemini 链路封存、SBV2 封存、默认 LLM 为 DeepSeek v4 pro、日语 TTS 为 VOICEVOX。
- 允许比学习页面更高信息密度，但仍使用同一控件、圆角、字体和状态色。

Knowledge OPS：

- 面向学习卡资产生产：输入规范化、内容生成、音频合成、质量检查。
- 生成记录表必须突出任务类型、模型、音频状态和补齐/查看操作。
- 右侧用于质量检查与音频资产，不与 Mission Control 的系统健康职责混淆。

学习卡弹窗：

- 采用接近全高的中心弹窗，背景页面淡化；弹窗内容区拉满，避免旧版顶部过高和标题撑满。
- 顶部只放短标题、卡型、音频/语言元信息和关闭/删除图标；标题必须优先使用 AI 生成的 10 字内短标题。
- 内容标签页固定为 `Content / Intel`；`Knowledge` 仅在卡型支持知识关系且存在有效 `generationId` 时显示。不恢复已删除的 `Train / Review` 能力。
- SRS 评分只在弹窗本身拥有的独立复习上下文显示；普通浏览和 `embed=1` 隐藏，Knowledge Hub 外层继续拥有评分动作。
- 评分可见文案统一为 `重来 / 困难 / 记住 / 简单`，底层值保持 `again / hard / good / easy`；外层保留 `kh-grade-*`，弹窗未来使用 `card-grade-*`。
- 日语注音只对对应汉字使用 `<ruby><rt>`，不显示整句假名行。
- 中文是母语解释文本，不生成或播放中文 TTS。
- 学习卡真源仍是 Markdown 文件；现代卡片 UI 是 Markdown 渲染后的结构化增强层，不能要求历史卡片一次性迁移到 JSON。
- 右侧信息栏只显示学习相关元数据；Markdown 兼容状态、renderer 版本和配色说明不进入用户界面。
- 标红缓存和远端 hydrate 不得绕过卡型 adapter；复用现有 `version` 字段将标红 DOM 契约升为 v2，并为 v1 提供标红锚点重放，不新增 schema 列。
- 窄屏下改为单列，弹窗支持焦点约束、Escape、关闭后焦点/滚动位置恢复与背景滚动锁定。

上述弹窗内部契约以 `Modern_Card_UI_Design.md` 为权威来源；本文只保留与全站 Shell、token、响应式和测试门禁相关的摘要。

---

## 7. 组件层

### 7.1 App Shell 前必须完成的最小原语

P3 App Shell 开始前先提供：

- `Button`：primary / secondary / ghost / danger，sm / md；
- `IconButton`：稳定尺寸、`aria-label`、tooltip；
- `Badge` / `StatusDot`；
- `Menu`：主题选择；
- `Tooltip`；
- `Drawer`：移动导航、遮罩、Escape、焦点管理；
- `FocusRing`：统一 `:focus-visible`。

### 7.2 页面逐步迁移的组件

- Input / Textarea / Select；
- Card / Metric / Table；
- Tabs / SegmentedControl；
- Modal / ConfirmDialog / Toast；
- Skeleton / EmptyState；
- AudioButton 和卡型 Pill。

组件只使用语义 token。数据图表和领域色通过明确的 data/card/language token 使用，不直接引用任意色值。

Modal 原语必须统一实现 `role="dialog"`、`aria-modal`、标题关联、初始焦点、焦点约束、Escape 关闭、关闭后焦点归还和背景滚动锁定。学习卡在共享 Modal 原语完成前改造时，也必须等价实现这组契约，不得留到后续阶段。

### 7.3 动效约束

- 仅对状态变化、抽屉、菜单和 Inspector 使用短动效。
- 禁止使用会改变布局尺寸的 hover 动画。
- `@media (prefers-reduced-motion: reduce)` 下关闭非必要动画和 smooth scroll。

---

## 8. 分阶段实施

每个阶段独立通过测试后再进入下一阶段，禁止把四个阶段合成一次大改。

| 阶段 | 范围 | 风险 | 完成门禁 |
|------|------|------|----------|
| **Gate 0 · 基线** | 新增真实截图测试；记录 4 页、弹窗和 embed 当前基线 | 低 | 现有测试全绿；截图可重复 |
| **P1 · 浅色设计系统** | 新建 `tokens.css`；迁移旧变量、CSS/静态 HTML/JS 生成 DOM 中的主题敏感颜色；处理 55 个 HTML 内联样式与 JS 模板内颜色样式；补语言/卡型/data/obs token；字体改为系统栈 | 中 | 仅出现已批准的 token/圆角差异；旧 token 引用为 0；场景卡配色测试保留 |
| **P2 · 主题与原语** | 暗色 token、主题控制器、防闪烁、最小组件、focus/reduced-motion | 中—高 | 明暗主题、刷新、跨页和键盘测试通过 |
| **P3 · App Shell** | 静态骨架、共享导航、学习/系统分组、移动抽屉、健康轮询收敛、首页资源深链接 | 高 | 四页导航、移动抽屉、健康状态、embed 全绿 |
| **P4 · 页面组件化** | Input/Card/Table/Tabs/Modal/Toast/Skeleton/EmptyState；Knowledge Hub P4 左栏精简 | 中 | 页面专题 E2E 与视觉矩阵全绿 |

依赖关系：`Gate 0 -> P1 -> P2 -> P3 -> P4`。暗色模式属于 P2；App Shell 依赖 P2 的最小组件，不再把组件层整体推迟到 Shell 之后。

---

## 9. 文件落点

### 9.1 新增

| 文件 | 职责 |
|------|------|
| `public/css/tokens.css` | 唯一 token 与主题重映射 |
| `public/css/components.css` | 跨页组件原语 |
| `public/css/app-shell.css` | 侧栏、topbar、内容区和响应式抽屉 |
| `public/js/modules/app-shell.js` | 导航、主题、健康状态和移动抽屉 |
| `public/js/modules/shell-health.js` | 单例健康状态、轮询和订阅接口 |
| `public/vendor/lucide.min.js` | 本地固定版本图标库 |
| `tests/unit/designTokens.test.js` | token 完整性、禁用旧 token、颜色字面量约束 |
| `tests/e2e/app-shell.spec.js` | 导航、主题、响应式和 embed |
| `tests/e2e/ui-visual-regression.spec.js` | 固定视口的真实截图回归 |

### 9.2 修改

- `public/index.html`、`dashboard.html`、`knowledge-ops.html`、`knowledge-hub.html`：统一 shell 骨架、脚本顺序和页面元数据。
- `public/styles.css`、`modern-card.css`、`css/dashboard.css`、`observability.css`：删除根 token 和主题敏感颜色字面量，消费共享 token。
- `public/js/modules/app.js`：支持 `?view=library`，消费共享 health 事件，迁移 JS 模板内的颜色/旧 token，保留队列、Markdown、标红与 embed 行为。
- `public/js/modules/dashboard.js`：消费共享 health 事件，迁移 JS 模板内的颜色样式，统一 SRS 评分可见文案，停止重复健康轮询。`?mode=review` 解析已存在，本轮只保留并回归验证。
- 现有 E2E：保留当前 `data-testid`，只在必要时补充 Shell test ID。

---

## 10. 测试与验收矩阵

### 10.1 视觉回归

使用 Playwright `toHaveScreenshot`，固定浏览器、字体环境、数据夹具和时间；关闭动画并遮罩动态时钟/轮询时间。

基础矩阵：

| 页面/状态 | 1440x1000 | 1024x768 | 390x844 | 浅色 | 深色 |
|-----------|-----------|----------|---------|------|------|
| 工作台 | 是 | 是 | 是 | 是 | 是 |
| Mission Control | 是 | 是 | 是 | 是 | 是 |
| Knowledge OPS | 是 | 是 | 是 | 是 | 是 |
| Knowledge Hub | 是 | 是 | 是 | 是 | 是 |

额外状态：

- 队列弹窗打开；
- 三语卡、语法卡和场景卡弹窗；
- 学习卡普通浏览、独立复习上下文、本地/远端标红 hydrate；
- Knowledge Hub Inspector；
- 移动导航抽屉；
- `?embed=1` 卡片；
- loading、empty、error、offline。

### 10.2 功能与可访问性

- 当前 `ui-quality-regression` 的无横向溢出检查继续覆盖所有页面。
- 主题 `system/light/dark` 切换即时生效，刷新和跨页面保持一致。
- 暗色系统偏好下首次加载无浅色闪烁。
- 侧栏 active 项对 query 状态正确：普通 Knowledge Hub 与 `mode=review` 分开。
- 移动抽屉支持键盘、Escape、遮罩关闭、焦点约束和焦点归还。
- 所有图标按钮有可访问名称；collapsed sidebar 有 tooltip。
- 普通文字对比度 >= 4.5:1；大文字和非文字控件符合 WCAG AA 对应要求。
- `prefers-reduced-motion` 下非必要动画停止。
- `?embed=1` 不渲染 Shell、不发 Shell 健康请求，卡片仍满高可播放。
- `?mode=review` 直接进入 Knowledge Hub 复习模式；该行为与已有 `knowledge-hub.spec.js` 保持一致，不是本轮待实现依赖。
- 学习卡只显示 `Content / Intel / Knowledge`，Knowledge 按卡型和 `generationId` 显示，不出现 `Train / Review`。
- 普通卡片浏览与 `embed=1` 不显示或提交 SRS 评分；Knowledge Hub 外层仅有一套 `kh-grade-*` 动作。
- 学习卡在 fresh Markdown、本地标红缓存和远端 hydrate 之后都保持 adapter 布局、音频绑定和选区能力。
- 学习卡弹窗支持初始焦点、焦点约束、Escape、关闭后焦点归还和背景滚动锁定；390px 下信息栏折叠为单列。
- DOMPurify 缺失时卡片渲染 fail closed，未净化 HTML 不进入 DOM。

### 10.3 静态门禁

- 除 `tokens.css` 外，CSS 不再定义 `:root`。
- HTML 的 `style` 属性为 0。
- JS 生成 DOM 也纳入门禁：允许设置动态尺寸/进度值，但禁止写入主题颜色或已废弃 token。
- `--sci-*`、`--neon-*`、`--glass-blur`、`--glow-shadow`、旧 `--font-display` 全部移除。
- 主题敏感颜色字面量只能存在于 `tokens.css`；测试、SVG 和数据可视化算法采用明确 allowlist。
- 不再加载 Google Fonts 或外部图标 CDN。

---

## 11. 最终验收清单

- [ ] 本文是全站 UI 横向基线，专题文档权威边界清楚。
- [ ] 导航以学习任务为主，Mission Control / Knowledge OPS 位于“系统”分组。
- [ ] 全站只有 `tokens.css` 定义根 token 和主题值。
- [ ] 爱马仕黄场景卡、语法卡、三语卡和语言色在明暗主题下均可辨识。
- [ ] HTML 内联样式为 0，主题敏感直接颜色完成迁移。
- [ ] 主题支持跟随系统、浅色、深色，无首屏闪烁并跨页面同步。
- [ ] App Shell 不移动业务 DOM，不破坏首页队列引用和现有 test ID。
- [ ] 健康状态只有一套轮询；队列业务不重复轮询。
- [ ] 桌面侧栏、平板图标栏和移动抽屉均可键盘操作。
- [ ] `?card=<id>&embed=1` 行为与当前一致。
- [ ] 学习卡 adapter 与标红缓存/hydrate 兼容，评分权不在普通浏览或 embed 中重复出现。
- [ ] 学习卡弹窗在桌面/移动端完成焦点、滚动、安全净化和音频回归。
- [ ] 普通文字和关键控件达到 WCAG AA。
- [ ] 明暗主题、多视口和关键弹层拥有真实截图基线。
- [ ] `npm run lint`、`npm test`、`npm run test:integration`、`npm run test:e2e` 全部通过。

---

## 12. 非目标与后续扩展

本轮不实现账户、多用户权限、云同步、全局搜索或新的前端框架。待基础设计系统稳定后，再评估：

- 全局命令面板；
- 可配置学习首页；
- 更完整的卡片库独立路由；
- PWA 和移动端离线体验；
- 用户级主题与无障碍偏好同步。
