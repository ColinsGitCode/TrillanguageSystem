#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMP_DIR="$ROOT_DIR/.tmp/e2e"
RECORDS_DIR="$TMP_DIR/records"
DATA_DIR="$TMP_DIR/data"

rm -rf "$TMP_DIR"
mkdir -p "$RECORDS_DIR" "$DATA_DIR"

export PORT="${PORT:-3310}"
export E2E_TEST_MODE=1
export RECORDS_PATH="$RECORDS_DIR"
export DB_PATH="$DATA_DIR/e2e.sqlite"
export RECORDS_TIMEZONE="${RECORDS_TIMEZONE:-Asia/Tokyo}"
export TTS_EN_ENDPOINT=""
export TTS_JA_ENDPOINT=""

cd "$ROOT_DIR"
exec node server.js
