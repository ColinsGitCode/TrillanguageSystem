# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Trilingual Records Viewer (三语卡片生成系统) — An Express web app that generates trilingual (Chinese/English/Japanese) learning cards via an LLM and synthesises audio. Beyond card generation it has a SQLite-backed history / observability layer, two background job queues (generation + knowledge analysis), and a knowledge analysis subsystem (synonym groups, grammar patterns, semantic clusters).

## Commands

**Run locally:**
```bash
npm install
npm start                       # Server on port 3010
npm run gemini-proxy            # Host-side Gemini executor on :13210 (separate process on host)
```

**Tests:**
```bash
npm test                        # node:test unit suite (tests/unit/*.test.js, ~238 tests, ~1s)
npm run test:unit               # Alias for the above
npm run e2e:server              # Start isolated e2e server (:3310, temp DB/records, E2E_TEST_MODE=1)
npm run test:e2e                # Full directory (all 5 specs, hermetic via resetServerState)
npm run test:e2e:smoke          # Happy-path generation/OCR/history
npm run test:e2e:pages          # Page navigation/routing
npm run test:e2e:gemini-sanitize # MCP diagnostic stripping regression
npm run test:e2e:real           # Hits real Gemini (needs RUN_REAL_GEMINI_E2E=1)
# frontend-regression.spec.js has no dedicated script — runs as part of test:e2e
```
Specs share one server + DB but each spec's `test.beforeAll` calls `resetServerState(request)` (see [tests/e2e/fixtures/resetServerState.js](tests/e2e/fixtures/resetServerState.js)) which hits `POST /api/_test/reset` (mounted only under `E2E_TEST_MODE=1`) to wipe all tables + the records dir. New specs MUST add this hook or they'll see leftover state from earlier files. Single test: `npx playwright test tests/e2e/<file>.spec.js -g "<name>"`.

**Lint:**
```bash
npm run lint                    # ESLint 9 flat config, zero-warning baseline
npm run lint:fix                # Auto-fix
```

**Docker (recommended for full stack):**
```bash
docker compose up -d --build    # viewer + gemini-proxy + ocr + tts-en + tts-ja
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
                          validateSanitizedGeminiCardResponse,
                          extractGeminiMarkdownResponse)
routes/                Each file = one express.Router() for a domain
├── _shared.js         Re-exports services + lib for routes to destructure
├── generate.js        /api/generate (the main card-generation endpoint)
├── ocr.js             /api/ocr (tesseract / local / auto)
├── generationJobs.js  /api/generation-jobs/*  (8 routes)
├── health.js          /api/health + /api/gemini/auth/*
├── history.js         /api/history /statistics /search /recent
├── dashboard.js       /api/dashboard/*
├── knowledge.js       /api/knowledge/*  (17 routes)
├── files.js           /api/folders + /highlights + /records/by-file
└── misc.js            DELETE /api/records/:id
services/              Business logic, grouped by domain subdirectory
├── llm/               LLM providers + gemini transport chain
│   ├── geminiService.js        Legacy Gemini API native client (OCR fallback)
│   ├── geminiCliService.js     In-process CLI transport
│   ├── geminiProxyService.js   HTTP client for the gemini proxy chain
│   ├── geminiGatewayServer.js  Docker gateway (:18888) — runs in container
│   ├── geminiAuthService.js    OAuth flow (CLI mode only)
│   ├── geminiProcessUtils.js   CLI spawn + process-tree kill (shared)
│   ├── geminiErrors.js         Structured error codes (EXECUTOR_TIMEOUT…)
│   ├── geminiTimeouts.js       Single-knob timeout hierarchy (client>gateway>exec)
│   └── localLlmService.js
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
│   └── tasks/                  {summary, cardIndex, grammarLink, cluster,
│                                issuesAudit, synonymBoundary}.js
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
│       └── knowledgeRelations.js    knowledge_outputs_raw write + overview /
│                                    relations / latest summary
├── ocr/               tesseractOcrService.js
└── fixtures/          e2eFixtureService.js (E2E_TEST_MODE deterministic output)
scripts/infra/gemini-host-proxy.js  HOST process (:13210) spawning the gemini CLI
tests/unit/            node:test, ~238 tests, in-memory SQLite for DB tests
tests/e2e/             Playwright
database/schema.sql    SQLite schema (~14 tables, FTS5 virtual table)
```

### Generation data flow
```
User Input → promptEngine (CoT) → LLM provider → JSON → htmlRenderer → fileManager → ttsService
                                                  ↓
                              databaseService (history, observability, metrics)
```

### LLM provider chain

[services/generation/cardGenerationService.js](services/generation/cardGenerationService.js) picks a provider per request:
- **`provider === 'local'`** → `services/llm/localLlmService.js` (OpenAI-compatible local endpoint, `LLM_BASE_URL`)
- **`provider === 'gemini'`** with **`GEMINI_MODE=host-proxy`** (default, production path) → `services/llm/geminiProxyService.js`
- **`provider === 'gemini'`** with **`GEMINI_MODE=cli`** → `services/llm/geminiCliService.js` (also enables `/api/gemini/auth/*`)

The host-proxy path is a **3-hop chain** because the `gemini` CLI must run on the host, not in Docker:
```
viewer  → gemini-gateway container (:18888, geminiGatewayServer.js)
        → host executor (scripts/infra/gemini-host-proxy.js :13210, spawns `gemini` CLI)
```

**Timeout hierarchy** is derived from a single base in [services/llm/geminiTimeouts.js](services/llm/geminiTimeouts.js):
- `GEMINI_EXECUTION_BUDGET_MS` (default 90s) = max CLI run for an interactive call
- `GEMINI_MAX_EXECUTION_BUDGET_MS` (default 240s) = hard ceiling for long single calls
- `GEMINI_HOP_BUFFER_MS` (default 15s) added per transport hop so the executor times out first with a clean error

**Error code convention** is in [services/llm/geminiErrors.js](services/llm/geminiErrors.js). Each layer raises `Error` objects with `.code`, `.status`, and `.payload`. `geminiProxyService` propagates these even through wrapped errors so `generationJobService` can classify (`isTransientCapacityError` reads `.payload.code`). Don't regex-match error messages — use the `code` field.

**Concurrency**: the host executor enforces `GEMINI_MAX_CONCURRENT` (default 2) — concurrent callers above the limit wait `GEMINI_QUEUE_WAIT_MS` for a slot then receive `429 EXECUTOR_BUSY`.

### Persistence

- **SQLite** via `better-sqlite3`. [services/storage/databaseService.js](services/storage/databaseService.js) is now a thin class (~1100 lines) that owns schema setup + `ensureTableColumns` migrations and delegates each table family to a module under [services/storage/db/](services/storage/db/). Each domain module takes `db` as its first argument and is backed by direct unit tests. Add new tables by creating a new `services/storage/db/<domain>.js` and a delegation wrapper on the class — don't inline new SQL in databaseService.js. The `DatabaseService` class is exposed alongside the singleton so unit tests can use `new DatabaseService(':memory:')`.
- Schema in `database/schema.sql` (~14 tables: `generations`, `audio_files`, `observability_metrics`, `generation_errors`, `model_statistics`, `system_health`, `generation_jobs`/`_events`, `knowledge_*`, `card_highlights`). FTS5 virtual table backs full-text search.
- **Migrations are additive and automatic** via `ensureTableColumns(...)` on startup. Add columns there, not as separate migration files.
- Generated card files live on disk under `RECORDS_PATH`, `YYYYMMDD` folders, `(2)`/`(3)` suffixes on conflicts (`fileManager.js`).
- **Security note**: `RECORDS_PATH` is NOT mounted as static. In the docker layout `DB_PATH` lives inside `RECORDS_PATH`, so a static mount used to expose the DB (and WAL) at `/data/trilingual_records.db` — see the comment in server.js. All file reads go through `/api/folders/:folder/files/:file`.

### Background jobs

DB-backed queues with `pending → running → completed/failed`, retry/backoff, stale-job recovery on startup:
- [services/generation/generationJobService.js](services/generation/generationJobService.js) — async card generation (`/api/generation-jobs/*`)
- [services/knowledge/knowledgeJobService.js](services/knowledge/knowledgeJobService.js) — knowledge tasks (`/api/knowledge/jobs/*`)

### Subsystems

- **Knowledge analysis** — `knowledgeAnalysisEngine.js` runs 6 task types (summary, index, synonym_boundary, grammar_link, cluster, issues_audit). UI: `knowledge-hub.html` (viewer), `knowledge-ops.html` (job mgmt).
- **Observability** — `observabilityService.js` tracks token counts, phase latencies, quality scores per generation. `healthCheckService.js` polls DB/LLM/TTS health. UI: `dashboard.html`.

### Frontend (public/)

Vanilla JS, no framework. Pages: `index.html` (main app), `dashboard.html`, `knowledge-hub.html`, `knowledge-ops.html`. ES modules in `public/js/modules/` (`app.js`, `api.js`, `store.js`, `audio-player.js`, `dashboard.js`, `generation-job-detail.js`, `virtual-list.js`). marked.js + DOMPurify.

**Text Selection → Generate**: select text in a card's content; floating "✦ Generate Card" button enqueues a background generation task — does NOT close the modal. See `initSelectionToGenerate()` / `checkSelection()` in `app.js`.

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
- Run with `npm test`. ~238 tests across ~25 modules in ~1s.
- DB tests use `:memory:` SQLite via the exported `DatabaseService` class — hermetic, ~6ms each.
- Pure helpers in `geminiProxyService` are exposed under `module._internal` for direct unit testing. Production code does not reach for these.
- Tests with timers use `t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 })`. Default mock time of 0 collides with `last || 0` fallbacks; always pass a realistic epoch.

**E2E** ([tests/e2e/](tests/e2e/), Playwright): runs against an isolated server via `scripts/tests/startE2EServer.sh` (port 3310, temp DB+records, `E2E_TEST_MODE=1`). E2E mode **bypasses `generateWithProvider`** — `/api/generate` calls `buildE2EGenerateResult` (fixture). Don't rely on e2e to catch regressions in the real generation pipeline. Specific phrase prefixes trigger deterministic behaviours (`__E2E_FAIL_ONCE__`, `__E2E_AUTO_BACKOFF__`, `__E2E_ALWAYS_FAIL__`).

Per-spec hermetic state is enforced via `resetServerState(request)` in `test.beforeAll` — see the Tests section above for details.

## Lint

ESLint 9 flat config in [eslint.config.js](eslint.config.js). Backend code only — `public/`, `tests/e2e/`, `Docs/` are ignored. Conservative ruleset built on `eslint:recommended`; stylistic checks downgraded to warnings. **Current baseline: 0 errors, 0 warnings.** Keep it there.

## Key Conventions

- **Prompt engineering** (`services/generation/promptEngine.js`): CoT 5-step reasoning, polysemy disambiguation, built-in self-check. Current prompts are generated programmatically; `prompts/phrase_3LANS_markdown.md` is deprecated legacy.
- **LLM response structure**: `{ markdown_content, html_content, audio_tasks: [{ text, lang, filename_suffix }] }`.
- **Audio file extensions**: English → `.mp3` (Safari compat), Japanese → `.wav` ([services/generation/audioFormat.js](services/generation/audioFormat.js)).
- **Japanese ruby**: `kanji(hiragana)` in markdown → `<ruby>` tags via Kuroshiro ([services/generation/japaneseFurigana.js](services/generation/japaneseFurigana.js)).
- **File naming**: safe chars only (alphanumeric, space, dash); `(2)`/`(3)` suffixes on conflicts.
- **Card highlight persistence**: `card_highlights` keyed on `(folder, base, sourceHash)` with `ON CONFLICT` update. UI persists `<mark class="study-highlight-red">` HTML.
- **Security**: HTML validation forbids `script`/`iframe`/`object`/`embed`; CSP headers on HTML responses; no static-served data directory.

## Environment Variables

See `.env.example` for the full set. Key knobs:

**LLM provider chain:**
- `GEMINI_MODE` = `host-proxy` (default) or `cli`
- `GEMINI_PROXY_URL` — must be the `:18888` gateway (default `http://host.docker.internal:18888/api/gemini`)
- `GEMINI_EXECUTION_BUDGET_MS` / `GEMINI_MAX_EXECUTION_BUDGET_MS` / `GEMINI_HOP_BUFFER_MS` — single-knob timeout hierarchy
- `GEMINI_MAX_CONCURRENT` / `GEMINI_QUEUE_WAIT_MS` — host executor concurrency
- `GEMINI_PROXY_MODEL` — model selection (`TRAINING_TEACHER_MODEL` still honored as a legacy fallback)
- `GEMINI_PROXY_API_KEY` / `GEMINI_PROXY_BEARER_TOKEN`, `GEMINI_PROXY_AUTH_MODE`
- `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` — local LLM (OpenAI-compatible)

**Logging:** `LOG_LEVEL`, `LOG_PRETTY`, `LOG_SILENT`.

**Storage:** `DB_PATH`, `RECORDS_PATH`, `RECORDS_TIMEZONE`. Use `DB_PATH=:memory:` in unit tests to keep them off disk.

**TTS:** `TTS_EN_ENDPOINT` (Kokoro), `TTS_JA_ENDPOINT` (VOICEVOX).

**OCR:** `OCR_PROVIDER=tesseract` (recommended), `OCR_TESSERACT_ENDPOINT`, `OCR_LANGS`.

## Docker services

- **3010** — viewer (Express)
- **18888** — gemini-proxy gateway container (forwards to host executor)
- **ocr** — Tesseract OCR sidecar
- **8000** — Kokoro TTS (English)
- **50021** — VOICEVOX (Japanese)

The `gemini` CLI binary + [scripts/infra/gemini-host-proxy.js](scripts/infra/gemini-host-proxy.js) run on the **host**, not in Docker. Install as a macOS LaunchAgent via [scripts/infra/install_host_executor_launchd.sh](scripts/infra/install_host_executor_launchd.sh).

## Docs

`Docs/` holds longer-form material: `Architecture/`, `Features/`, `Operations/`, `TestReports/`, `Archive/`. Check there for deployment / ops details.
