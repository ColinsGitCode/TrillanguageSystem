# 例句人工评审驱动 Few-shot 注入方案

## 1. 背景与目标
- 现状：Few-shot 示例主要来自历史高质量记录，缺少“例句级人工质量信号”。
- 目标：支持对**已生成**和**未来生成**学习卡片中的每条例句进行评分与评论，并在批次完成后统一决定是否进入注入池。
- 约束：不修改模型权重，仅在 Prompt Engineering / Code as Prompt 层实现。

---

## 2. 核心设计

## 2.1 实体
- **例句单元（example_units）**：去重后的最小注入样本，字段包含语言、原句、翻译、审核聚合分、准入状态。
- **来源映射（example_unit_sources）**：记录例句来自哪张学习卡片（generation）。
- **评审批次（review_campaigns）**：一次“冻结范围”的人工评审任务。
- **批次样本映射（review_campaign_items）**：某批次需要评审的例句清单。
- **评分记录（example_reviews）**：评审人对例句的打分、评论、推荐决策。

## 2.2 工作流
1. 生成学习卡片后，系统自动抽取 EN/JA 例句与中文翻译，写入例句单元池（自动去重）。
2. 创建评审批次时，冻结当前池内样本，形成批次待评列表。
3. 在 UI 中逐条评分与评论（原句质量、翻译质量、TTS 可读性、推荐决策）。
4. 批次完成后手动执行 Finalize，统一计算准入结果（approved/rejected/pending）。
   - 默认要求批次进度 100% 才允许 Finalize（避免“未评完即入池”）。
5. Few-shot 注入在启用“评审门控”时，仅从 approved 样本中检索。

---

## 3. 评分与准入规则（默认）
- 评分维度（1-5）：
  - `score_sentence`：原句自然度/正确性
  - `score_translation`：翻译准确性/可读性
  - `score_tts`：语音可读性（发音友好）
- 加权总分：
  - `overall = 0.45*sentence + 0.45*translation + 0.10*tts`
- 默认准入阈值（批次 Finalize 时可覆盖）：
  - `minVotes = 1`
  - `minOverall = 4.2`
  - `minSentence = 4.0`
  - `minTranslation = 4.0`
  - `maxRejectRate = 0.30`
- 决策：
  - 满足阈值 -> `approved`
  - 拒绝率过高或分数不足 -> `rejected`
  - 无评审数据 -> `pending`

---

## 4. API 设计

## 4.1 批次管理
- `GET /api/review/campaigns`
- `GET /api/review/campaigns/active`
- `POST /api/review/campaigns`
  - 创建批次并自动快照当前样本池
- `GET /api/review/campaigns/:id/progress`
- `POST /api/review/campaigns/:id/finalize`
  - 基于本批次评分统一计算准入状态
  - 默认仅允许在 `pending_examples=0` 时执行

## 4.2 例句评审
- `GET /api/review/generations/:id/examples`
  - 获取某学习卡片对应的例句单元与当前批次评分
- `POST /api/review/examples/:id/reviews`
  - 提交/更新评分与评论（按 reviewer + campaign upsert）

## 4.3 数据维护
- `POST /api/review/backfill`
  - 对历史 generations 执行一次例句回填（幂等）

---

## 5. 与 Few-shot 注入的集成
- 新增开关：`ENABLE_REVIEW_GATED_FEWSHOT`
- 启用后：
  1. 优先从 `example_units(eligibility=approved)` 检索例句样本
  2. 若样本不足，可按策略回退到原有 `goldenExamplesService`（可配置）
- 排序建议：
  - 相似度（phrase + sentence）+ 人工分 + 新鲜度 + 多样性

---

## 6. UI 落地
- 学习卡片弹窗新增 **REVIEW** 子页：
  - 显示当前 active campaign 进度
  - 展示本卡所有例句（原句/翻译）
  - 每条例句评分、评论、推荐决策
  - 支持“创建批次”“Finalize 批次”
- 历史卡片和文件列表卡片均可进入同一评审流程。

---

## 7. 实施步骤
1. 数据表与索引落地（schema）。
2. 例句抽取与去重服务（含历史回填 + 生成后自动入池）。
3. 评审批次与评分 API。
4. UI Review 页签与交互。
5. Few-shot 门控检索接入。
6. 观测字段与报表补充（后续）。

---

## 8. 风险与对策
- 风险：人工评审初期样本不足，导致注入池过窄。  
  对策：支持回退到原有高质量样本检索。
- 风险：单人评分主观波动。  
  对策：保留评分评论原始记录，允许后续多评审人汇总。
- 风险：旧卡片回填耗时。  
  对策：提供增量回填（仅未入池 generations）。
