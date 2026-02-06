#!/bin/bash

# 自动生成学习卡片工作流
# 结合 Gemini CLI（搜索）+ 本地 API（生成卡片）

PHRASE="$1"
API_URL="http://localhost:3010/api/generate"

if [ -z "$PHRASE" ]; then
  echo "用法: $0 <phrase>"
  echo "示例: $0 \"machine learning\""
  exit 1
fi

echo "🔍 步骤1：使用 Gemini 搜索最新定义..."

# 通过 Host Proxy 调用 Gemini 搜索
GEMINI_RESULT=$(curl -s -X POST http://localhost:3210/api/gemini \
  -H "Content-Type: application/json" \
  -d "{\"prompt\":\"搜索并总结【$PHRASE】的最新定义和用法（2026年），用中文回答\",\"baseName\":\"search\"}")

DEFINITION=$(echo "$GEMINI_RESULT" | jq -r '.markdown')

echo "📖 Gemini 返回："
echo "$DEFINITION" | head -n 5
echo "..."
echo ""

echo "🎨 步骤2：生成三语学习卡片..."

# 调用本地 API 生成完整卡片（使用 Local LLM）
CARD_RESULT=$(curl -s -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d "{\"phrase\":\"$PHRASE\",\"llm_provider\":\"local\",\"enable_compare\":false}")

SUCCESS=$(echo "$CARD_RESULT" | jq -r '.success')

if [ "$SUCCESS" = "true" ]; then
  FOLDER=$(echo "$CARD_RESULT" | jq -r '.result.folder')
  BASENAME=$(echo "$CARD_RESULT" | jq -r '.result.baseName')
  QUALITY=$(echo "$CARD_RESULT" | jq -r '.observability.quality.score')

  echo "✅ 卡片生成成功！"
  echo "   - 文件夹: $FOLDER"
  echo "   - 文件名: $BASENAME"
  echo "   - 质量评分: $QUALITY"
  echo "   - 查看: http://localhost:3010"
else
  echo "❌ 生成失败"
  echo "$CARD_RESULT" | jq .
fi
