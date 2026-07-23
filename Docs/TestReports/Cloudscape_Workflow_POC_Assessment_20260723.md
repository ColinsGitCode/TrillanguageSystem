# Cloudscape Workflow POC 评估

> 日期：2026-07-23
> 候选版本：`@cloudscape-design/components@3.0.1333`
> License：Apache-2.0
> 状态：采用表已确认

## 1. 结论

Cloudscape 的信息架构、密度、反馈、焦点与复杂任务模式值得吸收，但本轮**不把 Cloudscape 组件包和 global styles 引入生产应用**。Three LANS 采用“原则复用 + 自研有界包装”的方式。

原因：

- AppLayout 的侧栏、Tools、Drawer 与 Split Panel 模型适合管理型长流程；
- Flashbar 的任务状态反馈和焦点纪律可转化为共享 contract；
- Wizard 是多页表单组件，教材逐表达校对不是逐条 Wizard；
- 组件包解包约 20.8 MB，直接引入会带来明显依赖与 CSS 面；
- global styles 会改变字体、body 和视觉 tokens，不符合 Three LANS 品牌与语言/卡型色边界；
- 现有 React Router Shell 已具备导航、主题和健康状态，替换收益不足。

## 2. 采用表

| 候选 | 决策 | Three LANS 落点 |
|---|---|---|
| AppLayout | 包装使用其信息架构原则 | `ProductShell` + `WorkflowShell`，保留现有 tokens |
| SideNavigation | 保持自研 | `ProductShell` 导航与图标模式 |
| Flashbar | 包装使用其反馈语义 | `GlobalFeedback`，typed command |
| Wizard | 不采用到教材 | 教材使用 StageNavigation + TaskWorkbench |
| Progressive Steps / Steps | 包装使用 | 紧凑 StageNavigation |
| Tools / Drawer | 包装使用 | `ContextTools` / `ActivityDrawer` |
| Review pattern | 直接吸收原则 | 服务端 preview 驱动 `ReviewSummary` |

## 3. Foundation 映射

| Cloudscape foundation | Three LANS |
|---|---|
| surface/background | `--surface-*` tokens，不覆盖 |
| focus | 保留 `--color-focus` 与 `:focus-visible` |
| status | success/warning/error/info 语义映射 |
| spacing | 4/8/12/16/24 节奏，工作台密度优先 |
| typography | 系统字体，阅读区不采用 Open Sans |
| motion | 遵守 `prefers-reduced-motion` |
| dark mode | 保留现有 `data-theme` |

禁止映射：AWS 品牌色、global body reset、Cloudscape 私有 class/DOM、移动端抽屉行为。

## 4. 桌面与可访问性

- 正式验收视口仅 1280 和 1440；
- 状态同时使用文字与图标，不只靠颜色；
- Stage 切换后 H1 聚焦；
- 后台完成使用 `aria-live=polite`，不抢当前输入焦点；
- reduced motion 下取消非必要过渡；
- 不新增移动端基线。

## 5. POC 隔离

- 根 `package.json` 未变化；
- POC 不访问业务 API、SQLite 或真实教材；
- POC 未加载 `@cloudscape-design/global-styles`；
- 构建指标由 `scripts/tests/cloudscapeWorkflowPoc.mjs` 写入 Git 忽略的 `dist/poc-metrics.json`；
- 生产实现只保留自研共享原语，不依赖 Cloudscape 私有 DOM 或 class。
