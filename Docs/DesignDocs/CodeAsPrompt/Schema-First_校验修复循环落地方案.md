# Schema-First + 校验/修复循环落地方案（基于当前工程）

## 1. 目标
- 在不改模型权重前提下，提升输出结构稳定性与线上成功率。
- 通过“先约束、再校验、再定点修复”降低格式错误、字段缺失、音频任务异常。

---

## 2. 当前工程可直接复用的基础
- 生成入口与校验：`/Users/xueguodong/WorkTechDir/Three_LANS_PJ_CodeX/server.js`
  - `validateGeneratedContent`
  - 单模型与对比模式流程（均已包含后处理和基础校验）
- 内容后处理：`/Users/xueguodong/WorkTechDir/Three_LANS_PJ_CodeX/services/contentPostProcessor.js`
  - 外来语标注迁移、日语中文翻译清洗、音频文本清洗、重复段落去重
- Markdown 结构解析：`/Users/xueguodong/WorkTechDir/Three_LANS_PJ_CodeX/services/markdownParser.js`
- 音频任务补全与 HTML 注入：`/Users/xueguodong/WorkTechDir/Three_LANS_PJ_CodeX/services/htmlRenderer.js`
- 质量评估与可观测：`/Users/xueguodong/WorkTechDir/Three_LANS_PJ_CodeX/services/observabilityService.js`
- 错误入库：`/Users/xueguodong/WorkTechDir/Three_LANS_PJ_CodeX/services/databaseService.js`（`generation_errors`）

---

## 3. 可落地项（按优先级）

## 3.1 输出契约硬化（Schema-First）
- 将校验分为两层：
  - **Hard Rule（失败即拦截）**
    - `markdown_content` 必须存在且可解析。
    - 三语主结构必须可识别（标题 + 章节）。
  - **Soft Rule（可修复）**
    - `html_content` 可后端重建。
    - `audio_tasks` 缺失可从 markdown 推导补全。
- 推荐新增 `schema_version`（如 `v1`）到元数据，支持后续迭代。

## 3.2 Markdown 结构校验器
- 基于 `parseTrilingualMarkdown` 增加结构断言：
  - 必须存在 `#` 标题。
  - 必须存在 `## 1. 英文 / ## 2. 日本語 / ## 3. 中文`。
  - EN/JA 例句数量达标（至少 2 条）。
  - 中文释义行不允许混入假名/注音（异常则标记软错误）。

## 3.3 确定性修复层（非 LLM）
- 在保存前执行固定修复动作（低成本）：
  - 规范章节标题。
  - 外来语标注迁移到中文释义下方。
  - `audio_tasks` 自动补全 + `filename_suffix` 标准化。
  - 去除重复技术说明段。
- 这部分优先执行，尽量减少 LLM 重试。

## 3.4 目标化 LLM 修复回合（单次）
- 当 Hard Rule 不通过时，触发一次“定点修复”而非全量重生：
  - 输入：原输出 + 校验错误列表。
  - 输出：只修复结构/字段，不重写内容语义。
- 建议参数：
  - `max_repair_attempts = 1`
  - 修复 prompt 使用 strict 模式，防止 token 膨胀。

## 3.5 单模型/对比模式统一流水线
- 建议统一为同一后处理链路：
  `generate -> hard validate -> deterministic repair -> revalidate -> optional llm repair -> save`
- 目的：减少双路径行为不一致与回归风险。

## 3.6 可观测性增强
- 在可观测字段中新增：
  - `schema_version`
  - `validation_errors`
  - `repair_attempts`
  - `repair_success`
  - `repair_tokens`
- 并把失败类型写入 `generation_errors`，形成错误分布报表。

---

## 4. 验证方案（建议）
- 对照实验：
  - A 组：仅现有后处理
  - B 组：后处理 + 单次 LLM 定点修复
- 样本：文本/OCR 各 20+，覆盖高噪声与术语输入。
- 核心指标：
  - `Success Rate`
  - `Quality Score`
  - `Avg Tokens / Latency`
  - 统计显著性（`p-value`, `Cohen's d`）
- 预期：
  - 失败率下降明显
  - 质量稳定上升
  - token 增幅可控

---

## 5. 开发落地顺序
1. 实现结构校验器（Hard/Soft 规则）并接入单模型流程。
2. 接入统一错误码和校验报告结构。
3. 加入单次 LLM 定点修复回合（带开关）。
4. 对比模式复用同一校验/修复链路。
5. 补齐 observability 与错误统计字段，跑 A/B 评测并输出报告。

---

## 6. 风险与控制
- 风险：修复链路导致时延上升。  
  控制：仅 Hard 失败触发修复，且最多 1 次。
- 风险：修复回合引入语义漂移。  
  控制：修复 prompt 限定“仅修结构，不改语义”。
- 风险：两条模式逻辑分叉。  
  控制：统一流水线与统一校验函数。

