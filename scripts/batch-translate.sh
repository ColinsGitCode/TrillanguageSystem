#!/bin/bash

# 批量翻译脚本（使用宿主机 Gemini CLI）
# 用法: ./scripts/batch-translate.sh input.txt

INPUT_FILE="$1"
GEMINI_GATEWAY_URL="${GEMINI_GATEWAY_URL:-http://localhost:18888/api/gemini}"
GEMINI_API_KEY="${GEMINI_API_KEY:-${GEMINI_PROXY_API_KEY:-}}"

if [ -z "$INPUT_FILE" ] || [ ! -f "$INPUT_FILE" ]; then
  echo "用法: $0 <input_file>"
  echo "示例: $0 phrases.txt"
  exit 1
fi

if [ -z "$GEMINI_API_KEY" ]; then
  echo "缺少 GEMINI API Key：请设置 GEMINI_API_KEY 或 GEMINI_PROXY_API_KEY"
  exit 1
fi

echo "🚀 开始批量翻译..."
echo ""

while IFS= read -r phrase; do
  [ -z "$phrase" ] && continue

  echo "📝 处理: $phrase"

  # 通过 Gateway(18888) 调用 Gemini
  result=$(curl -s -X POST "$GEMINI_GATEWAY_URL" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: $GEMINI_API_KEY" \
    -d "{\"prompt\":\"翻译成中日英三语：$phrase\",\"baseName\":\"$phrase\"}")

  echo "$result" | jq -r '.markdown'
  echo "---"

done < "$INPUT_FILE"

echo "✅ 批量翻译完成"
