# Repo 架构与功能状态（最新）

**最后更新**: 2026-03-03
**版本**: 3.6.6

## 1. 项目定位

- 项目：Trilingual Records（三语学习卡片系统）
- 输入：文本 / OCR 图片
- 输出：三语学习卡片 / 日语语法卡片（Markdown + HTML）+ 例句语音
- 目标：在可观测和可评审前提下，持续提升生成质量

## 2. 当前架构

- 前端：`public/index.html`（生成、列表、弹窗） + `public/dashboard.html`（Mission Control）
- 后端：`server.js`（生成编排、对比、评审、实验导出）
- 服务层：`services/*`（LLM、OCR、TTS、few-shot、评审、观测、DB）
- 存储层：
  - 文件：按日期目录 `YYYYMMDD`
  - SQLite：16 张表（业务 + 观测 + 实验 + 评审）
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

### 3.13 OCR 清洗预览与队列状态条（v3.6.5~3.6.6）

- OCR 结果新增“原文/清洗后”双视图预览，默认写入清洗后单行文本
- Header 新增任务队列缩略状态条，空闲时固定显示 `Task Queue Idle`
- 学习卡片弹窗下调，避免遮挡顶部状态条
- Phrase List 按生成时间倒序展示（同日最新卡片优先）

## 4. 主线技术策略

- 默认主链路：本地 LLM
- Gemini 作为 teacher / 对照 /补充通道（host-proxy）
- 质量优化主手段：few-shot + 人工评审门控 + 可观测闭环

## 5. 现阶段重点关注

1. 扩大高质量样本池（teacher + approved）
2. 控制 token 膨胀，提升 gain per 1k token
3. 把观测指标升级为 SLO/门禁策略
4. 增强网关异常场景下的自恢复与告警

## 6. 关键文档入口

- `Docs/SystemDevelopStatusDocs/API.md`
- `Docs/SystemDevelopStatusDocs/BACKEND.md`
- `Docs/SystemDevelopStatusDocs/FRONTEND.md`
- `Docs/SystemDevelopStatusDocs/IMPLEMENTATION_STATUS.md`
- `Docs/DesignDocs/CodeAsPrompt/review_scoring_and_injection_gate.md`
- `Docs/SLIDES_OUTLINES.md`

---

**维护者**: Three LANS Team
