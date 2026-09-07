# Selection Reading Toolbar: Iteration 1

## Delivered

- Compact selection/gloss summary; low-confidence meanings display "待确认" beside the gloss. Sources, alternatives, correction and contextual reading actions appear in expandable details.
- Shared playback, speed, marking, copy and card-generation actions. Pronunciation details, knowledge lookup and notes remain accessible through the secondary menu.
- Original/word/phrase/sentence selection controls preserve occurrence identity using the visible-text annotation projection. Phrase expansion follows punctuation boundaries, not an AI syntactic parser. Ruby readings and audio controls are excluded; selections over 200 codepoints are rejected.
- Explicit contextual explanation via `POST /api/local-glossary/explain`, gated by `LOCAL_GLOSSARY_LLM_ENABLED`, sandbox high-cost authorization and generation quotas. Responses are ephemeral. Selection changes abort obsolete browser requests.
- Reading notes persist through existing `card_annotations` APIs and reopen from their rendered marks. Local glossary corrections remain reusable entries, distinct from contextual notes.
- Menus and note editing load on demand; existing frontend budgets remain unchanged. Toolbar placement considers available space above/below the selection.

## Validation

`npm run test:acceptance`: passed on 2026-09-07.

| Check | Result |
| --- | --- |
| TypeScript / ESLint | Passed |
| Unit tests | 601/601 |
| Integration tests | 119/119 |
| Architecture / asset budgets | Passed |
| Production-build smoke | 7/7 |
| Playwright functional / visual | 97/97 |

New coverage checks repeated Japanese occurrences, ruby exclusion, scope switching, explicit AI invocation, discarded stale explanations, note persistence/reopening, and explanation feature/input/quota gates. Service tests verify explanations perform zero SQLite changes. Existing keyboard, clipboard, glossary candidate, generation, TTS and viewport regressions passed. Visual baselines were not replaced.

An actual browser capture was inspected at `output/playwright/selection-reading-expanded.png`. It uses deterministic test content and an AI response fixture.

## Delivery Boundary

The counts above describe the initial iteration pass. The subsequent [detailed UI/UX audit](2026-09-07-selection-reading-ux-audit.md) found and fixed four issues and completed 602 unit, 119 integration and 114 browser tests. It also records a live DeepSeek contextual-explanation sample, VOICEVOX playback and the viewer deployment verification. This is not a general AI-quality certification. No production-data migration was needed or performed. Source changes remain uncommitted for review.
