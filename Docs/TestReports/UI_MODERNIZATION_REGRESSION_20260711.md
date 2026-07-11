# UI Modernization Full Regression Report - 2026-07-11

## 1. Result

**PASS**. The approved "A - Quiet Learning Workspace" design has been implemented across the workspace, study card modal, Mission Control, Knowledge OPS, and Knowledge Hub. Automated gates, rebuilt Compose services, real DeepSeek generation, English/Japanese TTS, persisted files, and direct browser inspection all passed.

Branch: `SaaS_Modify`

Implementation plan: `Docs/superpowers/plans/2026-07-11-ui-modernization.md`

## 2. Delivered Scope

- One shared token source with light/dark semantic themes and no legacy token references.
- Shared responsive App Shell, navigation, theme controls, Lucide icons, focus behavior, and centralized health polling.
- Quiet learning workspace with today's learning, card creation, card library, and the centered on-demand queue dialog.
- Markdown-first typed card adapters for trilingual, Japanese grammar, and scenario cards.
- Full-height accessible card modal with Content / Intel / conditional Knowledge tabs.
- Ruby limited to corresponding Japanese kanji; English and Japanese audio controls preserved.
- Highlight persistence contract v2 with v1 replay migration.
- Knowledge Hub browse preview, relation inspector, review, plan, and mutually exclusive mobile drawers.
- Mission Control runtime boundary and Knowledge OPS production pipeline boundary.

## 3. Automated Gates

| Gate | Result |
|------|--------|
| `npm run lint` | PASS |
| `npm test` | PASS - 299/299 |
| `npm run test:integration` | PASS - 55/55 |
| `npm run test:e2e` | PASS - 55/55 |
| Final affected E2E rerun | PASS - 12/12 |
| Static token inventory | PASS - root 0, HTML style 0, JS template style 0, legacy tokens 0 |

The visual suite covers light and dark themes at 1440x1000, 1024x768, and 390x844 for all four primary pages, plus all three card types and the mobile scenario modal. Updated snapshots were manually inspected before the final no-update run.

## 4. Behavior Coverage

- System/light/dark initialization, persistence, keyboard menu, and reduced motion.
- Desktop sidebar, tablet 64px rail, mobile focus-trapped drawer, and query-aware active navigation.
- One health owner per full page and no health/queue polling in card embed mode.
- Card sanitizer fail-closed behavior, hostile HTML removal, and adapter idempotence.
- Ruby rendering, audio button rebinding, highlight v1-to-v2 replay, modal focus trap, Escape, and opener restoration.
- Queue open only from the top status bar, centered placement, backdrop close, detail modal, retry, and capacity backoff.
- Knowledge Hub browse/insight/review/plan state machine, card preview, embed, relation inspector, and mobile drawer exclusion.
- No horizontal overflow across all primary pages and tested viewports.

## 5. Container Rebuild

Compose project: `three_lans_system`

Executed without deleting volumes:

```text
docker compose config --quiet
docker compose down --remove-orphans
docker compose up -d --build
```

Final services:

| Service | Runtime result |
|---------|----------------|
| `viewer` | Up on `3010` |
| `ocr` | Up, Tesseract 5.5.0 |
| `tts-en` | Up and healthy, Kokoro |
| `tts-ja` | Up, VOICEVOX 0.25.2 |

Historical data was preserved: 636 records existed before the real generation run. No `down -v` or destructive Git operation was used.

The post-rebuild health response reported DeepSeek API, Kokoro, VOICEVOX, OCR, and Storage online. The optional LAN Local LLM remained offline due to timeout; it is non-critical and not part of the current DeepSeek production path.

Compose emitted ownership warnings for the two pre-existing named volumes created before the Compose migration. Both volumes mounted correctly and retained data; this is a configuration ownership notice, not a runtime failure.

## 6. Real DeepSeek and TTS Acceptance

All jobs used `deepseek-v4-pro`, completed on the first attempt, persisted database rows, and produced non-empty Markdown, HTML, metadata, and audio files inside the viewer volume.

| Generation | Card type | Title | Audio | Result |
|------------|-----------|-------|-------|--------|
| `986` | Trilingual | `handoff validation` | 2 Kokoro EN + 2 VOICEVOX JA | PASS |
| `987` | Japanese grammar | `〜ことになっている` | 3 VOICEVOX JA | PASS |
| `988` | Scenario | `租房初期费用确认` (8 chars) | 12 Kokoro EN + 12 VOICEVOX JA | PASS |
| `989` | Ruby/TTS validation | `全額借主負担` | 3 VOICEVOX JA | PASS |

Persisted provider metadata matched the actual runtime:

- English: `kokoro`, model `hexgrad/Kokoro-82M`, voice `af_bella`.
- Japanese: `voicevox`, model `voicevox`, voice `speaker:2`.

## 7. Real Browser Acceptance

Direct Playwright inspection against `http://127.0.0.1:3010` used real historical data and did not call the E2E reset route.

- Workspace, Mission Control, Knowledge OPS, and Knowledge Hub: loaded with no horizontal overflow.
- Mobile workspace: navigation control visible and no horizontal overflow.
- Queue dialog: centered and closed by clicking its backdrop.
- Study card: full-height; ordinary browsing had no SRS footer.
- Ruby: first rendered base `全額`, reading `ぜんがく`; readings remained attached only to their kanji.
- Browser diagnostics: no console errors and no page errors on any inspected page.

## 8. Defects Found and Fixed During Acceptance

1. E2E reset cleared SQLite but not in-memory Knowledge OPS fixture jobs. A unified fixture reset now clears timers, jobs, IDs, and simulated generation attempts. Cross-spec visual tests are deterministic.
2. Two stale queue tests used obsolete assumptions after the centered backdrop interaction. They now close the real backdrop and assert the real `.gen-queue-panel` state.
3. Japanese explicit-reading normalization did not handle a reading followed immediately by another kanji word, such as `全額(ぜんがく)借主`. The ruby boundary now accepts following kanji, and derived TTS text strips the reading correctly.

The real validation card confirmed all Japanese TTS inputs contain `全額借主負担` without parenthetical kana. VOICEVOX request logs showed the cleaned text.

## 9. Log Review

The final `docker compose logs --tail=200 viewer ocr tts-en tts-ja` scan covered 450 lines. No unhandled error, failed request, exception, fatal event, or traceback was found.

## 10. Final Decision

The UI modernization is accepted for the `SaaS_Modify` branch. There are no remaining functional or release blockers in this scope. The application is running at `http://127.0.0.1:3010` with preserved historical data and the rebuilt `three_lans_system` container group.
