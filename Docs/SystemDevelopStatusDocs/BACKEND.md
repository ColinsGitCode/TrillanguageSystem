# 后端架构文档

**项目**: Trilingual Records  
**版本**: 3.3
**更新日期**: 2026-02-24

## 1. 核心目录

```text
server.js
services/
  localLlmService.js
  geminiService.js
  geminiCliService.js
  geminiProxyService.js
  promptEngine.js
  goldenExamplesService.js
  exampleReviewService.js
  experimentTrackingService.js
  fewShotMetricsService.js
  observabilityService.js
  statisticsService.js
  tesseractOcrService.js
  markdownParser.js
  contentPostProcessor.js
  japaneseFurigana.js
  htmlRenderer.js
  ttsService.js
  fileManager.js
  databaseService.js
  databaseHelpers.js
  healthCheckService.js
  geminiAuthService.js
database/schema.sql
scripts/
  run_fewshot_rounds.js
  export_round_trend_dataset.js
  generate_round_kpi_report.js
  gemini-host-proxy.js
```

## 2. 运行栈

- Node.js + Express：API 编排与路由
- SQLite (better-sqlite3)：业务、观测、实验、评审数据
- 文件系统：按日期目录存储 md/html/meta/audio
- 本地 LLM：OpenAI 兼容接口（默认主链路）
- Gemini：host-proxy（宿主机 Gateway 18888）
- OCR：Tesseract 容器（默认）+ local OCR 兜底
- TTS：Kokoro（EN）+ VOICEVOX（JA）

## 3. 生成主链路（单模型）

1. `POST /api/generate` 接收请求，执行限流检查
2. 构建 baseline prompt +（可选）few-shot 注入
3. 调用 `local` 或 `gemini`（含自动 fallback）
4. 后处理与校验（结构、注音、markdown/html）
5. 生成音频任务并调用 TTS
6. 保存文件（md/html/meta/audio）
7. 写入数据库：
   - `generations`
   - `observability_metrics`
   - `audio_files`
8. 写入实验追踪：
   - `few_shot_runs` / `few_shot_examples`
   - `experiment_samples` / `experiment_rounds`
9. 自动解析例句并写入评审池：
   - `example_units` / `example_unit_sources`

## 4. 对比链路（enable_compare）

- 并行执行 `gemini/local` 两路生成
- 生成 `input` 输入卡片
- 分别落库并追踪观测指标
- 返回 `comparison.metrics`（speed/quality/tokens/cost）与 `winner`

## 5. few-shot 机制（当前实现）

### 5.1 注入策略

- 生效范围：`provider=local 或 gemini` 且 few-shot enabled
- 来源优先级：
  1. review-gated approved 样本（开启时）
  2. 同实验 `teacher_references`
  3. 历史高质量样本（provider 可配）

### 5.2 预算控制

- 预算：`contextWindow * tokenBudgetRatio`
- 回退链：`budget_reduction -> budget_truncate -> budget_exceeded_disable`
- 追踪字段：`countRequested/countUsed/basePromptTokens/fewshotPromptTokens/fallbackReason/exampleIds`

### 5.3 人工评审门控

- `exampleReviewService` 维护样本评分与资格
- 聚合分：`0.45*sentence + 0.45*translation + 0.1*tts`
- 资格判定规则（`computeEligibility`）：
  1. `votes < minVotes(1)` → pending
  2. `rejectRate >= 0.3` → rejected
  3. `tts < minTts(3.0)` → rejected（独立下限，v3.3 新增）
  4. `overall >= 4.2 && sentence >= 4.0 && translation >= 4.0` → approved
  5. 其他 → rejected
- `reviewOnly=true` 且无 approved 样本时，直接不注入
- 相似度选例：`phraseSim*0.8 + sentenceSim*0.2`（v3.3 改为加权，优先 source_phrase）

### 5.4 评审批次生命周期

- 创建 → active（可评审）
- finalize → finalized（默认要求 100% 评审完成；`allowPartial=true` 启用采样模式）
- rollback → active（重置 eligibility，保留 example_reviews 原始数据；v3.3 新增）

## 6. Gemini host-proxy 集成（当前默认）

- 容器调用：`http://host.docker.internal:18888/api/gemini`
- 请求透传字段：`prompt/baseName/model`
- 鉴权：由 Gateway（18888）侧执行 API Key/Bearer 校验
- 稳定性策略：
  - 超时/5xx 重试
  - timeout 后可触发 `/admin/reset` 清理执行器挂起
  - 支持 IPv4 fallback 策略

> 说明：容器内部不要求安装 Gemini CLI；真实 CLI 由宿主机 Host Executor 执行。

## 7. OCR 机制

- 默认 `OCR_PROVIDER=tesseract`
- 支持：`tesseract` / `local` / `auto`
- `auto`：先 tesseract，失败回退 local OCR

## 8. 数据模型（摘要）

当前 schema 共 16 张表，分四组：

1. 业务主表：
   - `generations`、`audio_files`
2. 可观测与统计：
   - `observability_metrics`、`generation_errors`、`model_statistics`、`system_health`
3. few-shot / 实验：
   - `few_shot_runs`、`few_shot_examples`、`experiment_rounds`、`experiment_samples`、`teacher_references`
4. 评审与注入门控：
   - `example_units`、`example_unit_sources`、`review_campaigns`、`review_campaign_items`、`example_reviews`

## 9. 存储与部署

- Docker Compose 默认挂载命名 volume：`trilingual_records`
- 记录路径（容器内）：`/data/trilingual_records`
- DB 默认：`/data/trilingual_records/trilingual_records.db`
- 删除接口支持“记录+文件”联动清理

## 10. 关键环境变量

```bash
PORT=3010
RECORDS_PATH=/data/trilingual_records
DB_PATH=/data/trilingual_records/trilingual_records.db

LLM_BASE_URL=http://localhost:15800/v1
LLM_MODEL=qwen2_5_vl
LLM_MAX_TOKENS=2048

GEMINI_MODE=host-proxy
GEMINI_PROXY_URL=http://host.docker.internal:18888/api/gemini
GEMINI_PROXY_AUTH_MODE=apikey
GEMINI_PROXY_API_KEY=***
GEMINI_PROXY_MODEL=gemini-3-pro-preview

ENABLE_GOLDEN_EXAMPLES=false
FEWSHOT_TOKEN_BUDGET_RATIO=0.25
ENABLE_REVIEW_GATED_FEWSHOT=false
REVIEW_GATED_FEWSHOT_ONLY=false
REVIEW_GATE_MIN_OVERALL=4.2
REVIEW_GATE_MIN_TTS=3.0

OCR_PROVIDER=tesseract
OCR_TESSERACT_ENDPOINT=http://ocr:8080/ocr
OCR_LANGS=eng+jpn+chi_sim

TTS_EN_ENDPOINT=http://tts-en:8000/v1/audio/speech
TTS_JA_ENDPOINT=http://tts-ja:50021
```

## 11. 当前状态结论

- 主链路（文本/OCR -> 卡片 -> 音频 -> 落库）稳定可用
- 双模型对比、实验追踪、观测指标链路已闭环
- 人工评分/评论与 review-gated few-shot 已落地
- 主要优化方向：
  1. 将观测指标门禁化（SLO + 发布门禁）
  2. 扩充高质量 teacher 与人工通过样本池
  3. 优化 token 预算，降低 few-shot 成本膨胀

---

**维护者**: Three LANS Team
