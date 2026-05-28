#!/bin/bash

# 自动生成学习卡片工作流
# 结合 Gemini CLI（搜索）+ 本地 API（生成卡片）

PHRASE="$1"
API_URL="http://localhost:3010/api/generate"
GEMINI_GATEWAY_URL="${GEMINI_GATEWAY_URL:-http://localhost:18888/api/gemini}"
GEMINI_API_KEY="${GEMINI_API_KEY:-${GEMINI_PROXY_API_KEY:-}}"
GEMINI_SOURCE_APP="${GEMINI_SOURCE_APP:-tri-lang-learning-system}"
GEMINI_SOURCE_ENV="${GEMINI_SOURCE_ENV:-prod}"
GEMINI_PROJECT="${GEMINI_PROJECT:-tri-lang-learning-system}"
GEMINI_MODEL="${GEMINI_MODEL:-gemini-3-pro-preview}"

if [ -z "$PHRASE" ]; then
  echo "用法: $0 <phrase>"
  echo "示例: $0 \"machine learning\""
  exit 1
fi

if [ -z "$GEMINI_API_KEY" ]; then
  echo "缺少 GEMINI API Key：请设置 GEMINI_API_KEY 或 GEMINI_PROXY_API_KEY"
  exit 1
fi

echo "🔍 步骤1：使用 Gemini 搜索最新定义..."

# 通过 Gateway(18888) 调用 Gemini 搜索
GEMINI_RESULT=$(curl -s -X POST "$GEMINI_GATEWAY_URL" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $GEMINI_API_KEY" \
  -H "X-Source-App: $GEMINI_SOURCE_APP" \
  -H "X-Source-Env: $GEMINI_SOURCE_ENV" \
  -d "{\"prompt\":\"搜索并总结【$PHRASE】的最新定义和用法（2026年），用中文回答\",\"baseName\":\"search\",\"model\":\"$GEMINI_MODEL\",\"project\":\"$GEMINI_PROJECT\"}")

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
