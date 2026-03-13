# 文本选取与主输入即时生成（共享队列版）

**版本**: v3.6
**日期**: 2026-03-02
**状态**: 已实施

## 1. 功能概述

在学习卡片 CONTENT 区域提供选区浮动按钮：

- `✦ Generate Card`（三语卡）
- `📘 语法卡`（日语语法卡）

并将首页主输入 `Generate` 入口升级为**静默入队**：

- 点击后任务直接写入服务端共享队列 `generation_jobs`
- 不关闭当前卡片弹窗
- 不跳转页面、不打断阅读

### 交互流程

```text
路径 A：用户在 #cardContent 中拖选文字
        ↓
浮动按钮出现在选区上方（✦ Generate Card）
        ↓
点击按钮
        ↓
Ruby-aware 选区归一化（剔除 <rt>/<rp> 注音）
        ↓
加入后台任务队列（queued）
        ↓
路径 B：首页主输入框点击 Generate
        ↓
输入文本直接加入同一后台任务队列（queued）
        ↓
viewer 内置 worker 串行执行（running -> success/failed）
        ↓
列表静默刷新（保持当前目录与当前卡片阅读上下文）
```

> v3.6 补充：同一选区可直接生成语法卡（`card_type=grammar_ja`，`source_mode=selection`）。

## 2. 技术实现

### 2.1 核心函数

| 函数 | 文件 | 职责 |
|------|------|------|
| `initSelectionToGenerate(container)` | `public/js/modules/app.js` | 创建 FAB、绑定选区事件、点击入队 |
| `checkSelection(container, fab)` | `public/js/modules/app.js` | 检测选区可用性并定位 FAB |
| `buildSelectionCandidateFromContainer(container)` | `public/js/modules/app.js` | 从选区构建可入队文本（含 Ruby-aware 处理） |
| `collectVisibleSelectionText(node, pieces)` | `public/js/modules/app.js` | 遍历 DOM 片段，过滤 UI 噪音节点与注音节点 |
| `normalizeSelectionPhrase(text)` | `public/js/modules/app.js` | 归一化短语（空白/标点/前缀清洗） |
| `enqueueBackgroundGenerationTask(...)` | `public/js/modules/app.js` | 调用 `POST /api/generation-jobs` 写入共享队列 |
| `syncGenerationQueueFromServer()` | `public/js/modules/app.js` | 轮询共享队列摘要与任务列表 |
| `services/generationJobService.js` | `services/generationJobService.js` | viewer 内置单 worker，串行执行共享队列 |

### 2.5 类型化任务（v3.6）

- 队列任务新增字段：
  - `cardType`: `trilingual | grammar_ja`
  - `sourceMode`: `input | selection | ocr`
- 队列去重策略升级：`phrase + cardType` 维度去重（允许同短语分别生成三语卡与语法卡）

### 2.2 Ruby-aware 选区处理策略

- 不直接使用 `window.getSelection().toString()` 作为任务短语
- 使用 `range.cloneContents()` 获取选区片段
- 遍历时过滤：`rt/rp/audio/button` 及音频按钮、外来语标签等 UI 节点
- 对 `ruby` 节点仅保留基底正文，不保留注音
- 若用户只选中注音（`rt`），尝试回退到最近 `ruby` 主体文本

### 2.3 队列执行策略

- 严格 FIFO 串行执行（`running` 始终最多 1 个）
- 任务状态：`queued / running / success / failed`
- 默认重试：2 次（指数退避）
- 支持手动“重试失败任务”与“清理已完成任务”
- 浏览器仅负责入队与展示；事实来源是 SQLite：
  - `generation_jobs`
  - `generation_job_events`
- `localStorage:generation_queue_snapshot_v1` 仅保留最近任务镜像，供 UI 快速回显，不再承担恢复职责

### 2.4 非打断式保证

- 点击 FAB 后不触发 `closeModal()`
- 不写入输入框，不触发主 Generate 按钮流程
- 不切换当前 tab/目录，不重置当前卡片滚动上下文
- 仅进行轻量列表刷新：`loadFolders({ keepSelection: true, refreshFiles: true })`

## 3. 样式设计

### 3.1 FAB 样式

- `selection-gen-fab` 维持蓝色高亮与轻动效
- 用于就地触发入队操作

### 3.2 队列面板样式（新增）

- 右下角悬浮面板：`gen-queue-panel`
- 展示摘要 + 最近任务列表 + toast
- 状态色：`running/success/failed`
- 操作按钮：重试失败、清理完成、折叠/展开

## 4. 调用链路

```text
renderCardModal()
  └── initSelectionToGenerate(cardContent)
        ├── mouseup/selectionchange -> checkSelection()
        └── click(FAB)
              -> buildSelectionCandidateFromContainer()
              -> enqueueBackgroundGenerationTask()
                    -> POST /api/generation-jobs
viewer worker
  └── pick queued job
        -> api.generate(...)
        -> scheduleQueueFolderRefresh()
```

## 5. 修改文件清单

| 文件 | 改动类型 |
|------|----------|
| `public/js/modules/app.js` | 选区入队逻辑、Ruby-aware 提取、共享队列轮询、队列面板渲染 |
| `public/js/modules/api.js` | `createGenerationJob()/listGenerationJobs()/getGenerationJobSummary()` 等共享队列接口 |
| `services/generationJobService.js` | 共享队列 worker 与任务状态流转 |
| `database/schema.sql` | `generation_jobs / generation_job_events` |
| `public/styles.css` | 新增任务队列面板样式与状态样式 |

## 6. 验收要点

1. 连续点击 `✦ Generate Card` 多次后，所有浏览器看到同一份队列状态。
2. 首页主输入可连续输入并连续点击 `Generate`，任务按顺序执行。
3. 执行期间当前卡片不关闭、不跳转。
4. 日语含注音选区生成任务短语不包含注音文本（`rt`）。
5. 失败任务可重试，成功任务会出现在对应日期目录下。
6. 页面刷新后会重新拉取共享队列，任务不会因浏览器重载丢失。

---

**维护者**: Three LANS Team
