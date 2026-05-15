# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Trilingual Records Viewer (三语卡片生成系统) - An Express web app that generates trilingual (Chinese/English/Japanese) learning cards via LLM content generation and text-to-speech. Beyond card generation it also includes a SQLite-backed history/observability layer, a background job queue, a few-shot/training-pack experimentation pipeline, and a knowledge-analysis subsystem.

## Commands

**Run locally:**
```bash
npm install
npm start                       # Server on port 3010
npm run gemini-proxy            # Host-side Gemini executor on port 13210 (run separately on host)
```

**Docker (recommended):**
```bash
docker compose up -d --build    # viewer + gemini-proxy + ocr + tts-en + tts-ja
docker compose logs -f
docker compose down
```

**E2E tests (Playwright):**
```bash
npm run e2e:server              # Start isolated test server (port 3310, temp DB/records, E2E_TEST_MODE=1)
npm run test:e2e                # All e2e tests
npm run test:e2e:smoke          # Happy-path generation/OCR/history
npm run test:e2e:pages          # Page navigation/routing
npm run test:e2e:gemini-sanitize # Verifies MCP diagnostic noise is stripped from responses
npm run test:e2e:real           # Hits real Gemini (needs RUN_REAL_GEMINI_E2E=1)
```
`scripts/startE2EServer.sh` wipes `.tmp/e2e/`, disables TTS, and shrinks retry backoff. Single test: `npx playwright test tests/e2e/<file>.spec.js -g "<name>"`.

**Few-shot experiment workflow:**
```bash
npm run fewshot:rounds          # Run multi-round few-shot experiments
npm run fewshot:export-round    # Export round trend dataset
npm run fewshot:render-round-charts  # Render D3 charts (d3/)
npm run fewshot:report-round    # Generate KPI report
npm run training:backfill       # Backfill training packs for existing cards
```

## Architecture

### Generation data flow
```
User Input → promptEngine (CoT + few-shot) → LLM provider → JSON → htmlRenderer → fileManager → ttsService
                                                  ↓
                              databaseService (history, observability, metrics)
```

### LLM provider chain (important — this is the most-changed area)

`server.js` picks a provider per request. `DEFAULT_LLM_PROVIDER='gemini'`. The provider/mode logic lives around `server.js:871-888`:

- **`provider === 'local'`** → `services/localLlmService.js` (OpenAI-compatible local endpoint, `LLM_BASE_URL`).
- **`provider === 'gemini'`** with **`GEMINI_MODE=host-proxy`** (default) → `services/geminiProxyService.js`. This is the production path.
- **`provider === 'gemini'`** with **`GEMINI_MODE=cli`** → `services/geminiCliService.js` (direct Gemini CLI invocation; also enables the `/api/gemini/auth/*` OAuth routes).
- `services/geminiService.js` is the legacy native-API client (still used for some OCR paths).

The host-proxy path is a 3-hop chain because the Gemini CLI binary must run on the host, not in Docker:
```
viewer container → gemini-proxy container (geminiGatewayServer.js, :18888)
                 → host executor (scripts/gemini-host-proxy.js, :13210, spawns `gemini` CLI)
```
- `geminiProxyService.js` enforces that `GEMINI_PROXY_URL` points at the **:18888 gateway** ("unified mode"), with retry/backoff, circuit breaker, IPv4 fallback for `host.docker.internal`, and MCP-diagnostic sanitization.
- `geminiGatewayServer.js` (built by `Dockerfile.gemini-gateway`) is a thin pass-through to `GEMINI_EXECUTOR_BASE_URL`.
- `scripts/gemini-host-proxy.js` spawns the `gemini` binary, manages process lifecycle/timeouts, and exposes `POST /api/gemini` + `POST /admin/reset`. Auth dir resolves: `$GEMINI_PROXY_HOME` → `.runtime/.gemini/` → `~/.gemini/`. Install as a macOS LaunchAgent via `scripts/install_host_executor_launchd.sh`.

### Persistence

- **SQLite** via `better-sqlite3`. `services/databaseService.js` (~3900 lines) is the data layer; `services/databaseHelpers.js` has shared helpers. `DB_PATH` defaults to `./data/trilingual_records.db`.
- Schema in `database/schema.sql` (~25 tables: `generations`, `audio_files`, `observability_metrics`, `generation_jobs`/`_events`, `few_shot_*`, `experiment_*`, `review_*`, `example_*`, `knowledge_*`, `card_training_assets`, `card_highlights`, `model_statistics`, `system_health`). FTS5 virtual table backs full-text search.
- **Migrations are additive and automatic** — `databaseService` calls `ensureTableColumns(...)` on startup to add new columns. Add schema changes there, not as separate migration files.
- Generated card files still live on disk under `RECORDS_PATH`, organized in `YYYYMMDD` folders (`fileManager.js`), with `(2)`/`(3)` suffixes on name conflicts.

### Background jobs

Two DB-backed queues, each with `pending → running → completed/failed` states, retry/backoff, and stale-job recovery on startup:
- **`generationJobService.js`** — async card generation (`/api/generation-jobs/*`).
- **`knowledgeJobService.js`** — knowledge-analysis tasks (`/api/knowledge/jobs/*`).

### Subsystems

- **Few-shot / training** — `goldenExamplesService.js` selects high-quality past outputs as few-shot examples (strategies like `HIGH_QUALITY_GEMINI`, gated by quality score). `exampleReviewService.js` handles human review campaigns (5-dimension scoring). `experimentTrackingService.js` + `fewShotMetricsService.js` log and measure A/B variants. `trainingPackService.js` exports cards as structured training packs (`training_pack_v1`, with a repair variant). Prompts in `prompts/card_training_pack_*.md`.
- **Knowledge analysis** — `knowledgeAnalysisEngine.js` runs 6 task types over the card corpus (summary, index, synonym_boundary, grammar_link, cluster, issues_audit) to build term indexes, synonym groups, grammar patterns, semantic clusters, and detect quality issues. Surfaced via `knowledge-hub.html` (viewer) and `knowledge-ops.html` (job management).
- **Observability** — `observabilityService.js` tracks token counts, phase latencies, and quality scores per generation. `healthCheckService.js` polls DB/LLM/TTS health. Surfaced via `dashboard.html`.

### server.js route groups

`server.js` (~2650 lines) — route groups: generation & OCR (`/api/generate`, `/api/ocr`), generation jobs (`/api/generation-jobs/*`), history/search/statistics, Gemini auth (`/api/gemini/auth/*`, CLI mode only), health & dashboard (`/api/health`, `/api/dashboard/*`), review system (`/api/review/*`), knowledge (`/api/knowledge/*`), training (`/api/training/*`), files & folders (`/api/folders/*`, `/api/records/*`), highlights (`/api/highlights/*`).

### Frontend (public/)

Vanilla JS, no framework. Pages: `index.html` (main app), `dashboard.html` (observability), `knowledge-hub.html` / `knowledge-ops.html`. ES modules in `public/js/modules/` (`app.js`, `api.js`, `store.js`, `audio-player.js`, `dashboard.js`, `generation-job-detail.js`, `virtual-list.js`, etc.). Uses marked.js + DOMPurify.

**Text Selection → Generate**: selecting text inside a card's content area shows a floating "✦ Generate Card" button that pre-fills the phrase input. See `initSelectionToGenerate()` / `checkSelection()` in `app.js`.

## Key Conventions

- **Prompt engineering** (`services/promptEngine.js`): CoT 5-step reasoning, few-shot examples, 5-dimension example-quality standards (authenticity, length, difficulty, naturalness, diversity), polysemy disambiguation, built-in self-check. Current prompts are generated programmatically; `prompts/phrase_3LANS_markdown.md` is the deprecated legacy spec kept for reference.
- **LLM response structure**: `{ markdown_content, html_content, audio_tasks: [{ text, lang, filename_suffix }] }`.
- **Japanese ruby**: `kanji(hiragana)` in markdown auto-converts to `<ruby>` tags via `japaneseFurigana.js` (Kuroshiro, lazy singleton).
- **File naming**: safe chars only (alphanumeric, space, dash).
- **Security**: HTML validation forbids `script`/`iframe`/`object`/`embed`; CSP headers on HTML responses.
- **E2E fixtures**: when `E2E_TEST_MODE=1`, special phrase prefixes (e.g. `__E2E_FAIL_ONCE__`) trigger deterministic behaviors via `services/e2eFixtureService.js`.

## Environment Variables

See `.env.example` (extensively commented). Key settings:

**LLM provider:**
- `GEMINI_MODE` — `host-proxy` (default) or `cli`
- `GEMINI_PROXY_URL` — must point at the `:18888` gateway (default `http://host.docker.internal:18888/api/gemini`)
- `GEMINI_EXECUTOR_BASE_URL` / `GEMINI_HOST_EXECUTOR_URL` — host executor on `:13210`
- `GEMINI_PROXY_MODEL`, `TRAINING_TEACHER_MODEL` — model selection (currently `gemini-3-flash-preview`)
- `GEMINI_PROXY_API_KEY` / `GEMINI_PROXY_BEARER_TOKEN`, `GEMINI_PROXY_AUTH_MODE` — gateway auth
- `GEMINI_PROXY_*_TIMEOUT_MS`, `GEMINI_PROXY_RETRIES`, `TRAINING_*` — timeouts/retries (many tuning knobs in `.env.example`)
- `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` — local LLM provider (OpenAI-compatible)

**Few-shot:** `ENABLE_GOLDEN_EXAMPLES`, `ENABLE_GEMINI_FEWSHOT`, `GOLDEN_EXAMPLES_STRATEGY`, `GOLDEN_EXAMPLES_COUNT`, `GOLDEN_EXAMPLES_MIN_SCORE`, `FEWSHOT_TOKEN_BUDGET_RATIO`.

**Storage:** `DB_PATH`, `RECORDS_PATH`, `RECORDS_TIMEZONE`.

**TTS:** `TTS_EN_ENDPOINT` (Kokoro), `TTS_JA_ENDPOINT` (VOICEVOX).

**OCR:** `OCR_PROVIDER` (`tesseract` recommended — runs in the `ocr` container), `OCR_TESSERACT_ENDPOINT`, `OCR_LANGS`.

## Docker Services

- **3010** — viewer (Express app)
- **18888** — gemini-proxy gateway container (forwards to host executor on 13210)
- **ocr** — Tesseract OCR sidecar
- **8000** — Kokoro TTS (English)
- **50021** — VOICEVOX (Japanese)

The `gemini` CLI binary and `scripts/gemini-host-proxy.js` run on the **host**, not in Docker.

## Docs

`Docs/` holds longer-form material: `Architecture/`, `Features/`, `Operations/`, `Status/`, `Experiments/`, `TestReports/`. Check there for deployment/ops details and experiment logs.
