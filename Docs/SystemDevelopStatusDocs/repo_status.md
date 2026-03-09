# Repo 架构与功能状态（最新）

**最后更新**: 2026-03-09
**版本**: 3.8.0

## 1. 项目定位

- 项目：Trilingual Records（三语学习卡片系统）
- 输入：文本 / OCR 图片
- 输出：三语学习卡片 / 日语语法卡片（Markdown + HTML）+ 例句语音
- 目标：在可观测和可评审前提下，持续提升生成质量

## 2. 当前架构

- 前端：
  - `public/index.html`（生成、列表、弹窗）
  - `public/dashboard.html`（Mission Control）
  - `public/knowledge-ops.html`（知识任务控制）
  - `public/knowledge-hub.html`（知识资产浏览）
- 后端：`server.js`（生成编排、对比、评审、实验导出）
- 服务层：`services/*`（LLM、OCR、TTS、few-shot、评审、观测、DB）
- 存储层：
  - 文件：按日期目录 `YYYYMMDD`
  - SQLite：28+ 张表（业务 + 观测 + 实验 + 评审 + TRAIN + 知识任务/知识物化）
- 部署：Docker Compose（viewer + ocr + tts-en + tts-ja）+ 宿主机 Gemini Gateway/Executor

## 3. 当前功能清单

### 3.1 生成与对比

- 单模型生成（local/gemini）
- 对比模式：同时产出 Gemini 与 Local 结果并给出对比指标
- 卡片类型：`trilingual` / `grammar_ja`
- 来源模式：`input` / `selection` / `ocr`
- 删除：支持按 `id` 或按 `folder/base` 删除并清理关联文件

### 3.2 评审与注入

- 卡片弹窗新增 `REVIEW` 页
- 例句级评分：原句/翻译/TTS（1~5）
- 支持决策与评论（推荐注入/不推荐注入/中立）
- TTS 独立下限：`tts < 3.0` 直接 rejected，防止低质量音频样本注入
- 批次统一 finalize 后更新注入资格
- 采样评审模式：支持 `allowPartial` + `minReviewRate`，大批次无需全量评审
- Finalize 回滚：已完成批次可回滚为 active，重置 eligibility 但保留原始评分
- few-shot 可开启 review-gated，优先使用 approved 样本
- 相似度加权选例：`phraseSim*0.8 + sentenceSim*0.2`，优先匹配 source_phrase

### 3.3 可观测与实验

- 单次生成记录：prompt/rawOutput/outputStructured/tokens/quality/latency
- 实验追踪：`few_shot_runs`、`experiment_rounds`、`experiment_samples`、`teacher_references`
- 导出链路：脚本生成 CSV/JSON/SVG/Markdown 报告

### 3.4 OCR/TTS

- OCR 默认 tesseract（支持 local/auto）
- EN/JA 语音生成并归档到对应卡片目录

### 3.5 历史卡片样式治理（v3.4）

- 外来语标注统一升级为独立高亮块（标签与内容分行）
- 前端弹窗渲染支持旧格式运行时兼容转换
- 后端后处理统一规范 `外来语标注` 输出格式
- 提供离线回填脚本：`npm run cards:migrate-style`
  - 对 `/data/trilingual_records` 下历史 md/html 批量回填
  - 支持幂等重跑（用于运维补偿）

### 3.6 文本选取静默队列生成（v3.5）

- 卡片 CONTENT 区域选中文本后可直接入后台任务队列
- 点击 `✦ Generate Card` 不跳转、不关闭卡片弹窗
- 队列串行执行（并发=1）并按顺序完成
- 日语选区采用 Ruby-aware 提取（忽略 `<rt>/<rp>` 注音）
- 提供队列状态面板（queued/running/success/failed）与失败重试

### 3.7 主输入 Generate 队列化（v3.5）

- 首页文本输入点击 `Generate` 同样改为任务入队
- 支持用户持续输入并批量排队，不阻塞前台交互
- 执行完成后静默刷新文件列表，不改变当前浏览上下文

### 3.8 日语语法卡片（v3.6）

- 新增主输入卡片类型切换：
  - `🧩 三语卡片`
  - `📘 日语语法`
- 新增选区生成按钮：`📘 语法卡`
- 语法卡缩略样式：淡蓝背景 + `语法` 标签
- 语法卡详情页：`JA GRAMMAR` 标识 + 中文语法说明 + 日语例句音频
- Mission Control 任务队列新增卡片类型标识（`三语/语法`）

### 3.9 字体与可读性优化（v3.6.1）

- 主页面与弹窗统一字体变量体系：`--font-ui / --font-ja / --font-display / --font-mono`
- 中/日/英混排优化：日语内容与 ruby 注音使用更适配的日文字体栈
- 指标与计时类信息切换到等宽数值（`tabular-nums`），降低面板视觉抖动
- 目标：在不改动布局的前提下，提升阅读舒适度与信息扫描效率

### 3.10 输入区紧凑化与日期格式优化（v3.6.2）

- 模型选择与卡片类型改为水平并排，降低首屏纵向占用
- 输入区组件（textarea、按钮、OCR 区）收缩为紧凑版
- 日期目录显示格式改为 `YYYY.MM.DD`，更符合常见阅读习惯
- 月分组显示为 `YYYY.MM`，保留原有目录键兼容性

### 3.11 选区标红稳定性修复（v3.6.3）

- 选区标红改为文本节点切片高亮算法，兼容跨节点与 ruby 场景
- 去除对 `execCommand('hiliteColor')` 的依赖，避免浏览器兼容性问题
- 标红范围上限提升至 2000 字，生成任务仍保持 200 字限制

### 3.12 标红后端持久化（v3.6.4）

- 新增 `card_highlights` 数据表，支持标红内容长期保存
- 标红数据改为前端缓存 + 后端持久化双写，避免刷新/重启后丢失
- 卡片弹窗支持服务端标红异步拉取与本地回填
- 新增 `/api/highlights/by-file` 读写删接口
- 新增 `/api/dashboard/highlight-stats` 聚合接口，为后续统计分析提供数据入口

### 3.13 OCR 清洗预览与队列状态条（v3.6.5~3.6.7）

- OCR 结果新增“原文/清洗后”双视图预览，默认写入清洗后单行文本
- Header 新增任务队列缩略状态条，空闲时固定显示 `Task Queue Idle`
- 运行中任务新增实时计时标签（`mm:ss`），用于快速判断队列阻塞点
- 学习卡片弹窗下调，避免遮挡顶部状态条
- Phrase List 按生成时间倒序展示（同日最新卡片优先）

### 3.14 Knowledge 页面拆分（v3.6.9）

- `Knowledge OPS` 与 `Knowledge Hub` 从 Mission Control 拆分为同级独立页面
- 首页右上角入口改为三按钮并列：Mission Control / Knowledge OPS / Knowledge Hub
- 三个页面 Header 内支持同级导航互跳
- `dashboard.js` 改为多页面安全初始化：
  - Mission Control 仅加载统计面板
  - Knowledge OPS / Hub 仅加载知识任务与结果视图
  - 公共基础设施状态与任务队列状态可复用
- 支持 UI 触发知识任务：`summary/index/issues_audit/synonym_boundary/grammar_link/cluster`
- 支持任务列表、任务详情、最新 summary 与只读结果预览
- 对应 API 已接通并在 2026-03-05 完成全量执行：
  - `summary/index/issues_audit/synonym_boundary/grammar_link/cluster` 全部 success
  - 全量结果：266 cards / 266 index / 156 issues / 4 grammar patterns / 4 clusters
- UI 验证报告：`Docs/TestDocs/UI_Validation_MissionControl_20260305.md`

### 3.15 Knowledge 同义边界与删除交互修复（v3.6.10）

- 修复 Knowledge Hub 同义边界详情偶发 404：
  - `pair_key/group_key` 查询统一做 trim + lowercase 归一
  - 无效 key 自动回退为稳定 `id:<rowId>` 形式，前后端可一致读取
  - 详情接口新增 `id:<id>` 直查路径，避免脏数据导致详情不可达
- 修复单卡弹窗删除交互稳定性：
  - 删除入口由原生 `confirm()` 改为卡片内嵌确认弹层（popover）
  - 新增稳定测试选择器：`card-delete-trigger/cancel/confirm`
  - 交互更稳定，避免浏览器阻塞弹窗影响自动化与批量操作

### 3.16 搭配与语块训练面板（v3.6.11）

- 单卡弹窗新增 `TRAIN` 标签页（与 CONTENT/INTEL 同级）。
- 基于当前卡片 Markdown 的例句，前端本地提取：
  - 英文 `collocations`（2~3 词搭配）
  - 日语 `chunks`（语块/语法片段）
- 训练页包含：
  - 搭配/语块示例（原句 + 中文释义）
  - 填空训练（可一键显示/隐藏答案）
- 无需改动主生成链路与数据库，作为轻量学习增强模块直接复用现有卡片内容。

### 3.17 TRAIN 高质量化与持久化（v3.7.0）

- 主卡片生成当次同步产出 `trainingPack`（不再仅依赖前端规则临时抽取）。
- 质量链路：Teacher LLM 生成 -> JSON/语义校验 -> 修复重试 -> heuristic 回退。
- 持久化：
  - DB 表：`card_training_assets`（status/source/quality/tokens/payload）
  - sidecar：`<base>.training.v1.json`（与卡片文件同目录）
- 新增 TRAIN API：
  - `GET /api/training/by-generation/:id`
  - `GET /api/training/by-file`
  - `POST /api/training/by-generation/:id/regenerate`
- 前端 TRAIN 页改为后端优先加载，展示来源标记（LLM高质量/修复后/规则回退）与质量指标，并支持手动重算。

### 3.18 TRAIN 历史回填稳态化（v3.7.1）

- 新增回填接口：
  - `GET /api/training/backfill/summary`
  - `POST /api/training/backfill`
- 历史回填链路切换为 `runtimeMode=backfill`：
  - 独立 timeout / executionTimeout / retry / retryDelay
  - 回填脚本增加客户端超时参数
  - timeout 场景可直接跳过 repair，避免长时间阻塞
- 在回填前主动读取 `18888 /health`：
  - `breaker_state=closed`：继续 teacher LLM 高质量生成
  - `breaker_state=open|half_open`：直接快速写入 `heuristic fallback`
- 当前策略重点是“批量任务可收敛”，不是在配额不足时强行降级 teacher 质量。
- 当前现场状态：
  - `gemini-gateway` 可能因 `gemini-3-pro-preview` 配额/容量紧张进入 `half_open`
  - 因此历史 TRAIN 回填建议在配额恢复后继续执行，以保证 `ready/repaired` 比例

### 3.19 TRAIN 全量补齐与质量验收（v3.7.2）

- 截至 `2026-03-08`，`TRAIN` 资产已完成全库覆盖：
  - `totalGenerations = 266`
  - `withTraining = 266`
  - `missingTraining = 0`
- 当前状态分布：
  - `ready = 265`
  - `repaired = 1`
  - `fallback = 0`
  - `failed = 0`
- 已完成对历史 `39` 个 fallback 的定向重算，全部提升为 `ready`。
- 全量结构校验结果：
  - `enCollocations` 最小值 `4`
  - `jaChunks` 最小值 `4`
  - `quizzes` 最小值 `4`
  - 不合格记录数 `0`
- 抽样验收结论：
  - grammar / technical / OCR / repaired 样本均具备实际学习价值
  - 当前主风险已从“回退数据残留”切换为“少量低分样本的二次精修”和“极少数长尾时延”
- 已整理 `qualityScore <= 95` 的精修候选清单：
  - `Docs/TestDocs/TRAIN_REFINEMENT_CANDIDATES_20260308.md`

### 3.20 TRAIN 低分样本精修与 UI 一致性验证（v3.7.3）

- 已对 `qualityScore <= 95` 的 `13` 条样本完成逐条精修，结果：
  - 提升 `13`
  - 持平 `0`
  - 下降 `0`
- 平均 `qualityScore`：
  - `92.42 -> 98.59`
- 当前全库低分样本数：
  - `qualityScore <= 95` 为 `0`
- 对 `409 / fiddling with`、`391 / 细枝末节`、`503 / 差不多` 做了人工导向二次修正：
  - 修复 EN 主训练单元与 quiz 正答一致性
  - 修复 JA 语块过度具体化问题
  - 强化“接近完成 / 勉强可接受”这类边界语义拆分
- 浏览器端已完成 `TRAIN` 页抽查：
  - `fiddling with`
  - `细枝末节`
  - `差不多`
  三个样本的 UI 展示与数据库/sidecar 数据一致，未发现旧缓存残留
- 对应报告：
  - `Docs/TestDocs/TRAIN_REFINEMENT_EXECUTION_20260308.md`
  - `Docs/TestDocs/TRAIN_QUALITY_ACCEPTANCE_20260308.md`

### 3.21 TRAIN 页选区交互增强（v3.7.4）

- `TRAIN` 页已支持选中文字后的三动作浮动工具条：
  - `✦ Generate Card`
  - `📘 语法卡`
  - `🖍 标红`
- 生成动作复用现有后台任务队列：
  - 不跳转
  - 不关闭当前卡片弹窗
  - 继续停留在当前 `TRAIN` 页浏览上下文
- `TRAIN` 页标红已支持持久化恢复：
  - 本地缓存 key 独立按 `scope=train`
  - 服务端仍复用 `/api/highlights/by-file`
  - 无需新增数据库表
- `TRAIN` 页恢复高亮后，`重新生成训练包` / `显示答案` 等交互仍可正常绑定
- 已完成 UI 验证并清理测试产物：
  - `Docs/TestDocs/UI_Validation_TRAIN_Selection_20260309.md`

### 3.22 Playwright E2E 引入（v3.8.0）

- 新增 Playwright 基础设施：
  - `playwright.config.js`
  - `scripts/startE2EServer.sh`
  - `tests/e2e/smoke.spec.js`
- 新增 `E2E_TEST_MODE=1`：
  - `/api/generate` 走固定 fixture
  - 仍会写入目录、数据库与 TRAIN 资产
  - 跳过真实 LLM/TTS 依赖，保证 smoke 稳定
- 首批 smoke 用例覆盖：
  - 首页加载
  - 主输入生成
  - 卡片弹窗 tab 切换
  - TRAIN 显示答案
  - TRAIN 选区生成
  - TRAIN 标红刷新恢复
  - 删除链路
- 已执行首轮 smoke 回归：
  - `npm run test:e2e:smoke`
  - 结果：`6 passed`
- 新增稳定测试选择器（`data-testid`）：
  - 首页输入、队列状态、文件/文件夹容器
  - 卡片弹窗、tab、TRAIN 面板、选区工具条
- 设计文档：
  - `Docs/DesignDocs/Playwright_E2E_Testing_Design.md`

## 4. 主线技术策略

- 默认主链路：Gemini CLI Proxy（host-proxy）
- Gemini `pro` 作为 teacher / 主高质量生成通道
- 质量优化主手段：few-shot + 人工评审门控 + 可观测闭环 + TRAIN 高质量训练包

## 5. 现阶段重点关注

1. 对 `qualityScore <= 95` 的 TRAIN 样本做二次精修与人工抽查
2. 扩大高质量样本池（teacher + approved）
3. 控制 token 膨胀，提升 gain per 1k token
4. 把观测指标升级为 SLO/门禁策略
5. 增强网关异常场景下的自恢复与告警

## 6. 关键文档入口

- `Docs/SystemDevelopStatusDocs/API.md`
- `Docs/SystemDevelopStatusDocs/BACKEND.md`
- `Docs/SystemDevelopStatusDocs/FRONTEND.md`
- `Docs/SystemDevelopStatusDocs/IMPLEMENTATION_STATUS.md`
- `Docs/TestDocs/UI_Validation_MissionControl_20260305.md`
- `Docs/TestDocs/TRAIN_QUALITY_ACCEPTANCE_20260308.md`
- `Docs/TestDocs/TRAIN_REFINEMENT_CANDIDATES_20260308.md`
- `Docs/TestDocs/TRAIN_REFINEMENT_EXECUTION_20260308.md`
- `Docs/DesignDocs/CodeAsPrompt/review_scoring_and_injection_gate.md`
- `Docs/SLIDES_OUTLINES.md`

---

**维护者**: Three LANS Team
