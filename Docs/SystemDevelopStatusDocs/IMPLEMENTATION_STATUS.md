# 实现状态报告

**日期**: 2026-03-03
**版本**: v3.6.2
**状态**: 进行中（主链路稳定，已新增日语语法卡片与类型化队列）

## 1. 当前阶段结论

- 生成主链路（文本/OCR -> 卡片 -> 音频 -> 落库）稳定
- few-shot 实验追踪与导出链路可复现
- 人工评分/评论与 review-gated 注入机制已落地
- 主要瓶颈从“机制缺失”转为“样本质量与成本效率平衡”

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

### 2.5 Gemini host-proxy 稳定化

- 容器通过 Gateway `18888` 调用宿主机执行器
- 支持 `model` 透传、重试、超时 reset、fallback
- 当前默认模型链路为 `gemini-3-pro-preview`

## 3. 当前主要风险

1. approved 样本池规模不足时，review-gated 提升有限
2. few-shot 注入在部分场景仍会带来 token 膨胀
3. Gemini 上游链路受宿主机执行器状态影响
4. ~~规则评分与人工质量感知仍存在偏差~~ → 已通过 TTS 独立下限缓解
5. 并发场景下 rollback + finalize 的竞态尚未测试
6. 少量历史异常卡片仍可能包含“非结构化调试文本”混入正文，需二次清洗规则
7. 当前任务队列仅前端内存态，页面刷新会丢失未完成队列（待持久化）
8. 选中文本直接入语法队列时，若选区含中日混合整句，baseName 可能偏长（建议后续增加归一化截断）
9. 当前字体方案为系统字体栈，跨终端一致性仍受操作系统字体安装情况影响（后续可选自托管 webfont）

## 4. 下一步重点

1. 利用采样评审 + 回滚能力，快速扩充高质量 approved 样本池
2. 优化 `tokenBudgetRatio/exampleMaxChars`，压缩增量 token
3. 将观测指标门禁化（SLO + 发布阈值）
4. 把评审结果与实验结果联动，形成”评分→注入→效果→回滚调参”闭环
5. 对语法卡入口增加选区清洗策略（去翻译行、保留核心语法点）

## 5. 关键文档索引

- API：`Docs/SystemDevelopStatusDocs/API.md`
- 后端：`Docs/SystemDevelopStatusDocs/BACKEND.md`
- 前端：`Docs/SystemDevelopStatusDocs/FRONTEND.md`
- 最新仓库状态：`Docs/SystemDevelopStatusDocs/repo_status.md`
- 评分机制设计：`Docs/DesignDocs/CodeAsPrompt/review_scoring_and_injection_gate.md`
- AI Agent 可观测 slides：`Docs/SLIDES_OUTLINES.md`
- 卡片 UI 优化 v3.4：`Docs/SystemDevelopStatusDocs/CARD_UI_OPTIMIZATION_v3.4.md`
- 文本选取即时生成 v3.5：`Docs/SystemDevelopStatusDocs/SELECTION_TO_GENERATE_v3.5.md`
- 日语语法卡与类型化队列 v3.6：`Docs/SystemDevelopStatusDocs/FRONTEND.md` / `Docs/SystemDevelopStatusDocs/API.md`

---

**维护者**: Three LANS Team
