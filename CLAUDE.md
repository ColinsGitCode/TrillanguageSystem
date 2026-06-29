# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Trilingual Records Viewer (三语卡片生成系统) — An Express web app that generates trilingual (Chinese/English/Japanese) learning cards via DeepSeek V4 Pro and synthesises audio. Beyond card generation it has a SQLite-backed history / observability layer, two background job queues (generation + knowledge analysis), a knowledge analysis subsystem (synonym groups, grammar patterns, two-axis semantic classification), and a learner-facing study layer on top of it (Knowledge Hub semantic browse, SM-2 spaced-repetition review, difficulty grading, staged learning plans).

## Commands

**Run locally:**
```bash
npm install
npm start                       # Server on port 3010
```

**Tests:**
```bash
npm test                        # node:test unit suite (tests/unit/*.test.js, ~272 tests, ~1s)
npm run test:unit               # Alias for the above
npm run test:integration        # node:test L2 route tests (tests/integration/*.test.js, boots real Express on :memory:)
npm run e2e:server              # Start isolated e2e server (:3310, temp DB/records, E2E_TEST_MODE=1)
npm run test:e2e                # Full directory (all specs, hermetic via resetServerState)
npm run test:e2e:smoke          # Happy-path generation/OCR/history
npm run test:e2e:pages          # Page navigation/routing
# frontend-regression.spec.js + knowledge-hub.spec.js have no dedicated script — run as part of test:e2e
```
Specs share one server + DB but each spec's `test.beforeAll` calls `resetServerState(request)` (see [tests/e2e/fixtures/resetServerState.js](tests/e2e/fixtures/resetServerState.js)) which hits `POST /api/_test/reset` (mounted only under `E2E_TEST_MODE=1`) to wipe all tables + the records dir. New specs MUST add this hook or they'll see leftover state from earlier files. Single test: `npx playwright test tests/e2e/<file>.spec.js -g "<name>"`.

**Lint:**
```bash
npm run lint                    # ESLint 9 flat config, zero-warning baseline
npm run lint:fix                # Auto-fix
```

**Docker (recommended for full stack):**
```bash
docker compose up -d --build    # viewer + ocr + tts-en + tts-ja
docker compose logs -f
```

## Architecture

### Directory map

```
server.js              ~100 lines — bootstrap only: middleware, route mounting,
                       generation_jobs HTTP-worker bridge, error middleware,
                       listen. All business logic lives in services/ + routes/
lib/                   Process-wide infrastructure
├── logger.js          Zero-dep structured logger (JSON / pretty / silent)
├── serverConfig.js    Env-derived consts + pure helpers
├── throttle.js        Per-IP generate throttle with periodic sweep
├── e2eFixtures.js     E2E test fixtures (knowledge jobs, generate result)
└── generationHelpers.js  Pure helpers used by the generate pipeline
                          (normalizeAudioTasks, validateGeneratedContent,
                          markdown response extraction)
routes/                Each file = one express.Router() for a domain
├── _shared.js         Re-exports services + lib for routes to destructure
├── generate.js        /api/generate (the main card-generation endpoint)
├── ocr.js             /api/ocr (tesseract / local / auto)
├── generationJobs.js  /api/generation-jobs/*  (8 routes)
├── health.js          /api/health
├── history.js         /api/history /statistics /search /recent
├── dashboard.js       /api/dashboard/*
├── knowledge.js       /api/knowledge/*  (20 routes — jobs, base browse +
│                       categories, synonyms, grammar, clusters, relations)
├── srs.js             /api/srs/*  (spaced-repetition: queue, review, stats,
│                       plan — staged learning path)
├── files.js           /api/folders + /highlights + /records/by-file
└── misc.js            DELETE /api/records/:id
services/              Business logic, grouped by domain subdirectory
├── llm/               LLM providers and shared error mapping
│   ├── deepseekService.js      DeepSeek chat-completions client
│   ├── llmErrors.js           Structured provider error codes
│   └── localLlmService.js     OpenAI-compatible local endpoint for OCR/dev fallback
├── generation/        Card generation pipeline + content processing
│   ├── cardGenerationService.js  Core pipeline (generateWithProvider): prompt
│   │                             build → provider call → normalize → tokens /
│   │                             cost / quality / metadata. No DB, no fs, no TTS.
│   ├── promptEngine.js / contentPostProcessor.js
│   ├── htmlRenderer.js / markdownParser.js / japaneseFurigana.js
│   ├── audioFormat.js / ttsService.js
│   └── generationJobService.js
├── knowledge/         Knowledge analysis engine + jobs + per-task logic
│   ├── knowledgeAnalysisEngine.js  Thin dispatcher — runTask(type, cards, opts)
│   ├── knowledgeJobService.js
│   ├── textUtils.js            shared helpers
│   ├── taxonomy.js            curated two-axis semantic taxonomy (function /
│   │                          topic) consumed by the cluster task
│   └── tasks/                  {summary, cardIndex, grammarLink, cluster,
│                                issuesAudit, synonymBoundary}.js
│                              (cluster = rules-first + LLM-fallback classifier)
├── srs/               srsScheduler.js — SM-2 spaced-repetition engine (pure,
│                      grade in → next interval/ease/due out; unit-tested) +
│                      difficulty.js — card difficulty grading (SRS-empirical +
│                      heuristic; JS fn + matching SQL fragment, one constant set)
├── observability/     observabilityService.js, healthCheckService.js,
│                      statisticsService.js
├── storage/           DB + filesystem
│   ├── databaseService.js ~1100 lines — schema setup, additive migrations
│   │                       (ensureTableColumns) + thin delegations to db/
│   ├── databaseHelpers.js / fileManager.js
│   └── db/             Per-domain SQL modules each backed by direct unit tests
│       ├── helpers.js               safeJsonParse
│       ├── generations.js           generations + observability_metrics +
│       │                            audio_files insert txn + query/FTS/recent
│       ├── highlights.js            card_highlights CRUD + stats
│       ├── generationJobs.js        generation_jobs lifecycle + events + retry
│       ├── knowledgeJobs.js         knowledge_jobs lifecycle + synonym meta
│       ├── knowledgeIssues.js       knowledge_issues replace + filtered list
│       ├── knowledgeGrammar.js      knowledge_grammar_patterns + refs
│       ├── knowledgeClusters.js     knowledge_clusters + cluster_cards
│       ├── knowledgeTermsIndex.js   knowledge_terms_index upsert + search
│       ├── knowledgeSynonyms.js     candidates + groups + members + boundary
│       ├── knowledgeRelations.js    knowledge_outputs_raw write + overview /
│       │                            relations / latest summary
│       ├── cardSrs.js               card_srs + card_reviews (SM-2 state, review
│       │                            log, due queue, stats)
│       └── learningPlan.js          staged learning path (cluster → stage +
│                                    SRS progress + difficulty mix)
├── ocr/               tesseractOcrService.js
└── fixtures/          e2eFixtureService.js (E2E_TEST_MODE deterministic output)
tests/unit/            node:test, ~272 tests, in-memory SQLite for DB tests
tests/integration/     node:test L2 route tests — boot real Express on :memory: + E2E_TEST_MODE
tests/e2e/             Playwright
database/schema.sql    SQLite schema (~21 tables, FTS5 virtual table)
```

### Generation data flow
```
User Input → promptEngine (Markdown) → DeepSeek → Markdown/HTML → htmlRenderer → fileManager → ttsService
                                                        ↓
                                    databaseService (history, observability, metrics)
```

### LLM provider chain

[services/generation/cardGenerationService.js](services/generation/cardGenerationService.js) picks a provider per request:
- The active card-generation path is always DeepSeek via [services/llm/deepseekService.js](services/llm/deepseekService.js).
- [lib/serverConfig.js](lib/serverConfig.js) normalizes legacy or caller-supplied provider names to `deepseek`; generation jobs also default to `llm_provider=deepseek`.
- `DEEPSEEK_MODEL` defaults to `deepseek-v4-pro`; supported runtime model names are sanitized before use.
- [services/llm/localLlmService.js](services/llm/localLlmService.js) remains for optional OpenAI-compatible local OCR / development fallback, not the primary card-generation route.

**Timeouts**: DeepSeek calls use `DEEPSEEK_TIMEOUT_MS` (defaulted in service code when unset). Knowledge LLM fallback tasks use their own optional task timeout envs and model overrides, falling back to the DeepSeek model when unset.

**Error code convention** is in [services/llm/llmErrors.js](services/llm/llmErrors.js). Provider layers raise `Error` objects with `.code`, `.status`, and `.payload`; callers should classify by code instead of regex-matching error text.

### Persistence

- **SQLite** via `better-sqlite3`. [services/storage/databaseService.js](services/storage/databaseService.js) is now a thin class (~1100 lines) that owns schema setup + `ensureTableColumns` migrations and delegates each table family to a module under [services/storage/db/](services/storage/db/). Each domain module takes `db` as its first argument and is backed by direct unit tests. Add new tables by creating a new `services/storage/db/<domain>.js` and a delegation wrapper on the class — don't inline new SQL in databaseService.js. The `DatabaseService` class is exposed alongside the singleton so unit tests can use `new DatabaseService(':memory:')`.
- Schema in `database/schema.sql` (~21 tables: `generations`, `audio_files`, `observability_metrics`, `generation_errors`, `model_statistics`, `system_health`, `generation_jobs`/`_events`, `knowledge_*`, `card_highlights`, `card_srs`/`card_reviews`). FTS5 virtual table backs full-text search.
- **Migrations are additive and automatic** via `ensureTableColumns(...)` on startup. Add columns there, not as separate migration files.
- Generated card files live on disk under `RECORDS_PATH`, `YYYYMMDD` folders, `(2)`/`(3)` suffixes on conflicts (`fileManager.js`).
- **Security note**: `RECORDS_PATH` is NOT mounted as static. In the docker layout `DB_PATH` lives inside `RECORDS_PATH`, so a static mount used to expose the DB (and WAL) at `/data/trilingual_records.db` — see the comment in server.js. All file reads go through `/api/folders/:folder/files/:file`.

### Background jobs

DB-backed queues with `pending → running → completed/failed`, retry/backoff, stale-job recovery on startup:
- [services/generation/generationJobService.js](services/generation/generationJobService.js) — async card generation (`/api/generation-jobs/*`)
- [services/knowledge/knowledgeJobService.js](services/knowledge/knowledgeJobService.js) — knowledge tasks (`/api/knowledge/jobs/*`)

### Subsystems

- **Knowledge analysis** — `knowledgeAnalysisEngine.js` runs 6 task types (summary, index, synonym_boundary, grammar_link, cluster, issues_audit). UI: `knowledge-hub.html` (viewer), `knowledge-ops.html` (job mgmt).
  - **Semantic classification** — the `cluster` task ([services/knowledge/tasks/cluster.js](services/knowledge/tasks/cluster.js)) classifies cards into a **curated two-axis taxonomy** ([services/knowledge/taxonomy.js](services/knowledge/taxonomy.js)): grammar cards (`card_type === 'grammar_ja'`) onto a **`function`** axis (communicative function — 疑问 / 因果 / 假设 …, modeled on the Feishu「日语句式索引」base), everything else onto a **`topic`** axis (subject domain). It is **rules-first + LLM-fallback**: keyword rules place most cards, unmatched cards are batched to DeepSeek (default on, `KNOWLEDGE_CLUSTER_LLM_ENABLED`), residue lands in the axis fallback bucket. Results write `knowledge_clusters` (with an additive `taxonomy` column) + `knowledge_cluster_cards`. Categories are exposed via `GET /api/knowledge/base/categories?taxonomy=function|topic|all`; `/api/knowledge/base/terms` supports `category=<clusterKey>` and `uncategorized=1` filters.
  - **Knowledge Hub explorer** — `knowledge-hub.html` is a three-pane "knowledge explorer" (driven by `initKnowledgeBaseBrowse()` in `dashboard.js`): left nav (axis toggle + semantic-category tree + tags + Insights entries), centre term/insight list, right Relation Inspector. Data actions (refresh / rebuild-index / rebuild-cluster) start knowledge jobs from the Hub; clicking a term opens the **main app's native card modal embedded** via `/?card=<id>&embed=1` (see "Card embed mode" below). See [Docs/Features/Knowledge_Hub_and_Semantic_Classification.md](Docs/Features/Knowledge_Hub_and_Semantic_Classification.md).
- **Observability** — `observabilityService.js` tracks token counts, phase latencies, quality scores per generation. `healthCheckService.js` polls DB/LLM/TTS health. UI: `dashboard.html`.
- **Spaced repetition (SRS)** — per-card review scheduling via an SM-2 variant ([services/srs/srsScheduler.js](services/srs/srsScheduler.js), pure + unit-tested) over `card_srs` + `card_reviews` ([services/storage/db/cardSrs.js](services/storage/db/cardSrs.js)). 4-button grading (Again/Hard/Good/Easy). `GET /api/srs/queue` returns due (tracked + overdue) plus new (untracked) cards; `POST /api/srs/review {generationId, grade}` advances the schedule; `GET /api/srs/stats`. UI: the Knowledge Hub's「复习 Review」mode (a third centre-pane mode in `dashboard.js`) — due queue + grade buttons, with「查看卡片」reusing the embedded card modal.
- **Difficulty grading** — [services/srs/difficulty.js](services/srs/difficulty.js) grades each card easy/medium/hard from SRS signals (low ease / high lapses ⇒ hard) when reviewed, else a heuristic prior (card type / language profile / phrase length). The scoring constants are defined once and consumed by both the pure JS `gradeDifficulty` and a matching SQL fragment (`buildDifficultyScoreSql`) so `/api/knowledge/base/terms` can filter (`difficulty=easy|medium|hard`) and sort (`sort=difficulty`) with correct pagination; every term row returns `difficulty` + `difficultyScore`. UI: a difficulty filter + colored badge in the Hub term list.
- **Learning plan** — [services/storage/db/learningPlan.js](services/storage/db/learningPlan.js) assembles a deterministic staged study path (no LLM): one stage per active semantic cluster (axis-scoped), ordered easy→hard by average card difficulty, each with SRS progress (learned/due/new) + a difficulty mix + a recommended-next stage. `GET /api/srs/plan?axis=function|topic|all`. UI: the Knowledge Hub's「学习计划 Plan」mode (a fourth centre-pane mode) — stage cards with progress bars + a「学这组」action that jumps to that category's filtered browse.

### Frontend (public/)

Vanilla JS, no framework. Pages: `index.html` (main app), `dashboard.html`, `knowledge-hub.html`, `knowledge-ops.html`. ES modules in `public/js/modules/` (`app.js`, `api.js`, `store.js`, `audio-player.js`, `dashboard.js`, `generation-job-detail.js`, `info-modal.js`, `utils.js`, `dashboard-format.js`). `dashboard.js` serves all three dashboard-family pages (branch on `body[data-dashboard-page]`).

**Vendored libs**: marked, DOMPurify and d3 are self-hosted under `public/vendor/` (served by `express.static('public')`), not loaded from a CDN — DOMPurify is security-critical so it must always load. Google Fonts is still CDN (degrades gracefully). `eslint` ignores `public/`, so frontend JS is only validated by the Playwright e2e suite.

**Card embed mode**: `index.html` accepts `/?card=<generationId>&embed=1` — `init()` → `initEmbeddedCard()` mounts only the card modal (skips folder loading + the queue/health pollers), adds `kh-embed` to `<html>` (a pre-paint inline script does this to avoid a flash), reparents the modal overlay to `<body>` and hides every other body-level node via CSS. The Knowledge Hub embeds this in an iframe so a clicked term shows the exact main-app card modal (CONTENT/INTEL/KNOWLEDGE tabs, furigana, audio).

**Text Selection → Generate**: select text in a card's content; floating "✦ Generate Card" button enqueues a background generation task — does NOT close the modal. See `initSelectionToGenerate()` / `checkSelection()` in `app.js`.

**Dashboard polling** pauses while the tab is hidden (`isPageHidden()` guard on the health/queue/knowledge intervals) and refreshes once on `visibilitychange`.

## Logging

[lib/logger.js](lib/logger.js) is the project logger — pino/bunyan-style API, zero deps, structured JSON by default, pretty mode for dev. **Don't reach for `console.*`** in new code.

```js
const log = require('./lib/logger').child({ module: 'svc/foo' });
log.info({ port: 3010 }, 'listening');
log.error({ err }, 'failed');     // err is an Error; gets serialized with code+status
```

Config via env: `LOG_LEVEL=error|warn|info|debug`, `LOG_PRETTY=1`, `LOG_SILENT=1`. Tests use `silent: false, pretty: false` explicitly so the calling shell can't suppress assertions.

## Testing

**Unit** ([tests/unit/](tests/unit/), node:test):
- Run with `npm test`. ~272 tests across ~25 modules in ~1s.
- DB tests use `:memory:` SQLite via the exported `DatabaseService` class — hermetic, ~6ms each.
- DeepSeek provider wiring is covered by dedicated unit tests around `cardGenerationService` and `deepseekService`; production calls should keep using the service boundary rather than reaching into provider internals.
- Tests with timers use `t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 })`. Default mock time of 0 collides with `last || 0` fallbacks; always pass a realistic epoch.

**Integration** ([tests/integration/](tests/integration/), node:test — the "L2" route tier): `npm run test:integration`. A shared boot harness ([tests/integration/_harness.js](tests/integration/_harness.js)) pins env (`DB_PATH=:memory:`, `E2E_TEST_MODE=1`, `PORT=0`, blank TTS) then requires `server.js` to boot the **real Express stack** on a random port, and exposes a zero-dep `api(method, route, {body, headers})` fetch helper + `resetState()` (`truncateAllForTests`). Unlike unit tests (mocked DB) this exercises the actual route → service → DB path; unlike e2e it has no browser. Each test file runs in its own subprocess. Like e2e it's under `E2E_TEST_MODE`, so `/api/generate` uses the fixture branch. ~47 tests.

**E2E** ([tests/e2e/](tests/e2e/), Playwright): runs against an isolated server via `scripts/tests/startE2EServer.sh` (port 3310, temp DB+records, `E2E_TEST_MODE=1`). E2E mode **bypasses `generateWithProvider`** — `/api/generate` calls `buildE2EGenerateResult` (fixture). Don't rely on e2e to catch regressions in the real generation pipeline. Specific phrase prefixes trigger deterministic behaviours (`__E2E_FAIL_ONCE__`, `__E2E_AUTO_BACKOFF__`, `__E2E_ALWAYS_FAIL__`).

Per-spec hermetic state is enforced via `resetServerState(request)` in `test.beforeAll` — see the Tests section above for details.

`knowledge-hub.spec.js` covers the three-pane explorer (panes, axis toggle, category + uncategorized filtering, insights swap, relation inspector, embedded card modal). Because knowledge jobs are stubbed under E2E_TEST_MODE, it seeds a deterministic mini corpus via the test-only `POST /api/_test/seed-knowledge` (in [routes/testReset.js](routes/testReset.js), gated on `E2E_TEST_MODE=1` like `/api/_test/reset`).

## Lint

ESLint 9 flat config in [eslint.config.js](eslint.config.js). Backend code only — `public/`, `tests/e2e/`, `Docs/` are ignored. Conservative ruleset built on `eslint:recommended`; stylistic checks downgraded to warnings. **Current baseline: 0 errors, 0 warnings.** Keep it there.

## Key Conventions

- **Prompt engineering** (`services/generation/promptEngine.js`): two builders. `buildPrompt` generates a programmatic CoT/JSON prompt for the non-markdown JSON path. `buildMarkdownPrompt` is the default production path for DeepSeek card generation: it loads a template file from `prompts/` and substitutes the `{{ phrase }}` placeholder — `prompts/phrase_3LANS_markdown.md` for trilingual cards, `prompts/phrase_ja_grammar_markdown.md` for `grammar_ja`. Override paths via `MARKDOWN_PROMPT_PATH` / `GRAMMAR_MARKDOWN_PROMPT_PATH`; if a template is missing the code falls back to a minimal inline prompt. These template files are live inputs — don't delete them.
- **LLM response structure**: `{ markdown_content, html_content, audio_tasks: [{ text, lang, filename_suffix }] }`.
- **Audio file extensions**: English → `.mp3` (Safari compat), Japanese → `.wav` ([services/generation/audioFormat.js](services/generation/audioFormat.js)).
- **Japanese ruby**: `kanji(hiragana)` in markdown → `<ruby>` tags via Kuroshiro ([services/generation/japaneseFurigana.js](services/generation/japaneseFurigana.js)).
- **File naming**: safe chars only (alphanumeric, space, dash); `(2)`/`(3)` suffixes on conflicts.
- **Card highlight persistence**: `card_highlights` keyed on `(folder, base, sourceHash)` with `ON CONFLICT` update. UI persists `<mark class="study-highlight-red">` HTML.
- **Security**: HTML validation forbids `script`/`iframe`/`object`/`embed`; CSP headers on HTML responses; no static-served data directory.

## Environment Variables

See `.env.example` for the full set. Key knobs:

**LLM provider chain:**
- `DEEPSEEK_API_KEY` — required outside fixture/test modes; never commit a real value.
- `DEEPSEEK_BASE_URL` — defaults to `https://api.deepseek.com`.
- `DEEPSEEK_MODEL` — defaults to `deepseek-v4-pro`; accepted values are sanitized in `lib/serverConfig.js`.
- `DEEPSEEK_TIMEOUT_MS` and `DEEPSEEK_THINKING` — provider call timeout and thinking-mode flag.
- `DEEPSEEK_INPUT_COST_PER_1M` / `DEEPSEEK_OUTPUT_COST_PER_1M` — optional observability cost overrides.
- `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_OCR_MODEL` — optional OpenAI-compatible local endpoint for OCR local/auto mode and development fallback only.

**Logging:** `LOG_LEVEL`, `LOG_PRETTY`, `LOG_SILENT`.

**Storage:** `DB_PATH`, `RECORDS_PATH`, `RECORDS_TIMEZONE`. Use `DB_PATH=:memory:` in unit tests to keep them off disk.

**TTS:** `TTS_EN_ENDPOINT` (Kokoro), `TTS_JA_ENDPOINT` (VOICEVOX).

**OCR:** `OCR_PROVIDER=tesseract` (recommended), `OCR_TESSERACT_ENDPOINT`, `OCR_LANGS`.

**Knowledge analysis (LLM fallback, all optional):** `KNOWLEDGE_CLUSTER_LLM_ENABLED` (default on — the cluster task's LLM fallback) + `KNOWLEDGE_CLUSTER_{MAX_LLM_CARDS,LLM_BATCH_SIZE,LLM_TIMEOUT_MS,MODEL}`; `KNOWLEDGE_SYNONYM_LLM_ENABLED` (default off) + `KNOWLEDGE_SYNONYM_{LLM_TIMEOUT_MS,MODEL}`. Model knobs fall back to `DEEPSEEK_MODEL`. See `.env.example` for the full list. SRS / difficulty / learning-plan read no env (deterministic).

## Docker services

- **3010** — viewer (Express)
- **ocr** — Tesseract OCR sidecar
- **8000** — Kokoro TTS (English)
- **50021** — VOICEVOX (Japanese)

## Docs

`Docs/` holds longer-form material: `Architecture/`, `Features/`, `Operations/`, `TestReports/`. Check there for deployment / ops details.
