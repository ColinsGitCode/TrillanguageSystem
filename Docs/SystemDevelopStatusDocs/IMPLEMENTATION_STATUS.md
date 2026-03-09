# 实现状态报告

**日期**: 2026-03-09
**版本**: v3.7.4
**状态**: 进行中（主链路稳定；TRAIN 已全量持久化、精修完成，并补齐 TRAIN 页选区交互）

## 1. 当前阶段结论

- 生成主链路（文本/OCR -> 卡片 -> 音频 -> 落库）稳定
- few-shot 实验追踪与导出链路可复现
- 人工评分/评论与 review-gated 注入机制已落地
- Knowledge Ops / Knowledge Hub 已从 Mission Control 拆分为独立页面，可同级访问
- TRAIN 历史资产已全量补齐，当前主要问题已从“缺失/回退”转为“长期质量闭环与后续知识复用”

## 2. 已完成能力

### 2.1 生成与对比

- `POST /api/generate` 支持单模型与 `enable_compare=true` 对比模式
- `provider_requested/provider_used/fallback` 可明确回退链路
- 生成后自动保存 `md/html/meta/audio` 并写入数据库

### 2.2 OCR 与 TTS

- OCR 支持 `tesseract/local/auto`
- `auto` 模式下可从 tesseract 回退到 local OCR
- 英语与日语例句可批量生成音频并随记录持久化

### 2.2.4 日语语法卡片（v3.6 新增）

- 新增 `card_type=grammar_ja` 生成链路（与三语卡并行）
- 语法卡内容：中文语法说明 + 日语例句 + 日语例句音频
- 保持日期目录落盘策略，与三语卡共存于同一 `YYYYMMDD` 目录
- 生成入口覆盖：
  - 主输入区（队列化）
  - 卡片内选中文本（队列化）
- 队列快照、Mission Control、历史记录均可识别 `card_type/source_mode`

### 2.2.1 历史卡片样式治理（v3.4 新增）

- 外来语标注统一改为”独立高亮块”展示，不与中文释义同一行
- 后端后处理兼容旧格式：`外来语标注: ...` 与同行内嵌形式
- 前端弹窗渲染增加运行时兼容转换，历史卡片可即刻显示新样式
- 提供离线迁移脚本：`scripts/updateLegacyCardStyle.js`
  - 支持 `--apply` 批量回填 volume 内历史 md/html
  - 幂等可重复执行，便于后续运维巡检

### 2.2.2 文本选取即时生成（v3.5 新增）

- 卡片 CONTENT 区域支持拖选文字后弹出浮动按钮 “✦ Generate Card”
- 点击按钮不再跳转；任务直接加入后台队列，继续停留在当前卡片页面
- 队列严格串行执行（并发=1），按加入顺序逐个完成
- 自动过滤音频按钮占位符，限制选取长度 ≤200 字符
- Ruby-aware 提取：忽略 `<rt>/<rp>` 注音，只将正文日语文本入队
- 提供轻量队列面板：状态展示 + 失败重试 + 已完成清理
- 仅作用于 CONTENT tab，INTEL / REVIEW tab 不触发

### 2.2.3 主输入 Generate 队列化（v3.5 增强）

- 主输入区点击 `Generate` 改为“入后台任务队列”，不再占用前台生成状态
- 支持连续输入与连续点击，任务按队列顺序串行执行
- 生成执行期间保持当前页面与当前卡片阅读状态，不自动跳转
- 队列任务与选区任务共用同一执行器与重试策略（并发=1）

### 2.3 可观测与实验

- `observability` 包含 tokens、quality、performance、prompt/output 快照
- few-shot 追踪表已稳定写入：
  - `few_shot_runs`
  - `few_shot_examples`
  - `experiment_samples`
  - `experiment_rounds`
  - `teacher_references`
- 导出脚本与图表脚本可生成报告级产物（CSV/JSON/SVG/MD）

### 2.4 人工评审与注入门控

- 自动解析卡片例句入 `example_units` 样本池
- UI 支持 3 维评分（原句/翻译/TTS）+ 决策 + 评论
- 批次机制支持”统一处理并入池”（finalize）
- finalize 后更新 `eligibility`（pending/approved/rejected）
- few-shot 可启用 review-gated 优先注入 `approved` 样本

### 2.6 Mission Control 业务化重构（v3.5 新增）

- 删除虚荣指标面板（API Fuel / Model Arena / Cost Trend）
- 新增 Review Pipeline 面板：eligibility 分布 + campaign 进度 + 评审活动折线
- 新增 Few-shot Effectiveness 面板：baseline vs fewshot 对比 + 注入率 + fallback 原因
- 补全 Error Monitor 渲染（原空壳）
- Quality Signal 降级为 mini 指示卡，注明仅为模板合规分
- 后端新增 `getReviewStats()` / `getFewShotStats()` 聚合查询 + 2 条 API 路由

### 2.7 评审机制增强（v3.3 新增）

- **TTS 独立下限**：`computeEligibility` 新增 `minTts=3.0` 门控，tts 低于阈值直接 rejected，防止 overall 达标但音频不可用的样本注入
- **采样评审模式**：`finalizeCampaign` 支持 `allowPartial=true` + `minReviewRate` 参数，大批次可按比例抽样评审后 finalize
- **Finalize 回滚**：新增 `rollbackCampaign` 方法 + `POST /api/review/campaigns/:id/rollback` 路由，事务性重置 eligibility/scores 但保留原始评分记录
- **相似度加权**：few-shot 选例从 `Math.max(phraseSim, sentenceSim)` 改为 `phraseSim*0.8 + sentenceSim*0.2`，抑制长句噪声匹配

### 2.8 字体系统优化（v3.6.1 新增）

- 前端主页面与卡片弹窗统一为中/日/英混排字体方案（方案 A）
- 在 `styles.css` 与 `modern-card.css` 中落地四类字体变量：
  - `--font-ui`：通用 UI 与正文
  - `--font-ja`：日语句子与注音场景
  - `--font-display`：标题与强调文本
  - `--font-mono`：指标、计时、token、技术字段
- 数字面板启用 `tabular-nums`，修复统计值宽度抖动
- `ruby/rt` 注音字号与间距同步优化，减少日语行高拥挤

### 2.9 生成区紧凑化与日期展示优化（v3.6.2 新增）

- 生成区 UI 压缩：模型选择与卡片类型改为同一行并排布局，输入与按钮高度整体下调
- Date 区空间扩大：减少生成区上方控件占用，提升日期目录可见行数
- 日期显示格式优化：目录按钮显示 `YYYY.MM.DD`，月份分组显示 `YYYY.MM`
- 保持兼容：目录实际存储与 API 仍使用 `YYYYMMDD`

### 2.10 选区标红稳定性修复（v3.6.3 新增）

- 修复选区标红在复杂 DOM（ruby/多节点）下失效问题
- 原逻辑 `surroundContents + execCommand` 容易在跨节点选区失败
- 新逻辑改为“文本节点切片高亮”：
  - 遍历文本节点并计算与选区的交集区间
  - 对有效片段执行 `splitText + mark.study-highlight-red` 包裹
  - 自动跳过 `rt/rp/button/audio/source` 等不可高亮节点
- 生成与标红长度门限分离：
  - 生成任务仍为 200 字上限
  - 标红允许更长选区（2000 字）用于阅读批注

### 2.11 标红后端持久化与统计接口（v3.6.4 新增）

- 新增数据库表 `card_highlights`：按 `folder_name + base_filename + source_hash` 唯一存储卡片标红 HTML 快照
- 标红保存改为双通路：
  - 本地 `localStorage`（快速回显）
  - 服务端 `/api/highlights/by-file`（持久化 + 跨会话）
- 卡片弹窗打开时新增服务端回填：若服务端有同源哈希版本，则覆盖本地临时状态并重新绑定音频按钮
- 删除卡片时同步清理标红：
  - `/api/records/:id`、`/api/records/by-file` 均会触发标红数据删除
- 新增统计接口 `/api/dashboard/highlight-stats`：
  - 总卡片数、总标记数、平均标记数、高亮字符数、按 provider/cardType 分布、近 90 天趋势

### 2.12 OCR 结果清洗与双视图预览（v3.6.5 新增）

- OCR 识别结果在写入主输入框前新增字符串清洗：
  - 多行转单行
  - 去除常见噪声特殊字符
  - 压缩空白与中日文空格规范化
- 新增 OCR 预览组件：`清洗后` / `原文` 双 tab
- 默认显示 `清洗后`，便于“生成前人工确认”

### 2.13 队列可见性与列表顺序优化（v3.6.6~v3.6.7）

- Header 新增任务队列缩略状态条：
  - 运行中显示当前任务短语、序号、卡片类型与待/成/失计数
  - 运行中新增实时计时（`mm:ss`），用于观察单任务耗时
  - 无任务显示 `Task Queue Idle`
- 学习卡片弹窗下移，避免遮挡顶部状态条
- Phrase List 同日卡片排序改为“生成时间倒序（最新优先）”：
  - 优先按 `meta.created_at`
  - 缺失时回退 `.html mtime`

### 2.14 Knowledge Ops 与全量分析验证（v3.6.8）

- Knowledge Ops 页面（`knowledge-ops.html`）支持：
  - task type / scope / batch size 输入
  - start、jobs 列表、job detail、latest summary 展示
- Knowledge Hub 页面（`knowledge-hub.html`）支持：
  - summary/index/issues/grammar/clusters/synonyms 只读浏览
  - relation inspector 术语关联查询
- Mission Control 页面（`dashboard.html`）专注业务统计，不再混入知识任务操作
- 前端新增 API 封装：
  - `startKnowledgeJob/getKnowledgeJobs/getKnowledgeJob/cancelKnowledgeJob`
  - `getKnowledgeSummaryLatest/getKnowledgeIndex/getKnowledgeIssues/getKnowledgeGrammar/getKnowledgeClusters/getKnowledgeSynonyms`
- 后端知识任务 API 已接通并通过预检：
  - `POST /api/knowledge/jobs/start`
  - `GET /api/knowledge/jobs` / `GET /api/knowledge/jobs/:id`
  - `POST /api/knowledge/jobs/:id/cancel`
  - `GET /api/knowledge/summary/latest` / `index` / `issues` / `grammar` / `clusters` / `synonyms`
- 2026-03-05 全量任务执行结果（success）：
  - `summary/index/issues_audit/synonym_boundary/grammar_link/cluster`
  - 总卡片：266；index 条目：266；issues：156；grammar patterns：4；clusters：4
- UI 验证报告已落地：
  - `Docs/TestDocs/UI_Validation_MissionControl_20260305.md`

### 2.15 知识页面拆分与多页初始化（v3.6.9）

- Mission Control 与知识能力拆分为三个同级页面：
  - `dashboard.html`（Mission Control）
  - `knowledge-ops.html`（任务控制）
  - `knowledge-hub.html`（结果浏览）
- 首页右上角入口改为三按钮组（同级入口）
- `dashboard.js` 增加页面类型识别（`data-dashboard-page`）：
  - Mission Control 页面只初始化统计逻辑
  - Knowledge OPS/Hub 页面只初始化 knowledge 相关逻辑
  - 公共模块（基础设施状态、任务队列）跨页面复用
- `dashboard.js` 增加空 DOM 容错，避免多页面复用时因缺失节点抛错
- 修复知识关联查询排序歧义（`getKnowledgeTermRelations` 使用 `t.score/t.updated_at`）

### 2.16 P1/P2 稳定性修复（v3.6.10）

- P1（Knowledge Hub 同义边界详情 404）：
  - 同义边界 key 统一归一（trim/lowercase）
  - 列表 key 失效时回退 `id:<rowId>`
  - 详情接口支持 `id:<id>` 直查与 `pair_key/group_key` 兼容查询
- P2（单卡弹窗删除交互不稳定）：
  - 删除确认从原生 `confirm()` 改为弹窗内 popover
  - 增加稳定测试选择器（trigger/cancel/confirm）
  - 删除链路保持兼容：优先按记录 id，失败回退按 `folder/base` 删除

### 2.17 搭配与语块训练功能（v3.6.11）

- 单卡弹窗新增 `TRAIN` 页签，作为学习强化层。
- 前端本地解析卡片 Markdown：
  - 提取英文例句并抽取 `collocation` 候选
  - 提取日语例句并抽取 `chunk` 候选（兼容注音文本）
- 训练面板提供：
  - 搭配/语块清单（原句 + 翻译）
  - 填空练习（答案显隐切换）
- 该能力不改变生成链路，不引入新 API/新表，属于 UI 侧低风险增强。

### 2.18 TRAIN 高质量化、全量回填与精修闭环（v3.7.x）

- `POST /api/generate` 已支持同步产出 `trainingPack`，并持久化到：
  - `card_training_assets`
  - `<base>.training.v1.json`
- 历史卡片 TRAIN 资产已完成全量补齐：
  - `totalGenerations = 266`
  - `withTraining = 266`
  - `missingTraining = 0`
- 当前状态分布：
  - `ready = 265`
  - `repaired = 1`
  - `fallback = 0`
  - `failed = 0`
- 已完成对旧 `fallback` 样本的定向重算，全部提升为可用高质量资产
- 已完成 `qualityScore <= 95` 的 13 条低分候选精修：
  - 平均 `qualityScore`：`92.42 -> 98.59`
  - 当前低分候选数：`0`
- 已对 3 条代表样本做人工导向二次修正：
  - `409 / fiddling with`
  - `391 / 细枝末节`
  - `503 / 差不多`
- 已完成浏览器端 TRAIN UI 一致性抽查，验证前端展示与数据库/sidecar 数据一致
- 验收与执行报告：
  - `Docs/TestDocs/TRAIN_QUALITY_ACCEPTANCE_20260308.md`
  - `Docs/TestDocs/TRAIN_REFINEMENT_CANDIDATES_20260308.md`
  - `Docs/TestDocs/TRAIN_REFINEMENT_EXECUTION_20260308.md`

### 2.19 TRAIN 页选区生成与标红恢复（v3.7.4）

- `TRAIN` 页已支持选区工具条，与 `CONTENT` 页保持一致：
  - `✦ Generate Card`
  - `📘 语法卡`
  - `🖍 标红`
- 选区生成动作已接入现有后台任务队列：
  - 来源仍为 `selection`
  - 页面保持在当前卡片弹窗，不自动跳转
- `TRAIN` 页标红采用独立 highlight context：
  - `CONTENT` 与 `TRAIN` 分别计算 `sourceHash`
  - 本地缓存 key 按 `scope=content/train` 区分
  - 服务端继续复用 `card_highlights`
- 为支持 `TRAIN` 页恢复后的控件可用性，前端净化白名单已保留：
  - `data-answer`
  - `data-action`
  - `data-target`
  - `data-view`
- UI 回归已验证：
  - 选区生成三语卡成功
  - 选区生成语法卡成功
  - 标红刷新后可恢复
  - 高亮恢复后 `重新生成训练包 / 显示答案` 按钮仍可用
- 测试报告：
  - `Docs/TestDocs/UI_Validation_TRAIN_Selection_20260309.md`

### 2.18 TRAIN 高质量化（v3.7.0）

- 生成链路新增同步阶段：主卡片完成后立即生成 `trainingPack`。
- 训练包策略：`LLM 生成 -> 强校验 -> 修复重试 -> heuristic 回退`。
- 新增后端接口：
  - `GET /api/training/by-generation/:id`
  - `GET /api/training/by-file`
  - `POST /api/training/by-generation/:id/regenerate`
- 持久化策略落地：
  - DB 主存：`card_training_assets`
  - 同目录 sidecar：`<base>.training.v1.json`
- 前端 TRAIN 页改为后端优先加载，并显示来源/状态/质量分，支持手动重算。

### 2.19 TRAIN 历史回填稳态化（v3.7.1）

- 新增历史回填接口：
  - `GET /api/training/backfill/summary`
  - `POST /api/training/backfill`
- 回填链路增加 `runtimeMode=backfill`：
  - 独立 timeout / executionTimeout / retry
  - 回填脚本增加客户端超时
  - timeout 场景可跳过 repair，避免双倍等待
- 回填前读取 Gateway `18888 /health`：
  - 若 `breaker_state != closed`，直接快速落 `heuristic fallback`
  - 目标是保证批量回填“收敛优先”，不因单卡或单轮上游异常挂死
- 当前高质量策略不变：历史大批量回填仍建议在 `gemini-3-pro-preview` 配额恢复后继续执行。

### 2.20 TRAIN 全量完成与抽样验收（v3.7.2）

- 截至 `2026-03-08`，`TRAIN` 资产已完成全库覆盖：
  - `totalGenerations = 266`
  - `withTraining = 266`
  - `missingTraining = 0`
- 当前状态分布：
  - `ready = 265`
  - `repaired = 1`
  - `fallback = 0`
  - `failed = 0`
- 已完成 `39` 个历史 fallback 的定向重算，全部提升为 `ready`。
- 全量结构校验：
  - `enCollocations >= 4`
  - `jaChunks >= 4`
  - `quizzes >= 4`
  - 不合格记录数 `0`
- 抽样验收覆盖 grammar / technical / OCR / repaired 样本，结论为：
  - 内容不只是“结构满足 schema”，而是具备可直接用于学习训练的搭配、语块和题目
  - 现阶段主要优化点已转为低分样本精修与长尾时延治理
- 已输出低分样本精修清单：
  - `Docs/TestDocs/TRAIN_REFINEMENT_CANDIDATES_20260308.md`

### 2.5 Gemini host-proxy 稳定化

- 容器通过 Gateway `18888` 调用宿主机执行器
- 支持 `model` 透传、重试、超时 reset、fallback
- 当前默认模型链路为 `gemini-3-pro-preview`

## 3. 当前主要风险

1. approved 样本池规模不足时，review-gated 提升有限
2. few-shot 注入在部分场景仍会带来 token 膨胀
3. Gemini 上游链路受宿主机执行器状态影响
4. `gemini-3-pro-preview` 配额不足时，18888 Gateway 可能进入 `open/half_open`，导致 TRAIN 历史回填快速 fallback 而非高质量 ready
4. ~~规则评分与人工质量感知仍存在偏差~~ → 已通过 TTS 独立下限缓解
5. 并发场景下 rollback + finalize 的竞态尚未测试
6. 少量历史异常卡片仍可能包含“非结构化调试文本”混入正文，需二次清洗规则
7. 当前任务队列仅前端内存态，页面刷新会丢失未完成队列（待持久化）
8. 选中文本直接入语法队列时，若选区含中日混合整句，baseName 可能偏长（建议后续增加归一化截断）
9. 当前字体方案为系统字体栈，跨终端一致性仍受操作系统字体安装情况影响（后续可选自托管 webfont）
10. `cancel` 在极短任务场景会出现“已完成导致取消失败”的竞态（表现为 `cancelled=false`），需通过最小执行时间或更细粒度状态机优化体验

## 4. 下一步重点

1. 对 `qualityScore <= 95` 的 TRAIN 样本做二次精修与人工抽查
2. 利用采样评审 + 回滚能力，快速扩充高质量 approved 样本池
3. 优化 `tokenBudgetRatio/exampleMaxChars`，压缩增量 token
4. 将观测指标门禁化（SLO + 发布阈值）
5. 把评审结果与实验结果联动，形成“评分→注入→效果→回滚调参”闭环
6. 对语法卡入口增加选区清洗策略（去翻译行、保留核心语法点）
7. 基于 `knowledge_issues` 开展第一轮治理（audio_missing / format_anomaly / duplicate_phrase），并建立修复后重跑基线

## 5. 关键文档索引

- API：`Docs/SystemDevelopStatusDocs/API.md`
- 后端：`Docs/SystemDevelopStatusDocs/BACKEND.md`
- 前端：`Docs/SystemDevelopStatusDocs/FRONTEND.md`
- 最新仓库状态：`Docs/SystemDevelopStatusDocs/repo_status.md`
- Mission Control UI 验证：`Docs/TestDocs/UI_Validation_MissionControl_20260305.md`
- TRAIN 验收报告：`Docs/TestDocs/TRAIN_QUALITY_ACCEPTANCE_20260308.md`
- TRAIN 精修清单：`Docs/TestDocs/TRAIN_REFINEMENT_CANDIDATES_20260308.md`
- TRAIN 精修执行报告：`Docs/TestDocs/TRAIN_REFINEMENT_EXECUTION_20260308.md`
- 评分机制设计：`Docs/DesignDocs/CodeAsPrompt/review_scoring_and_injection_gate.md`
- AI Agent 可观测 slides：`Docs/SLIDES_OUTLINES.md`
- 卡片 UI 优化 v3.4：`Docs/SystemDevelopStatusDocs/CARD_UI_OPTIMIZATION_v3.4.md`
- 文本选取即时生成 v3.5：`Docs/SystemDevelopStatusDocs/SELECTION_TO_GENERATE_v3.5.md`
- 日语语法卡与类型化队列 v3.6：`Docs/SystemDevelopStatusDocs/FRONTEND.md` / `Docs/SystemDevelopStatusDocs/API.md`

---

**维护者**: Three LANS Team
