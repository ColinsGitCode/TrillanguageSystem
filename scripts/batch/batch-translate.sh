#!/bin/bash

# 批量翻译脚本（使用 DeepSeek Chat Completions）
# 用法: ./scripts/batch/batch-translate.sh input.txt

INPUT_FILE="$1"
DEEPSEEK_BASE_URL="${DEEPSEEK_BASE_URL:-https://api.deepseek.com}"
DEEPSEEK_MODEL="${DEEPSEEK_MODEL:-deepseek-v4-pro}"

if [ -z "$INPUT_FILE" ] || [ ! -f "$INPUT_FILE" ]; then
  echo "用法: $0 <input_file>"
  echo "示例: $0 phrases.txt"
  exit 1
fi

if [ -z "$DEEPSEEK_API_KEY" ]; then
  echo "缺少 DeepSeek API Key：请设置 DEEPSEEK_API_KEY"
  exit 1
fi

echo "开始批量翻译..."
echo ""

while IFS= read -r phrase; do
  [ -z "$phrase" ] && continue

  echo "处理: $phrase"

  payload=$(jq -n \
    --arg model "$DEEPSEEK_MODEL" \
    --arg prompt "翻译成中日英三语：$phrase" \
    '{model:$model, messages:[{role:"user", content:$prompt}], stream:false}')

  result=$(curl -s -X POST "${DEEPSEEK_BASE_URL%/}/chat/completions" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
    -d "$payload")

  echo "$result" | jq -r '.choices[0].message.content // .error.message // .message // empty'
  echo "---"

done < "$INPUT_FILE"

echo "批量翻译完成"
