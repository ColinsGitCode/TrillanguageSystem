# 文本选取即时生成卡片（静默队列版）

**版本**: v3.5
**日期**: 2026-02-26
**状态**: 已实施

## 1. 功能概述

在学习卡片 CONTENT 区域保留选区浮动按钮（FAB）`✦ Generate Card`，但交互升级为**静默入队**：

- 点击后任务直接进入后台生成队列
- 不关闭当前卡片弹窗
- 不跳转页面、不打断阅读

### 交互流程

```text
用户在 #cardContent 中拖选文字
        ↓
浮动按钮出现在选区上方（✦ Generate Card）
        ↓
点击按钮
        ↓
Ruby-aware 选区归一化（剔除 <rt>/<rp> 注音）
        ↓
加入后台任务队列（queued）
        ↓
队列串行执行（running -> success/failed）
        ↓
列表静默刷新（保持当前目录与当前卡片阅读上下文）
```

## 2. 技术实现

### 2.1 核心函数

| 函数 | 文件 | 职责 |
|------|------|------|
| `initSelectionToGenerate(container)` | `public/js/modules/app.js` | 创建 FAB、绑定选区事件、点击入队 |
| `checkSelection(container, fab)` | `public/js/modules/app.js` | 检测选区可用性并定位 FAB |
| `buildSelectionCandidateFromContainer(container)` | `public/js/modules/app.js` | 从选区构建可入队文本（含 Ruby-aware 处理） |
| `collectVisibleSelectionText(node, pieces)` | `public/js/modules/app.js` | 遍历 DOM 片段，过滤 UI 噪音节点与注音节点 |
| `normalizeSelectionPhrase(text)` | `public/js/modules/app.js` | 归一化短语（空白/标点/前缀清洗） |
| `enqueueBackgroundGenerationTask(...)` | `public/js/modules/app.js` | 入队（去重、队列上限） |
| `processGenerationQueue()` | `public/js/modules/app.js` | 串行调度执行器（并发=1） |
| `runGenerationTaskFromQueue(task)` | `public/js/modules/app.js` | 调用 `api.generate()` 完成单任务生成 |

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
              -> processGenerationQueue()
                    -> runGenerationTaskFromQueue()
                         -> api.generate(...)
                    -> scheduleQueueFolderRefresh()
```

## 5. 修改文件清单

| 文件 | 改动类型 |
|------|----------|
| `public/js/modules/app.js` | 选区入队逻辑、Ruby-aware 提取、静默队列执行器、队列面板渲染 |
| `public/js/modules/api.js` | `generate()` 支持扩展参数（`target_folder` 等） |
| `public/styles.css` | 新增任务队列面板样式与状态样式 |

## 6. 验收要点

1. 连续点击 `✦ Generate Card` 多次后，任务按顺序串行执行。
2. 执行期间当前卡片不关闭、不跳转。
3. 日语含注音选区生成任务短语不包含注音文本（`rt`）。
4. 失败任务可重试，成功任务会出现在对应日期目录下。

---

**维护者**: Three LANS Team
