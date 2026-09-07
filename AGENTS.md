# Repository Guidelines

## Project Structure & Module Organization

Three LANS generates trilingual learning cards. `server.mjs` combines React Router SSR and Express; `server.js` bootstraps API integration tests only.

- `app/`: TypeScript routes, features, clients, and styles; `public/`: static assets.
- `routes/`: Express adapters; `services/`: domain logic; `lib/`: runtime utilities.
- `database/`: schema/migrations; `prompts/`: templates; `tests/`: automated tests; `scripts/`: tooling.
- Read [CLAUDE.md](CLAUDE.md) for architecture and domain invariants; [Docs/README.md](Docs/README.md) indexes supporting documents.

## Build, Test, and Development Commands

Use Node.js 22, `npm ci`, and settings from `.env.example`.

- `npm run dev:react`: development server.
- `npm run build:react && npm start`: production build/server at `http://127.0.0.1:3010/`.
- `docker compose up -d --build`: viewer/OCR/TTS deployment, project `three_lans_system`.
- `npm run typecheck:react` / `npm run lint`: TypeScript/ESLint checks.
- `npm test` / `npm run test:integration` / `npm run test:e2e`: individual suites.
- `npm run test:acceptance`: typecheck, lint, unit/integration, architecture/asset budgets, smoke, and Playwright gates. Verify Docker runtime separately.

## Coding Style & Naming Conventions

Use two-space indentation, single quotes, and semicolons. Keep backend `.js` CommonJS; `.mjs` and frontend TypeScript use ES modules. Use PascalCase components and camelCase functions/services. Log through `lib/logger.js`; classify provider errors by structured `code`/`status`, not message text.

## Architecture & Persistence Rules

Keep Express adapters thin; reuse backend services through server-only adapters or HTTP. Workers call `executeCardGeneration` directly. Preserve API envelopes, test IDs, route-owned CSS, and deferred CardModal chunks. Do not restore retired frontend, Knowledge, or SRS subsystems; follow current Learning Assistance 2.0/KG designs.

Every schema change must update `database/schema.sql` and add an idempotent versioned transition under `database/migrations/` in the same commit. Keep designated read paths write-free. Runtime highlights use `card_annotations`; `card_highlights` is frozen audit data.

## Testing Guidelines

Use `node:test` (`tests/unit/*.test.js`, `tests/integration/*.test.js`) and Playwright (`tests/e2e/*.spec.js`). Add behavioral regressions using isolated SQLite/managed E2E fixtures. Acceptance targets desktop; inspect images before updating visual baselines. Fixtures do not establish live DeepSeek/TTS quality. No numeric coverage threshold is configured.

## Commit & Pull Request Guidelines

Use scoped messages, e.g. `fix(pronunciation): ...`. PRs should explain behavior, link relevant issues, report validation/limitations, and include UI screenshots.

## Configuration & Data Safety

Keep credentials and runtime/textbook data outside Git. Back up before migrations; review manifests and runbooks. Preserve owner/sandbox isolation and feature gates. DOMPurify failures must fail closed. Constrain file access to `RECORDS_PATH`; never expose it through `express.static`. Production images must not bind-mount source or `node_modules`.
