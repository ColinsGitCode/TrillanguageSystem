#!/bin/bash

# 自动生成学习卡片工作流
# 使用 DeepSeek 搜索式摘要，再调用本地 API 生成卡片。

PHRASE="$1"
API_URL="${API_URL:-http://localhost:3010/api/generate}"
DEEPSEEK_BASE_URL="${DEEPSEEK_BASE_URL:-https://api.deepseek.com}"
DEEPSEEK_MODEL="${DEEPSEEK_MODEL:-deepseek-v4-pro}"

if [ -z "$PHRASE" ]; then
  echo "用法: $0 <phrase>"
  echo "示例: $0 \"machine learning\""
  exit 1
fi

if [ -z "$DEEPSEEK_API_KEY" ]; then
  echo "缺少 DeepSeek API Key：请设置 DEEPSEEK_API_KEY"
  exit 1
fi

echo "步骤1：使用 DeepSeek 总结最新定义..."

summary_payload=$(jq -n \
  --arg model "$DEEPSEEK_MODEL" \
  --arg prompt "搜索并总结【$PHRASE】的最新定义和用法（2026年），用中文回答" \
  '{model:$model, messages:[{role:"user", content:$prompt}], stream:false}')

summary_result=$(curl -s -X POST "${DEEPSEEK_BASE_URL%/}/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -d "$summary_payload")

definition=$(echo "$summary_result" | jq -r '.choices[0].message.content // .error.message // .message // empty')

echo "DeepSeek 返回："
echo "$definition" | head -n 5
echo "..."
echo ""

echo "步骤2：生成三语学习卡片..."

card_payload=$(jq -n \
  --arg phrase "$PHRASE" \
  --arg model "$DEEPSEEK_MODEL" \
  '{phrase:$phrase, llm_provider:"deepseek", llm_model:$model, enable_compare:false}')

card_result=$(curl -s -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d "$card_payload")

success=$(echo "$card_result" | jq -r '.success')

if [ "$success" = "true" ]; then
  folder=$(echo "$card_result" | jq -r '.result.folder')
  base_name=$(echo "$card_result" | jq -r '.result.baseName')
  quality=$(echo "$card_result" | jq -r '.observability.quality.score')

  echo "卡片生成成功！"
  echo "   - 文件夹: $folder"
  echo "   - 文件名: $base_name"
  echo "   - 质量评分: $quality"
  echo "   - 查看: http://localhost:3010"
else
  echo "生成失败"
  echo "$card_result" | jq .
fi
