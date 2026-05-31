# UI Full Regression Report — 2026-06-01

## Scope

- Baseline review: commits after `5f3aede`, current `main` product surface, existing unit/integration/E2E tests.
- Covered UI surfaces: Home, shared task queue, card modal, Mission Control, Knowledge OPS, Knowledge Hub, OCR, Knowledge graph browse, learning plan, review/SRS, queue retry/backoff.
- Current product shape note: the old TRAIN / REVIEW / few-shot subsystems have been removed on `main`; this run validates the current Knowledge Hub / SRS / learning-plan flow instead.

## Changes Added During Test Execution

- Added `tests/e2e/ui-quality-regression.spec.js`.
  - Multi-viewport no-horizontal-overflow matrix for Home / Mission Control / Knowledge OPS / Knowledge Hub.
  - Local CSS/JS dependency guard for key app assets.
  - Card modal full-height and compressed-header layout checks on desktop and mobile.
  - Queue panel / audit timeline / job detail modal close-and-reopen checks.
- Fixed responsive overflow found by the new tests.
  - `public/styles.css`: Home topbar now stacks cleanly below 1180px.
  - `public/css/dashboard.css`: Dashboard-family headers and grid children now collapse safely on mobile.
- Fixed queue retry timing flake found by full E2E.
  - `services/storage/db/generationJobs.js`: retry eligibility now compares against millisecond-precision SQLite time instead of second-truncated `strftime('%s') * 1000`.

## Automated Results

- `npm run lint`: pass.
- `npm run test:unit`: pass, 272 tests.
- `npm run test:integration`: pass, 47 tests.
- `npx playwright test tests/e2e/ui-quality-regression.spec.js`: pass, 4 tests.
- `npm run test:e2e`: pass, 33 passed / 4 skipped.
  - Skipped tests are the real Gemini acceptance tests gated by `RUN_REAL_GEMINI_E2E=1`.

## Container / Browser Smoke

- Containers rebuilt and running before this run.
- `docker compose ps`: viewer, gemini-proxy, OCR, TTS EN, TTS JA all up; TTS EN healthy.
- `GET http://127.0.0.1:3010/api/health`: `overallStatus=online`, `criticalOnline=true`.
- In-app browser against `http://127.0.0.1:3010`:
  - Home: loaded, no horizontal overflow at current browser viewport.
  - Mission Control: loaded, no horizontal overflow.
  - Knowledge OPS: loaded, no horizontal overflow.
  - Knowledge Hub: loaded, no horizontal overflow.

## Findings

- Home tablet layout overflowed because the dashboard links stayed in a non-wrapping right column. Fixed and covered.
- Dashboard-family mobile headers overflowed because inline flex rows and grid-column spans retained desktop layout assumptions. Fixed and covered.
- Queue transient retry could stall in E2E because DB retry comparisons used second precision while E2E retry delays are sub-second. Fixed and covered by the backoff smoke test.

## Remaining Explicit Exclusions

- Real Gemini acceptance was not executed because the suite intentionally skips it unless `RUN_REAL_GEMINI_E2E=1`.
- Visual validation was functional/layout-focused; it did not include pixel-diff screenshot approval.
