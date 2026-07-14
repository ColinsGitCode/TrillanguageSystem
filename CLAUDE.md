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
- generation observability and infrastructure health;
- Learning Assistance 2.0 backend contract for plan, daily queue, resumable session, reveal, skip, end, idempotent review and Study Item view models; no learning UI yet.

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
      -> React Router v7 root route
      -> app/features/*
      -> /api/*

    server.mjs composition root
      -> React Router SSR + hashed client assets
      -> Express route adapters
      -> generation/llm/ocr/observability/storage services
      -> SQLite + records filesystem
      -> one in-process generation worker

The active Cards Factory frontend is React Router v7 + TypeScript at `/`; `/api/*` remains Express in the same `server.mjs` process. The former `/__rr-poc` route and legacy browser ESM frontend are retired and return 404. The production viewer is an immutable image; do not restore source or node_modules bind mounts.

`server.js` is not a second production entry. It is the CommonJS API-only bootstrap used by `tests/integration/_harness.js`; both entrypoints delegate Express construction and startup to `lib/httpRuntime`, while only `server.mjs` mounts React Router and runs in Compose.

## Routes

Active route modules:

- routes/generate.js: POST /api/generate;
- routes/generationJobs.js: /api/generation-jobs list, summary, detail, events, retry, cancel, clear;
- routes/files.js: folders, files, highlights, delete by file;
- routes/history.js: history, statistics, search, recent, record detail;
- routes/health.js: /api/health;
- routes/ocr.js: /api/ocr;
- routes/misc.js: delete record by id;
- routes/learning.js: `/api/learning` plan, queue, session, review and Study Item contract;
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
      learning/
        application/
          learningService.js
          materializeStudyItems.js
        domain/
        scheduling/
        time/
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
      -> SQLite persistent queue + atomic claim
      -> in-process generation worker
      -> executeGenerationJob adapter
      -> executeCardGeneration use case
      -> promptEngine
      -> deepseekService
      -> content post-processing and validation
      -> Markdown/HTML rendering
      -> TTS
      -> fileManager
      -> databaseService

routes/generate.js is a thin HTTP adapter. Both that route and the in-process worker call the same executeCardGeneration application use case; the former HTTP self-request bridge and worker bypass header are retired.

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

    app/root.tsx
    app/routes/_index.tsx
    app/features/factory/*
    app/features/card-modal/*
    app/lib/api/client.ts
    app/styles/tokens.css
    app/styles/factory.css
    app/styles/card-modal.css

The shell has one product destination: Cards Factory. The card library is part of that page, not a separate route.

`marked`, `DOMPurify`, React Query and Lucide are production npm dependencies bundled into hashed local assets. Card rendering must preserve the Markdown -> audio/ruby adapter -> DOMPurify pipeline.

## Persistence

SQLite uses better-sqlite3 with WAL, foreign keys, busy_timeout, bounded SQLITE_BUSY retry, and an atomic UPDATE...RETURNING queue claim. Startup requeues stale running jobs. SIGTERM/SIGINT stops HTTP intake, drains the current worker job, and only then closes SQLite.

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
- card_tags;
- schema_migrations;
- learning_profiles;
- learning_source_admissions;
- learning_plans;
- study_items;
- learning_daily_queues;
- learning_queue_entries;
- learning_sessions;
- learning_review_events;
- learning_schedule_states;
- generations_fts virtual table and triggers.

database/schema.sql is the complete desired-state schema source. Existing-database transitions are versioned and idempotent under database/migrations, with checksums recorded by services/storage/db/migrationRunner.js. Every future schema change must update the full schema and add its transition in the same commit. databaseService initializes schema.sql, keeps ensureSchemaMigrations only for pre-runner compatibility, then runs the versioned migration runner. Do not add learning-domain migrations to ensureSchemaMigrations. SQL storage infrastructure lives under services/storage/db; learning-domain application and scheduling code lives under services/learning.

Learning Assistance 2.0 is currently at LA-P2: admissions and 1,090 historical Study Items are materialized; online generation materializes eligible Study Items in the same transaction; `/api/learning` implements plan, preview, scope options, queue, session, reveal, skip, end, idempotent review and item view-model contracts. The desktop React routes `/learn`, `/learn/plan`, and `/learn/session` are the sole user-visible learning workflow. The production database can legitimately keep plan/queue/session/review/schedule rows empty until the user creates a plan; merely loading a learning page must remain read-only. Learning history, outcome metrics, and learner feedback remain LA-P3 work.

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

Complete architecture acceptance:

    npm run test:acceptance

This runs typecheck, lint, unit, integration, architecture ownership, production smoke, and Playwright functional/visual gates. Docker runtime is verified separately with the Compose project `three_lans_system`.

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

1. D0-P6 are complete: retired products, the legacy frontend, and the HTTP worker bridge must not be restored.
2. React Router owns `/`; `/__rr-poc` and `/index.html` must remain 404.
3. Keep root package CommonJS; use an ESM composition root.
4. Keep existing Express API envelopes stable during UI migration.
5. Preserve tokens, testids, behavior, and visual gates.
6. Keep the worker on the direct executeGenerationJob -> executeCardGeneration path.
7. Do not implement new learning or graph features during migration.
