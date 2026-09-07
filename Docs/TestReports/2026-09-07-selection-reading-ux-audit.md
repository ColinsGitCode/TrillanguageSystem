# 阅读选区工具条 UI/UX 详细复测

日期：2026-09-07。范围：当前迭代的桌面端选区工具条、释义详情、范围调整、语境解释、阅读笔记及原有操作入口回归。

## 复测方式

- 使用隔离的 E2E SQLite、生成夹具和真实浏览器执行交互；不把接口测试代替 UI 操作。
- 新增 `tests/e2e/selection-reading-ux.spec.js`，17 个独立场景；共用选区/生成夹具提取到 `tests/e2e/fixtures/cardSelection.js`。
- 页面运行时异常会直接使新增测试失败。保存和刷新读取走真实隔离接口；延迟、服务失败和 AI 候选使用注明的模拟响应。
- 在线补验使用 `http://127.0.0.1:3010/` 的真实卡片“用户与权限管理”。

## 发现并修复的问题

| 问题 | 修复 | 回归证据 |
| --- | --- | --- |
| 释义编辑按 Esc 后焦点丢失 | 退出编辑恢复“纠正释义”按钮焦点，继续 Esc 逐层退出 | UX09 |
| 笔记按 Esc 可能连带关闭整张卡片 | 阻止默认退出行为，主弹窗尊重已处理事件，取消后恢复“更多”入口；焦点环补入 textarea/select | UX10 |
| 日语整句预览与复制文本不同，复制额外包含“例句1:” | 复制以工具条实际显示的 phrase 为准 | UX12 |
| 正文 DOM 刷新后原选区 Range 失效，调整范围抛异常 | 保存原始文本锚点，操作时重新解析；拒绝失效/折叠 Range | UX12、UX14、selectionScope 单测 |

最初 14 项专项测试为 12 通过、2 失败；扩大矩阵后发现另外两处产品问题。测试编写过程中也修正了异步界面等待及请求字段 `card_type` 的断言错误，没有把测试脚本错误计入产品缺陷。

## 功能覆盖矩阵

| 功能点 | 覆盖内容 | 证据/方式 |
| --- | --- | --- |
| 收起态摘要 | 已选文本、中文释义、待确认标识，默认不展示来源详情 | UX01，截图检查 |
| 展开/收起 | 来源、桥接提示、候选单选、焦点恢复、收起后保留候选 | UX01、UX09；词典候选模拟 |
| 释义纠正 | 空白禁用、取消不保存、新建、刷新读取、修改、失败保留草稿及重试 | UX02、UX03；真实隔离数据库，首次 503 模拟 |
| AI 释义候选 | 必须显式生成及接受，不自动保存；人工修订、拒绝 | UX06；候选/接受/拒绝响应模拟，服务域逻辑由既有测试覆盖 |
| 语境解释 | 不自动请求、显式生成、加载禁用防重复、失败重试、结果保留 | UX05；延迟/502/成功响应模拟，另有真实 DeepSeek 样本 |
| 解释隔离和门禁 | 换选区丢弃旧结果、未启用提示、输入长度/语境匹配、无词条或提案写入、沙箱高成本/额度策略 | 原有 stale-explanation E2E、UX04、localGlossary 单元/集成测试 |
| 范围调整 | 原选/词/短语/整句、日语基文不混入注音或播放控件、重复词定位、正文节点替换后的恢复 | UX12、UX14、既有范围 E2E、selectionScope 单测 |
| 复制与生成 | 日语整句的剪贴板、预览、三个卡片类型请求文本一致；source_mode=selection | UX12；真实剪贴板，三类入队响应模拟；实际队列另由既有 E2E 覆盖 |
| 阅读笔记 | 空白禁用、取消、创建、刷新后点击标记读取、修改、删除、保存失败保留草稿、重试 | UX07、UX08；真实隔离数据库，首次 409 模拟 |
| 朗读 | 0.8/1.0/1.2 倍速、播放/停止/重播、播放时禁用倍速 | UX13；模拟 Audio/音频接口；真实 VOICEVOX 另行补验 |
| 朗读回归 | 英/日语言识别、纯汉字语言确认、错误重试、关闭语言框焦点恢复、旧请求取消、音频互斥、功能关闭 | 既有 ST-P2 E2E |
| 标记/更多入口 | 保存标记、改色、取消；知识点查询传入选区；日语读音详情打开 | 既有 CA-I1/CA-P8/P4 E2E，在线读音详情入口补验 |
| 键盘交互 | 选区键盘入口、菜单 Enter/方向键/Esc、弹层逐级退出、文本框光标不被工具条方向键抢走 | UX09、UX10、既有 CA-P1/CA-I1 E2E |
| 布局 | 1024×768、1440×900，明/暗四组合；长释义、长笔记、无横向溢出、保存入口可见 | UX11 四场景，逐张查看截图 |
| 位置/原有功能 | 工具条上下定位、桌面边界、右键替换过期选区、注音显示开关、清洗安全 | 既有 P4/注音 E2E |

## 最终验证

`npm run test:acceptance` 最终完整执行通过，退出码 0，输出 `Architecture acceptance OK`。

| 检查 | 结果 |
| --- | --- |
| TypeScript / ESLint | 通过 |
| 单元测试 | 602/602 |
| 集成测试 | 119/119 |
| 构建、架构与资源预算 | 通过；CardModal 119.9 kB raw / 40.3 kB gzip |
| Production smoke | 7/7 |
| Chromium 功能及视觉回归 | 114/114，包含本轮专项 17/17；无跳过/重试 |

本地完整日志：`output/playwright/selection-ux-acceptance-final.log`。专项文件可通过 `npm run test:e2e -- tests/e2e/selection-reading-ux.spec.js` 单独重跑。

## 真实服务补验

- 日语例句2选中 `ユーザー`，右键工具条显示同一基文，展开显示 JMdict 英中桥接来源及“待确认”。
- 点击“解释此处用法”，`POST /api/local-glossary/explain` 返回 200，模型 `deepseek-v4-flash`。返回内容结合当前例句解释“用户”、与“権限管理”的并列关系及 `見直さないと` 语境。已查看实际渲染截图，未见乱码/注音混入。
- 点击朗读，`POST /api/tts/selection` 返回 200、`audio/wav`、provider=`voicevox`，请求为 `text=ユーザー, language=ja, speed=1`。观察到停止按钮，点击停止后显示重播。
- 从“更多”打开“查看日语读音详情”，读音面板正常出现。该浏览器会话控制台检查为 0 errors / 0 warnings。
- 以上提供商补验发生在本轮修复重建前的迭代镜像；修复后部署核验另记下节，避免混淆版本。

## 部署后核验

最终验收通过后执行：`docker compose -p three_lans_system up -d --build --no-deps viewer`，退出码 0。仅重建 viewer，OCR/TTS 容器未重建。

- 容器：`trilingual-viewer`；启动时间：2026-09-07 15:46:45 JST；RestartCount=0。
- 镜像 ID：`sha256:446131462b5f7df1309daa11941003596442b56040765ce9392ed8adf9c31a93`。
- `/api/health`：overallStatus=online、criticalOnline=true，DeepSeek、英语/日语 TTS、OCR、Storage、Selection TTS Cache 均 online；e2e_test_mode=false。
- `/api/local-glossary/capabilities`：contextExplanation=true。
- 刷新浏览器后重新打开真实卡片，纠正释义 Esc 恢复按钮焦点、笔记 Esc 恢复更多入口焦点，卡片仍可见。
- 选择“整句”并复制，预览和剪贴板均为 `ユーザーと権限管理を見直さないと、誰が何を編集できるかわからなくなってきた。`，一致性检查通过；切换“原选”恢复 `ユーザー`。
- 部署后截图 `output/playwright/ux-live-deployed.png` 已查看。重建日志：`output/playwright/selection-ux-viewer-rebuild.log`。

Compose 提示两个既有 volume 并非由当前 Compose 创建；本轮保留原卷，没有为了消除警告而删除/重建数据。启动日志未见应用错误。

## 截图与边界

已检查以下截图，文件保存在仓库忽略的 `output/playwright/`，未替换视觉基线：

- `ux01-compact.png`
- `ux11-light-1024.png`、`ux11-light-1440.png`
- `ux11-dark-1024.png`、`ux11-dark-1440.png`
- `ux-live-japanese-explained.png`
- `ux-live-deployed.png`

这是当前功能清单的桌面 Chromium 覆盖，不代表所有输入、所有浏览器或完整辅助技术认证。未验证 Safari/Firefox、移动端、屏幕阅读器，也未做人耳音质/发音准确率评测。真实 AI 仅验证一个上下文样本，不代表语义质量全库验收。

线上未创建、修改或删除真实卡片、笔记、词条；正常访问统计、释义反馈及 TTS 缓存可能随交互写入。没有迁移、清洗数据卷或修改服务开关。源码和报告暂未提交；既有交接文档保持不动。
