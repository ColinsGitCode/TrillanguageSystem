# 后端架构文档

**项目**: Trilingual Records  
**版本**: 3.7.0
**更新日期**: 2026-03-05

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
  knowledgeAnalysisEngine.js
  knowledgeJobService.js
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
  trainingPackService.js
database/schema.sql
scripts/
  run_fewshot_rounds.js
  export_round_trend_dataset.js
  generate_round_kpi_report.js
  gemini-host-proxy.js
  updateLegacyCardStyle.js
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
2. 根据 `card_type` 构建 prompt：
   - `trilingual`：三语卡片模板
   - `grammar_ja`：日语语法卡片模板（中文讲解 + 日语例句）
3. 构建 baseline prompt +（可选）few-shot 注入
4. 调用 `local` 或 `gemini`（含自动 fallback）
5. 后处理与校验（结构、注音、markdown/html）
6. 生成音频任务并调用 TTS
7. 保存文件（md/html/meta/audio）
8. 写入数据库：
   - `generations`
   - `observability_metrics`
   - `audio_files`
9. 写入实验追踪：
   - `few_shot_runs` / `few_shot_examples`
   - `experiment_samples` / `experiment_rounds`
10. 自动解析例句并写入评审池：
   - `example_units` / `example_unit_sources`
11. 同步生成 TRAIN 训练包（高质量优先）：
   - teacher LLM 生成 JSON
   - schema + 语义校验
   - 失败走修复提示词重试
   - 再失败走 heuristic 回退
   - 落库 `card_training_assets` + sidecar `*.training.v1.json`

> 说明：`grammar_ja` 当前默认不启用 few-shot 注入，避免把三语样本注入到语法模板。

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

### 6.1 知识同义边界 key 归一修复（v3.6.10）

- 问题：历史脏数据下 `pair_key/group_key` 可能为空、包含省略符或大小写/空白不一致，导致 Knowledge Hub 详情查询 404。
- 修复点（`databaseService.js`）：
  - 新增 key 规范化方法：trim + lowercase；
  - 列表输出统一生成稳定 `pairKey`（优先有效 `pair_key`，再 `group_key`，最终 fallback `id:<rowId>`）；
  - 详情查询支持三种路径：`id:<id>` / `pair_key` / `group_key`；
  - 查询语句改为 `LOWER(TRIM(...))`，降低脏数据影响。
- 结果：Knowledge Hub 同义边界列表与详情可稳定联动，异常 key 不再导致前端空页。

## 7. OCR 机制

- 默认 `OCR_PROVIDER=tesseract`
- 支持：`tesseract` / `local` / `auto`
- `auto`：先 tesseract，失败回退 local OCR

## 8. 数据模型（摘要）

当前 schema 已扩展为 28+ 张表，分七组：

1. 业务主表：
   - `generations`、`audio_files`
2. 可观测与统计：
   - `observability_metrics`、`generation_errors`、`model_statistics`、`system_health`
3. few-shot / 实验：
   - `few_shot_runs`、`few_shot_examples`、`experiment_rounds`、`experiment_samples`、`teacher_references`
4. 评审与注入门控：
   - `example_units`、`example_unit_sources`、`review_campaigns`、`review_campaign_items`、`example_reviews`
5. 内容批注与分析：
   - `card_highlights`（标红 HTML 快照、mark 数、高亮字符数）
6. TRAIN 训练包：
   - `card_training_assets`（status/source/quality/tokens/latency/payload）
7. 知识任务与知识物化：
   - `knowledge_jobs`、`knowledge_outputs_raw`
   - `knowledge_terms_index`
   - `knowledge_issues`
   - `knowledge_synonym_groups`、`knowledge_synonym_members`
   - `knowledge_grammar_patterns`、`knowledge_grammar_refs`
   - `knowledge_clusters`、`knowledge_cluster_cards`

### 8.1 generations 新增字段（v3.6）

- `card_type`：`trilingual | grammar_ja`
- `source_mode`：`input | selection | ocr`

用于区分卡片类型与来源入口，支持后续筛选、统计与可观测追踪。

### 8.2 TRAIN 持久化（v3.7.0）

- 新增表：`card_training_assets`
  - 唯一键：`generation_id`（一张卡片一个当前训练包版本）
  - 关键字段：`status/source/quality_score/validation_errors_json/payload_json`
- 同目录 sidecar：`<base>.training.v1.json`
  - 用于导出、离线复用和目录级运维检查
- 新增接口：
  - `GET /api/training/by-generation/:id`
  - `GET /api/training/by-file`
  - `POST /api/training/by-generation/:id/regenerate`
  - `GET /api/training/backfill/summary`
  - `POST /api/training/backfill`

### 8.3 TRAIN 历史回填稳态策略（v3.7.1）

- 历史回填切换为 `runtimeMode=backfill`，使用独立超时/执行时长/重试参数。
- 回填脚本增加客户端超时，避免 `npm run training:backfill` 在上游异常时无限挂起。
- 回填前先检查 `18888 /health`：
  - `breaker_state=closed`：继续使用 teacher LLM 生成高质量 TRAIN
  - `breaker_state=open|half_open`：直接写入 `heuristic fallback`，优先保证批任务收敛
- 当单卡触发 timeout / breaker open 时，不再拖死整批任务；当前策略允许“快速失败 + 快速落盘”。
- 当前质量优先策略不变：默认仍等待 `gemini-3-pro-preview` 配额恢复后，再继续大规模历史回填。

## 9. 存储与部署

- Docker Compose 默认挂载命名 volume：`trilingual_records`
- 记录路径（容器内）：`/data/trilingual_records`
- DB 默认：`/data/trilingual_records/trilingual_records.db`
- 删除接口支持“记录+文件”联动清理

### 9.2 Phrase List 排序规则（v3.6.6）

- `listHtmlFilesInFolder()` 返回按生成时间倒序（最新优先）
- 排序优先级：
  1. `*.meta.json` 的 `created_at`
  2. `.html` 文件 `mtime`
- 同时间戳下按文件名做稳定排序

### 9.1 历史卡片样式迁移（v3.4 新增）

- 目标：将历史 `md/html` 卡片中的旧格式外来语标注统一迁移为独立高亮块（不与中文释义同一行）
- 脚本：`scripts/updateLegacyCardStyle.js`
- 能力：
  - 兼容 `- 外来语标注: ...` 与 `- ... - 外来语标注: ...` 两种旧格式
  - 自动纠正 `日文=英文` 顺序为 `英文 → 日文`
  - 自动修复旧数据中 loanword span 闭合不平衡问题
  - 幂等：重复执行不产生额外变更
- 常用命令：
  - 预检查：`node scripts/updateLegacyCardStyle.js`
  - 执行迁移：`npm run cards:migrate-style`（等价 `node scripts/updateLegacyCardStyle.js --apply`）

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
TRAINING_PROXY_TIMEOUT_MS=120000
TRAINING_PROXY_EXECUTION_TIMEOUT_MS=100000
TRAINING_PROXY_RETRIES=1
TRAINING_PROXY_RETRY_DELAY_MS=1200
TRAINING_BREAKER_RETRY_DELAY_MS=6000
TRAINING_PROXY_RESET_ON_TIMEOUT=true
TRAINING_PROXY_RETRY_ON_TIMEOUT=true
TRAINING_RETRY_ON_BREAKER_OPEN=true
TRAINING_BACKFILL_PROXY_TIMEOUT_MS=45000
TRAINING_BACKFILL_EXECUTION_TIMEOUT_MS=35000
TRAINING_BACKFILL_PROXY_RETRIES=1
TRAINING_BACKFILL_RETRY_DELAY_MS=600
TRAINING_BACKFILL_BREAKER_RETRY_DELAY_MS=8000
TRAINING_BACKFILL_RETRY_ON_BREAKER_OPEN=true
TRAINING_BACKFILL_DISABLE_REPAIR_ON_TIMEOUT=true
TRAINING_BACKFILL_GATEWAY_RECOVERY_TIMEOUT_MS=20000
TRAINING_BACKFILL_GATEWAY_RECOVERY_POLL_MS=2000

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
- Knowledge Ops 后端已落地（本地任务队列 + 结果物化 + 只读查询 API）
- TRAIN 历史回填链路已具备“快速收敛”能力，不会再因 Gateway timeout/breaker 长时间卡死
- 当前 `gemini-gateway` 若处于 `half_open/open`，历史回填会优先产出 fallback；要恢复高质量 TRAIN，需等待 `gemini-3-pro-preview` 配额恢复
- 主要优化方向：
  1. 将观测指标门禁化（SLO + 发布门禁）
  2. 扩充高质量 teacher 与人工通过样本池
  3. 优化 token 预算，降低 few-shot 成本膨胀

---

**维护者**: Three LANS Team
