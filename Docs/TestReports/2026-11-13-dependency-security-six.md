# Three LANS Dependency Security Release

Date: 2026-11-13 (Asia/Tokyo)

## Scope

Fix the six production npm dependency alerts, prioritizing both critical alerts. Deploy only the existing X86-MAC production viewer. Preserve other services, persistent volumes, configuration, backups, and rollback images. No database migration, feature/configuration change, commit, or push is included.

## Dependency Changes

| Dependency | Severity | Before | After |
| --- | --- | --- | --- |
| dompurify | critical | 3.4.13 | 3.4.17 |
| proxy-addr | critical | 2.0.7 | 2.0.8 |
| body-parser | high | 1.20.6 | 1.20.9 |
| fast-uri | high | 3.1.5 | 3.1.9 |
| source-map-js | high | 1.2.1 | 1.2.2 |
| qs | moderate | 6.15.2 | 6.16.2 |

Express moves from 4.22.2 to 4.22.3 to obtain the patched transitive dependency ranges. There are no forced major upgrades or overrides. Existing DOMPurify fail-closed behavior and Express trust-proxy configuration are unchanged.

Primary advisories: [DOMPurify](https://github.com/advisories/GHSA-cg2g-xh64-v4q7), [proxy-addr](https://github.com/advisories/GHSA-jqcg-44mw-7w3h), [body-parser](https://github.com/advisories/GHSA-27r3-jxmh-p828), [fast-uri](https://github.com/advisories/GHSA-w74x-v6f9-j3xg), [source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), [qs](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw).

## Audit Boundary

- Production dependency audit after lockfile update: 0 vulnerabilities.
- Audit inside the pruned production image: 0 vulnerabilities.
- Full development dependency audit: 14 before, 8 after, critical 2 -> 0.
- Remaining dev-only alerts: `@eslint/config-array`, `@eslint/js`, `eslint`, `minimatch`, `baseline-browser-mapping`, `brace-expansion`, `browserslist`, `vite` (5 moderate, 3 high). These require a separate development-toolchain update and are not included in the six production alerts.
- This is an npm dependency audit, not an OS-image vulnerability scan or proof of absence of every security issue.

## Changes And Validation

Owned code changes are `package.json`, `package-lock.json`, `tests/unit/dependencySecurity.test.js`, and `tests/unit/generationJobService.test.js`.

Eight new security checks cover all lockfile copies, proxy trust boundaries, DOMPurify shadow-root template sanitization, textbook ruby/highlight preservation, hostile qs serialization, URI authority injection, source-map offsets, and compressed-body process survival. Negative control against old dependencies: 6 failures and 2 passes, including both critical probes failing. The compressed-body survival probe also passes on the old version; it is a compatibility guard, not an exact reproducer of the historical crash.

Two generation-worker tests now await the existing worker-running condition before awaiting the start promise. This keeps HTTP-free tests alive while the worker uses an unref'ed timer. The original production image reproduces 8 cancellations without this harness fix and passes all 10 job tests with it. Runtime worker code is unchanged.

Results:

- TypeScript, ESLint, architecture ownership, production build, frontend asset budgets: pass.
- Unit tests in the Node 22 development test image: 661/661.
- Actual Alpine production image: security 8/8 and asset budget pass; full unit suite 657/661, with four release-helper tests requiring Git absent from the intentionally minimal production image.
- Integration tests: candidate 121/122; old production image with only its baked build-info file removed inside an isolated test container also 121/122. Both fail the same Activity Center assertion at `tests/integration/activity.test.js:93`. An initial unmodified production-image test also failed the fixture build-descriptor assertion, as expected when testing a baked release against environment-supplied fixture metadata.
- Initial complete Chromium attempt: 125 passed, 3 failed, 36 not run after failure cutoff/serial suite interruption. Two failures are missing Linux visual baselines; the third is the scenario-outline current-item assertion. Original logs are retained.
- Public error-page baseline reproduction: old dependencies fail the same missing Linux baselines; actual light/dark PNG SHA-256 hashes are identical between old and new dependencies. No repository snapshots were updated.
- Functional follow-up for public errors, textbooks, UI quality and visual-suite interactions: 19/19 with `--ignore-snapshots`. This does not establish pixel-baseline acceptance.
- Card functional follow-up, excluding the separately repeated scenario case: 51/51. The scenario case passes 3/3 isolated candidate repetitions and 2/2 old-dependency repetitions. The original failure is retained as an unresolved timing-instability observation, not declared fixed or proven pre-existing.
- Chromium/Firefox/WebKit modern-web matrix: 57/57, covering enhanced, fallback, and native overlay modes.
- Native-overlay selection/reading regression: 34/34.

The targeted release gate passes with the explicitly recorded limitations above. The complete acceptance suite is not all-green; no failed result, missing visual baseline, or unresolved timing observation was silently removed.

## Release Identity

- Base commit: `eef13659546eb69c9a3a86a73ab8b74b9c942220`.
- Uncommitted security patch: `dirty=true` (intentional and accurately reported).
- Source fingerprint: `c80bbc4ec46782eec16a270ba85352a25c531e2f7f73475b6a77cfe626557748`.
- Candidate: `three-lans-viewer:security-20261113`.
- Candidate image: `sha256:2f4f171ef690bf62967a3fa40b3003c158ae6aad7602c3bac309e3205c56a770`.
- Release evidence directory on X86-MAC: `/Users/colin/ThreeLANS/releases/security-20261113`.
- Frozen source worktree: `/Users/colin/ThreeLANS/worktrees/security-six-20261113`.
- Production entry point: https://x86-mac.tailc3818f.ts.net/.

## Deployment Status

Deployed at 13:29 JST; post-browser verification completed at 13:30 JST on 2026-11-13.

- Only `trilingual-viewer` was recreated, using `compose up -d --no-build --no-deps --pull never viewer` on the existing default `colima` engine.
- Running image and `/api/runtime` match the candidate identity above, including `dirty=true` and the frozen source fingerprint.
- All six health checks are online: DeepSeek API, Kokoro, VOICEVOX, Tesseract OCR, storage, selection-TTS cache.
- All 43 unrelated containers retained their IDs, images, states, start times, and restart counts. The intentionally stopped FinTech rehearsal services remain stopped.
- Mounts, environment, ports, Tailscale routes, existing two SQLite backups, and six pre-existing viewer image tags were preserved.
- Counts before/after deployment and browser acceptance: 738 generations, 29 annotations, 0 learning review events, 1 textbook Track, 20 textbook expressions.
- Client-side Chrome 157 acceptance through the production HTTPS MagicDNS name passes: all seven primary routes return 200, zero page errors and failed reads; toolbar single Tab entry, speed-key navigation, selection highlight retention, persistent save failure, unsaved-draft guard, and modal cleanup behave as expected.
- Four production screenshots (factory, card-note error state, learning, textbooks) were visually inspected; screenshots are retained under the release directory's `browser-screenshots/`.
- The four owned code/test files were copied to the X86-MAC main repository and runtime source export after guarded comparison with their original contents. Main `.claude/` and the existing handoff file are untouched. No staging, commit, or push was performed.
- After evidence export, 15 stopped test containers created by this task were removed. No images, volumes, or unrelated containers were removed.

## Backup And Rollback

- New SQLite backup: `/Users/colin/ThreeLANS/releases/security-20261113/production.before.sqlite`.
- Verified SQLite `quick_check=ok`; size 229,552,128 bytes.
- SHA-256: `a4f92698a77dde9d28323d4c44b970e2e1d2dc55cefb5cef9d7f35a95b2a03b1`.
- New rollback tag: `three-lans-viewer:rollback-before-security-20261113`.
- Rollback image ID: `sha256:226a4fae14236f3c48c580090be016fa3d2a7cf9a0002738cb0554616dab079e` (the previous clean `eef1365` release).
- Earlier backups and rollback tags remain intact. No database was restored or migrated.
- Frozen patched source is archived in `source.snapshot.tar`; prior runtime manifests/test file are retained in `runtime-source.before.tar` within the release directory.

If an application rollback is explicitly requested, execute on X86-MAC:

```sh
docker --context colima tag three-lans-viewer:rollback-before-security-20261113 three_lans_system-viewer:latest
/Users/colin/ThreeLANS/bin/compose up -d --no-build --no-deps --pull never viewer
curl -fsS http://127.0.0.1:3010/api/runtime
curl -fsS http://127.0.0.1:3010/api/health
```

This rolls back application code only. Do not restore SQLite as part of a routine image rollback, and do not run a whole-project Compose recreation or prune.

## Verification Limits

Fixture tests do not validate real DeepSeek generation or spoken TTS quality. Production browser acceptance blocked all non-GET/HEAD requests, including engagement, pronunciation telemetry, annotation save and learning-plan preview. Thus the plan page loaded, but its POST-based preview computation was not exercised against production. No cards, notes, or review records were created. Screenshots, traces, and private operational snapshots are kept outside Git. No claim is made that the entire acceptance suite or all development dependencies are clean.

## Subsequent Git Publication

This report records the pre-commit deployment. The subsequent user-authorized commit and push publish the tested patch and this report without rebuilding or restarting services. The running immutable image retains its original `eef1365`, `dirty=true`, and source-fingerprint metadata until a separate rebuild is requested.
