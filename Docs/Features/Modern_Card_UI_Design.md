# 现代学习卡片 UI 设计方案

> 状态：**2026-07 修订基线（待开发）**
> 关联：[UI Modernization Design System](UI_Modernization_Design_System.md)
> 核心修订：学习卡仍以 Markdown 文件为真源；现代 UI 是 Markdown 渲染后的结构化增强层，不要求历史卡片一次性迁移到 JSON。

## 0. 2026-07 确认决策

本轮可视化评审确认学习卡片采用 **全高专注弹窗**，并纳入以下硬约束：

- `.md` 文件仍是学习卡真源；`.html` 和前端 DOM 是渲染产物或缓存。
- 前端继续走 `marked + DOMPurify`，在安全 HTML 之上做现代卡片结构增强。
- 不能为了新 UI 要求旧卡片全部迁移成结构化 JSON。
- 场景卡标题优先使用 AI 生成的 10 字以内短标题，避免原始场景描述撑爆卡片头部。
- 弹窗高度接近视口满高，顶部压缩，内容区拉满；SRS 评分仅在弹窗拥有复习上下文时固定于底部。
- 日语注音只对对应汉字使用 `<ruby><rt>`，不显示整句假名行。
- 中文是母语解释文本，不生成或播放中文 TTS；音频按钮只绑定英文和日语。
- 三类卡片视觉固定：三语卡蓝色，日语语法卡青绿色，场景表达卡爱马仕黄。

### 0.1 Markdown-first 渲染契约

现有链路已经具备需要复用的基础：

- `public/index.html` 加载 `public/vendor/marked.min.js` 和 `public/vendor/purify.min.js`。
- `public/js/modules/app.js` 的 `selectFile()` 读取 `${baseName}.md`，再调用 `renderCardModal(mdContent, ...)`。
- `renderMarkdownWithAudioButtons(markdown)` 使用 `marked.parse()` 渲染 Markdown，并把 `<audio src="...">` 替换为 `.audio-btn`。
- `services/generation/htmlRenderer.js` 的 `prepareMarkdownForCard()` 会先做日语 ruby 规范化，再注入音频标签。

新 UI 应该在这条链路上增加 adapter，而不是绕开它。需要以真实运行顺序为准：`renderMarkdownWithAudioButtons()` 会在净化前把 `<audio>` 替换为 `.audio-btn`，所以 adapter 的输入是已净化、已包含音频按钮的 HTML，不是原始 `<audio>` DOM：

```
.md 文件
  -> prepareMarkdownForCard()                  // 生成阶段：ruby + audio tags
  -> marked.parse()
  -> replaceAudioTagsWithButtons()
  -> DOMPurify                                 // 展示阶段：安全基础 HTML
  -> resolveHighlightHtml(highlightVersion)    // 选取或迁移本地/远端标红 HTML
  -> enhanceCardHtmlByType(cardType, safeHtml) // 按卡型做幂等的结构增强
  -> bindCardInteractions()
```

adapter 只做展示增强，不改变原始 Markdown。若结构化提取失败，回退到已净化 HTML 的普通 Markdown 阅读视图，保证历史卡片可打开。`DOMPurify` 是强制依赖；若未加载，必须转义为纯文本或显示加载错误，禁止把未净化 HTML 写入 DOM。

### 0.2 标红持久化与 adapter 生命周期

当前标红能力会保存 `#cardContent.innerHTML`，因此现代化不能只增强首次渲染的 HTML。实施时必须同时满足：

- fresh Markdown、本地标红缓存和远端标红恢复都经过同一个幂等 adapter。
- adapter 保留已有 `<mark class="study-highlight-red">`、`ruby/rt` 和 `.audio-btn`，不重复包装已增强节点。
- 复用现有标红 payload/数据表的 `version` 字段，把现代卡片 DOM 契约升为 v2，不新增 schema 列。v2 直接恢复已净化 DOM；v1 先从旧 DOM 提取标红文本、出现次序和上下文锚点，再在 fresh 基础 HTML 上重放标红并经过 adapter。迁移失败时保留旧记录且回退安全 Markdown 视图，不让旧 DOM 覆盖新布局。
- 远端 hydrate 替换内容后，重新执行 adapter、音频绑定、选区绑定和焦点修复；不得让异步 hydrate 把弹窗退回旧布局。
- 本阶段可继续保存 HTML；将标红改为语义 range 是后续数据升级，不是本轮前置条件。

### 0.3 场景卡 Markdown 约定

场景卡沿用当前 Markdown 结构：

```markdown
# 配镜验光

## 1. 场景说明
- **角色**: 顾客と店員
- **语气**: 丁寧
- **目标**: 重新验光并询问镜片方案

## 2. 常用表达
### 01. 看远处模糊
- **中文**: 我看远处的时候有点模糊。
- **英文**: Things look a little blurry when I look into the distance. <audio src="card_en_1.mp3"></audio>
- **日本語**: <ruby>遠<rt>とお</rt></ruby>くを<ruby>見<rt>み</rt></ruby>ると、<ruby>少<rt>すこ</rt></ruby>しぼやけます。 <audio src="card_ja_1.wav"></audio>
- **使用提示**: 描述视力问题时使用。
```

场景卡 adapter 按 `## 2. 常用表达` 和 `### NN.` 分组，识别 `中文 / 英文 / 日本語 / 使用提示` 四类字段，英文和日语行旁边显示音频按钮。中文行只作为解释文本。

### 0.4 日语 ruby 规则

日语注音只标注汉字对应读音：

```html
<ruby>遠<rt>とお</rt></ruby>くを<ruby>見<rt>み</rt></ruby>ると、<ruby>少<rt>すこ</rt></ruby>しぼやけます。
```

禁止在同一句下方再输出整句假名，例如：

```text
とおくをみると、すこしぼやけます。
```

原因：整句假名会增加阅读噪音、撑高卡片内容，并让学习者难以对应具体汉字。

### 0.5 弹窗布局与上下文

学习卡弹窗结构：

- Header：短标题、卡型 Pill、语言/音频元信息、删除和关闭图标。
- Tabs：`Content` 和 `Intel` 始终显示；`Knowledge` 仅对拥有有效 `generationId` 且支持知识关系的卡型显示。不新增已删除的 `Train` / `Review` Tab。
- Body：桌面端为主内容区 + 学习元信息栏。信息栏只显示用户可理解的内容，如场景对象、语气、目标、卡型、文件夹和生成时间；Markdown 兼容状态、渲染版本和配色规则属于 Intel / Knowledge OPS，不在学习界面展示。
- Footer：只承载 SRS 评分，不同时放生成元数据或尚无数据来源的自动标签。可见文案统一为 `重来 / 困难 / 记住 / 简单`，底层 grade 值保持 `again / hard / good / easy`。

SRS Footer 的所有权规则：

- 普通卡片库、文件夹和历史记录打开：隐藏，避免误点推进调度。
- `/?card=<id>&embed=1`：隐藏，评分由 Knowledge Hub 外层复习视图拥有。
- 仅在明确的独立复习上下文（例如 `reviewOwner="modal"`）显示，并且必须有有效 `generationId`。
- Knowledge Hub 继续保留 `data-testid="kh-grade-*"`；未来的弹窗评分使用 `data-testid="card-grade-*"`，不重用测试标识。

在 `/?card=<id>&embed=1` 中保持嵌入模式：不渲染 App Shell，卡片仍全高，外层由 Knowledge Hub 控制关闭。

### 0.6 响应式与无障碍契约

- `> 900px`：主内容与信息栏双列，信息栏宽度稳定，主内容独立滚动。
- `601px..900px`：改为单列，信息栏折叠到内容末尾，不维持狭双列。
- `<= 600px`：弹窗占满可用视口，Header 紧凑，Tabs 可水平滚动，Footer 考虑 `env(safe-area-inset-bottom)`，所有操作目标不小于 `44px`。
- `#modalOverlay` 保持 `role="dialog"` 和 `aria-modal="true"`，标题通过 `aria-labelledby` 关联。
- 打开时记录触发元素并把焦点移入弹窗；弹窗内限制 Tab 焦点；Escape 关闭；关闭后恢复焦点与列表滚动位置。
- 弹窗打开时锁定背景滚动。`embed=1` 中由外层 Knowledge Hub 管理关闭按钮与焦点归还。

## 1. 设计目标 (Design Goals)
*   **Markdown-first**: 保留历史卡片和当前生成链路，以 Markdown 为真源。
*   **现代学习美学**: 结合安静 SaaS 工作台和结构化学习阅读，不做重后台卡片。
*   **沉浸式体验**: 优化查看详情的转场动画与布局，使其更像是在阅读一张精心设计的知识卡片。
*   **可回退**: adapter 无法识别结构时，仍展示安全 Markdown HTML。

## 2. 视觉风格定义 (Visual Identity)

### 2.1 字体系统 (Typography)
学习卡消费全站字体 token，不再新增 Google Fonts：
*   **标题**: 使用 `--font-sans`，短标题控制在一行；长原始标题只作为元信息或 tooltip。
*   **正文**: 使用 `--font-sans`，日语句子使用 `--font-ja`。
*   **注音/技术元信息**: 使用 `--font-mono` 或继承 `--font-ja`；`rt` 字号必须小于正文且不影响行距稳定。
*   **长篇解释**: 如确有阅读性需要，可在卡片正文局部使用 `--font-serif`，但不得重新引入外部字体。

### 2.2 配色方案 (Color Palette)
卡片配色消费 `UI_Modernization_Design_System.md` 的语义 token：
*   **背景 / 文本 / 边框**: `--color-bg-surface`、`--color-text-*`、`--color-border`。
*   **三语卡**: `--color-card-trilingual-*`。
*   **日语语法卡**: `--color-card-grammar-*`。
*   **场景表达卡**: `--color-card-scenario-*`，也就是已确认的爱马仕黄体系。
*   **语言色**: `--color-lang-en`、`--color-lang-ja`、`--color-lang-zh` 仅用于语言标签或细节标记，不铺满大面积背景。

### 2.3 卡片形态 (Card Physics)
*   **弹窗圆角**: 使用 `--radius-modal`。
*   **内容区圆角**: 使用 `--radius-lg` 或更小，不使用过度圆润卡片。
*   **阴影**: 使用 `--shadow-modal`；卡内工具块使用 `--shadow-sm` 或无阴影。
*   **边框**: 使用 `--color-border`，关键聚焦态使用 `--color-focus`。

## 3. 界面布局设计 (Layout)

### 3.1 卡片库 / 工作台资源区
保持左侧导航，优化右侧文件列表：
*   **Grid View**: 将文件列表从纯文本链接改为**“微缩卡片”**。
    *   每个微缩卡片显示：短标题/短语、卡型和生成日期。标签只在后续存在明确数据来源时显示。
    *   Hover 效果：轻微上浮，阴影加深。

### 3.2 详情页 (Detail View - The "Card")
点击微缩卡片后，使用 **中心全高模态浮层 (Centered Full-height Modal)**，内容布局如下：

#### A. 头部 (Header)
*   **核心短语 (Hero Phrase)**: 左对齐，字号受容器限制；场景卡优先显示 10 字内短标题。
*   **音标/注音**: 日语只对汉字用 ruby 注音；不输出整句假名行。
*   **操作区**: 顶部右侧提供删除、关闭等图标按钮；音频播放放到内容行或音频工具区。

#### B. 内容区 (Content Body)
采用 **“块状结构”** 分隔不同语言的内容：

1.  **释义块 (Definition Block)**:
    *   图标/标签指示语言（如 "EN", "JP"）。
    *   释义文本高亮显示。

2.  **例句块 (Example Block)**:
    *   **句子**: 左侧竖线引用样式。
    *   **交互式音频**: 每句例句旁有一个圆形的 `▶` 按钮。点击变色并播放。
    *   **注音 (Ruby)**: 日文例句默认显示 Ruby，可点击开关隐藏。

#### C. 信息栏与底部 (Metadata Rail / Footer)
*   **信息栏**: 展示真实存在的学习元数据；模型、质量和生成调试信息放在 Intel。
*   **底部**: 仅在弹窗拥有复习评分权时显示 SRS 动作；其它上下文不渲染空 Footer。
*   **标签边界**: 当前 `generations` 无卡片级自动语义标签字段，本轮不伪造 `#Business / #Casual` 等标签。后续如展示标签，必须先定义来源（例如 Knowledge 聚类）和刷新规则。

## 4. 技术实现路径 (Implementation Path)

### 4.1 数据源策略
*   **现状**: 前端读取 `.md`，生成阶段同时保存 `.html` 文件；数据库 `generations` 保存 `markdown_content`、`md_file_path` 和 `html_file_path`，不保存 `html_content` 列。
*   **新方案**: 保持 Markdown-first。新增前端 adapter，把安全 HTML 中的标题、段落、列表、`ruby`、`.audio-btn` 和场景卡字段映射到现代卡片组件。
*   **不做**: 不把结构化 JSON 作为本阶段前置条件。后续可以增加 JSON 副本作为优化，但不能阻塞历史卡片展示。

### 4.2 前端重构
*   复用现有 `marked` 和 `DOMPurify`，不新增 Markdown 解析库。
*   使用原生 JS adapter 和 Template Literals；本阶段不引入 Alpine、Preact 或 SPA 框架。
*   `enhanceCardHtmlByType(cardType, html, { highlightVersion })` 必须是幂等的，并按卡型输出现代卡片 DOM：
    *   `scenario_phrase`: 解析 `## 2. 常用表达` 和 `### NN.` 表达组。
    *   `grammar_ja`: 保留规则、接续、例句、辨析等 Markdown 小节。
    *   `trilingual`: 保留英文、日语、中文小节和例句。
*   音频播放复用现有 `bindAudioButtons()` 和 `audio-player.js`。
*   highlight / selection / Intel / Knowledge 现有能力必须继续挂载在 `#cardContent` 或等价作用域内；本地缓存与远端 hydrate 都要经过 adapter 和交互重绑定。
*   `sanitizeHtml()` 在 DOMPurify 不可用时必须 fail closed，不得原样返回 HTML。
*   标红缓存增加 renderer 版本并覆盖旧缓存、异步 hydrate 和已增强 DOM 的回归测试。

## 5. 交互流程 (User Flow)
1.  用户点击列表中的 "配镜验光" 或任意卡片。
2.  界面变暗，中央显示全高学习卡弹窗。
3.  卡片加载时显示骨架屏 (Skeleton)。
4.  前端请求 `.md` 文件内容。
5.  解析 Markdown 为安全 HTML，再由 adapter 增强为现代卡片 DOM。
6.  用户点击英文或日语句子旁的播放按钮，按钮进入播放态。
7.  若是独立复习上下文，用户可评分；普通浏览和 `embed=1` 不显示评分。
8.  用户关闭弹窗，焦点和滚动位置回到原列表。

## 6. 后续扩展
*   **Anki 导出**: 既然有了结构化展示，可以轻松添加“导出为 Anki 卡片”功能。
*   **结构化 JSON 副本**: 可作为后续性能优化，但不作为新 UI 前置条件。

## 7. 实施验收

- 三语卡、日语语法卡、场景卡均覆盖 fresh Markdown、历史 Markdown 和 adapter fallback。
- 音频按钮在首次渲染、本地标红缓存、远端 hydrate 之后都能播放，不生成中文音频。
- 旧标红 HTML 不能覆盖新布局；标红内容在 renderer 版本升级后不丢失或重复。
- 普通浏览和 `embed=1` 不能调用 `POST /api/srs/review`；只有弹窗拥有的复习上下文可提交评分。
- Tabs 只有 `Content / Intel / Knowledge`，其中 Knowledge 按卡型和 `generationId` 条件渲染；不出现 `Train / Review`。
- 1440x1000、1024x768、390x844 下无横向溢出，双列在窄屏正确折叠，底部动作不遮挡内容。
- 键盘可完成打开、Tab 切换、音频播放、评分和关闭；焦点不逃出弹窗，关闭后回到触发元素。
- DOMPurify 未加载时显示安全错误/纯文本，不执行卡片中的 HTML。
