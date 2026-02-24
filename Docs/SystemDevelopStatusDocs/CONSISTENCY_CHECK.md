# Repo 文档与代码一致性检查

**检查日期**: 2026-02-24  
**检查范围**: `Docs/SystemDevelopStatusDocs/*` 对照当前代码主链路

## 1. 已对齐项

- 路由对齐：`server.js` 中 27 个 API 端点已在 `API.md` 覆盖
- 生成接口对齐：`/api/generate` 的 `target_folder/llm_model/fewshot_options` 已更新文档
- OCR 对齐：`tesseract/local/auto` 三模式和返回 `provider` 已更新文档
- 评审链路对齐：`/api/review/*` 端点、批次 finalize、评分字段已更新文档
- few-shot 对齐：review-gated / reviewOnly / reviewMinOverall 已更新文档
- 数据模型对齐：16 张表（含 review 相关 5 张）已在后端文档体现
- 前端对齐：弹窗 `CONTENT/INTEL/REVIEW`、Prompt/Output RAW/STRUCT 已记录

## 2. 历史文档说明

- `FEATURE_UPDATE_v2.1.md` 属于历史发布归档，不作为当前实现基线
- 历史说明保留用于回溯，不影响当前状态判断

## 3. 结论

- `Docs/SystemDevelopStatusDocs` 当前已与代码主链路基本一致
- 当前文档可直接支撑：
  1. 接口联调
  2. 评分与注入机制解释
  3. 可观测与实验链路说明

