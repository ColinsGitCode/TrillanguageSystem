# 后端架构文档

**项目**: Trilingual Records  
**版本**: 2.9  
**更新日期**: 2026-02-10

## 后端目录（核心）

```text
server.js
services/
  localLlmService.js
  geminiService.js
  geminiCliService.js
  geminiProxyService.js
  promptEngine.js
  contentPostProcessor.js
  htmlRenderer.js
  ttsService.js
  fileManager.js
  observabilityService.js
  databaseService.js
  databaseHelpers.js
  goldenExamplesService.js
  fewShotMetricsService.js
  experimentTrackingService.js
  geminiAuthService.js
  healthCheckService.js
database/schema.sql
scripts/
  gemini-host-proxy.js
  start-gemini-proxy.sh
  run_fewshot_rounds.js
  export_round_trend_dataset.js
  generate_round_kpi_report.js
  migrate_fewshot_tables.js
```

## 运行栈与职责

- Node.js + Express：API 编排与业务路由
- SQLite（better-sqlite3）：记录、指标、实验数据持久化
- 文件系统：学习卡片与音频资产存储
- 本地 LLM：OpenAI 兼容接口（默认主链路）
- Gemini：支持 `cli` 或 `host-proxy`（推荐 host-proxy）
- TTS：英语 Kokoro + 日语 VOICEVOX

## 生成链路（单模型）

1. `POST /api/generate` 进入生成请求
2. 根据 provider/mode 构建 prompt（JSON 或 Markdown 输出模式）
3. local/gemini 执行推理（gemini 支持 `llm_model` 覆盖）
4. 解析与后处理：结构校验、注音、内容修正
5. HTML 渲染与音频任务提取
6. 保存 `md/html/meta` 到日期目录
7. 生成英语/日语音频（如 TTS 服务可用）
8. 写入 `generations + observability_metrics + audio_files`
9. 写入 `few_shot_runs + few_shot_examples + experiment_samples`

## 对比链路（enable_compare）

- 并行执行 `gemini/local` 两路生成
- 分别保存文件与观测数据
- 自动生成 `input` 输入卡片
- 返回 `comparison.metrics`（speed/quality/tokens/cost）与 winner
- 双路结果可分别删除（按文件或按记录）

## Few-shot 机制（当前实现）

- 生效范围：`provider=local` 且 few-shot enabled
- 示例来源优先级：
  1. `teacher_references`（同实验、round<=当前 round，且分数达阈值）
  2. 历史高质量生成记录（默认 provider=gemini，可切换）
- 预算控制：
  - 预算 = `contextWindow * tokenBudgetRatio`
  - 回退链路：`budget_reduction -> budget_truncate -> budget_exceeded_disable`
- 追踪字段：
  - `countRequested/countUsed`
  - `basePromptTokens/fewshotPromptTokens/totalPromptTokensEst`
  - `fallbackReason/exampleIds`

## Gemini Host Proxy（当前推荐模式）

- `services/geminiProxyService.js` 请求体包含：`prompt/baseName/model`
- `scripts/gemini-host-proxy.js` 支持 `model` 透传为 CLI 参数（默认 `--model`）
- `server.js` 透传请求 `llm_model` 到 proxy 调用路径
- 说明：容器当前不要求安装 Gemini CLI，执行可在宿主机完成
- 默认模型：`gemini-3-pro-preview`（可被请求 `llm_model` 覆盖）
- 实测可用模型（2026-02-10）：`gemini-3-pro-preview`、`gemini-3-flash-preview`、`gemini-2.5-pro`、`gemini-2.5-flash`

## 数据模型（重点）

- 核心业务表：
  - `generations`
  - `audio_files`
  - `observability_metrics`
  - `generation_errors`
- few-shot/实验表：
  - `few_shot_runs`
  - `few_shot_examples`
  - `experiment_rounds`
  - `experiment_samples`
  - `teacher_references`

## 环境变量（关键）

```bash
PORT=3010
RECORDS_PATH=/data/trilingual_records
DB_PATH=/data/trilingual_records/trilingual_records.db

# Local LLM
LLM_BASE_URL=http://localhost:15800/v1
LLM_MODEL=qwen2_5_vl
LLM_OCR_MODEL=qwen2_5_vl
LLM_MAX_TOKENS=2048
LLM_TEMPERATURE=0.2

# Gemini (推荐 host-proxy)
# GEMINI_MODE=host-proxy
# GEMINI_PROXY_URL=http://host.docker.internal:3210/api/gemini
# GEMINI_PROXY_MODEL=gemini-3-pro-preview
# GEMINI_CLI_MODEL=gemini-3-pro-preview
# GEMINI_TEACHER_MODEL=gemini-3-pro-preview

# Few-shot
# ENABLE_GOLDEN_EXAMPLES=true
# GOLDEN_EXAMPLES_STRATEGY=HIGH_QUALITY_GEMINI
# GOLDEN_EXAMPLES_COUNT=3
# GOLDEN_EXAMPLES_MIN_SCORE=85
# LLM_CONTEXT_WINDOW=4096
# FEWSHOT_TOKEN_BUDGET_RATIO=0.25
# GOLDEN_EXAMPLE_MAX_CHARS=900

# TTS
TTS_EN_ENDPOINT=http://tts-en:8000/v1/audio/speech
TTS_JA_ENDPOINT=http://tts-ja:50021
```

## 当前状态结论

- 本地 LLM 主链路稳定，few-shot 轮次实验与可视化链路已打通
- Gemini proxy `model` 透传已完成代码实现与实机验证，默认模型已切换为 `gemini-3-pro-preview`
- `/api/experiments/:id` + 导出脚本可直接产出报告级数据（CSV/JSON/SVG）
- 21 样本实验验证：few-shot 质量提升明确，但 Token 成本上升明显，需持续优化示例长度与预算比

---

**维护者**: Three LANS Team
