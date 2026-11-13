# Development Dependency Security Remediation

Date: 2026-11-13. Baseline: `33b33eda7b162fa28bb2073b15803f82d8dd1ddf`.

## Scope And Resolution

The remaining npm audit entries were development-only: 3 high and 5 moderate,
including propagated ESLint findings rather than eight independent root causes.
Both full and production-only npm audits now report **0 vulnerabilities**.
Every production package-lock entry is unchanged from the baseline.

| Package | Before | After |
| --- | --- | --- |
| Vite | 7.3.6 | 7.3.8 |
| minimatch, both ESLint consumers | 10.2.5 | 11.0.8 |
| brace-expansion | 5.0.9 | 5.0.13 |
| baseline-browser-mapping | 2.10.43 | 2.11.37 |
| browserslist | 4.28.6 | 4.29.5 |

Related browser compatibility data packages were updated through npm's resolver.
ESLint 10.8.0, `@eslint/js` 10.0.1, React Router and all runtime dependencies are
unchanged. No `npm audit fix --force`, major Vite migration, or ESLint downgrade
was used.

## Temporary Override

`"minimatch@10": "11.0.8"` replaces only the vulnerable 10.x dependency range.
The current lockfile has two affected consumers: ESLint and its config array.
The fix requires minimatch 11 because the amplification fix is not available in
10.x. Its matching implementation changes, so lint discovery and glob behavior
were verified rather than assuming a version override was compatible.

An initial pair of parent-scoped overrides passed functionality and npm 11.12.1
dependency inspection, but npm 11.6.2 falsely marked a shared brace-expansion edge
invalid. The final version-scoped form passes full dependency-tree inspection on
the Node 22 test image's npm 11.6.2 without changing any resolved package entry.

Remove this override once ESLint and its config-array dependency natively resolve
patched minimatch versions. Regenerate the lockfile and rerun the full audit,
`npm run test:toolchain-security`, lint file-discovery comparison and acceptance
gates. Do not remove it solely because an audit is green with the override present.

## Regression Coverage

`tests/toolchain/dependencySecurity.test.js` adds nine checks, exposed through
`npm run test:toolchain-security` and included in the existing architecture
acceptance script. Existing gates have not been removed or weakened.

- All locked copies meet security floors; the installed dependency tree is valid.
- Both ESLint consumers retain brace/extglob matching and partial traversal.
- ESLint ignores remain effective and genuine undefined identifiers are reported.
- Glob amplification is rejected, and brace rewriting completes within bounded
  child-process CPU time and memory. No hostile input runs against production.
- Invalid Baseline options throw instead of terminating the caller.
- Browserslist handles hostile object-property names in custom statistics.
- A real loopback Vite server serves an allowed mirrored file but rejects an
  outside file at the colliding raw filesystem URL with HTTP 403.

The patched image passes **9/9**. The same test file against the pre-fix dependency
image yields **3 passes and 6 expected failures**: the floor check plus five
behavioral security regressions. ESLint's original **376 files** remain in its
inventory; the new security test is the only addition, bringing the total to 377.

## Validation Results

Node 22.23.2, Linux x86_64, Playwright 1.58.2. Isolated test containers use no
production data mounts, credentials or published ports.

- Fresh `npm ci`, full audit, production audit, full dependency-tree inspection:
  pass, zero audit findings.
- React typecheck, ESLint, all **661 unit tests**, production build, frontend
  asset budgets, architecture ownership checks and seven-probe SSR smoke: pass.
- Integration: **121/122**, both patched and baseline images. The same existing
  Activity Center assertion fails at `tests/integration/activity.test.js:93`
  because the expected cross-domain attention item is absent. It is not repaired
  or suppressed in this dependency-only change; aggregate acceptance is not green.

- Chromium functional run: **164/164** with `--ignore-snapshots`. Existing Linux
  screenshot baselines are missing, so this is not pixel-level visual acceptance.
  The previously intermittent scenario-outline assertion passed in this run.
- Modern Web Guidance Chromium/Firefox/WebKit matrix: **57/57**.
- Native-overlay selection and note regression: **34/34** with
  `MWG_NATIVE_OVERLAYS=1`.

The full browser run used identical application source and resolved package entries
to the final candidate. After the override syntax was refined, all nine security
tests, lint and all unit tests were rerun against a fresh final installation.

## Release Boundary

The release must be built from the newly pushed clean commit, not relabeled from
the earlier dirty build. Only the existing X86-MAC `colima` viewer service is to be
recreated with `--no-deps --no-build --pull never`. Before promotion, retain a fresh
verified SQLite backup, the previous production image under a rollback tag, all
older backups/images, and a private snapshot of unrelated container identities
and states. Deployment verification and screenshots belong outside Git under
`/Users/colin/ThreeLANS/releases/dev-security-20261113`.

This report records code/test evidence, not a claim that deployment has already
finished. No application data migration, external-service restart or credential
change is included.

## Primary References

- [minimatch amplification advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249)
- [brace-expansion rewrite advisory](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr)
- [Baseline option handling advisory](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv)
- [Browserslist statistics advisory](https://github.com/advisories/GHSA-73wf-gq98-2v4g)
- [Vite filesystem boundary advisory](https://github.com/advisories/GHSA-rq7h-c2jc-7f22)
- [Vite 7.3.8 release](https://github.com/vitejs/vite/releases/tag/v7.3.8)
