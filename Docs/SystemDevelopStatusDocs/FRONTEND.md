# 前端架构文档

**项目**: Trilingual Records
**版本**: 3.6.9
**更新日期**: 2026-03-05

## 1. 前端目录

```text
public/
├── index.html
├── dashboard.html
├── knowledge-ops.html
├── knowledge-hub.html
├── styles.css
├── modern-card.css
├── observability.css
├── favicon-lan.svg
├── css/
│   └── dashboard.css
└── js/
    └── modules/
        ├── app.js
        ├── dashboard.js
        ├── api.js
        ├── store.js
        ├── utils.js
        ├── audio-player.js
        ├── info-modal.js
        └── virtual-list.js
```

## 2. 主界面布局（index）

```text
Header (TRILINGUAL RECORDS + Task Queue 状态条 + 页面入口组)
├─ 左侧：生成面板（文本输入 / OCR / 进度）
├─ 右侧：Phrase List（学习卡片列表）
└─ 下方：资源区 Tabs（文件夹 / 历史记录）
```

### 2.1 关键交互

- 点击主输入区 `Generate` 后任务入后台队列，可继续输入并连续点击生成
- 支持卡片类型切换：`三语卡片` / `日语语法卡片`
- 队列串行执行完成后静默刷新列表（保持当前目录与当前浏览上下文）
- 页面常驻操作时保持当前选中目录
- 页面刷新时默认显示最近日期目录
- Phrase List 按同日卡片生成时间倒序显示（最新优先）
- 卡片列表支持多列自适应显示
- 右上角入口并列：`Mission Control` / `Knowledge OPS` / `Knowledge Hub`
- 语法卡片在列表中显示淡蓝背景与 `语法` 标签
- 全站字体统一为中/日/英混排优化方案（方案A）：UI/JA/Mono/Display 四类字体变量
- 生成区进一步紧凑化：模型选择与卡片类型并排显示，输入区高度收缩，为 Date 区让出可视面积
- 日期目录展示改为习惯格式：`YYYY.MM.DD`（显示层），内部目录键仍保留 `YYYYMMDD`
- OCR 结果支持“原文/清洗后”双视图预览，默认展示清洗后单行文本用于生成前确认

## 3. 卡片弹窗（Viewer Modal）

### 3.1 单卡弹窗 Tabs

- `CONTENT`：卡片正文 + 例句音频 + **文本选取即时生成**
- `INTEL`：质量/Token/性能/Prompt/LLM Output
- `REVIEW`（有 generationId 时显示）：例句人工评分与评论

### 3.1.2 文本选取即时生成（v3.6）

- 在 CONTENT 区域拖选文字后，选区上方弹出浮动按钮：
  - `✦ Generate Card`（生成三语卡）
  - `📘 语法卡`（生成日语语法卡）
  - `🖍 标红`（对当前卡片正文执行持久化高亮）
- 点击按钮后直接进入后台任务队列，不关闭弹窗、不跳转页面
- 队列按顺序串行执行（并发=1），执行期间不打断当前卡片阅读
- 自动过滤音频按钮占位符 "▶"，选取超 200 字符时不弹出
- Ruby-aware 文本提取：忽略 `<rt>/<rp>` 注音，仅保留日语正文入队
- 仅在 CONTENT tab 内有效，INTEL / REVIEW tab 不触发
- 实现：`initSelectionToGenerate()` + `buildSelectionCandidateFromContainer()` + `enqueueBackgroundGenerationTask()` + `processGenerationQueue()` (app.js)
- 标红实现（2026-03-03 修复）：弃用 `surroundContents/execCommand` 单路径，改为文本节点切片包裹 `mark`，兼容跨节点选区（含 ruby）
- 标红持久化（2026-03-03 增强）：
  - 前端本地缓存（`localStorage`）+ 后端数据库双写
  - 打开卡片时会优先展示本地缓存，并异步回填/拉取服务端版本
  - 删除学习卡片时会同步清理对应标红数据

### 3.1.3 日语语法卡片（v3.6 新增）

- 输入区新增卡片类型选择器（`🧩 三语卡片` / `📘 日语语法`）
- 语法卡弹窗头部标识为 `JA GRAMMAR`
- 内容页显示 `CARD TYPE · 语法卡片`
- 与三语卡共享：删除、INTEL、REVIEW、队列、历史与可观测能力

### 3.1.1 外来语标注展示（v3.4 新增）

- 统一展示为独立高亮块：`loanword-block`
- 标签与内容分行：
  - 第一行：`外来语标注`
  - 第二行：`English → カタカナ` tag 列表
- 兼容旧卡片：
  - 弹窗渲染路径会在前端运行时规范化旧格式（`normalizeLoanwordAnnotations`）
  - 历史文件可通过迁移脚本离线回填为新格式

### 3.2 INTEL 页能力

- Prompt / LLM Output 支持 `RAW` / `STRUCT` 切换
- 支持一键复制
- 指标说明 `?` 按钮弹窗（info-modal）

### 3.3 REVIEW 页能力

- 每条例句评分：`原句 / 翻译 / TTS`（1~5）
- 决策：`推荐注入 / 不推荐注入 / 中立`
- 评论：文本备注
- 批次动作：
  - 创建批次、查看进度、刷新
  - 统一处理并入池（要求全量评审完成）
  - **采样处理**（绿色按钮）：跳过未评审样本，按 `minReviewRate=0.3` 门控（v3.3 新增）
  - **回滚**（红色按钮，二次确认）：已完成批次重置为 active（v3.3 新增）
  - **已完成** 标签（蓝色 badge）：finalized 批次状态标识（v3.3 新增）

## 4. 对比模式弹窗

- 左右双列并排显示 Gemini / Local 内容
- 同时支持 CONTENT 与 INTEL 对照
- 结果区含 winner 与 metrics 对比
- 支持按模型侧删除对应生成记录

## 5. Mission Control（dashboard）

定位：业务级统计大盘，服务"评审→注入→效果→调参"闭环（不再内嵌知识任务）

主要模块：

- Infrastructure（服务健康）
- Error Monitor（错误监控）
- Data Core（存储统计）
- Review Pipeline（评审管线：eligibility 分布 + campaign 进度）
- Few-shot Effectiveness（注入效果：baseline vs fewshot 对比）
- Token 趋势 / 延迟趋势 / Quality Signal（模板合规分）
- Live Feed（实时生成记录）/ Provider Split（供应商分布）
- Task Queue 顶部模块显示任务卡片类型（`三语/语法`）

### 5.1 独立页面：Knowledge OPS / Knowledge Hub

- `knowledge-ops.html`：知识任务控制台（启动/取消/列表/详情/summary）
- `knowledge-hub.html`：知识资产浏览页（index/issues/grammar/clusters/synonyms/relation inspector）
- 三页同级导航互跳：Mission Control / Knowledge OPS / Knowledge Hub

## 6. 状态管理与 API 封装

- 状态：`store.js`
  - `selectedFolder`、`selectedFile`
  - `llmProvider`、`modelMode`、`compareMode`
  - `cardType`
- API：`api.js`
  - 生成/OCR/历史/统计
  - `generate()` 支持扩展参数透传（`target_folder/card_type/source_mode`）以服务后台队列任务
  - 评审 campaign（创建/finalize/rollback）与评分提交
  - Knowledge Ops / Hub（任务启动/取消/列表/详情 + 物化结果查询）
  - 删除与文件读取

## 7. 视觉与可用性

- 主页面：浅色、内容密度高、卡片化
- 对比弹窗：宽视图对照优先
- Mission Control：仪表盘风格
- Knowledge OPS / Knowledge Hub：同级页面，沿用仪表盘视觉与信息卡布局
- 浏览器标签页图标：`favicon-lan.svg`（LAN）
- 外来语标注：左侧强调线 + 橙色高亮背景 + 粗体胶囊 tag（强调可读性）
- 静默任务队列面板：右下角显示待执行/执行中/成功/失败（支持重试失败与清理完成）
- 顶部 Header 常驻任务队列缩略状态条：运行中/等待中/空闲（Task Queue Idle）一目了然
  - 运行中新增实时计时器（`mm:ss`），显示当前任务已执行时长
- 学习卡片弹窗整体下调，避免遮挡顶部任务队列状态条
- 字体体系（2026-03-03）：
  - `styles.css` 与 `modern-card.css` 统一字体变量：`--font-ui / --font-ja / --font-display / --font-mono`
  - 默认正文采用 `--font-ui`，日语内容（含 ruby）优先 `--font-ja`
  - 指标与数字面板采用 `--font-mono` + `tabular-nums`，提升可读性与对齐稳定性

## 8. 与后端主线关系

- 前端不直接执行 few-shot 逻辑，只透传配置
- 单卡详细实验字段由 `observability.metadata` 驱动
- review-gated 流程通过评审 API 触发，最终由后端 finalize 后生效

---

**维护者**: Three LANS Team
