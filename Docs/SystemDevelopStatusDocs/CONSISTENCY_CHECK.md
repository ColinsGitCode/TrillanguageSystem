# Repo 文档与代码一致性检查

**检查日期**: 2026-02-06  
**检查范围**: `Docs/SystemDevelopStatusDocs/*` 对照当前代码

## 已对齐内容

- `server.js` 路由与 `API.md` 端点说明一致
- `/api/generate` 的实验参数（`experiment_*`、`fewshot_options`、`llm_model`）已在文档中完整体现
- few-shot 追踪链路与数据库表（`few_shot_runs/experiment_rounds/experiment_samples/teacher_references`）已对齐
- Gemini host-proxy 的 `model` 透传机制已在后端文档与 API 文档标注
- 实验导出脚本与图表脚本（round trend/KPI）已进入状态文档

## 保留差异（可接受）

1. `FEATURE_UPDATE_v2.1.md` 为历史发布说明，不代表当前全量状态
2. `public/js/dashboard.js` 仍作为旧版兼容文件保留
3. `geminiService.js`（Gemini API）仍存在但当前主线不依赖

## 结论

- 当前系统状态文档已与代码主链路保持一致
- few-shot 主线、proxy 透传、实验追踪与测试报告索引均已可追溯
