#!/bin/bash

# 批量翻译脚本（使用宿主机 Gemini CLI）
# 用法: ./scripts/batch-translate.sh input.txt

INPUT_FILE="$1"

if [ -z "$INPUT_FILE" ] || [ ! -f "$INPUT_FILE" ]; then
  echo "用法: $0 <input_file>"
  echo "示例: $0 phrases.txt"
  exit 1
fi

echo "🚀 开始批量翻译..."
echo ""

while IFS= read -r phrase; do
  [ -z "$phrase" ] && continue

  echo "📝 处理: $phrase"

  # 通过 Host Proxy 调用 Gemini
  result=$(curl -s -X POST http://localhost:3210/api/gemini \
    -H "Content-Type: application/json" \
    -d "{\"prompt\":\"翻译成中日英三语：$phrase\",\"baseName\":\"$phrase\"}")

  echo "$result" | jq -r '.markdown'
  echo "---"

done < "$INPUT_FILE"

echo "✅ 批量翻译完成"
