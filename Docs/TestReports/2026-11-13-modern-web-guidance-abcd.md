# Modern Web Guidance A/B/C/D 实施与发布报告

日期：2026-11-13，日本时间。正式发布：12:18:57 JST；发布后只读复核：12:26 JST。

## 1. 结论与授权

用户授权一次性推进 A/B/C/D，测试后直接替换 X86-MAC 正式 viewer。四阶段代码已实现并执行自动化；A/C/D 的改进已默认生效，B 的原生弹层仍按设计门禁默认关闭。**这不等于全部人工兼容性验收完成，也不等于全量测试全绿。** 本报告的发布验收快照早于 Git 提交；用户随后另行授权 commit/push，实际提交以 Git 历史为准。未创建 PR，提交不改变既有运行镜像及其构建标识。

正式入口：<https://x86-mac.tailc3818f.ts.net/>。

- 设计：[Modern Web Guidance 前端交互方案](../Features/Modern_Web_Guidance_Frontend_Interaction_Design.md)。MWG 固定版本 `4dd968349e54ca45a05dd5c818fb035c9054b022`，BCD 固定版本 `d675bf0c9b3545cd3b3135be0564e864eda0ea6e`。
- 不修改后端领域规则、数据库 schema、原文投影、DOMPurify 安全边界、学习调度或历史 Ruby；不扩大 Card Reader v3 白名单。
- 使用既有默认 Docker context `colima`，仅重建/替换 `trilingual-viewer`，不新增 Colima/VM。

## 2. 实施内容

| 阶段 | 已实施 | 正式行为及边界 |
| --- | --- | --- |
| A | `web-vitals@6.2.3` 标准指标；选区 Custom Highlight；单 Tab 工具条；持久错误及草稿离开保护；field-sizing；摘要注音同步；滚动稳定与引导折叠 | 能力检测后渐进启用，旧浏览器保留回退；性能上报仍关闭 |
| B | 稳定 native modal owner、模态内 portal、按钮锚点 popover、异步加载和未保存状态合同 | 会话开关默认关闭；正式使用兼容弹层；未替换所有 Radix 菜单 |
| C | rAF 合并视口、resize、observer 的重复定位通知，首次定位仍同步；保留重模块延迟加载与原资源预算 | 有重复测量减少的证据；不宣称打开速度或真实 INP 已改善 |
| D | 卡片与笔记表面的 140ms 局部透明度淡入 | 尊重 prefers-reduced-motion；关闭/输入不等动画；无全页/共享元素过渡 |

关键入口：`app/lib/platform/capabilities.ts`、`app/lib/performance/web-vitals.ts`、`app/features/card-modal/useSelectionHighlight.ts`、`useToolbarNavigation.ts`、`app/components/overlays/CardOverlayBoundary.tsx`、`OverlayScope.tsx`。

### 技术取舍

- Custom Highlight 只管理 `three-lans-active-selection`，不改写文本节点、不替换原生 Selection、不清空全局 Highlight 注册表；断连或失效的范围会清理。
- Chrome 157 实机中原生 focusgroup 不包含工具条中的 select，导致方向键/Tab 行为不完整。因此当前含语速选择框的组合强制使用 roving tabindex。Firefox 保留文本选区时也出现 Tab 原地停留，已限定修复工具条的 Tab 出口，不清除用户选区、不另加整窗焦点陷阱。
- 原生路径保留经过回归的 body 滚动锁兼容处理；不把它描述为已经实现指南中的纯 CSS 滚动隔离。未在未经人工验证的浏览器上默认开启原生路径。
- Web Vitals 仅在运行配置开启时延迟加载，文档生命周期只初始化一次；报告仍使用固定指标/路由桶，不上传原文、DOM target 或原始 URL。库没有公开的统一清理句柄，停止上报不会伪称已断开库的所有内部 observer；React 重挂载不重复注册。
- `card-modal-open` 从挂载计时改为正文可用后的绘制机会；不宣称它证明全部注音就绪。性能对照使用独立且两版一致的测试终点。
- field-sizing 支持时不读 scrollHeight；不支持时沿用 JS 高度回退。保留 IME composition/229 保护。

## 3. 测试结果

权威运行环境为 X86-MAC 的 Linux/Node 22 测试容器；本地 Chrome 157.0.8103.52 补充实机操作。隔离测试使用专用夹具，不写正式数据库。

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| TypeScript / ESLint | 通过 | 最终源码 |
| 生产构建、资源预算、架构、注音纯文本、路由所有权 | 通过 | 未放宽预算，保留 CardModal 延迟加载 |
| 单元测试 | 653/653 | 最终源码 |
| MWG 三引擎专项 | 57/57 | Chromium、Firefox、Playwright WebKit；含增强、强制 legacy、native opt-in |
| 默认选词回归 | 34/34 | 最终源码 |
| 原生弹层选词回归 | 34/34 | 最终源码；`MWG_NATIVE_OVERLAYS=1` |
| 较广 UI 回归 | 117/117 | 最后工具条兼容修正前通过；受影响选词路径随后按上面最终套件重跑 |
| 后端集成，候选串行 | 121/122 | Activity 用例失败，见下文；不是全量 acceptance 通过 |
| 生产 Chrome 157 只读 smoke | 通过 | 运行指纹、卡片选词、笔记失败及草稿保护、关闭清理、三页 HTTP 200 |

专项包含：选区保留/注册表所有权、单 Tab/箭头/Home/End/语速选择框、Tab 双向退出、子菜单 Esc 与焦点返回、409/网络失败持久提示、草稿关闭和路由保护、减少动态效果、滚动隔离、摘要注音、引导折叠不写学习数据、模拟 composition 不提交、延迟加载期间只存在一个模态 owner。

复跑命令：

```sh
npm ci
npm run typecheck:react
npm run lint
npm run build:react
npm run test:architecture
npm test
npx playwright test -c playwright.mwg.config.js
npx playwright test tests/e2e/selection-reading-ux.spec.js
MWG_NATIVE_OVERLAYS=1 npx playwright test tests/e2e/selection-reading-ux.spec.js
npm run test:integration
```

### 未消除的失败与验收缺口

- `tests/integration/activity.test.js:93`：预期知识解析活动缺失，读取 `resolution.status` 失败。未改动的 `6819975` 基线同样失败；候选串行 121/122。候选并行首次为 120/122，另有一次 KG planning 失败，串行未再出现，不将整套集成标为通过。
- Playwright WebKit 不等于发行版 Safari。真实 Safari、VoiceOver、真实系统 IME、系统滚动条模式、200% 缩放与系统字号放大的完整人工矩阵仍未完成；新增测试不能证明所有 AT-01 至 AT-16 合同完全验收。
- 桌面是本轮验收范围。390px 手机探测时页面宽 480px，存在横向溢出；尚未定位来源，不宣称它一定为历史问题，也不宣称移动端通过。
- 没有重新执行真实 DeepSeek 内容质量、TTS 音质或全套教材端到端验收；健康接口仅证明对应探针正常。

## 4. 性能证据

固定三语夹具、同一环境下分别运行基线和最终版本各 30 次冷打开、30 次热打开；统一终点是可见注音 token 加两帧。此为实验室外部耗时，不是标准 INP，也不是新旧自定义挂载指标的混比。

| 指标，ms | 基线 | 最终版本 |
| --- | ---: | ---: |
| 冷打开 p50 / p75 / max | 1059 / 1086 / 2210 | 1072 / 1084 / 1102 |
| 热打开 p50 / p75 / max | 222 / 250 / 630 | 243 / 259 / 331 |
| 同批 30 次 resize 通知产生的 Range 测量 | 30 | 1 |

重复通知压力实验重复 30 批，均为 30→1；它不代表页面整体快 30 倍。冷打开 p75 基本不变，热打开 p75 增加 9ms；无充分证据证明整体打开变快，冷打开 500ms 目标未达成。

冷打开观测到的长任务总数基线 54、最终 62，热打开均 30；未消除所有 50ms 长任务。已保存 CDP trace，但未完成真实短/中/长卡片的全面性能画像。未为追求形式添加 scheduler 分片或全文虚拟化。

## 5. 发布、安全与只读回读

- 基线 commit：`681997551f49b1f7d07f18654457e7592967b197`。
- 正式镜像：`three-lans-viewer:mwg-abcd-20261113`。
- 镜像 ID：`sha256:83a019cb625d7cded9e7cff3c3e6a660df0843ae76de48d0f7b0a2e70cc2cd80`。
- 运行源码指纹：`ade2d42acb81887827770813f4611947f369358f13f3806e48b1b46466c3953b`。
- 构建：`2026-11-13T03:16:48.622Z`，`dirty: true`。这是已测试的未提交快照，不能仅凭 commit 字段认作旧版干净代码；源码快照及逐文件 SHA-256 已归档。
- 测试源码与最终生产镜像的 app 文件摘要一致。构建后仅补交付文档，不改冻结源码快照或重写镜像指纹。
- 仅 viewer 替换；另外 23 个容器 ID、状态、启动时间和重启计数未变。既有挂载、环境变量、Tailscale Serve 路由未变。
- 上线前和生产浏览器检查后的关键计数相同：generations 738、card_annotations 29、learning_review_events 0、textbook_tracks 1、textbook_expressions 20。此检查不是全库字节不变证明。
- 六项健康探针在线：DeepSeek API、Kokoro、VOICEVOX、OCR、Storage、Selection TTS Cache。
- 生产浏览器拦截所有非 GET/HEAD 请求。实际阻断了 engagement、pronunciation telemetry、annotations POST；通过失败场景验证笔记提示和草稿保护，没有保存测试笔记。关闭后无残留 inert、滚动锁或临时 Highlight；页面无 JS 异常。

## 6. 原生实验与回退

仅对当前浏览器会话开启原生弹层，刷新后生效；默认正式访问不需要设置：

```js
sessionStorage.setItem('three-lans:native-overlays', '1');
location.reload();
```

强制兼容能力回退：

```js
sessionStorage.setItem('three-lans:web-platform', 'legacy');
location.reload();
```

恢复默认：删除上述两个 key 后刷新。不要将实验开关变成默认，直到人工兼容验收补齐。

发布资料目录：`/Users/colin/ThreeLANS/releases/mwg-abcd-20261113`。在线 SQLite 备份 `production.before.sqlite` 为 229552128 bytes，quick_check 为 ok，SHA-256 为 `58218bcfc1391e65f9a6cff4f77c952cf80bd73cacf09859fdd937c8d122eb48`；保留既有历史备份和回退镜像。

回退镜像 `three-lans-viewer:mwg-before-20261113` 对应原正式镜像 `sha256:28a3e2b34471be02e3e7928e7e4c98e05514e035aa119edcb7576ae0261aa170`。仅需应用回退时，在 X86-MAC 执行：

```sh
export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH
docker --context colima tag three-lans-viewer:mwg-before-20261113 three_lans_system-viewer:latest
/Users/colin/ThreeLANS/bin/compose up -d --no-build --no-deps --pull never viewer
```

这是镜像回退，不恢复数据库，不删除用户后续数据。回退后再检查 runtime、health、页面与挂载。

## 7. 交付位置

- 正式代码工作区：`/Users/colin/ThreeLANS/source-repository`；发布时 main 存在未提交改动，后续按明确文件清单提交。原有 `.claude/`、交接文档和其他文件保留，不批量暂存。
- 隔离开发工作区：`/Users/colin/ThreeLANS/worktrees/mwg-abcd-20261113`；`codex/mwg-abcd-20261113`，保留测试快照。
- 发布目录保存 `source.snapshot.tar`、`verified-app-files.sha256`、构建日志、`final-checks-evidence/`、`final-metrics/`、`verification.final.json`、`release-metadata.json`、备份及发布前运行资料。含配置的运行快照为私有资料，不加入 Git。
- 本机证据：`/Users/xueguodong/.codex/visualizations/2026/11/13/three-lans-mwg-implementation/evidence/`；含正式页笔记错误/学习页/手机探测截图、实机 Chrome 记录及性能数据。原本机项目目录不恢复。

下一步是人工兼容验收与现存集成失败的独立修复；用户已另行授权本次 commit/push。开发完成、正式部署、人工验收和 Git 提交是不同状态。
