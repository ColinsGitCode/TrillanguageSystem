# 实现状态报告

**日期**: 2026-02-24
**版本**: v3.3
**状态**: 进行中（主链路稳定，评审机制增强）

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

### 2.6 评审机制增强（v3.3 新增）

- **TTS 独立下限**：`computeEligibility` 新增 `minTts=3.0` 门控，tts 低于阈值直接 rejected，防止 overall 达标但音频不可用的样本注入
- **采样评审模式**：`finalizeCampaign` 支持 `allowPartial=true` + `minReviewRate` 参数，大批次可按比例抽样评审后 finalize
- **Finalize 回滚**：新增 `rollbackCampaign` 方法 + `POST /api/review/campaigns/:id/rollback` 路由，事务性重置 eligibility/scores 但保留原始评分记录
- **相似度加权**：few-shot 选例从 `Math.max(phraseSim, sentenceSim)` 改为 `phraseSim*0.8 + sentenceSim*0.2`，抑制长句噪声匹配

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

## 4. 下一步重点

1. 利用采样评审 + 回滚能力，快速扩充高质量 approved 样本池
2. 优化 `tokenBudgetRatio/exampleMaxChars`，压缩增量 token
3. 将观测指标门禁化（SLO + 发布阈值）
4. 把评审结果与实验结果联动，形成”评分→注入→效果→回滚调参”闭环

## 5. 关键文档索引

- API：`Docs/SystemDevelopStatusDocs/API.md`
- 后端：`Docs/SystemDevelopStatusDocs/BACKEND.md`
- 前端：`Docs/SystemDevelopStatusDocs/FRONTEND.md`
- 最新仓库状态：`Docs/SystemDevelopStatusDocs/repo_status.md`
- 评分机制设计：`Docs/DesignDocs/CodeAsPrompt/review_scoring_and_injection_gate.md`
- AI Agent 可观测 slides：`Docs/SLIDES_OUTLINES.md`

---

**维护者**: Three LANS Team
