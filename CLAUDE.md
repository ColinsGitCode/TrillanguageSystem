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
- desktop CardModal English/Japanese selection read-aloud with conservative language confirmation, three speeds, retry, exclusive cross-surface playback, and an isolated ephemeral cache;
- one shared CardModal selection toolbar for English and Japanese, with read-only layered Chinese gloss lookup, manually managed local glossary entries, and explicit human-confirmed DeepSeek proposals;
- generation observability and infrastructure health;
- Learning Assistance 2.0 desktop workflow for plan, daily queue, resumable review, idempotent rating, Study Item view models, learning history and outcome metrics;
- Textbook Courses TC-P4: Git-external draft Manifest import, textbook search, controlled official Track audio streaming, `/textbooks` desktop review page, persisted selection highlights, human verification, explicit Track publishing to `textbook_track` generation projections, formal English/Japanese per-expression TTS assets, `textbook_en/ja` Study Items, learning plan scope v2, review item view-models, history filters, textbook selection card derivation, full desktop E2E/visual acceptance, and documented backup/recovery.

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
    npm run test:textbooks:acceptance
    docker compose up -d --build

The Compose project name is three_lans_system. The user-visible app is http://127.0.0.1:3010/.

## Local textbook tooling

`skills/import-textbook-track/` is the accepted TC-P0 Codex Skill for turning ordered local textbook screenshots and optional official Track audio into a Git-external draft Manifest. It uses image understanding directly, never the application `/api/ocr` route, and never writes SQLite. Actual textbook text, screenshots, audio, Manifest and dry-run summary must remain outside Git.

TC-P4 runtime support is enabled by default and can be disabled with `TEXTBOOK_FEATURE_ENABLED=false`: `database/schema.sql` plus `database/migrations/002_textbook_courses.sql` own the seven textbook tables, `routes/textbooks.js` owns draft import/query/media/publish/derivation/highlight/TTS APIs, `TEXTBOOK_SOURCE_ROOT` is a controlled read-only media root, and `TEXTBOOK_WORK_PATH` is the writable projection/TTS root. Draft import and human verification must not create `textbook_track` generation projections, Study Items, or formal TTS assets; only explicit publish from a verified Track may create/update the projection, manual learning admission, `textbook_en/ja` Study Items with per-expression unit hashes, and subsequent per-expression TTS generation. Operational recovery is defined in `Docs/Operations/Textbook_Courses_Runbook.md`.

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

The active Cards Factory frontend is React Router v8 + TypeScript at `/`; `/api/*` remains Express in the same `server.mjs` process. The former `/__rr-poc` route and legacy browser ESM frontend are retired and return 404. The production viewer is an immutable image; do not restore source or node_modules bind mounts.

`server.js` is not a second production entry. It is the CommonJS API-only bootstrap used by `tests/integration/_harness.js`; both entrypoints delegate Express construction and startup to `lib/httpRuntime`, while only `server.mjs` mounts React Router and runs in Compose.

Frontend feature styles belong to their React Router route modules, not `app/root.tsx`; the root may load only shared tokens, page-header, dialog, and page-state styles. The full CardModal is a deferred interaction module reached through `DeferredCardModal`, so Cards Factory and the review session must not eagerly import its JS or CSS. CardModal's generation info, selection knowledge, selection read-aloud, and local-glossary panels are separate deferred chunks and must not be folded back into the main modal bundle. `npm run test:architecture` includes `check:frontend-budget`, which enforces global CSS, per-route initial assets, and deferred chunk budgets in `config/frontend-asset-budgets.json`.

Card Reader v3 is at CR-P2 visible Canary. `services/cardReader/` owns the server-side Unified/Remark parser, bounded v2/v3 comparator and allowlisted CardDocument projection. Shadow and Canary reads must remain SQLite-write-free. `CARD_READER_V3_CANARY_ENABLED` plus `CARD_READER_V3_CANARY_GENERATION_IDS` may expose v3 only for server-validated `trilingual` generations whose parity passes and diagnostics are empty; every other card and every fetch/render failure must immediately use v2. `CardReaderV3` renders only controlled React nodes and no frontend module may import Unified/Remark/Rehype. CR-P2 does not authorize CR-P3 full trilingual rollout, grammar/scenario migration, historical Ruby migration, legacy-reader removal, or analyzer proposal acceptance.

Public SaaS readiness does not add account, tenant, role, or billing UI. `lib/workspaceAccess.js` owns the process-level `owner` / `sandbox` boundary and `routes/runtime.js` exposes the sanitized public descriptor. A public owner workspace must be protected by a real gateway, VPN, or reverse proxy. A sandbox process must use a dedicated instance id and keep SQLite, records, textbook source/work files, and selection-TTS cache inside that instance root. Sandbox writes are fail-closed and high-cost operations use a second gate. Never bypass these checks or mount the owner's persistent volumes into an anonymous sandbox; see `Docs/Operations/Public_SaaS_Workspace_Runbook.md`.

UI performance telemetry is a privacy-safe operational signal, not an analytics or content pipeline. `routes/uiPerformance.js` and `services/observability/uiPerformanceService.js` may record only the fixed metrics and route buckets in `config/ui-performance-budgets.json`; they must never record query strings, card or textbook content, selected text, user input, workspace ids, cookies, or identity. An unauthenticated telemetry request at the public gateway must not allocate a sandbox. Public capacity/startup errors must use the recoverable gateway error contract and must never fall back to the owner workspace.

The global Activity Center is a read-only projection, not a new domain store. `routes/activity.js` and `services/activity/activityService.js` aggregate persisted generation jobs, textbook operations, the active learning session, and KG source-sync jobs. The browser's typed shell event and `sessionStorage` copy are optimistic UI hints only; they must never replace or mutate the server-authoritative state. One degraded source must not hide the remaining activity sources, and public summaries must not expose raw payloads, internal paths, or provider errors.

## Routes

Active route modules:

- routes/generate.js: POST /api/generate;
- routes/generationJobs.js: /api/generation-jobs list, summary, detail, events, retry, cancel, clear;
- routes/files.js: folders, files, highlights, delete by file;
- routes/history.js: history, statistics, search, recent, record detail;
- routes/health.js: /api/health;
- routes/runtime.js: sanitized workspace and build descriptor at `/api/runtime`;
- routes/activity.js: read-only server-authoritative Activity Center at `/api/activity`;
- routes/uiPerformance.js: bounded, content-free UI performance samples at `POST /api/ui-performance`;
- routes/ocr.js: /api/ocr;
- routes/selectionTts.js: `GET/POST /api/tts/selection` config discovery and immediate English/Japanese binary synthesis;
- routes/localGlossary.js: read-only layered English/Japanese Chinese-gloss lookup, manual local glossary CRUD/restore, imported-provider catalog statistics, explicit DeepSeek proposal acceptance/rejection, and DIC-R2 sentence-free lookup feedback plus its read-only stats projection;
- routes/cardReader.js: CR-P1 read-only shadow report plus CR-P2 server-allowlisted CardDocument Canary by generation id;
- routes/misc.js: delete record by id;
- routes/learning.js: `/api/learning` plan, queue, session, review, Study Item and read-only history/metrics contract;
- routes/textbooks.js: `/api/textbooks` draft import, course/track/search reads, human verification, explicit publish, persisted highlights, selection derivation jobs, official audio content, and generated per-expression TTS content, feature-flagged on by default for TC-P4;
- routes/languageMetadata.js: `GET /api/language-metadata` read-only inspection plus JLM-A1 adjudication (`POST .../proposals/:id/accept`, `.../reject`, `POST .../corrections`), all gated by `LANGUAGE_METADATA_ENABLED` and 404 by default;
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
        ttsRequestCoordinator.js
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
      selectionTts/
        selectionTtsCache.js
        selectionTtsErrors.js
        selectionTtsService.js
      languageMetadata/
        application/
          extractionService.js
        domain/
          foreignOriginExtraction.js
      localGlossary/
        localGlossaryNormalizer.js
        localGlossaryService.js
        localDictionaryCatalog.js
        openDictionaryImport.js
        dictionaryEvaluation.js
      learning/
        application/
          learningService.js
          materializeStudyItems.js
        domain/
        scheduling/
        time/
      textbooks/
        manifestContract.mjs
        manifestValidator.js
        textbookImportService.js
        textbookMediaService.js
      storage/
        databaseService.js
        databaseHelpers.js
        fileManager.js
        db/
          generationJobs.js
          generations.js
          helpers.js
          highlights.js
          localDictionary.js
          localGlossaryFeedback.js
          languageMetadata.js
          textbooks.js
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
- DEEPSEEK_MODEL defaults to deepseek-v4-flash.
- Legacy provider names normalize to deepseek.
- localLlmService is only an optional OpenAI-compatible OCR/development adapter.
- English TTS: Kokoro, MP3.
- Japanese TTS: VOICEVOX, WAV.
- Style-Bert-VITS2 is archived behind an opt-in Compose profile because resource cost exceeded its practical quality gain.
- Selection TTS is a desktop-only, on-demand English/Japanese tool. It calls the same Kokoro/VOICEVOX providers through `synthesizeSpeech()` and the shared priority coordinator; interactive work enters before waiting batch work, while a 5-second anti-starvation window preserves batch progress.
- `GET /api/tts/selection` exposes only controlled client configuration. `POST /api/tts/selection` returns immediate binary audio with provider/cache metadata; it must not create `audio_files`, generations, annotations, KG facts, Study Items, Review Events, or FSRS state.
- Selection TTS cache is an opaque-hash, TTL-bounded named volume at `three_lans_system_selection_tts_cache`. It is outside SQLite, `RECORDS_PATH`, textbook media, and `express.static`; cache write failure must degrade to `X-TTS-Cache: BYPASS` while still returning successful provider audio.
- Local Chinese-gloss lookup is read-only and local-first: current-card exact translations, textbook expressions, confirmed local entries, versioned local dictionary entries, then exact recent-card history. Human-confirmed entries always outrank dictionary results. Inside the dictionary layer, curated entries and direct Japanese-to-Chinese Wiktionary evidence rank before the JMdict-to-ECDICT English bridge; bridge results remain low-confidence fallbacks. Dictionary lookup receives a bounded semantic-block context and the accepted pronunciation reading when available; it ranks all matching senses instead of taking the first row, and returns bounded alternatives with visible source and confidence. It must never call DeepSeek or persist data during lookup. `LOCAL_GLOSSARY_LLM_ENABLED` controls only the explicit proposal endpoint; proposals remain pending and editable until a user accepts them into `local_glossary_entries`.
- Open local dictionaries are imported only through `scripts/import/importOpenDictionaries.js`. Dry-run is the default; `--apply` is required for SQLite writes. ECDICT provides English-to-Chinese entries. The Chinese Wiktionary Japanese extraction provides direct Japanese-to-Chinese entries; import normalizes its Traditional Chinese glosses to Simplified Chinese with `opencc-js` and records that transform in `source_ref_json`. It must retain its CC BY-SA/GFDL attribution URL and input hash. Japanese JMdict-Simplified entries use only the first exact English-to-ECDICT Chinese mapping, are always shown as low confidence, and retain both JMdict and ECDICT source hashes, URLs, and licenses. Importing a new source version retires previous active versions for that source; it never deletes audit rows or overrides confirmed local entries. The curated starter dictionary follows the same retirement rule when its version changes. External dictionary files stay outside Git and application images.
- DIC-R2 disambiguation is deterministic and LLM-free. Context ranking infers a part of speech from English cue words (infinitive/modal/pronoun to verb, linking verb and degree adverb to adjective, determiner and preposition to noun, determiner plus a following non-verb to attributive adjective) and from the Japanese particle after the term (`する` to verb, `な` to adjective, case particles to noun); when no cue is confident it returns null and the deterministic order is preserved. Part-of-speech tags are compared as tokenized tag sets so ECDICT `n.`/`vt.`, JMdict `n, vs, vt`/`adj-i` and traditional `名詞`/`動詞` all match. A context match may raise confidence, but an English-pivoted JMdict bridge gloss stays low confidence regardless.
- `local_glossary_lookup_events` records DIC-R2 usage facts and is append-only, enforced by update/delete-blocking triggers. It stores the selected short term because the problem-term list needs it, but has no surrounding context, snippet, or sentence column; source details, match reasons and sense keys are server-allowlisted instead of copied from arbitrary client text. `GET /api/local-glossary/lookup` stays write-free; only an explicit `POST /api/local-glossary/feedback` records a `shown`/`rejected`/`switched`/`corrected` outcome, and each resolved selection reports `shown` once. Statistics report action-level interventions rather than a misleading query-level error rate. `GET /api/local-glossary/feedback/stats` is a read-only projection that ranks terms the user had to fix; it must not become an analytics pipeline.
- `scripts/maintenance/dicR2Observation.js` is the read-only before/after accuracy gate over `scripts/maintenance/fixtures/dicR2EvaluationCases.json`; see `Docs/TestReports/Local_Dictionary_DIC_R2_Observation_20260810.md`.
- `services/languageMetadata/` owns Japanese linguistic metadata proposals. `domain/foreignOriginExtraction.js` is the pure `jlm-foreign-origin-v1` validator: it re-locates an LLM-proposed katakana surface by segment plus occurrence, owns the resulting codepoint range, and rejects anything it cannot locate with one of twelve enumerated reasons. Its `proposal_key` separator is NUL, never a space. `application/extractionService.js` is the JLM-A0 shadow stage: it runs after a card is already persisted, as a second best-effort DeepSeek call that must never fail, delay or roll back card generation, and it writes only `pending` proposals. `LANGUAGE_METADATA_ENABLED` and `LANGUAGE_METADATA_EXTRACTION_ENABLED` both default to false; the first gates the domain, the second gates whether a call is issued at all. The shadow result must never enter the `/api/generate` response envelope. JLM-A1 adds human adjudication: reading a projection merges foreign origins by the order human correction > curated dictionary > accepted LLM > pending LLM > none, using only proposals bound to the body version being read, and the read path stays write-free. A pending candidate must be labelled as an AI candidate and never worded like a confirmed source. A human correction is stored as `origin='human'` with `status='accepted'`, which is what lets a wrong curated entry be overridden without editing the shipped dictionary file. Adjudication is optimistic on the current status and returns 409 rather than re-deciding, and it must never write learning, FSRS, KG, TTS, annotation, Markdown or `content_hash` data. A job row is created before the provider call so a timeout stays distinguishable from "this card has no loanwords"; proposals bind `source_content_hash` and are marked stale rather than reused when the body changes. `scripts/poc/jlmP0DryRun.js` remains the offline contract runner. See `Docs/Architecture/Language_Metadata_Proposal_ADR.md`, `Docs/Features/LLM_Generated_Japanese_Linguistic_Metadata_Design.md` and `Docs/TestReports/Language_Metadata_JLM_P0_DryRun_20260810.md`.
- `/dictionary` is the desktop management surface. It edits only `local_glossary_entries`; imported `local_dictionary_entries` stay read-only and are shown only as source/version/count metadata. Archive/restore uses optimistic versions, and an imported dictionary upgrade must not rewrite manual overrides.

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
- newly generated scenario cards have an AI-generated title within ten Chinese characters and exactly 20 expression blocks; legacy 12-block cards remain readable and reviewable;
- card modal has CONTENT and INTEL only;
- highlights and notes persist through `card_annotations`; `card_highlights` is a frozen
  migration/audit snapshot and must not be used by runtime readers or writers;
- desktop modal height, focus trap, Escape, and focus restoration remain stable.
- English and Japanese selections use the same toolbar. A selection intersecting a pronunciation token is deterministically Japanese, including kanji-only text; a kanji-only selection outside that projection remains ambiguous and must not be guessed.

## Frontend

Active files:

    app/root.tsx
    app/routes/_index.tsx
    app/routes/learn*.tsx
    app/features/factory/*
    app/features/card-modal/*
    app/features/learning/*
    app/components/ProductShell.tsx
    app/lib/api/client.ts
    app/styles/tokens.css
    app/styles/factory.css
    app/styles/card-modal.css

The shell has Cards Factory plus the Learning Workbench. User-visible learning routes are `/learn`, `/learn/plan`, `/learn/session`, and `/learn/history`; the review session is entered from today learning rather than treated as a sidebar destination. The card library is part of Cards Factory, not a separate route.

`marked`, `DOMPurify`, React Query and Lucide are production npm dependencies bundled into hashed local assets. Card rendering must preserve the Markdown -> audio/ruby adapter -> DOMPurify pipeline.

## Public sandbox runtime

- `sandbox-gateway.mjs` is the only anonymous public entrypoint. It maps one signed HttpOnly cookie to one dedicated viewer child process and one isolated storage root.
- `docker-compose.public.yml` must never mount owner SQLite, records, textbook media, or caches. The regular `docker-compose.yml` remains the owner workspace deployment.
- Public sandbox instances are seeded only with synthetic cards. They expire, reset, and shut down by deleting their child process and storage directory.
- High-cost generation, OCR, and TTS are safe-default off. When enabled, `SandboxQuotaService` enforces per-session request and storage quotas before domain routes.
- Capacity exhaustion and child startup failure must fail closed. Never route an anonymous request to the owner viewer or another sandbox.
- `npm run test:public-sandbox` is the repeatable two-session isolation, quota, reset, and cleanup gate.

`app/lib/audio/exclusive-audio.ts` is the single browser playback owner shared by CardModal,
Textbook Courses and Review Session. Starting any managed audio stops the previous managed
audio; selection change, navigation and unmount must abort unfinished selection synthesis,
stop playback and revoke Blob URLs. Selection TTS keyboard behavior must close its language
confirmation before closing the surrounding selection toolbar and must restore focus.

## Persistence

SQLite uses better-sqlite3 with WAL, foreign keys, busy_timeout, bounded SQLITE_BUSY retry, and an atomic UPDATE...RETURNING queue claim. Startup requeues stale running jobs. SIGTERM/SIGINT stops HTTP intake, drains the current worker job, and only then closes SQLite.

Current tables:

- generations;
- audio_files;
- observability_metrics;
- generation_errors;
- model_statistics;
- system_health;
- card_highlights (frozen legacy migration/audit snapshot);
- card_annotations;
- card_annotation_migration_events;
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
- textbook_courses;
- textbook_tracks;
- textbook_track_revisions;
- textbook_track_assets;
- textbook_expressions;
- textbook_expression_revisions;
- textbook_card_derivations;
- kg_points;
- kg_surface_forms;
- kg_evidence;
- kg_resolution_cases;
- kg_resolution_events;
- kg_point_transitions;
- kg_point_surface_links;
- kg_point_evidence_links;
- kg_lookup_events;
- kg_point_stats;
- kg_planning_signals;
- local_glossary_entries;
- local_glossary_proposals;
- local_dictionary_entries;
- local_glossary_lookup_events;
- language_metadata_jobs;
- language_metadata_proposals;
- generations_fts virtual table and triggers.

database/schema.sql is the complete desired-state schema source. Existing-database transitions are versioned and idempotent under database/migrations, with checksums recorded by services/storage/db/migrationRunner.js. Every future schema change must update the full schema and add its transition in the same commit. databaseService initializes schema.sql, keeps ensureSchemaMigrations only for pre-runner compatibility, then runs the versioned migration runner. Do not add learning-domain migrations to ensureSchemaMigrations. SQL storage infrastructure lives under services/storage/db; learning-domain application and scheduling code lives under services/learning.

Learning Assistance 2.0 LA-P0-P4 is complete: admissions and historical Study Items are materialized; online generation materializes eligible Study Items in the same transaction; `/api/learning` implements plan, preview, scope options, queue, session, reveal, skip, end, idempotent review, item view-model and read-only history/metrics contracts. `/learn/history` derives progress, backlog, rating, response-time and recent-event views from Review Events, queue snapshots and sessions without a new analytics table. Merely loading any learning page or `GET /api/learning/history` must remain read-only. Historical skip counts are intentionally unavailable because skip is currently a temporary session workflow state, not a durable fact. `services/learning/planning` owns the synchronous, side-effect-free PlanningSignalProvider contract, Heuristic v1 and the optional Graph reader adapter. Providers run only after the base queue set is selected; missing, empty, failed, asynchronous or over-budget providers must preserve the base set and deterministic fallback order.

Knowledge Graph 2.0 KG-P0-P3 and KG-R0-R1 are complete. KG-R0 provides the only initial-facts maintenance path: `applyKnowledgeBackfill` requires a stable approved manifest hash, an empty KG fact store, and a fresh source-content hash match before one transaction writes deterministic points, surfaces, Evidence, links and materializable unresolved cases, then rebuilds projections. Resolved backfill sources must pass target-language checks, must not contain HTML/ruby presentation markup, and Japanese ruby must be reduced to its visible base text before identity analysis; failures stay unresolved. The CLI requires `--apply`, an SQLite backup path and a non-overwrite report path; read `Docs/Operations/Knowledge_Graph_2_0_Runbook.md` before it is used against a volume. SQLite restore must happen with viewer stopped and the matching WAL/SHM removed before replacing the main database. Migration 003 owns eleven `kg_*` tables; migration 004 owns LA's `learning_manual_queue_intents` table. `services/kg` owns deterministic identity analysis, append-only lookup/resolution facts, reversible unresolved cases, Evidence attachments, rebuildable point-stats/planning-signal read models, and the synchronous read-only `GraphPlanningSignalReader`. `/api/kg` is explicitly mounted but `KG_ENABLED`, `KG_PLANNING_ENABLED`, and `KG_LLM_ENRICHMENT_ENABLED` all default to disabled. Search is read-only; only explicit lookup submission writes a lookup fact. The graph reader is injected only when both KG core and planning flags are enabled, executes one prepared primary-key query, and may only reorder items after the base queue set is selected. Missing, invalid, failed, or over-budget signals must preserve the deterministic fallback order. `kg:r1:canary` is the required Git-external, read-only same-snapshot gate before local planning enablement; it must prove selected-set/base-key parity, exact failure fallback, primary-key lookup, p95 below 5ms, no 10ms budget breach, zero network and zero observed-table mutation. KG must not write Review Events, Schedule States, or FSRS data. `/knowledge` may request LA's manual-intent use case only after explicit confirmation. That use case accepts only admitted, active, already-scheduled Study Items; it never admits fresh items, never changes plan scope, and never writes Review Events or Schedule States until the normal review transaction runs. Bucket 5 is shared by `difficult-reappearance` and `manual-lookup`, distinguished by reason/source and always ordered after due buckets 1-4 and before fresh bucket 6.

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
- theme, keyboard, desktop layout, and visual snapshots;
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
- local glossary proposal gate: LOCAL_GLOSSARY_LLM_ENABLED.

Knowledge and SRS environment variables are retired and must not be reintroduced.

## Migration rules

1. D0-P6 are complete: retired products, the legacy frontend, and the HTTP worker bridge must not be restored.
2. React Router owns `/`; `/__rr-poc` and `/index.html` must remain 404.
3. Keep root package CommonJS; use an ESM composition root.
4. Keep existing Express API envelopes stable during UI migration.
5. Preserve tokens, testids, behavior, and visual gates.
6. Keep the worker on the direct executeGenerationJob -> executeCardGeneration path.
7. The architecture migration is complete. New learning work must follow the Learning Assistance 2.0 baseline and ADR; graph capabilities remain optional providers rather than scheduling dependencies.
