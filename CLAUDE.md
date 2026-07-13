# CLAUDE.md

## Project

Three LANS Cards Factory is a local Express application for generating Markdown-first trilingual, Japanese grammar, and scenario-expression learning cards with DeepSeek. English audio uses Kokoro; Japanese audio uses VOICEVOX; Chinese explanation text has no TTS.

This file is the authoritative current architecture index. For migration intent, read Docs/Architecture/Fullstack_Migration_React_Router.md.

## Product boundary

Current runtime capabilities:

- card generation for trilingual, grammar_ja, and scenario_phrase;
- OCR input;
- DB-backed generation queue, retry, recovery, and audit events;
- folder/card browsing, history, deletion, and highlights;
- card modal with CONTENT and INTEL;
- generation observability and infrastructure health.

Retired on 2026-07-13:

- Mission Control;
- Knowledge Hub and Knowledge OPS;
- knowledge analysis, taxonomy, synonym, grammar-link, issue-audit, and relation domains;
- SRS, review, daily goal, difficulty, engagement, and learning plan;
- card KNOWLEDGE tab, SRS footer, and embed mode.

Retired code, routes, schema, tests, and visual snapshots must not be restored during the architecture migration. Learning Assistance 2.0 and Knowledge Graph 2.0 are post-migration product projects and require new designs.

## Commands

    npm start
    npm test
    npm run test:integration
    npm run lint
    npm run smoke
    npm run test:e2e
    docker compose up -d --build

The Compose project name is three_lans_system. The user-visible app is http://127.0.0.1:3010/.

## Runtime architecture

    Browser
      -> public/index.html
      -> public/js/modules/*
      -> /api/*

    Express server.js
      -> route adapters
      -> generation/llm/ocr/observability/storage services
      -> SQLite + records filesystem
      -> one in-process generation worker

The active Cards Factory frontend is still vanilla browser ESM. The Node 20 container now runs server.mjs as a hybrid composition root: /__rr-poc is React Router v7 SSR, / remains legacy Cards Factory, and /api/* remains Express. The production viewer is an immutable image; do not restore the source or node_modules bind mounts.

## Routes

Active route modules:

- routes/generate.js: POST /api/generate;
- routes/generationJobs.js: /api/generation-jobs list, summary, detail, events, retry, cancel, clear;
- routes/files.js: folders, files, highlights, delete by file;
- routes/history.js: history, statistics, search, recent, record detail;
- routes/health.js: /api/health;
- routes/ocr.js: /api/ocr;
- routes/misc.js: delete record by id;
- routes/testReset.js: E2E-only reset.

Routes under /api/dashboard, /api/knowledge, and /api/srs do not exist and must return 404.

## Services

    services/
      fixtures/
        e2eFixtureService.js
      generation/
        audioFormat.js
        cardGenerationService.js
        contentPostProcessor.js
        generationJobService.js
        htmlRenderer.js
        japaneseFurigana.js
        markdownParser.js
        promptEngine.js
        ttsService.js
      llm/
        deepseekService.js
        llmErrors.js
        localLlmService.js
      observability/
        healthCheckService.js
        observabilityService.js
        statisticsService.js
      ocr/
        tesseractOcrService.js
      storage/
        databaseService.js
        databaseHelpers.js
        fileManager.js
        db/
          generationJobs.js
          generations.js
          helpers.js
          highlights.js
          testReset.js

Do not create a second copy of backend services inside the future React app. React server code must call existing backend capabilities through explicit server-only adapters or HTTP contracts.

## Generation flow

    user input or OCR
      -> POST /api/generation-jobs
      -> generation worker
      -> POST /api/generate with worker bridge
      -> promptEngine
      -> deepseekService
      -> content post-processing and validation
      -> Markdown/HTML rendering
      -> TTS
      -> fileManager
      -> databaseService

routes/generate.js still owns too much orchestration. The architecture migration extracts executeCardGeneration(command, context) as an application use case. Until parity tests pass, the worker retains the HTTP self-request bridge.

## LLM and TTS

- DeepSeek is the only active card-generation provider.
- DEEPSEEK_MODEL defaults to deepseek-v4-pro.
- Legacy provider names normalize to deepseek.
- localLlmService is only an optional OpenAI-compatible OCR/development adapter.
- English TTS: Kokoro, MP3.
- Japanese TTS: VOICEVOX, WAV.
- Style-Bert-VITS2 is archived behind an opt-in Compose profile because resource cost exceeded its practical quality gain.

Provider errors use structured Error.code, Error.status, and Error.payload. Do not classify by matching message text.

## Markdown-first card contract

    Markdown
      -> marked
      -> ruby/audio adapter
      -> DOMPurify
      -> card renderer

Required invariants:

- DOMPurify failure is fail-closed;
- Japanese ruby annotates only the corresponding kanji;
- generated audio tasks strip readings before TTS;
- English audio uses MP3 and Japanese audio uses WAV;
- scenario cards have an AI-generated title within ten Chinese characters and 12 expression blocks;
- card modal has CONTENT and INTEL only;
- highlights persist through card_highlights;
- desktop/mobile modal height, focus trap, Escape, and focus restoration remain stable.

## Frontend

Active files:

    public/index.html
    public/styles.css
    public/modern-card.css
    public/css/tokens.css
    public/css/components.css
    public/css/app-shell.css
    public/js/modules/api.js
    public/js/modules/app-shell.js
    public/js/modules/app.js
    public/js/modules/audio-player.js
    public/js/modules/card-renderer.js
    public/js/modules/generation-job-detail.js
    public/js/modules/info-modal.js
    public/js/modules/shell-health.js
    public/js/modules/store.js
    public/js/modules/utils.js

The shell has one product destination: Cards Factory. The card library is part of that page, not a separate route.

Vendored marked, DOMPurify, and d3 are served locally under public/vendor. Keep DOMPurify loaded before card rendering. D3 is still used by the INTEL panel.

## Persistence

SQLite uses better-sqlite3 with WAL and foreign keys enabled.

Current tables:

- generations;
- audio_files;
- observability_metrics;
- generation_errors;
- model_statistics;
- system_health;
- card_highlights;
- generation_jobs;
- generation_job_events;
- generations_fts virtual table and triggers.

database/schema.sql is the schema source. databaseService initializes it and runs compatibility migrations. SQL domain code lives under services/storage/db.

dropDeprecatedTables permanently removes legacy training, Knowledge, SRS, card_reviews, and user_preferences tables from existing databases. This destructive cleanup is intentional and part of the approved retirement.

Generated files live under RECORDS_PATH. Do not expose RECORDS_PATH through express.static. File reads must use the files routes.

## Security

- Never commit a real DeepSeek key.
- Generated HTML rejects script, iframe, object, and embed.
- Card HTML is sanitized with DOMPurify.
- HTML responses use CSP.
- File paths must remain constrained under RECORDS_PATH.
- Test-only endpoints mount only under E2E_TEST_MODE=1.

## Testing

Unit tests:

    npm test

They use node:test and in-memory SQLite where applicable.

Integration tests:

    npm run test:integration

The harness boots the real Express stack with DB_PATH=:memory:, E2E_TEST_MODE=1, and a random port.

Playwright:

    npm run test:e2e

The E2E server uses deterministic generation and OCR fixtures. It does not validate real DeepSeek or TTS quality. Core coverage must include:

- three card types;
- queue success/failure/retry/detail;
- OCR;
- folder and card browsing;
- CONTENT/INTEL modal;
- highlights and deletion;
- theme, keyboard, responsive layout, and visual snapshots;
- 404 for retired pages and APIs.

Never update visual baselines without inspecting the images.

## Logging

Use lib/logger.js, not new console calls in backend code.

Environment:

- LOG_LEVEL;
- LOG_PRETTY;
- LOG_SILENT.

## Environment

See .env.example. Key groups:

- DeepSeek: DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, DEEPSEEK_TIMEOUT_MS;
- storage: DB_PATH, RECORDS_PATH, RECORDS_TIMEZONE;
- TTS: TTS_EN_ENDPOINT, TTS_JA_ENDPOINT;
- OCR: OCR_PROVIDER, OCR_TESSERACT_ENDPOINT, OCR_LANGS;
- optional local OCR/dev LLM: LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, LLM_OCR_MODEL.

Knowledge and SRS environment variables are retired and must not be reintroduced.

## Migration rules

1. Finish deletion and runtime verification before adding React.
2. Add React Router first on /__rr-poc; do not seize / immediately.
3. Keep root package CommonJS; use an ESM composition root.
4. Keep existing Express API envelopes stable during UI migration.
5. Preserve tokens, testids, behavior, and visual gates.
6. Extract the generation use case before replacing the worker bridge.
7. Do not implement new learning or graph features during migration.
