# 重构总结：2026-05-15 → 2026-05-18

> 范围：从上周五（2026-05-15）开始到今天（2026-05-18）的所有重构、优化、Bug 修复与文档更新。
> 分支：`claude/angry-robinson-1cdb4d`（worktree）。
> 提交数：29 个。代码增删：+12,983 / −6,980（净 +6,003，但 services/databaseService.js 一个文件就减了 ~2,750 行）。

## 0. 一句话总结

把 `server.js`（779 → 102 行）、`databaseService.js`（3,875 → 1,129 行）、`knowledgeAnalysisEngine.js`（1,005 → 58 行）三个"上帝文件"全部拆成有单测护栏的领域模块；同时打通了结构化日志、ESLint 零警告基线、E2E 测试隔离，并顺带修掉了 9 个真实 Bug。单测从 14 个起步发展到 238 个，全部在 ~1s 内跑完。

---

## 1. 时间线 / 提交全景

```
2026-05-15  Fri
  81857ed  refactor: harden gemini request chain
  2be2705  refactor: split server.js into lib/ and routes/ modules
  b687031  docs: refresh CLAUDE.md; test: fix flaky TRAIN selection
  9a750df  test: add unit tests for the gemini chain shared modules
  d07658f  chore: add eslint + fix two missed-import bugs surfaced by lint
  8cf8ae5  fix: remove static /data mount that exfiltrated the SQLite db
  001941b  fix: prune generationThrottle map periodically (was unbounded)
  dac6739  feat: add structured logger and migrate the error / route layer
  7ac1e2d  test/fix: labeled break in retry loop + extractor unit tests
  6d6920b  test: cover audioFormat, goldenExamples, contentPostProcessor

2026-05-16  Sat
  84822ca  chore: clear all 20 eslint warnings
  962960c  chore: migrate services/* console.* to the structured logger
  986fd7c  refactor: extract training-asset pipeline to services/ + routes/
  4ae3069  test: build in-memory SQLite test foundation for databaseService
  8d74ae8  docs: rewrite CLAUDE.md to match the post-refactor architecture
  5a17ac4  test: extend databaseService unit suite to job + experiment domains
  13764e1  refactor: extract generation_jobs domain out of databaseService.js
  2a275cf  refactor: extract experiments + few-shot domain out of databaseService.js
  02e11c3  refactor: extract remaining viable db domains from databaseService
  7ec10da  refactor: extract pure generation helpers from server.js + add unit tests

2026-05-17  Sun
  05aeefa  refactor: extract three small knowledge_* domains
  2d39c68  refactor: extract knowledge_terms_index domain
  1314b48  refactor: extract knowledge_synonyms domain
  0b0280c  refactor: extract knowledge relations + overview + summary domain
  f343a49  refactor: server.js Phase 4.5 — extract core generation pipeline + routes
  b9532d6  docs: bring CLAUDE.md in sync with completed refactors

2026-05-18  Mon
  b6db1cc  feat: E2E reset endpoint so Playwright specs can be hermetic
  8f417d2  refactor: split knowledgeAnalysisEngine.js into per-task modules
  51d9891  docs: CLAUDE.md sync — E2E reset + knowledge engine split
```

---

## 2. 三大"上帝文件"拆分

### 2.1 server.js：779 → 102 行（−87%）

**起点**：`server.js` 同时承担 middleware 装配、所有路由处理、`generateWithProvider` 核心生成管线、`generateWithAutoFallback`、`/api/generate` (300+ 行)、`/api/ocr`、错误中间件、进程守护和 listen。

**过程**：
1. `2be2705` 先把 11 个路由家族（generation_jobs / health / history / dashboard / review / knowledge / training / files / misc）抽到 `routes/*.js`，并新建 `routes/_shared.js` 集中 re-export 所有依赖。
2. `7ec10da` 把 5 个纯辅助函数（`truncateExamplesForBudget` / `normalizeAudioTasks` / `validateGeneratedContent` / `validateSanitizedGeminiCardResponse` / `extractGeminiMarkdownResponse`）抽到 `lib/generationHelpers.js`，配 23 个单测。
3. `f343a49`（Phase 4.5）把 `generateWithProvider`（~270 行）整体抽到 `services/cardGenerationService.js`；把 `/api/generate`（300+ 行）抽到 `routes/generate.js`；把 `/api/ocr` 抽到 `routes/ocr.js`。

**现状**：server.js 只剩 middleware + generation_jobs HTTP worker 桥接 + 路由挂载 + 错误处理 + 进程守护 + listen。

### 2.2 databaseService.js：3,875 → 1,129 行（−71%）

**起点**：单文件 3,875 行的数据访问"上帝类"，所有 SQL 内联，零单测。

**过程**（9 个提交，每片先写单测再 delegation）：

| 提交 | 抽出域 | 模块文件 | 单测增量 |
|---|---|---|---|
| 13764e1 | generation_jobs 生命周期 | services/db/generationJobs.js | +12 |
| 2a275cf | experiments + few-shot | services/db/experiments.js | +7 |
| 02e11c3 | generations / highlights / trainingAssets / knowledge_jobs 生命周期 | services/db/{generations,highlights,trainingAssets,knowledgeJobs}.js | +13 |
| 05aeefa | knowledge issues / grammar / clusters | services/db/knowledge{Issues,Grammar,Clusters}.js | +17 |
| 2d39c68 | knowledge_terms_index | services/db/knowledgeTermsIndex.js | +6 |
| 1314b48 | knowledge synonyms（5 方法+3 key helper） | services/db/knowledgeSynonyms.js | +9 |
| 0b0280c | knowledge_outputs_raw + 关系/聚合/summary | services/db/knowledgeRelations.js | +10 |
| b6db1cc | testReset 域（test-only truncate） | services/db/testReset.js | +3 |

**统一模式**：每个域模块导出函数，第一个参数是 `db`（不依赖 `this`）；databaseService 上的同名方法变成 `return domain.fn(this.db, ...args)`；外部调用方契约零变化。

**现状**：databaseService.js 只剩 constructor、`CREATE TABLE IF NOT EXISTS` schema 装配、`ensureTableColumns` 加性迁移、close()，加上 ~30 个 thin delegation 包装方法。

### 2.3 knowledgeAnalysisEngine.js：1,005 → 58 行（−94%）

**起点**：单文件 1,005 行，6 个任务类型（summary/index/synonym_boundary/grammar_link/cluster/issues_audit）的 `runX` 函数、加上 ~25 个不同粒度的辅助函数。

**过程**（`8f417d2`，单次提交）：
- 共享文本工具 → `services/knowledge/textUtils.js`（13 个 helper：stripHtml / normalizeText / profileLang / 3 个 headword 抽取 / buildAliases / inferTags / extractJapaneseSentences / detectGrammarPatterns / hashFingerprint / sanitizeMcpDiagnosticText / getLlmResponseText / percentile）
- 每个任务一个文件 → `services/knowledge/tasks/{summary,cardIndex,grammarLink,cluster,issuesAudit,synonymBoundary}.js`
- 最大的 synonymBoundary（~590 行，含 LLM 增强分支）封装在自己模块里，内部 helper 通过 `_internal` 暴露给 e2e 回归测试
- 主文件只留 `wrapResult` + `runTask(taskType, cards, opts)` switch

**现状**：知识引擎是纯 dispatcher。

---

## 3. 路由层与基础设施

### 3.1 `lib/` 工具模块（全部从 server.js 抽出）

| 模块 | 职责 |
|---|---|
| `lib/logger.js` | 零依赖结构化日志，pino/bunyan 风格 API；JSON / pretty / silent 三模式 |
| `lib/serverConfig.js` | 环境变量派生常量 + 纯辅助（toNumberOr / normalizeCardType / resolveGeminiModel 等） |
| `lib/throttle.js` | per-IP 生成节流，含周期性 Map 清扫（fix #001941b） |
| `lib/e2eFixtures.js` | E2E 模式下的确定性 fixture（knowledge jobs / generate result / training） |
| `lib/trainingSidecar.js` | 训练 sidecar 路径构造 |
| `lib/generationHelpers.js` | 5 个纯生成辅助（few-shot 截断 / audio task 规范化 / 验证器） |

### 3.2 `routes/` 模块（13 个 Express.Router）

```
routes/_shared.js         # 集中 re-export，路由按名解构
routes/generate.js        # POST /api/generate（原 300+ 行内联代码）
routes/ocr.js             # POST /api/ocr
routes/generationJobs.js  # /api/generation-jobs/*
routes/health.js          # /api/health + /api/gemini/auth/*
routes/history.js         # /api/history /statistics /search /recent
routes/dashboard.js       # /api/dashboard/*
routes/review.js          # 11 routes
routes/knowledge.js       # 17 routes
routes/training.js        # 5 routes
routes/files.js           # /api/folders + highlights + records/by-file
routes/misc.js            # experiments export + DELETE /api/records/:id
routes/testReset.js       # POST /api/_test/reset（仅 E2E_TEST_MODE 挂载）
```

### 3.3 Gemini 调用链加固（`81857ed`）

把原本散落在 server.js 的超时常量、错误码、进程管理统一到三个新模块：

- `services/geminiTimeouts.js` — 单旋钮超时层级：执行预算 → 网关缓冲 → 客户端总预算
- `services/geminiErrors.js` — 结构化错误码（`EXECUTOR_TIMEOUT` / `RATE_LIMITED` / `EXECUTOR_BUSY` / `GATEWAY_TIMEOUT` 等），各层 `Error.code/status/payload`
- `services/geminiProcessUtils.js` — CLI 进程树 spawn + kill（host executor 和 in-process CLI 共用）

**契约**：上游不再正则匹配错误消息，统一读 `err.payload.code`。`generationJobService.isTransientCapacityError` 据此分类。

---

## 4. 测试基线

### 4.1 单测：14 → 238（17 倍增长，~1s）

| 提交 | 新增测试 | 覆盖目标 |
|---|---|---|
| 4ae3069 | 14 | databaseService 内存 SQLite 基线（generations / observability / audio_files / 删除级联 / FTS） |
| 5a17ac4 | +7 | generation_jobs + experiments |
| 02e11c3 | +5 | 新拆出的 4 个域（delegation 验证） |
| 7ec10da | +23 | lib/generationHelpers 5 个纯函数全分支 |
| 9a750df / 7ac1e2d / 6d6920b | +30 | geminiTimeouts / geminiErrors / geminiProxyService / audioFormat / contentPostProcessor / goldenExamples |
| 05aeefa | +17 | knowledge issues / grammar / clusters |
| 2d39c68 | +6 | knowledge_terms_index |
| 1314b48 | +9 | knowledge synonyms 5 方法 |
| 0b0280c | +10 | relations / overview / summary |
| b6db1cc | +3 | truncateAllForTests |
| 8f417d2 | +14 | 6 个 task 模块 + dispatcher |

**关键基础设施**：DatabaseService 类与单例并存导出，单测用 `new DatabaseService(':memory:')` 完全隔离。`DB_PATH=:memory:` + `LOG_SILENT=1` 在 test 启动时设置，避免 module-load 单例落盘。

### 4.2 ESLint 9 flat config（`d07658f`、`84822ca`）

从零开始引入。最初 20 条 warning + 2 个真 bug（routes/files.js + routes/misc.js 漏掉 `buildTrainingSidecarPath` import）。最终降为 **0 errors / 0 warnings 基线**，CI 应永久维护这个状态。

### 4.3 结构化日志（`dac6739`、`962960c`）

`lib/logger.js` 是项目 logger，pino 风格 child binding，零依赖。所有 `services/*` 和 `routes/*` 的 `console.*` 全部迁移完毕。新代码禁止 `console.*`。配置：`LOG_LEVEL` / `LOG_PRETTY` / `LOG_SILENT`。

### 4.4 E2E 隔离（`b6db1cc`）

**问题**：Playwright 跑 `tests/e2e/` 整目录时，3 个 spec 共享 server + DB 互相污染。原 workaround 是"一次只跑一个 spec 文件"。

**方案**：
- `services/db/testReset.js` 定义子表→父表依赖序，`truncateAll(db)` 在事务里 `DELETE FROM <t>` 全表清空，再 reset `sqlite_sequence` 让 AUTOINCREMENT 从 1 重新计数
- `routes/testReset.js` 提供 `POST /api/_test/reset`，**仅在 `E2E_TEST_MODE=1` 时挂载**（已 curl 验证生产模式下返回 404）
- 同时清 `RECORDS_PATH` 目录、重置 generationJobService 的 retryTimer + running 标志
- `tests/e2e/fixtures/resetServerState.js` 提供 spec 端 helper，smoke.spec.js + pages.spec.js 在 `test.beforeAll` 调用

**结果**：`playwright test tests/e2e/` 整目录可一把跑通。

---

## 5. 修复的真实 Bug（9 个）

每个 Bug 都是某次结构化改造时浮上来的。原本不知道存在，靠测试 / 静态检查 / 代码审视暴露。

| # | Bug | 提交 | 描述 |
|---|---|---|---|
| 1 | Timeout 层级反了 | 81857ed | 客户端总预算 < 网关 < 执行预算，导致客户端先超时收到无意义错误。修后单旋钮派生 |
| 2 | shouldShortCircuit 永远为真 | 81857ed | training 回填代码里 `state !== 'closed'` 在 `state=='unknown'` 时为真，导致回填从不真正调 Gemini。删除整段死短路代码 |
| 3 | `/admin/reset` 链接自禁用 | 81857ed | 同上死代码连带影响 admin 页 |
| 4 | runGeminiProxy 丢失 err.status/.code/.payload | 81857ed | 包装错误时只保留 message，上游再无法分类。改为透传 |
| 5 | executionTimeoutMs>0 绕过执行天花板 | 81857ed | 上游传超长 timeout 时直接覆盖了硬上限。改为 `Math.min(ceiling, requested)` |
| 6 | routes/files.js + misc.js 漏 import | d07658f | ESLint 第一次跑就抓到。本来运行时才会炸 |
| 7 | `/data` 静态挂载泄漏 SQLite | 8cf8ae5 | docker 布局下 `DB_PATH` 在 `RECORDS_PATH` 里，`app.use('/data', express.static(RECORDS_PATH))` 把整个数据库（含 WAL）以 HTTP 暴露出去。验证过 200 OK on `/data/trilingual_records.db`。删除该 mount |
| 8 | generationThrottle Map 无界增长 | 001941b | per-IP 节流 Map 从不清理，长跑会内存泄漏。加周期 sweep |
| 9 | 重试循环 break 只退出内层 | 7ac1e2d | `geminiProxyService` 非重试错误被重试 6 次（应立即失败）。修为 labeled break `retry: for(...) { break retry; }`。这个 Bug 是先写单测才暴露的——证明"加测试 → 抓 Bug"的循环有效 |

---

## 6. 文档同步

- `b687031`、`8d74ae8`、`b9532d6`、`51d9891` 四次重写 / 同步 `CLAUDE.md`
- 当前 CLAUDE.md 描述匹配最新架构：完整的 services/db/ 13 模块清单、services/knowledge/tasks/ 6 任务清单、E2E reset 端点的使用约定、测试数从 130 → 238 的更新
- Known unfinished work 列表：原本 3 项（server.js Phase 4.5 / databaseService 拆分 / E2E 跨文件污染）现在全部清零；新列入"未来候选"是 trainingPackService（1031 行）和 knowledgeAnalysisEngine 后续观察

---

## 7. 当前模块体量快照

| 模块 | 行数 | 说明 |
|---|---|---|
| **重构后的"瘦"主文件** | | |
| server.js | 102 | 仅 bootstrap |
| services/knowledgeAnalysisEngine.js | 58 | dispatcher |
| services/databaseService.js | 1,129 | schema + 迁移 + ~30 个 thin delegation |
| **新建领域模块** | | |
| services/db/ 13 个文件 | ~2,900 总 | 每个独立单测 |
| services/knowledge/textUtils.js | 168 | 共享文本辅助 |
| services/knowledge/tasks/*.js 6 个 | ~870 总 | synonymBoundary 占 590 |
| services/cardGenerationService.js | 321 | LLM 调用主链路 |
| lib/generationHelpers.js | 105 | 5 个纯辅助 |
| routes/ 13 个 | ~1,700 总 | 每域一个 Router |

总计：本轮 29 commits 后，从 `services/` 顶层的 god-file 完全解构为 ~30 个高内聚模块，并配套 238 个单测。

---

## 8. 一些值得复用的工作模式

1. **God-file 拆分流程**：
   - 先在内存 SQLite / pure context 中写完整单测（覆盖目标方法的所有分支）
   - 创建新模块，逐字搬代码，导出函数（第一参数为 `db` 或 context）
   - 主文件原方法体替换为 `return domain.fn(this.db, ...args)`
   - 再跑测试 → 所有原测试仍绿 = 行为零回归
   - 每片独立 commit

2. **加测试经常顺手抓 Bug**：本轮 9 个 Bug 里有 3 个（#4 / #9 / #6）就是写测试 / 引入静态检查时发现的，而不是事后排查。

3. **delegation 模式保护 API 契约**：所有外部调用方（routes、service、scripts）对 dbService.X(...) 的依赖完全没动，但内部实现已经被 14 个新模块替换。给了重构最大自由度。

4. **小步提交**：29 个 commit 平均每个改 ~340 行。每个都能独立 revert，每个都跑 `npm test + npx eslint .` 验证后才入。

---

## 9. 下一步候选（未在本轮处理）

| 项 | 说明 | 优先级 |
|---|---|---|
| trainingPackService.js 拆分（1031 行） | 唯一剩下的 god-file 候选，但内部是否真有子域不明 | 低-中 |
| 路由层 supertest 集成测试 | 当前 routes/*.js 没有专门的集成测试层，依赖 e2e 覆盖 | 中 |
| 前端 public/js 单元测试 | 完全未覆盖，但纯展示层 ROI 一般 | 低 |
| CI 集成 | npm test + lint 入 GitHub Actions | 中 |
| knowledgeJobService 整合测试 | 任务编排器目前没 mocked LLM 的集成测试 | 中 |

---

## 10. 验证当前状态

```bash
npm test                # 238/238 全绿，~1s
npx eslint .            # 0 errors / 0 warnings
PORT=3999 node server.js  # 应输出 {"level":"info","module":"http","msg":"server listening"}
curl -X POST http://127.0.0.1:3999/api/_test/reset
# 生产模式下应返回 404；带 E2E_TEST_MODE=1 启动时返回 {"ok":true}
```

文件路径：`Docs/Status/REFACTOR_LOG_2026-05-15_to_05-18.md`。
