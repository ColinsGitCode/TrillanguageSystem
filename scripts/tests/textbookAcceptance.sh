#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

echo "[TC-P4] lint"
npm run lint -- --quiet

echo "[TC-P4] unit"
npm run test:unit

echo "[TC-P4] integration"
npm run test:integration

echo "[TC-P4] React Router typecheck"
npm run typecheck:react

echo "[TC-P4] production build"
npm run build:react

echo "[TC-P4] API smoke"
npm run smoke

echo "[TC-P4] desktop E2E and visual regression"
npm run test:e2e

echo "[TC-P4] Compose contract"
docker compose config --quiet

if [[ -n "${TEXTBOOK_MANIFEST_PATH:-}" || -n "${TEXTBOOK_SOURCE_ROOT:-}" ]]; then
  if [[ -z "${TEXTBOOK_MANIFEST_PATH:-}" || -z "${TEXTBOOK_SOURCE_ROOT:-}" ]]; then
    echo "TEXTBOOK_MANIFEST_PATH and TEXTBOOK_SOURCE_ROOT must be set together" >&2
    exit 1
  fi
  SUMMARY_PATH="$(mktemp "${TMPDIR:-/tmp}/tc-p4-manifest-summary.XXXXXX.json")"
  trap 'rm -f "$SUMMARY_PATH"' EXIT
  echo "[TC-P4] Git-external Manifest validation"
  node skills/import-textbook-track/scripts/validate-manifest.mjs \
    --manifest "$TEXTBOOK_MANIFEST_PATH" \
    --source-root "$TEXTBOOK_SOURCE_ROOT" \
    --summary "$SUMMARY_PATH"
fi

echo "[TC-P4] acceptance gates passed"
