#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

export RUN_REAL_GEMINI_E2E="${RUN_REAL_GEMINI_E2E:-1}"
export PLAYWRIGHT_REAL_BASE_URL="${PLAYWRIGHT_REAL_BASE_URL:-http://127.0.0.1:3010}"
export PLAYWRIGHT_REAL_KNOWLEDGE_MODEL="${PLAYWRIGHT_REAL_KNOWLEDGE_MODEL:-gemini-2.5-flash}"

exec npx playwright test tests/e2e/real-gemini.spec.js "$@"
