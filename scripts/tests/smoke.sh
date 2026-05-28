#!/usr/bin/env bash
# L5 启动冒烟：拉起 server → /api/health + 几个核心 GET 端点 → exit 0
# 用法: ./scripts/tests/smoke.sh
# 用途: post-deploy / 本地变更后快速回归
#
# 完全自隔离：临时 DB_PATH / RECORDS_PATH / 端口，不写真实数据目录。
set -euo pipefail

PORT="${PORT:-3987}"
TMP_DIR="$(mktemp -d)"
SRV=0
cleanup() {
  if [ "$SRV" -ne 0 ]; then
    kill "$SRV" 2>/dev/null || true
    wait "$SRV" 2>/dev/null || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

export PORT
export DB_PATH="$TMP_DIR/smoke.sqlite"
export RECORDS_PATH="$TMP_DIR/records"
export TTS_EN_ENDPOINT=""
export TTS_JA_ENDPOINT=""
export LOG_SILENT=1
mkdir -p "$RECORDS_PATH"

node server.js >"$TMP_DIR/server.log" 2>&1 &
SRV=$!

# Wait up to 5s for the port to come up
ready=0
for _ in $(seq 1 50); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/api/health" 2>/dev/null; then
    ready=1
    break
  fi
  sleep 0.1
done
if [ "$ready" -ne 1 ]; then
  echo "SMOKE FAIL: server did not become ready within 5s" >&2
  tail -30 "$TMP_DIR/server.log" >&2
  exit 1
fi

# Core probes — each must return 2xx on an empty DB.
# Paths are the real ones from routes/*.js (verified against
# routes/{health,history,dashboard,files,knowledge}.js).
PROBES=(
  "/api/health"
  "/api/history?page=1&limit=1"
  "/api/dashboard/highlight-stats"
  "/api/dashboard/review-stats"
  "/api/folders"
  "/api/knowledge/jobs?limit=1"
)
fail=0
for path in "${PROBES[@]}"; do
  if ! curl -fsS -o /dev/null "http://127.0.0.1:$PORT$path"; then
    echo "SMOKE FAIL: $path" >&2
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  tail -30 "$TMP_DIR/server.log" >&2
  exit 1
fi

echo "smoke OK (${#PROBES[@]} probes, port $PORT)"
