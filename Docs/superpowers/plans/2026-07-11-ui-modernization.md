# Three LANS UI 现代化实施计划

> 状态：**实施与验收已完成**
> 日期：2026-07-11
> 执行方式：按本文勾选任务，每个任务独立验证和提交，禁止跳过阶段门禁。

## 1. 目标与权威边界

**目标**：将现有四个静态 HTML 主页统一成“A · 安静学习工作台”，落地全站 token、明暗主题、App Shell、响应式和现代学习卡弹窗，同时保持生成、音频、SRS、Knowledge Hub、标红和 embed 现有行为。

**权威顺序**：

1. `Docs/Features/UI_Modernization_Design_System.md`：全站信息架构、token、Shell、主题、响应式和测试门禁。
2. `Docs/Features/Modern_Card_UI_Design.md`：Markdown-first 学习卡、adapter、标红、音频、Tabs、SRS Footer 和 Modal 内部契约。
3. `Docs/Features/Knowledge_Hub_UI_Redesign.md`：Knowledge Hub 内部浏览、复习、计划和 Inspector。
4. `Docs/Features/Engagement_and_Retention_System.md`：“今日学习”、SRS 统计和复习数据语义。

冲突时按上述文档职责裁决，不允许实施计划反向改写设计结论。

## 2. 不可破坏的行为

- `.md` 文件仍是学习卡真源，不要求历史卡片迁移为 JSON。
- `renderMarkdownWithAudioButtons()` 的 `marked -> audio button -> DOMPurify` 顺序必须保留。**当前 DOMPurify 缺失时是 fail-open，这是已知安全缺口；Task 19 必须将其改为 fail-closed。**
- 音频只支持英文和日文，不生成中文 TTS。
- 日语只对汉字使用 `<ruby><rt>` 注音，不恢复整句假名行。
- 学习卡 Tabs 只有 `Content / Intel / Knowledge`，Knowledge 按卡型和 `generationId` 条件显示，不恢复已删除的 Train / Review 子系统。
- 普通浏览和 `embed=1` 不提交 SRS 评分；Knowledge Hub 外层仍拥有 `kh-grade-*` 动作。
- `/?card=<id>&embed=1` 不渲染 Shell、不启动首页健康/队列轮询，卡片仍可播放和关闭。
- `/knowledge-hub.html?mode=review` 直接进入复习已实现，只做回归，不重写路由语义。
- 首页队列 DOM 在 `app.js` 加载前保持存在，队列弹窗仍由点击顶部队列栏打开。
- 现有业务 ID 和 `data-testid` 原则上保留，只为 Shell/新组件增加标识。
- 不修改生成 API、DeepSeek、OCR、TTS、SRS 算法、Knowledge 聚合算法和数据库业务 schema。

## 3. 技术路线

```text
Gate 0 可重复基线
  -> P1 浅色 token 与旧样式迁移
  -> P2 主题控制器与组件原语
  -> P3 App Shell 与健康轮询收敛
  -> P4 页面与学习卡现代化
  -> 全容器重建 + 真实运行验收
```

| 阶段 | 任务 | 退出条件 |
|------|------|----------|
| Gate 0 | 1-3 | 可重复的截图、功能和溢出基线 |
| P1 | 4-8 | 唯一 `:root`、旧 token 为 0、浅色基线通过 |
| P2 | 9-12 | system/light/dark、原语、键盘与 reduced-motion 通过 |
| P3 | 13-17 | 四页 Shell、查询状态、抽屉、health 单例和 embed 通过 |
| P4 | 18-24 | 四页及三类卡片完成目标 UI 与全部行为回归 |
| Final | 25 | `three_lans_system` 全容器与 3010 真实环境验收通过 |

## 4. 执行约定

- 开始每个任务前执行 `git status --short`，不覆盖或夹带与 UI 无关的 TTS、Compose 或用户未提交改动。
- 每个任务先写失败测试或固定基线，再改实现，最后运行定向测试。
- 阶段内只更新与已批准视觉变化相关的截图，不批量接受未知差异。
- 动态宽度、进度和图表数值可由 JS 设置；主题颜色必须通过 class 和语义 token 表达。
- 提交时显式列文件，不使用 `git add -A`。
- 阶段门禁失败时停在当前阶段，不进入下一阶段。

---

## Gate 0：可重复基线

### Task 1：建立视觉回归骨架

**文件**：

- Create: `tests/e2e/ui-visual-regression.spec.js`
- Modify: `playwright.config.js`
- Reuse: `tests/e2e/fixtures/resetServerState.js`

- [x] 使用 E2E 隔离服务（端口 3310）和 `seed-knowledge` 固定数据。
- [x] 为工作台、Mission Control、Knowledge OPS、Knowledge Hub 建立 1440x1000、1024x768、390x844 截图用例。
- [x] 遮罩时钟、运行时长、轮询时间和其他动态文字，禁用非必要动画。
- [x] 在 visual spec 中阻断 `fonts.googleapis.com` / `fonts.gstatic.com` 请求，并等待 `document.fonts.ready`，使 Gate 0 从首次截图起就使用封闭、可重复的系统字体。
- [x] 截图存入 Playwright 默认 snapshot 目录并纳入版本管理。
- [x] 运行 `npx playwright test tests/e2e/ui-visual-regression.spec.js --update-snapshots`。
- [x] 再运行一次不带 `--update-snapshots`，确认截图可重复。

**建议提交**：`test: add deterministic UI visual baselines`

### Task 2：扩展现有 UI 质量基线

**文件**：

- Modify: `tests/e2e/ui-quality-regression.spec.js`
- Modify: `tests/e2e/pages.spec.js`

- [x] 保留四页多视口无横向溢出检查。
- [x] 将三语卡、语法卡、场景卡弹窗都纳入全高/无溢出基线。
- [x] 增加队列弹窗中置、点击外部关闭、Escape 关闭和焦点恢复基线。
- [x] 增加 `/?card=<id>&embed=1` 仅显示卡片、无首页轮询和可播放音频基线。
- [x] 运行 `npx playwright test tests/e2e/ui-quality-regression.spec.js tests/e2e/pages.spec.js`。

**建议提交**：`test: expand UI behavior baselines`

### Task 3：建立设计系统静态审计

**文件**：

- Create: `tests/unit/designTokens.test.js`

- [x] 记录当前 `:root`、HTML `style` 属性、JS 模板 `style` 和旧 token 引用的基线数量。
- [x] 定义最终门禁：仅 `tokens.css` 可定义 `:root`；HTML 内联样式为 0；JS 不写主题颜色；旧 `--sci-* / --neon-* / --font-display` 为 0。
- [x] 对动态进度、图表算法、SVG 和测试数据建立小型 allowlist，禁止整文件豁免。
- [x] 测试先以 inventory 模式输出当前值，Task 8 再切换为强制模式。
- [x] 运行 `node --test tests/unit/designTokens.test.js`。

**建议提交**：`test: inventory legacy UI styling`

---

## P1：浅色设计系统

### Task 4：建立唯一 token 源与过渡别名

**文件**：

- Create: `public/css/tokens.css`
- Modify: `public/index.html`
- Modify: `public/dashboard.html`
- Modify: `public/knowledge-ops.html`
- Modify: `public/knowledge-hub.html`
- Modify: `tests/unit/designTokens.test.js`

- [x] 按设计基线定义背景、文字、边框、状态、语言、卡型、间距、圆角、阴影、字体和动效 token。
- [x] 暂时在 `tokens.css` 定义旧 token 别名，使迁移可分任务进行；别名必须在 Task 8 删除。
- [x] 四页按 `tokens.css -> components.css(尚未存在时不加载) -> app-shell.css(同上) -> 页面 CSS` 排序。
- [x] 保留 `marked.min.js` / `purify.min.js` / D3 在对应业务模块之前加载。
- [x] 运行 `node --test tests/unit/designTokens.test.js`和四页 smoke。

**建议提交**：`feat: add shared UI tokens`

### Task 5：迁移首页与学习卡浅色样式

**文件**：

- Modify: `public/styles.css`
- Modify: `public/modern-card.css`
- Modify: `public/index.html`
- Modify: `tests/unit/scenarioPalette.test.js`
- Modify: `tests/unit/designTokens.test.js`

- [x] 删除两个 CSS 中的 `:root`，把变量和主题敏感色迁移到语义 token。
- [x] 按圆角映射保持旧 6/8/12px 语义，只对已批准卡片收紧。
- [x] 保持三语蓝、语法青绿、场景爱马仕黄的明确识别。
- [x] 把 Space Grotesk、Noto Serif 和 JetBrains Mono 网络字体迁移为系统字体 token，保持日语字体栈。
- [x] 删除首页 Google Fonts 请求。
- [x] 运行 `node --test tests/unit/scenarioPalette.test.js tests/unit/designTokens.test.js`。
- [x] 运行首页与三类卡片的浅色截图对比。

**建议提交**：`refactor: migrate workspace and cards to shared tokens`

### Task 6：迁移 Dashboard 与 Observability 浅色样式

**文件**：

- Modify: `public/css/dashboard.css`
- Modify: `public/observability.css`
- Modify: `public/dashboard.html`
- Modify: `public/knowledge-ops.html`
- Modify: `public/knowledge-hub.html`
- Modify: `tests/unit/designTokens.test.js`

- [x] 删除 `dashboard.css` 的独立 `:root`，将 `observability.css` 的直接深色颜色与上下文例外收敛为 `--color-obs-*`。
- [x] 迁移 Mission Control、Knowledge OPS、Knowledge Hub 的文字、边框、面板、表格、状态和图表颜色。
- [x] 删除三页 Google Fonts 请求。
- [x] 观测面板可保留高信息密度，但不恢复全页 sci/neon 皮肤。
- [x] 运行 `node --test tests/unit/designTokens.test.js`和三页浅色截图对比。

**建议提交**：`refactor: migrate system pages to shared tokens`

### Task 7：清理静态内联样式与 JS 颜色模板

**文件**：

- Modify: `public/*.html`
- Modify: `public/js/modules/app.js`
- Modify: `public/js/modules/dashboard.js`
- Modify: `public/styles.css`
- Modify: `public/modern-card.css`
- Modify: `public/css/dashboard.css`
- Modify: `tests/unit/designTokens.test.js`

- [x] 将 HTML 内联布局样式改为有语义的 class，目标 `style` 属性为 0。
- [x] 将 `app.js` / `dashboard.js` 模板中的静态布局和颜色改为 class。
- [x] 将 rank、进度、图表等动态值改为 `data-*` 状态或 CSS 自定义属性，不在 JS 中选择主题颜色。
- [x] 本任务不处理图标换代，避免 P1 出现 emoji 半迁移状态；所有存量操作图标统一在 Task 10 处理。
- [x] 运行 `node --test tests/unit/designTokens.test.js`。
- [x] 运行 `npx playwright test tests/e2e/ui-quality-regression.spec.js`。

**建议提交**：`refactor: remove inline theme styling`

### Task 8：通过 P1 浅色门禁

**文件**：

- Modify: `public/css/tokens.css`
- Modify: `tests/unit/designTokens.test.js`
- Update: `tests/e2e/ui-visual-regression.spec.js-snapshots/*`

- [x] 删除 Task 4 的所有旧 token 过渡别名。
- [x] 将 `designTokens.test.js` 切到强制模式：唯一 `:root`、旧 token 为 0、HTML 内联样式为 0、JS 主题颜色为 0。
- [x] 对每个视觉差异分类为“已批准 token/圆角变化”或“回归”，只更新前者。
- [x] 运行 `npm run lint`、`npm test`、`npm run test:integration`。
- [x] 运行 `npx playwright test tests/e2e/ui-quality-regression.spec.js tests/e2e/ui-visual-regression.spec.js`。
- [x] 门禁通过后才进入 P2。

**建议提交**：`feat: complete light design system migration`

---

## P2：主题与组件原语

### Task 9：实现无闪烁主题状态

**文件**：

- Modify: `public/css/tokens.css`
- Modify: `public/index.html`
- Modify: `public/dashboard.html`
- Modify: `public/knowledge-ops.html`
- Modify: `public/knowledge-hub.html`
- Create or Modify: `public/js/modules/app-shell.js`
- Create: `tests/e2e/app-shell.spec.js`

- [x] 在每页 CSS 前添加最小主题预初始化脚本，写入 `data-theme-preference` 和解析后 `data-theme`。
- [x] 实现 `three-lans-theme-v1`，只接受 `system / light / dark`。
- [x] 仅在偏好为 `system` 时监听 `prefers-color-scheme`，并通过 `storage` 事件同步跨页/跨标签页状态。
- [x] 增加跟随系统、浅色、深色三项菜单的功能测试。
- [x] 用 `page.emulateMedia({ colorScheme: 'dark' })` 验证首屏无浅色闪烁。

**建议提交**：`feat: add persistent theme controller`

### Task 10：建立最小组件原语与 Lucide

**文件**：

- Create: `public/css/components.css`
- Add: `public/vendor/lucide.min.js`
- Add: `public/vendor/lucide.LICENSE.txt`
- Modify: `public/js/modules/app-shell.js`
- Modify: `tests/unit/designTokens.test.js`
- Modify: `tests/e2e/app-shell.spec.js`

- [x] 固定 Lucide 版本并随仓库提供，记录版本与许可，不从 CDN 加载。
- [x] 实现 Button、IconButton、Badge、StatusDot、Menu、Tooltip、Drawer 和 FocusRing。
- [x] 图标按钮统一稳定尺寸、`aria-label`、hover/focus/disabled 状态。
- [x] 关闭、删除、播放、刷新、菜单、主题和导航不再使用 emoji 作为操作图标。
- [x] 增加键盘焦点、tooltip 和菜单键盘测试。

**建议提交**：`feat: add shared UI primitives and icons`

### Task 11：完成暗色 token 和页面迁移

**文件**：

- Modify: `public/css/tokens.css`
- Modify: `public/css/components.css`
- Modify: `public/styles.css`
- Modify: `public/modern-card.css`
- Modify: `public/css/dashboard.css`
- Modify: `public/observability.css`
- Modify: `tests/e2e/ui-visual-regression.spec.js`

- [x] 仅在 `:root[data-theme="dark"]` 重映射语义 token，不复制组件选择器。
- [x] 为三种卡型、三种语言、状态、图表和 Observability 建立暗色值。
- [x] 验证普通文字、图标、焦点环、边框和卡型色的 WCAG AA 对比度。
- [x] 增加四页、三类卡片、队列弹窗和 Inspector 暗色截图。
- [x] 不使用暗蓝/紫色单一色调铺满整页，保留卡型和语言的跨色识别。

**建议提交**：`feat: add complete dark theme`

### Task 12：通过 P2 主题与无障碍门禁

- [x] 为 `prefers-reduced-motion` 关闭非必要动画和 smooth scroll。
- [x] 检查图标按钮可访问名称、键盘菜单和焦点可见性。
- [x] 运行 `npm run lint`、`npm test`、`npm run test:integration`。
- [x] 运行 `npx playwright test tests/e2e/app-shell.spec.js tests/e2e/ui-quality-regression.spec.js tests/e2e/ui-visual-regression.spec.js`。
- [x] 使用 light/dark/system 与三个视口审核所有截图，通过后进入 P3。

**建议提交**：`test: enforce theme and accessibility gates`

---

## P3：App Shell 与共享状态

### Task 13：为四页建立静态 Shell 骨架

**文件**：

- Create: `public/css/app-shell.css`
- Modify: `public/index.html`
- Modify: `public/dashboard.html`
- Modify: `public/knowledge-ops.html`
- Modify: `public/knowledge-hub.html`
- Modify: `tests/e2e/app-shell.spec.js`

- [x] 四页添加一致的 `.app-shell / #appSidebarMount / .app-main / .app-topbar / .app-content` 静态骨架。
- [x] 为 body 添加 `data-page` 和 `data-page-title`。
- [x] 首页队列 DOM 保留在静态 `[data-shell-actions]` 中，不运行时搬移。
- [x] 不创建页面级浮动大卡片，主内容保持无外框布局。
- [x] 先使用空侧栏挂载点确认现有业务测试不因 DOM 层级改变失败。

**建议提交**：`refactor: add static app shell skeletons`

### Task 14：实现共享导航与查询状态

**文件**：

- Modify: `public/js/modules/app-shell.js`
- Modify: `public/js/modules/app.js`
- Modify: `tests/e2e/app-shell.spec.js`
- Modify: `tests/e2e/knowledge-hub.spec.js`

- [x] 注入 Three LANS 品牌、LANS Rail、“学习”和“系统”两组导航。
- [x] 实现 `/?view=library` 资源区深链，保留文件夹/历史记录状态。
- [x] active 判定顺序：`view=library` 优先于工作台，`mode=review` 优先于普通 Knowledge Hub。
- [x] 回归 `/knowledge-hub.html?mode=review` 已有行为，不在 Shell 中复制复习状态机。
- [x] 为所有导航项增加 `aria-current="page"`、图标和文字名称。

**建议提交**：`feat: add learning-first shell navigation`

### Task 15：实现平板图标栏和移动抽屉

**文件**：

- Modify: `public/css/app-shell.css`
- Modify: `public/js/modules/app-shell.js`
- Modify: `tests/e2e/app-shell.spec.js`

- [x] `>1024px` 使用 232px 完整侧栏。
- [x] `769px..1024px` 使用 64px 图标栏，tooltip 和可访问名称保留。
- [x] `<=768px` 使用遮罩抽屉，支持菜单按钮、遮罩、Escape、焦点约束和焦点归还。
- [x] 抽屉开启时锁定背景滚动，不与页面 Modal 的滚动锁冲突。
- [x] 在 1024x768 和 390x844 执行键盘与无溢出测试。

**建议提交**：`feat: add responsive shell navigation`

### Task 16：收敛健康状态为单例

**文件**：

- Create: `public/js/modules/shell-health.js`
- Modify: `public/js/modules/app-shell.js`
- Modify: `public/js/modules/app.js`
- Modify: `public/js/modules/dashboard.js`
- Modify: `tests/e2e/app-shell.spec.js`

- [x] 实现 `startHealthMonitor()`、`getHealthSnapshot()` 和 `subscribeHealth(listener)`。
- [x] snapshot 固定为 `{ state, label, services, updatedAt }`，订阅时立即回放当前值。
- [x] 单例拥有首次请求、30 秒轮询和页面恢复可见刷新。
- [x] 删除 `app.js` 和 `dashboard.js` 重复 `/api/health` 轮询，但保留它们对生成按钮和系统面板的业务渲染。
- [x] 不收编生成队列轮询，队列仍归首页和 Mission Control 各自模块。
- [x] 验证 `embed=1` 不导入/启动 health monitor。

**建议提交**：`refactor: centralize shell health monitoring`

### Task 17：通过 P3 Shell 门禁

- [x] 四页导航和 active 查询状态全部通过。
- [x] 桌面侧栏、平板图标栏、移动抽屉的键盘和截图通过。
- [x] `/api/health` 在单页中只有一个周期性请求所有者。
- [x] 队列栏、队列弹窗、今日学习和生成按钮状态不回归。
- [x] `embed=1` 无 Shell、无 health 轮询、卡片可播放。
- [x] 运行 `npm run lint && npm test && npm run test:integration && npm run test:e2e`。
- [x] 通过后才进入 P4。

**建议提交**：`feat: complete shared app shell`

---

## P4：页面与学习卡现代化

### Task 18：落地工作台首页和卡片库资源区

**文件**：

- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `public/js/modules/app.js`
- Modify: `tests/e2e/frontend-regression.spec.js`
- Modify: `tests/e2e/engagement-retention.spec.js`

- [x] 按确认视觉落地“今日学习”、“创建学习卡”、今日复习和最近卡片布局。
- [x] 复用已有 engagement API 和 `mode=review` 入口，不改统计口径。
- [x] 三种卡型控件使用明确图标、卡型色和简短标签，场景卡保留 10 字标题约束。
- [x] 卡片库微缩卡只展示短标题/短语、卡型和生成日期，不伪造无数据源的标签。
- [x] `?view=library` 聚焦资源区且保留文件夹/历史状态。
- [x] 运行首页生成、OCR、队列、今日学习和卡片库 E2E。

**建议提交**：`feat: modernize learning workspace`

### Task 19：拆分安全的卡型 adapter

**文件**：

- Create: `public/js/modules/card-renderer.js`
- Modify: `public/js/modules/app.js`
- Create: `tests/e2e/card-modernization.spec.js`
- Modify: `tests/e2e/frontend-regression.spec.js`

- [x] 保留 `marked.parse -> <audio> 替换为 .audio-btn -> DOMPurify` 的真实顺序。
- [x] `sanitizeHtml()` 在 DOMPurify 缺失时返回安全错误/纯文本，不返回原 HTML。
- [x] 实现幂等 `enhanceCardHtmlByType()`，输入是已净化、已包含 `.audio-btn` 的 HTML。
- [x] 实现 `scenario_phrase`、`grammar_ja`、`trilingual` 三个 adapter，无法识别时回退安全 Markdown 视图。
- [x] 保留 `ruby/rt`、`.audio-btn`、`mark.study-highlight-red` 和 `#cardContent` 作用域。
- [x] 测试现有卡片、结构偏差的历史 Markdown、恶意 HTML 和 DOMPurify 缺失场景。

**建议提交**：`feat: add safe markdown card adapters`

### Task 20：升级标红 DOM 契约为 v2

**文件**：

- Modify: `public/js/modules/app.js`
- Modify: `public/js/modules/card-renderer.js`
- Modify: `tests/e2e/card-modernization.spec.js`
- Modify: `tests/integration/files.test.js`

- [x] 复用现有 `card_highlights.version` 字段，不新增数据库列。
- [x] v2 持久化已净化且符合新 adapter 契约的 DOM。
- [x] v1 读取时从旧 DOM 提取标红文本、出现次序和上下文锚点，在 fresh HTML 上重放并升级为 v2。
- [x] 迁移失败时保留旧记录，展示安全 Markdown 视图，不让旧 DOM 覆盖新布局。
- [x] fresh HTML、本地缓存和远端 hydrate 都执行 adapter、音频绑定、选区绑定和焦点修复。
- [x] 测试异步 hydrate 不会把新布局替换回旧 HTML，标红和音频均保留。

**建议提交**：`feat: migrate card highlights to renderer v2`

### Task 21：落地全高学习卡 Modal

**文件**：

- Modify: `public/index.html`
- Modify: `public/modern-card.css`
- Modify: `public/js/modules/app.js`
- Modify: `public/js/modules/card-renderer.js`
- Modify: `public/js/modules/dashboard.js`
- Modify: `tests/e2e/card-modernization.spec.js`
- Modify: `tests/e2e/knowledge-hub.spec.js`

- [x] Header 只保留短标题、卡型、学习元信息和删除/关闭图标。
- [x] Tabs 固定为 Content / Intel，Knowledge 按卡型和 `generationId` 条件显示。
- [x] 桌面端使用主内容 + 学习元信息栏；<=900px 改为单列；<=600px 满可用视口且适配 safe-area。
- [x] 信息栏不显示 Markdown 兼容状态、renderer 版本、配色说明或伪造标签。
- [x] 普通浏览和 `embed=1` 隐藏 SRS Footer；仅 `reviewOwner="modal"` 且有效 `generationId` 时显示 `card-grade-*`。
- [x] Knowledge Hub 外层评分文案统一为“重来/困难/记住/简单”，保留底层 `again/hard/good/easy` 和 `kh-grade-*`。
- [x] Modal 实现 `aria-labelledby`、初始焦点、焦点约束、Escape、背景滚动锁定、关闭后焦点/滚动恢复。
- [x] 运行三卡型、多视口、embed、SRS 所有权和键盘 E2E。

**建议提交**：`feat: modernize full-height study card modal`

### Task 22：落地 Knowledge Hub 现代化与 P4 左栏精简

**文件**：

- Modify: `public/knowledge-hub.html`
- Modify: `public/css/dashboard.css`
- Modify: `public/js/modules/dashboard.js`
- Modify: `tests/e2e/knowledge-hub.spec.js`
- Modify: `tests/e2e/ui-visual-regression.spec.js`

- [x] 按 `Knowledge_Hub_UI_Redesign.md` §0 落地“语义空间/分类树 + 词条与卡片主列表 + 上下文面板”三个职责区；不把语义分类称为文件夹。
- [x] 完成 P4 左栏精简，不生成第二套全站导航。
- [x] 保留 browse / insight / review / plan 状态机和 `mode=review` 直达。
- [x] browse 模式右侧显示当前卡片预览，列表加载后选中首张可用卡；预览提供打开 embed 学习卡与查看关系入口。
- [x] browse 的“查看关系”和 insight 模式在同一右侧上下文面板中复用 Relation Inspector；保留 `#khInspector`、`.has-inspector`、`setKhInspectorOpen()` 和已有 test ID。
- [x] review / plan 收起右栏并让主舞台扩展；<=1100px 右栏改为抽屉，<=760px 左侧导航抽屉和右侧上下文抽屉不同时打开。
- [x] 复习视图只保留一套评分 UI，打开嵌入卡不增加第二 Footer。
- [x] 扩展 `knowledge-hub.spec.js`，覆盖 browse 预览、预览↔Inspector 切换、insight Inspector、review/plan 无右栏和移动抽屉。
- [x] 运行 `npx playwright test tests/e2e/knowledge-hub.spec.js tests/e2e/engagement-retention.spec.js`。

**建议提交**：`feat: modernize knowledge hub workspace`

### Task 23：落地 Mission Control 与 Knowledge OPS

**文件**：

- Modify: `public/dashboard.html`
- Modify: `public/knowledge-ops.html`
- Modify: `public/css/dashboard.css`
- Modify: `public/observability.css`
- Modify: `public/js/modules/dashboard.js`
- Modify: `tests/e2e/pages.spec.js`
- Modify: `tests/e2e/ui-visual-regression.spec.js`

- [x] Mission Control 聚焦健康摘要、服务健康、最近任务、事件时间线和队列容量。
- [x] 清楚展示运行边界：DeepSeek v4 pro、VOICEVOX，Gemini 链路与 SBV2 已封存。
- [x] Knowledge OPS 聚焦输入规范化、内容生成、音频合成、质量检查和补齐操作。
- [x] 将系统健康和卡片资产生产的信息边界分开，但消费同一组控件与 token。
- [x] 高密度表格支持 1024px 和 390px 降级，不用嵌套卡片包装整个页面。
- [x] 运行 `npx playwright test tests/e2e/pages.spec.js tests/e2e/ui-quality-regression.spec.js`。

**建议提交**：`feat: modernize system workspaces`

### Task 24：通过 P4 全功能与视觉门禁

- [x] 运行 `npm run lint`。
- [x] 运行 `npm test`。
- [x] 运行 `npm run test:integration`。
- [x] 运行 `npm run test:e2e`。
- [x] 逐张审查 light/dark × 1440/1024/390 截图和所有额外状态，只更新已确认差异。
- [x] 检查 console error/warning、请求失败、横向溢出、文字裁切、焦点丢失和重复评分 UI。
- [x] 验证三类卡片的 ruby、英/日音频、Markdown fallback、标红 v1/v2、Intel 和条件 Knowledge。
- [x] 形成一份新的 UI 全量回归报告，记录测试命令、截图、已知限制和结论。

**建议提交**：`test: complete UI modernization acceptance`

---

## Final：全容器与真实运行验收

### Task 25：重建 `three_lans_system` 并执行 3010 冒烟

**不改动数据卷，禁止使用 `down -v`。**

- [x] 执行 `docker compose config --quiet`。
- [x] 执行 `docker compose down --remove-orphans`。
- [x] 执行 `docker compose up -d --build`。
- [x] 执行 `docker compose ps`，确认 viewer、ocr、tts-en、tts-ja 处于预期状态。
- [x] 执行 `curl -fsS http://127.0.0.1:3010/api/health`。
- [x] 在 `http://127.0.0.1:3010` 依次验证工作台、今日复习、卡片库、Knowledge Hub、Mission Control 和 Knowledge OPS。
- [x] 用历史数据打开三类卡片，验证标题、ruby、音频、标红、Tabs、embed 和关闭恢复。
- [x] 生成一张三语卡、一张语法卡和一张场景卡，确认 DeepSeek + TTS + 保存 + 卡片库链路。
- [x] 检查 `docker compose logs --tail=200 viewer ocr tts-en tts-ja` 无新增未处理错误。
- [x] 将真实运行结果追加到 UI 全量回归报告。

**建议提交**：`chore: validate rebuilt three lans system`

## 5. 最终完成定义

- [x] 四个页面共享唯一 token 源、App Shell、主题控制器和组件原语。
- [x] 设计实现与“A · 安静学习工作台”已确认视觉一致。
- [x] 三类学习卡在新旧 Markdown、标红缓存、embed 和多视口下行为一致。
- [x] 无条件显示的 SRS Footer、Train/Review Tab、中文 TTS、内部配色说明和伪造语义标签均未进入产品 UI。
- [x] 明暗主题、三视口、键盘、reduced-motion、WCAG AA 和无溢出通过。
- [x] lint、unit、integration、E2E、visual regression 和 3010 真实环境验收全部通过。
- [x] `three_lans_system` 容器组可重建、可访问，无未处理新增错误。

## 6. 回滚策略

- token 迁移失败：在当前 P1 任务中修复别名/映射，不回退已通过的 Gate 0 基线。
- 主题失败：保留浅色语义 token，暂停暗色入口，不继续 Shell。
- Shell 失败：保留设计 token 和组件原语，撤回当前 Shell 静态骨架提交，不修改业务 DOM ID。
- 卡片 adapter 失败：回退到已净化 Markdown HTML，标红旧记录保留不删除。
- 标红 v1 迁移失败：不覆盖 v1 记录，记录可观测警告并使用安全基础视图。
- 真实容器冒烟失败：保留数据卷，使用上一个已通过阶段提交重建 viewer，不使用破坏性 Git 或 Docker 命令。
