# Repo 文档与代码一致性检查

**检查日期**: 2026-03-05
**检查范围**: `Docs/SystemDevelopStatusDocs/*` 对照当前代码主链路

## 1. 已对齐项

- 路由对齐：`server.js` 中 28 个 API 端点已在 `API.md` 覆盖（含新增 rollback）
- 生成接口对齐：`/api/generate` 的 `target_folder/llm_model/fewshot_options` 已更新文档
- OCR 对齐：`tesseract/local/auto` 三模式和返回 `provider` 已更新文档
- 评审链路对齐：`/api/review/*` 端点、批次 finalize/rollback、评分字段、采样模式已更新文档
- few-shot 对齐：review-gated / reviewOnly / reviewMinOverall / minTts / 加权相似度 已更新文档
- 数据模型对齐：16 张表（含 review 相关 5 张）已在后端文档体现
- 前端对齐：弹窗 `CONTENT/INTEL/REVIEW`、采样按钮/回滚按钮/已完成标签 已记录
- 卡片样式对齐：外来语标注独立高亮块（非同行显示）与历史卡片兼容转换已记录
- 运维脚本对齐：`scripts/updateLegacyCardStyle.js` 与 `npm run cards:migrate-style` 已记录
- v3.5 选区生成对齐：`✦ Generate Card` 已切换为静默任务队列（不跳转），并补充 Ruby-aware 选区提取策略
- v3.5 主入口对齐：首页 `Generate` 入口已切换为静默任务队列（支持连续入队）
- Knowledge Ops 对齐：
  - 前端 `knowledge-ops.html/knowledge-hub.html/dashboard.js/api.js` 已接入知识任务与知识浏览调用链
  - `dashboard.html` 已回归 Mission Control 专注页（不再内嵌知识任务面板）
  - 后端 `server.js` 的 `/api/knowledge/*` 路由与 `knowledgeJobService` 已对齐
  - 文档 `API.md/BACKEND.md/FRONTEND.md` 已覆盖 Knowledge Ops

## 2. v3.3 评审改进对齐

- TTS 独立下限（`computeEligibility` + `getApprovedExamplesForFewShot`）→ BACKEND.md 5.3
- 采样评审模式（`finalizeCampaign` allowPartial）→ API.md 7.1 + FRONTEND.md 3.3
- Finalize 回滚（`rollbackCampaign` + 路由 + 前端按钮）→ API.md 7.1 + BACKEND.md 5.4 + FRONTEND.md 3.3
- 相似度加权（`phraseSim*0.8 + sentenceSim*0.2`）→ BACKEND.md 5.3
- 集成测试报告：`Docs/TestDocs/review_scoring_improvements_test_report.md`（12/12 PASS）

## 3. 历史文档说明

- `FEATURE_UPDATE_v2.1.md` 属于历史发布归档，不作为当前实现基线
- 历史说明保留用于回溯，不影响当前状态判断

## 4. 最新验证补充（2026-03-05）

- 全量知识任务执行结果已产出并可查询：
  - `summary/index/issues_audit/synonym_boundary/grammar_link/cluster` 均为 `success`
  - 结果规模：266 cards / 266 index / 156 issues / 4 grammar patterns / 4 clusters
- Mission Control UI 验证报告已新增：
  - `Docs/TestDocs/UI_Validation_MissionControl_20260305.md`

## 5. 结论

- `Docs/SystemDevelopStatusDocs` 当前已与代码主链路一致（v3.6.9）
- 当前文档可直接支撑：
  1. 接口联调
  2. 评分与注入机制解释（含 TTS 门控、采样模式、回滚）
  3. 可观测与实验链路说明
  4. Mission Control + Knowledge OPS + Knowledge Hub 的分页化验证与运行
