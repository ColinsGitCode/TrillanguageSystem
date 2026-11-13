# Three LANS: Modern Web Guidance 驱动的前端技术与交互方案

状态：**A/B/C/D 代码实施与自动化验证已完成，2026-11-13 已部署正式 viewer；B 原生弹层默认关闭，人工兼容验收待完成**。正式发布时尚未 commit/push，用户随后已授权提交推送；实际提交以 Git 历史为准。日期：2026-11-13，日本时间。

本文是前端交互专题，不替代 `CLAUDE.md`、全栈迁移架构、注解层 ADR 或学习辅助 2.0 产品基线。它回答：哪些现代 Web 能力适用于现有页面、怎样引入、何时应保留旧实现，以及如何证明没有回归。它不是上一轮产品功能愿望清单的改名。

## 0. 实施状态与取舍

用户随后明确授权一次性实施 A/B/C/D、测试后在 X86-MAC 替换正式版。12:18 JST 已完成 viewer 发布；完整测试、性能数据、已知缺口和回退步骤见 [实施与发布报告](../TestReports/2026-11-13-modern-web-guidance-abcd.md)。以下设计章节保留设计时证据，不代表仍未实施，也不应把设计验收目标全部视为已通过。

- A：标准 Web Vitals 接入、临时选区高亮、工具条单 Tab 入口、持续错误提示、草稿离开保护、输入自适应、注音一致性及学习页减噪已实施。正式性能上报仍关闭。
- B：稳定的 native dialog owner、模态内 portal 和按钮锚点 popover 已实现并通过隔离自动化；原生模式默认关闭。保留滚动锁回退，不宣称完全采用指南的纯 CSS 锁定方案。
- C：将同一帧的重复几何定位合并。30 次重复通知压力用例的 Range 测量由 30 次降至 1 次；卡片打开耗时未明显改善，不宣称达到冷打开 500ms 目标或改善真实用户 INP。
- D：卡片和笔记局部 140ms 淡入，尊重减少动态效果设置；关闭和输入不等待动画。未引入全页 View Transitions。
- 实机 Chrome 157 的原生 focusgroup 无法完整覆盖含 select 的工具条，因此该组合继续使用经验证的 roving tabindex；不为采用新 API 牺牲键盘合同。
- 真实 Safari、VoiceOver、真实系统 IME、系统滚动条及放大设置未完成人工验收；Playwright WebKit 不能代替这些结论。

## 1. 设计时基线与证据边界

- 设计时的代码和正式运行版本：`681997551f49b1f7d07f18654457e7592967b197`，当时运行标识 `dirty: false`；新发布版本的源码指纹和 `dirty: true` 见实施报告。
- 正式站：<https://x86-mac.tailc3818f.ts.net/>。当前预览版已经退役，本方案不重新创建预览、容器或数据卷。
- MWG 固定版本：[`4dd968349e54ca45a05dd5c818fb035c9054b022`](https://github.com/GoogleChrome/modern-web-guidance/tree/4dd968349e54ca45a05dd5c818fb035c9054b022)，而不是会漂移的 `main`。本次获取 20 篇专题指南，按实际需求核读规则、示例和回退章节。
- 兼容性二次来源：MDN Browser Compat Data [`d675bf0c9b3545cd3b3135be0564e864eda0ea6e`](https://github.com/mdn/browser-compat-data/tree/d675bf0c9b3545cd3b3135be0564e864eda0ea6e)。版本数据是支持线索，不等于本项目通过实机验收。
- 当前资料中的稳定版本为 Chrome 157、Firefox 160、Safari 27.2；Safari 27.3 被标为 beta，不能按稳定版能力设计。实际验收必须另外记录浏览器和操作系统版本。[B1][B15][B16]
- 设计时证据是源代码检查、正式运行标识读取、指南及兼容数据核对；页面视觉依据同日只读检查。**当时尚未执行候选技术的行为测试或性能基准；后续执行结果以实施报告为准，真实 Safari 验收仍未完成。**
- 桌面端为范围：建议 1024、1280、1440、1920 CSS px 视口，覆盖 200% 缩放与系统字体放大；不扩展手机布局，但不主动删除已有响应式行为。

## 2. 决策摘要

| 编号 | 面向用户的结果 | 指南驱动的技术决策 | 本轮设计结论 |
| --- | --- | --- | --- |
| MWG-01 | 弹窗层级明确，关闭不丢笔记 | 原生 dialog/top layer；区分阻塞确认与非阻塞工具 | 隔离验证后决定，不直接替换正式实现 |
| MWG-02 | 操作工具条时仍能识别选区，键盘不需逐个 Tab | CSS Custom Highlight + 完整 toolbar 单 Tab 入口 | 优先实施候选 |
| MWG-03 | 按钮旁的小面板不被裁剪、不遮挡焦点 | Popover + CSS Anchor Positioning；Range 保留 JS 定位 | 有条件采用 |
| MWG-04 | 输入框随内容增长，错误看得见，中文日文不会误提交 | field-sizing、明确校验状态和 IME 保护 | 优先实施候选，保留已有正确防护 |
| MWG-05 | 用准确指标判断是否更快 | 校准 INP/CLS；测量后才拆长任务 | 测量工作先行 |
| MWG-06 | 阅读时少跳动、首屏不因装饰变慢 | 稳定滚动区域、局部排版增强、维持延迟加载 | 优先实施候选 |
| MWG-07 | 必要过渡柔和，但关闭和输入不等动画 | 渐进 CSS 动效；复杂 View Transitions 暂缓 | 最后考虑，不作为首批目标 |
| MWG-08 | 今日学习只突出一个下一步 | content-first 信息减噪 | 小范围交互整理，不改变学习规则 |

全文搜索、上一张/下一张、笔记集合、跟读评分是独立产品需求，**不因采用 MWG 自动进入本轮**。也不更换 React Router、引入整套组件库、升级 Card Reader v3 白名单或迁移历史 Ruby。

## 3. 已有实现与真实差距

以下路径均相对仓库根目录，行号对应固定代码版本。

| 证据 | 当前实现 | 方案含义 |
| --- | --- | --- |
| E01 `app/components/overlays/DialogSurface.tsx:45` | 自定义 section、Tab 限制、Escape、焦点恢复与 body overflow 修改 | 有迁移到原生 dialog 的空间，但必须消除双重控制 |
| E02 `app/features/card-modal/CardModal.tsx:384`；`app/components/overlays/focus-management.ts:20` | 卡片另有一套隔离与关闭逻辑，特判多个子面板 | 优先设计共同的层级/关闭合同，不先机械换标签 |
| E03 `app/features/card-modal/CardModal.tsx:476` | 通过 Range、尺寸读取、ResizeObserver 和视口事件修正位置 | 任意文本选区不是普通元素锚点，不能用 CSS Anchor 一笔替代 |
| E04 `app/features/card-modal/CardModal.tsx:965` | 有左右/Home/End，但按钮未统一 roving tabindex | 方向键支持不等于完整 toolbar 单 Tab 入口 |
| E05 `app/features/factory/QuickComposer.tsx:132`、`app/features/factory/QuickComposer.tsx:248` | JS 读 scrollHeight 调整高度；已有 isComposing 和 229 防误提交 | 前者可渐进替换，后者保留并补跨入口回归 |
| E06 `app/features/card-modal/SelectionNoteEditor.tsx:39`；`app/features/card-modal/CardModal.tsx:467` | 草稿已保留；失败主要依赖约 2.4 秒 toast | 增加编辑器内持续可见的错误与重试，不重复开发草稿保护 |
| E07 `app/lib/performance/UiPerformanceObserver.tsx:62` | CLS 为排除近期输入后的累计和；INP 为最大 event duration | 与标准指标算法不完全一致，不能直接作为标准 Web Vitals 验收 |
| E08 `app/features/card-modal/DeferredCardModal.tsx:8`；`config/frontend-asset-budgets.json` | 已有懒加载、拆包和资源预算 | 保留架构，不为“现代化”把重模块搬回入口 |
| E09 `app/styles/card-modal.css:33`；`app/styles/virtual-list.css:5` | 卡片滚动区未配置稳定 gutter；虚拟列表已有 gutter/overscroll | 只补缺口，不全站套新 CSS |
| E10 `app/features/card-modal/CardModal.tsx:1166`；`app/features/card-modal/CardReadingAids.tsx` | 摘要读音未接收正文 showReadings 状态 | 注音开关应有一致且明确的作用域 |
| E11 `app/features/learning/TodayLearningPage.tsx` | 首次学习清单与旧会话恢复可同时显示两个主要继续入口 | 合并呈现，不自动结束旧会话 |

E07 是算法差距，不是“目前用户必然感到卡顿”的证据。正式 runtime 当前关闭 UI 性能上报，不能声称已有真实用户性能分布。

## 4. MWG-01: 浮层语义与生命周期

依据：[Dialog][G1]、[Light-dismiss][G2]、[Prevent background scroll][G3]。这些指南优先使用浏览器原生模态能力，但不免除应用的草稿和异步操作责任。

### 4.1 分类与交互

| 场景 | 语义与候选载体 | 焦点与关闭规则 |
| --- | --- | --- |
| 主卡片阅读器 | 原生 `<dialog>` + `showModal()` 候选 | 进入后有可访问标题和明确关闭；关闭回到原卡片入口 |
| 删除确认、放弃草稿确认 | 阻塞型子 dialog | 初始焦点为取消/继续编辑；Esc 只取消这一级 |
| 选词工具条 | 非模态 toolbar，top-layer popover 候选 | 鼠标选词不强抢焦点；键盘调用进入首个或上次操作 |
| 释义、朗读语言选择 | 有名称的非模态区域/按钮组 | 不滥加 menu 语义；关闭回到触发按钮 |
| 笔记编辑器 | 主 dialog 内的持久编辑区域 | 不依附临时工具条生命周期；滚动、切标签不卸载草稿 |

建议设立 `OverlayScope` 概念，集中提供当前模态的 portal 容器、触发元素和关闭请求入口；它不是全新的全局业务 store。渲染器分为 legacy 与 native，两条路径共用业务状态，但**同一浮层只能有一套焦点和关闭控制器**。

### 4.2 迁移的硬约束

1. 原生模态路径不再叠加手写 focus trap、重复 inert 和通用 document Escape。`cancel` 只处理最上层子交互和未保存状态等应用责任。
2. 检查所有 Radix、TTS、释义、标签 portal。原生主 dialog 内的子面板必须挂在正确的模态 DOM 范围；不能默认丢到 body，再用超大 z-index 绕过 top layer 或 inert。
3. 懒加载 fallback 与加载后的正文共用稳定的模态容器，避免关闭旧 dialog 再打开新 dialog 导致焦点、滚动和背景状态闪动。
4. 保存/删除成功仍由既有 API 结果决定。不能把 `<form method="dialog">` 的关闭当作保存成功。
5. 任何关闭入口统一走 `requestClose(reason)`：关闭按钮、Esc、背景点击、路由离开及父级卸载。存在草稿或未决保存时不得静默丢弃。
6. 草稿所有权独立于原生 open 状态；即使浏览器关闭事件已发生，也不能据此清空草稿。连续 Esc、原生关闭与 React 状态失配属于专项必测。
7. 不依赖 `closedby` 单独保护草稿。Safari 当前稳定版支持不足；背景点击回退需同时确认按下和释放都在矩形外，避免拖选文字到外侧误关闭。
8. 原调用元素因删除不存在时，将焦点送到下一卡片或列表标题。普通关闭交还浏览器，不重复抢焦点。

### 4.3 滚动锁定的明确取舍

MWG 建议 `dialog:modal` 和 `::backdrop` 使用 overscroll containment，避免修改根 overflow。其完整行为依赖“无可滚动溢出容器也生效”的子能力，Safari 目前不足；`CSS.supports()` 无法检测此行为。[G3][B3]

因此先验证长卡片、短确认框、背景滚轮与触控板。若 native 路径不能满足“背景不移动”的现有合同，**整个 native 模态方案保持实验，正式版保留 legacy 实现**。不删掉已验证的锁定逻辑再把退化解释为兼容回退；也不把额外 body-lock 补丁冒充已经遵循该指南的原生方案。

## 5. MWG-02: 选区可见性和完整工具条

依据：[Highlight Text Ranges][G4]、[Toolbar][G5]。

### 5.1 选区视觉层

目标是点击工具条、词典输入框后，正文仍明确显示操作对象，同时不影响原来的选择与复制。

- 继续用当前选择投影和 selector 冻结原文、目标版本与范围。不要换成字符串 `indexOf`，不要改变 UTF-16/码点的既有转换合同。
- 使用 CSS Custom Highlight 绘制临时选区；保留工具条“已选原文”作为文字说明，因为 Highlight 本身没有可访问语义。
- 只用于瞬态视觉反馈，不替换持久化 `card_annotations`、可点击笔记和语义标记。
- 正文渲染或注音开关变更后，从新 DOM 重建 Range；旧节点断开即清理，不复用失效范围。
- Registry 由组件拥有命名空间，并只删除自己注册的键。**不照抄指南示例中的 `CSS.highlights.clear()`**，以免删除教材、搜索或其他组件的高亮。
- 不支持时退回现有原生 selection 与已选原文预览，保持功能完整。不为临时反馈向注音 DOM 包装 `<mark>`，避免再次改变投影和选词边界。

### 5.2 键盘合同

工具条拆成“非交互原文说明 + 操作组”，避免长原文展开、输入框与方向键操作争抢焦点。

- Tab 一次进入操作组，左右键/Home/End 在组内移动，Tab 离开；不让用户 Tab 遍历所有按钮。
- 原生 `focusgroup` 可用且专项通过时使用它；否则按指南使用一个 roving-tabindex 回退。两者绝不同时运行。
- 不能只设置 `role="toolbar"` 就宣布完成。动态按钮增删、繁忙/不可用操作、下拉关闭后的焦点均需覆盖。
- 若使用 `aria-disabled` 保留可发现性，点击、Enter、Space 都必须拒绝执行；提供不可用原因。它不是防重复提交的替代品。
- 鼠标选词继续保留正文焦点，键盘选词/Shift+F10 才主动进入工具条。Esc 优先关菜单/选择面板，再关工具条，最后才是主卡片。

## 6. MWG-03: 有边界的锚定定位

依据：[Viewport-aware Dropdowns][G6]、[Position-aware Tooltips][G7]。

**先区分两个问题：Popover 解决层级和显示，Anchor Positioning 解决位置。它们都不自动实现 ARIA menu 的键盘合同。**

### 6.1 普通按钮是元素锚点

朗读语言、释义展开、更多操作等面板可以试用显式唯一 anchor-name/position-anchor、逻辑方向 position-area 与 flip-block/flip-inline 回退。实际门槛同时检测使用到的属性，不仅检测 anchor-name。

CSS 定位路径与现有 JS 定位路径二选一，避免二者同时写 top/left。面板要设置视口内最大尺寸和内部滚动；空间不足时宁可变为受约束的面板，也不能让关键按钮不可点。

使用 native popover 不代表要移除 Radix 的菜单行为。先保留成熟的语义和键盘处理，证明 portal 与 top layer 兼容后才决定是否简化依赖。

### 6.2 任意文本 Range 不是 CSS 元素锚点

跨行、跨注音 token 的选区仍保留现有 Range/矩形定位。改进应是读写分批、每帧至多一次定位、去除无效重复测量，而不是宣称纯 CSS 能直接锚定任意 DOM Range。

如未来试验虚拟锚点元素，必须满足不进入正文投影、不参与选择、不改变布局且随缩放/滚动更新；这仍需要 JS，本轮不作为默认实现。

不为装饰箭头引入 anchored container queries。普通无箭头面板已能解决问题，而且后者跨浏览器能力不足。[G7]

## 7. MWG-04: 输入、错误与保存反馈

依据：[Auto-sizing Fields][G8]、[IME-safe Enter][G9]、[Accessible Error Announcement][G10]。

- QuickComposer 在支持 `field-sizing: content` 的路径停止 JS 高度写入；固定 inline-size、设置 min/max block-size，达到上限后内部滚动。不支持时保留现有自动高度，不能两套同时驱动。
- 笔记框可渐进采用同一 CSS，旧浏览器保留固定最小高度与手动调整。不要让长 placeholder 决定横向宽度。
- 保留已有 isComposing/229 防护；审查所有自定义 Enter 入口。候选词确认不得触发生成、提交或关闭；多行笔记的 Enter 仍是换行。
- 笔记保存失败增加就地、持续可见的错误和重试按钮；草稿不清空。版本冲突与网络失败需有不同说明，不诱导用户无效地重复覆盖。
- 字段级错误用 aria-invalid 和 aria-describedby 关联；未交互时不先报错。服务端冲突不能伪装成本地 required 校验。
- 保存成功使用一个温和状态播报；失败在当前有效模态范围内播报一次，避免全局和局部同时读两遍。原生模态之外的 inert live region 不能作为唯一播报入口。

此项改变呈现与交互，不修改保存 API、expectedVersion 校验或持久化模型。

## 8. MWG-05: 先校准测量，再优化长任务

依据：[Identify INP Causes][G11]、[Break Up Long Tasks][G12]、[Conditional Async Dependencies][G13]、[web-vitals][B4]。

### 8.1 先修正指标口径

目前 INP 取最大 event duration，缺少标准交互归并和异常值处理；CLS 简单累加，缺少标准会话窗口。应采用官方 web-vitals 的标准计算，并通过现有固定字段 reporter 发送，不复制一套相似算法。

- 先在隔离测试环境开启标准采集与归因。正式 telemetry 开关保持现状，不在设计阶段开启。
- 测量库仅在采集开启后加载和初始化一次；关闭采集或页面卸载时释放观察器，避免开发模式重复挂载和后台路由反复注册。归因构建不默认进入首屏包。
- 既有值与校准后的值不可直接拼接比较；记录基线版本和采样时段。若需要新增协议版本字段，另审 telemetry allowlist，而不是悄悄扩展 payload。
- 归因只用于本地诊断，不能直接照抄指南上传 interactionTarget、完整 URL 或源函数等字段；沿用项目隐私合同，线上只保留批准的指标、固定路由桶和 cold/warm 上下文。
- 不支持某 PerformanceEntry 类型时标记不可测，不伪造 0 分或判定为通过。实验室分位数不等于真实用户 Web Vitals。

### 8.2 有 trace 才做的优化

重点测量 Markdown 渲染、注解投影、注音 DOM 构建、工具条矩形扫描和输入后的布局。不能仅因函数很长就断言是瓶颈。

- 找到超过 50ms 的独立处理循环后，再按约 8-16ms 的工程预算拆分；支持时使用 scheduler.yield，否则用 setTimeout 任务回退。Promise.resolve 微任务不能替代向浏览器让出执行权。
- 可取消的分片任务必须带内容 revision/任务序号；旧卡片任务不得在用户切换后覆盖新内容。不在 React render 或需要原子完成的选区更新中随意 await。
- DOM 测量先批量读、再写；不能每个 token 都读写交错。保留安全清洗和失败关闭逻辑，性能目标不授权绕过 DOMPurify。
- 沿用 DeferredCardModal 和功能拆包。必要时只对明确用户意图预取代码 chunk，不预渲染业务页面、不提前 TTS、不发送打卡/打开事件。
- 不采用全站 speculation rules；本系统存在状态读取、业务事件和高成本操作，收益与副作用尚未验证。[G14]

### 8.3 性能目标

复用 `config/ui-performance-budgets.json`：INP good 200ms、CLS good 0.1、LCP good 2500ms、路由切换 good 300ms、卡片打开 good 500ms。它们是既有目标，**不是本次测得结果**。

在同一机器、浏览器、数据集与网络条件下分别记录至少 30 次 cold/warm 卡片打开，以及短、中、长卡的操作样本。对照 median/p75/p95；明确“看到正文”和“注解/注音可交互”的完成点，不把模块加载完毕当作全部完成。字段标准指标按会话收集。

若原基线未达目标，报告差距并证明收益；不得降低预算来制造通过。若基线已达目标，新增交互的 p75 不应回退超过 10%，且不引入新的超 50ms 主线程阻塞。资源体积继续通过现有预算，不能扩大上限掩盖 polyfill 开销。

## 9. MWG-06: 阅读布局稳定优先

依据：[Text Layout and Legibility][G15]、[Defer Heavy Content][G16]、[Content-first Noise Reduction][G17]。

- 为真正滚动的卡片区域试加 scrollbar-gutter: stable，防止内容长短变化引起横移；现有虚拟列表已经有此能力，不重复改造。
- 保留当前语言色和阅读宽度。text-wrap: balance 只用于允许多行的短标题，pretty 只在部分英文解释中试验；不全局应用，不给日语 token 排版额外制造性能和定位不确定性。
- 注音开关先统一摘要和正文的语义范围；必要时保存当前段落与相对偏移再恢复阅读锚点，不把每次内容高度变化都强制拉回原像素位置。
- 加载骨架和错误区域预留合理空间，不在用户正在阅读的位置上方插入新的高大提示。
- `content-visibility: auto` 仅在 trace 证明收益的非关键、屏外独立区块试验，并设置 contain-intrinsic-size。不得用于首屏、选词正文、活跃注音区域或已有虚拟列表内部。
- 浏览器页内查找、跨段选择、键盘访问和屏幕阅读器任一受损即撤回该渲染优化；默认完整渲染是有效回退。

## 10. MWG-07/08: 克制动效与信息减噪

依据：[Top-layer Animation][G18]、[Same-document Transitions][G19]、[Scoped Transitions][G20]、[Content-first][G17]。

**动效不是第一轮目标。** 真正需要时只增加短暂淡入，建议设计值 120-160ms，减少动态效果模式立即切换或仅极短淡入。不能因等待动画而推迟保存、取消、焦点归还或错误显示。

原生浮层退出动画要求 overlay 与可工作的离散 display transition；仅 CSS.supports(transition-behavior) 不足。首版允许即时关闭，不引入延迟卸载计时器来追求动画一致。

不在选词、注音开关、笔记输入时启动 document View Transition，避免全页快照覆盖浮层、冻结阅读状态。element-scoped transition 可作为后续实验；不支持时直接更新，不能回退成更大范围的 document transition。

今日学习将首次引导折叠为进度摘要，让活动会话只保留一个主要继续入口。旧会话的结束/准备今天保留为明确的次要操作，不自动调用任何写接口。主卡片标题栏保持简短且稳定，不采用滚动自动隐藏导致关闭按钮消失的设计。指南中的条高比例是设计建议，不压过 200% 缩放下的可访问性需求。

## 11. 兼容矩阵与指南核验

以下为固定 BCD 快照的记录，不是承诺支持所有这些旧版本。版本号表示具体能力的起点；完整组合仍需实测。每行链接直接指向相应数据文件。

| 具体能力 | Chrome / Firefox / Safari | 策略 |
| --- | --- | --- |
| [dialog.showModal][B2] | 37 / 98 / 15.4 | 有广泛基础，但 portal、草稿和滚动仍须验收 |
| [HTMLElement.popover][B5] | 114 / 125 / 17 | 仅说明基础属性；不等于 hint/source 等新子能力都可用 |
| [dialog.closedBy][B2] | 134 / 141 / 27.3 beta | Safari 稳定版不能作为必需条件；受控关闭回退 |
| [anchor-name][B6] | 125 / 147 / 26 | 与 position-area、try-fallbacks 一起检测 |
| [position-area][B7] | 129 / 147 / 26 | 排除旧名 inset-area，限定本方案所用逻辑值 |
| [position-try-fallbacks][B8] | 128 / 147 / 26 | 单独测试四边和角落溢出 |
| [anchor 布局/transform 后定位][B6] | 144 / 未支持 / 27 | 避免变换锚点；缩放场景专项，不靠语法探测 |
| [Highlight][B9] + [CSS.highlights][B10] | 105 / 140 / 17.2 | 仅瞬态视觉，缺失退回现有选区和文字预览 |
| [focusgroup][B5] | 150 / 未支持 / 未支持 | 原生与 JS roving 回退互斥 |
| [field-sizing][B11] | 123 / 152 / 26.2 | 支持时 CSS；否则现有 JS/固定尺寸 |
| [scrollbar-gutter][B12] | 94 / 97 / 18.2 | 不支持时正常滚动，不引入重型补丁 |
| [scheduler.yield][B13] | 129 / 142 / 未支持 | setTimeout 回退；必须实测分片是否有收益 |
| [overlay CSS 属性][B14] | 117 / 未支持 / 未支持 | 不把浮层退出动画设为功能依赖 |
| [非溢出容器 overscroll containment][B3] | 144 / 150 / 不完整 | 行为不可只靠 CSS.supports 判定，native 模态发布门槛 |

### 必须记录的差异

- G6 的“Anchor positioning 整体支持”摘要写为仅 Safari 27，而 BCD 的 anchor-name/position-area/position-try-fallbacks 明确记录三引擎支持。**不据此断言整个指南错误，也不以整体摘要否定具体子能力**；本方案只依赖并测试所列子集。
- G4 汇总的 Firefox Highlight 起点为 149，而本次用到的 Highlight 构造与 CSS.highlights 核心 API 在 BCD 为 140；不把整组功能的 Baseline 与单个 API 起点混用。
- Safari 27.3 的 closedBy 是 beta 记录，不代表 Safari 27.2 已支持。
- G4 的全局 clear、G11 的详细归因 beacon、G6 的 CDN/polyfill 示例不直接复制：分别与共享 registry 所有权、项目隐私规则和资源/CSP 约束冲突。

能力适配器应集中返回实际选用的渲染路径，供测试强制关闭增强能力。禁止 UA 字符串分流，禁止同时加载原生行为和同功能 polyfill。本轮优先使用项目已有回退，不新增 CDN 运行依赖。

## 12. 验收合同

所有候选增强都要在 native/enhanced 与强制 fallback 两条路径执行；接口存在检查不能替代行为测试。

| 用例 | 必须满足的结果 |
| --- | --- |
| AT-01 嵌套浮层 | 主卡片→工具条→菜单/语言面板→确认；Esc 每次只退出最上层，Tab 不泄漏 |
| AT-02 草稿保护 | 滚动、切标签、背景点击、连续 Esc、路由离开与保存失败不静默丢稿 |
| AT-03 鼠标拖选 | 从正文拖到背景释放不关闭卡片；注音、标点、跨行、emoji 和重复词定位正确 |
| AT-04 工具条键盘 | Tab 单次进入/退出；左右/Home/End 正确；动态禁用和菜单返回不丢焦点 |
| AT-05 浮层边界 | 四角、长文本、缩放、窗口 resize 下所有必要操作可见可点，命中测试通过 |
| AT-06 选区高亮 | 聚焦输入框仍可识别选区；不污染复制文本、不改持久注解；切卡后无旧 Range |
| AT-07 IME | macOS 中文/日文真实输入法确认不提交；自动 composition 测试之外保留人工 Safari 验收 |
| AT-08 错误可访问性 | 字段错误可关联且持续可见，成功/失败各播报一次；VoiceOver 实机检查 |
| AT-09 滚动与焦点 | 短/长 dialog、背景滚轮、触控板不移动背景；普通开关后位置偏差不超过 1 CSS px |
| AT-10 排版 | 200% 缩放、字号放大、明暗主题、强制颜色下不丢控件；焦点不被面板遮挡 |
| AT-11 减少动态效果 | 不依赖动画完成才能关闭或输入；关闭后无透明拦截层 |
| AT-12 性能 | 固定环境基线与候选对比，标准 INP/CLS 与自定义完成点分别报告；资源预算不放宽 |
| AT-13 数据边界 | 选词、布局切换、能力降级不创建生成任务/学习评分/额外 TTS；既有合法事件单独列明 |
| AT-14 首屏与懒加载 | 首屏不提前包含完整 CardModal；模块失败可重试；fallback 切正文无双模态闪动 |
| AT-15 今日学习 | 展示一个主要继续入口；折叠引导只改 UI 状态，不结束会话或提交评分 |
| AT-16 清理 | 反复打开关闭后无残留 inert、滚动锁、事件监听、Highlight、观察器或播放 owner |

自动化覆盖 Chromium、Firefox、Playwright WebKit；后者**不等于**发行版 Safari。Safari、VoiceOver、真实 IME、系统滚动条模式和缩放须单独记录人工结果。沿用已有 selection-reading-ux 回归，并新增各能力关闭后的测试。

AT-09 的像素要求针对未改变正文内容的普通开关；切换注音会改变行高，应比较原段落锚点是否仍在视野内，不能误用像素不变作为唯一标准。AT-13 中正常显式保存可写隔离测试数据；正式环境观察须阻断业务写入，不能拿生产笔记做删除回归。

## 13. 实施顺序与发布边界

| 阶段 | 工作包 | 放行条件 |
| --- | --- | --- |
| A 基线与低风险改进 | 标准指标校准；工具条单 Tab 入口；临时选区视觉；输入错误/field-sizing；阅读布局与首页减噪 | 上述对应合同、回退路径、资源预算通过 |
| B 隔离技术验证 | 原生主 dialog 与全部子 portal；button-anchor popover；跨浏览器滚动/草稿合同 | 不满足任一核心合同就保留 legacy，不强行推进 |
| C 有证据的性能改进 | 根据 trace 分片、去重复测量或局部延迟渲染 | 有可重复收益，不损坏选择、页内查找和可访问性 |
| D 可选动效 | 小范围淡入或 scoped transition | 前三阶段稳定；关闭/交互不依赖动画；可直接禁用 |

阶段 A 可以先交付用户收益，不以完成原生浮层迁移为前提。阶段 B 初始只在隔离环境启用，不能因 CSS.supports 为 true 就自动在正式版开启未经验证的路径。

设计时约定实施需先经用户确认范围；本轮用户已随后授权 A/B/C/D 开发、测试和正式部署，并在交付后另行授权 commit/push。若再次要求前后对照，只在 X86-MAC 现有默认 colima 中部署隔离 viewer，继续使用独立数据副本和明确端口，不创建第二个 Colima。验证、用户验收、正式部署、commit/push 和清理预览应分别记录；保留正式备份与回退镜像。本文记录授权结果，本身不构成额外操作授权。

## 14. 来源

指南链接固定到本次核读版本；兼容数据另行固定。以下是采用/保留/拒绝决策的来源，不表示示例可直接粘贴到本项目。

[G1]: https://github.com/GoogleChrome/modern-web-guidance/blob/4dd968349e54ca45a05dd5c818fb035c9054b022/skills/modern-web-guidance/guides/ui-components/dialog.md
[G2]: https://github.com/GoogleChrome/modern-web-guidance/blob/4dd968349e54ca45a05dd5c818fb035c9054b022/skills/modern-web-guidance/guides/ui-behaviors/light-dismiss-a-dialog.md
[G3]: https://github.com/GoogleChrome/modern-web-guidance/blob/4dd968349e54ca45a05dd5c818fb035c9054b022/skills/modern-web-guidance/guides/ui-behaviors/prevent-page-scroll-under-modal-dialog.md
[G4]: https://github.com/GoogleChrome/modern-web-guidance/blob/4dd968349e54ca45a05dd5c818fb035c9054b022/skills/modern-web-guidance/guides/ui-behaviors/highlight-text-ranges.md
[G5]: https://github.com/GoogleChrome/modern-web-guidance/blob/4dd968349e54ca45a05dd5c818fb035c9054b022/skills/modern-web-guidance/guides/ui-components/toolbar.md
[G6]: https://github.com/GoogleChrome/modern-web-guidance/blob/4dd968349e54ca45a05dd5c818fb035c9054b022/skills/modern-web-guidance/guides/ui-atoms/viewport-aware-dropdowns.md
[G7]: https://github.com/GoogleChrome/modern-web-guidance/blob/4dd968349e54ca45a05dd5c818fb035c9054b022/skills/modern-web-guidance/guides/ui-atoms/position-aware-tooltips.md
[G8]: https://github.com/GoogleChrome/modern-web-guidance/blob/4dd968349e54ca45a05dd5c818fb035c9054b022/skills/modern-web-guidance/guides/forms/form-fields-automatically-fit-contents.md
[G9]: https://github.com/GoogleChrome/modern-web-guidance/blob/4dd968349e54ca45a05dd5c818fb035c9054b022/skills/modern-web-guidance/guides/forms/ime-safe-enter-submit.md
[G10]: https://github.com/GoogleChrome/modern-web-guidance/blob/4dd968349e54ca45a05dd5c818fb035c9054b022/skills/modern-web-guidance/guides/accessibility/accessible-error-announcement.md
[G11]: https://github.com/GoogleChrome/modern-web-guidance/blob/4dd968349e54ca45a05dd5c818fb035c9054b022/skills/modern-web-guidance/guides/performance/identify-inp-causes.md
[G12]: https://github.com/GoogleChrome/modern-web-guidance/blob/4dd968349e54ca45a05dd5c818fb035c9054b022/skills/modern-web-guidance/guides/performance/break-up-long-tasks.md
[G13]: https://github.com/GoogleChrome/modern-web-guidance/blob/4dd968349e54ca45a05dd5c818fb035c9054b022/skills/modern-web-guidance/guides/performance/conditional-async-dependencies.md
[G14]: https://github.com/GoogleChrome/modern-web-guidance/blob/4dd968349e54ca45a05dd5c818fb035c9054b022/skills/modern-web-guidance/guides/performance/improve-next-page-load-performance.md
[G15]: https://github.com/GoogleChrome/modern-web-guidance/blob/4dd968349e54ca45a05dd5c818fb035c9054b022/skills/modern-web-guidance/guides/visual-design/improve-text-layout-and-legibility.md
[G16]: https://github.com/GoogleChrome/modern-web-guidance/blob/4dd968349e54ca45a05dd5c818fb035c9054b022/skills/modern-web-guidance/guides/performance/defer-rendering-heavy-content.md
[G17]: https://github.com/GoogleChrome/modern-web-guidance/blob/4dd968349e54ca45a05dd5c818fb035c9054b022/skills/modern-web-guidance/guides/user-experience/content-first-noise-reduction.md
[G18]: https://github.com/GoogleChrome/modern-web-guidance/blob/4dd968349e54ca45a05dd5c818fb035c9054b022/skills/modern-web-guidance/guides/ui-behaviors/animate-to-from-top-layer.md
[G19]: https://github.com/GoogleChrome/modern-web-guidance/blob/4dd968349e54ca45a05dd5c818fb035c9054b022/skills/modern-web-guidance/guides/ui-behaviors/same-document-transitions.md
[G20]: https://github.com/GoogleChrome/modern-web-guidance/blob/4dd968349e54ca45a05dd5c818fb035c9054b022/skills/modern-web-guidance/guides/ui-behaviors/scoped-component-transitions.md
[B1]: https://github.com/mdn/browser-compat-data/blob/d675bf0c9b3545cd3b3135be0564e864eda0ea6e/browsers/safari.json
[B2]: https://github.com/mdn/browser-compat-data/blob/d675bf0c9b3545cd3b3135be0564e864eda0ea6e/api/HTMLDialogElement.json
[B3]: https://github.com/mdn/browser-compat-data/blob/d675bf0c9b3545cd3b3135be0564e864eda0ea6e/css/properties/overscroll-behavior.json
[B4]: https://github.com/GoogleChrome/web-vitals
[B5]: https://github.com/mdn/browser-compat-data/blob/d675bf0c9b3545cd3b3135be0564e864eda0ea6e/api/HTMLElement.json
[B6]: https://github.com/mdn/browser-compat-data/blob/d675bf0c9b3545cd3b3135be0564e864eda0ea6e/css/properties/anchor-name.json
[B7]: https://github.com/mdn/browser-compat-data/blob/d675bf0c9b3545cd3b3135be0564e864eda0ea6e/css/properties/position-area.json
[B8]: https://github.com/mdn/browser-compat-data/blob/d675bf0c9b3545cd3b3135be0564e864eda0ea6e/css/properties/position-try-fallbacks.json
[B9]: https://github.com/mdn/browser-compat-data/blob/d675bf0c9b3545cd3b3135be0564e864eda0ea6e/api/Highlight.json
[B10]: https://github.com/mdn/browser-compat-data/blob/d675bf0c9b3545cd3b3135be0564e864eda0ea6e/api/CSS.json
[B11]: https://github.com/mdn/browser-compat-data/blob/d675bf0c9b3545cd3b3135be0564e864eda0ea6e/css/properties/field-sizing.json
[B12]: https://github.com/mdn/browser-compat-data/blob/d675bf0c9b3545cd3b3135be0564e864eda0ea6e/css/properties/scrollbar-gutter.json
[B13]: https://github.com/mdn/browser-compat-data/blob/d675bf0c9b3545cd3b3135be0564e864eda0ea6e/api/Scheduler.json
[B14]: https://github.com/mdn/browser-compat-data/blob/d675bf0c9b3545cd3b3135be0564e864eda0ea6e/css/properties/overlay.json
[B15]: https://github.com/mdn/browser-compat-data/blob/d675bf0c9b3545cd3b3135be0564e864eda0ea6e/browsers/chrome.json
[B16]: https://github.com/mdn/browser-compat-data/blob/d675bf0c9b3545cd3b3135be0564e864eda0ea6e/browsers/firefox.json
