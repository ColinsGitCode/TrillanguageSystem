#!/bin/bash
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "Usage: $0 <phrases.txt> <output.jsonl> [variant] [experiment_id]" >&2
  exit 1
fi

INPUT_FILE="$1"
OUTPUT_FILE="$2"
VARIANT="${3:-baseline}"
EXPERIMENT_ID="${4:-exp_$(date +%s)}"

: > "$OUTPUT_FILE"

while IFS= read -r phrase; do
  [ -z "$phrase" ] && continue
  echo "[batch-test] ${phrase}" >&2
  payload=$(jq -n \
    --arg phrase "$phrase" \
    --arg variant "$VARIANT" \
    --arg experiment_id "$EXPERIMENT_ID" \
    '{phrase:$phrase, llm_provider:"local", enable_compare:false, variant:$variant, experiment_id:$experiment_id}')

  resp=$(curl -s -X POST http://localhost:3010/api/generate \
    -H "Content-Type: application/json" \
    -d "$payload")

  echo "$resp" >> "$OUTPUT_FILE"
  sleep 2

done < "$INPUT_FILE"

echo "[batch-test] done. experiment_id=${EXPERIMENT_ID}" >&2
