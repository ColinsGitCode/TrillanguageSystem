# 🎯 本地 LLM 质量提升指南

**版本**: v1.0
**日期**: 2026-02-06
**目标**: 通过 Gemini Golden Examples 和评分反馈提升本地 LLM 生成质量

---

## 📊 当前基础设施

### 已有资源
- ✅ 完整的 Observability 数据（quality_score, tokens, performance）
- ✅ SQLite 数据库存储所有生成记录
- ✅ 双模型对比功能（Gemini vs Local）
- ✅ `promptEngine.js` 支持 Few-shot learning

### 质量评分维度（现有）
```javascript
{
  completeness: 40,    // 完整性（占比 40%）
  accuracy: 30,        // 准确性（占比 30%）
  exampleQuality: 22,  // 例句质量（占比 22%）
  formatting: 8        // 格式规范（占比 8%）
}
```

---

## 🎯 方案一：动态 Few-shot Learning（立即可用）

### 核心原理
从高质量 Gemini 生成结果中提取示例，注入到 Local LLM 的 Prompt 中。

### 实施步骤

#### Step 1: 在 server.js 中集成 Golden Examples

在 `server.js` 的 `POST /api/generate` 路由中添加：

```javascript
const goldenExamplesService = require('./services/goldenExamplesService');

// 在 generateWithProvider() 函数中
async function generateWithProvider(phrase, provider, perfTracker) {
  // ... 现有代码 ...

  // 【新增】如果是 Local LLM，启用 Few-shot enhancement
  let prompt = promptEngine.buildPrompt(phrase, basename);

  if (provider === 'local' && process.env.ENABLE_GOLDEN_EXAMPLES === 'true') {
    console.log('[Quality] Fetching golden examples...');

    // 获取与当前短语相关的高质量示例（3个）
    const examples = await goldenExamplesService.getRelevantExamples(phrase, 3);

    if (examples.length > 0) {
      console.log(`[Quality] Found ${examples.length} golden examples, enhancing prompt...`);
      prompt = goldenExamplesService.buildEnhancedPrompt(prompt, examples);
    }
  }

  // 继续原有生成流程...
  const content = await localLlmService.generateContent(prompt);
  // ...
}
```

#### Step 2: 配置环境变量

在 `.env` 或 `docker-compose.yml` 中添加：

```bash
# 启用 Golden Examples Few-shot Learning
ENABLE_GOLDEN_EXAMPLES=true

# Golden Examples 配置
GOLDEN_EXAMPLES_STRATEGY=HIGH_QUALITY_GEMINI  # 或 GEMINI_WINNER, DIVERSE_SAMPLING
GOLDEN_EXAMPLES_COUNT=3                        # 每次使用的示例数量
GOLDEN_EXAMPLES_MIN_SCORE=85                   # 最低质量分数
```

#### Step 3: 测试效果

```bash
# 测试1: 不使用 Golden Examples（baseline）
curl -X POST http://localhost:3010/api/generate \
  -H "Content-Type: application/json" \
  -d '{"phrase":"test phrase","llm_provider":"local"}' | jq '.observability.quality.score'

# 测试2: 使用 Golden Examples
# 先设置环境变量 ENABLE_GOLDEN_EXAMPLES=true，重启服务
# 再次测试同一短语
curl -X POST http://localhost:3010/api/generate \
  -H "Content-Type: application/json" \
  -d '{"phrase":"test phrase","llm_provider":"local"}' | jq '.observability.quality.score'

# 比较质量评分变化
```

---

## 🎯 方案二：批量收集 Golden Dataset（数据准备）

### 目标
使用对比模式批量生成数据，构建高质量训练集。

### 实施脚本

创建 `scripts/collect-golden-dataset.sh`：

```bash
#!/bin/bash

# 批量收集 Golden Dataset
# 用法: ./scripts/collect-golden-dataset.sh phrases.txt

INPUT_FILE="$1"
OUTPUT_DIR="./golden_dataset"
STATS_FILE="$OUTPUT_DIR/stats.json"

mkdir -p "$OUTPUT_DIR"

echo "🚀 开始收集 Golden Dataset..."
echo "{\"total\":0,\"gemini_success\":0,\"local_success\":0,\"high_quality\":0}" > "$STATS_FILE"

while IFS= read -r phrase; do
  [ -z "$phrase" ] && continue

  echo "📝 处理: $phrase"

  # 使用对比模式生成
  result=$(curl -s -X POST http://localhost:3010/api/generate \
    -H "Content-Type: application/json" \
    -d "{\"phrase\":\"$phrase\",\"llm_provider\":\"local\",\"enable_compare\":true}")

  # 提取 Gemini 结果
  gemini_success=$(echo "$result" | jq -r '.gemini.success')
  gemini_quality=$(echo "$result" | jq -r '.gemini.observability.quality.score // 0')

  # 如果 Gemini 生成成功且质量 > 85，保存为 Golden Example
  if [ "$gemini_success" = "true" ] && [ "$gemini_quality" -gt 85 ]; then
    filename="$OUTPUT_DIR/$(date +%s)_${phrase//[^a-zA-Z0-9]/_}.json"
    echo "$result" > "$filename"
    echo "✅ 已保存 Golden Example (质量: $gemini_quality)"
  fi

  sleep 2  # 避免速率限制

done < "$INPUT_FILE"

echo "✅ 数据收集完成，保存到: $OUTPUT_DIR"
```

### 示例输入文件 `phrases.txt`：

```
hello world
machine learning
photosynthesis
quantum computing
supply chain
artificial intelligence
```

---

## 🎯 方案三：Prompt Engineering 优化

### 分析高质量案例特征

创建分析脚本 `scripts/analyze-quality-patterns.js`：

```javascript
const goldenExamplesService = require('./goldenExamplesService');

async function analyzeQuality() {
	console.log('📊 分析高质量案例特征...\n');

	// 获取统计数据
	const analysis = await goldenExamplesService.analyzeGoldenPatterns();

	console.log('=== Golden Standards ===');
	console.log(`平均质量评分: ${analysis.goldenStandards.avgQualityScore.toFixed(2)}`);
	console.log(`平均 Token 数: ${analysis.goldenStandards.avgTokens.toFixed(0)}`);
	console.log(`平均内容长度: ${analysis.goldenStandards.avgContentLength.toFixed(0)} 字符`);
	console.log(`样本数量: ${analysis.goldenStandards.sampleSize}`);

	console.log('\n=== 优化建议 ===');
	analysis.recommendations.forEach((rec, idx) => {
		console.log(`${idx + 1}. ${rec}`);
	});

	// 提取具体示例
	console.log('\n=== 高质量示例 ===');
	const examples = await goldenExamplesService.extractGoldenExamples('HIGH_QUALITY_GEMINI');

	examples.slice(0, 3).forEach((ex, idx) => {
		console.log(`\n示例 ${idx + 1}:`);
		console.log(`  输入: ${ex.input}`);
		console.log(`  质量: ${ex.qualityScore}`);
		console.log(`  长度: ${ex.output.length} 字符`);
	});
}

analyzeQuality().catch(console.error);
```

### 基于分析结果优化 Prompt

在 `services/promptEngine.js` 中添加质量标准：

```javascript
// 基于 Golden Examples 分析的质量标准
const QUALITY_STANDARDS = `
质量标准（基于评分 > 85 的案例分析）：
1. 例句要求：
   - 英文例句：真实场景对话，15-25 个单词
   - 日文例句：自然表达，包含汉字注音，10-20 字
   - 每个例句必须提供完整中文翻译

2. 内容完整性：
   - 翻译、解释、例句一个不能少
   - 每种语言至少 2 个例句
   - 总内容长度建议 > 800 字符

3. 格式规范：
   - 严格遵循 Markdown 结构
   - 日语汉字必须注音：漢字(かんじ)
   - 片假名外来语标英文：テスト(test)
`;

// 在 buildPrompt() 中注入
function buildPrompt(phrase, basename) {
  return `
你是中英日三语学习卡片生成器。

${QUALITY_STANDARDS}

输入短语: "${phrase}"
文件名基础: "${basename}"

[... 继续原有 Prompt ...]
`;
}
```

---

## 🎯 方案四：评分反馈循环（中长期）

### 阶段 1: 收集用户反馈

在前端添加质量反馈按钮：

```javascript
// public/js/modules/app.js
function renderCardModal(record) {
  // ... 现有代码 ...

  // 添加质量反馈区域
  const feedbackHtml = `
    <div class="quality-feedback">
      <label>您对此卡片的评价：</label>
      <button onclick="submitFeedback(${record.id}, 'excellent')">优秀 👍</button>
      <button onclick="submitFeedback(${record.id}, 'good')">良好 👌</button>
      <button onclick="submitFeedback(${record.id}, 'poor')">需改进 👎</button>
    </div>
  `;

  // 注入到弹窗中...
}

async function submitFeedback(generationId, rating) {
  await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ generationId, rating })
  });
  alert('感谢您的反馈！');
}
```

### 阶段 2: 基于反馈调整策略

```javascript
// services/qualityOptimizer.js
class QualityOptimizer {
  async adjustPromptParameters() {
    // 统计用户反馈
    const feedback = await this.getFeedbackStats();

    // 如果差评率 > 20%，调整策略
    if (feedback.poorRate > 0.2) {
      // 策略1: 增加 Few-shot 示例数量
      // 策略2: 提高 temperature（增加创造性）
      // 策略3: 增加最大 tokens
    }

    // 如果优评率 > 80%，可减少 Few-shot（节省成本）
  }
}
```

---

## 📊 效果评估

### 评估指标

| 指标 | Baseline | 启用 Golden Examples | 目标提升 |
|------|----------|---------------------|---------|
| 平均质量评分 | 72 | ? | +10% → 79+ |
| 完整性评分 | 20/40 | ? | +5 → 25/40 |
| 例句质量 | 14/22 | ? | +4 → 18/22 |
| Token 消耗 | 926 | ? | 控制在 +20% 内 |

### 测试方案

```bash
# 1. 准备测试短语（20个）
cat > test_phrases.txt << EOF
hello
machine learning
photosynthesis
quantum entanglement
EOF

# 2. Baseline 测试（不使用 Golden Examples）
./scripts/batch-test.sh test_phrases.txt baseline_results.json

# 3. 启用 Golden Examples 后测试
# 修改 .env: ENABLE_GOLDEN_EXAMPLES=true
# 重启服务
./scripts/batch-test.sh test_phrases.txt enhanced_results.json

# 4. 对比结果
node scripts/compare-results.js baseline_results.json enhanced_results.json
```

---

## 🚀 快速开始

### 最小化实施（10分钟）

1. **收集 Golden Examples（前提：已有 Gemini 数据）**
   ```bash
   # 检查是否有高质量 Gemini 数据
   sqlite3 trilingual_records.db "
   SELECT COUNT(*) FROM generations g
   JOIN observability_metrics om ON g.id = om.generation_id
   WHERE g.llm_provider = 'gemini' AND om.quality_score >= 85;
   "

   # 如果数量 < 10，先批量生成
   ./scripts/collect-golden-dataset.sh common_phrases.txt
   ```

2. **启用 Few-shot Enhancement**
   ```bash
   # 添加到 .env
   echo "ENABLE_GOLDEN_EXAMPLES=true" >> .env

   # 重启服务
   npm start
   ```

3. **测试效果**
   ```bash
   # 生成一张卡片
   curl -X POST http://localhost:3010/api/generate \
     -H "Content-Type: application/json" \
     -d '{"phrase":"test","llm_provider":"local"}' | jq '.observability.quality'
   ```

---

## 📈 长期路线图

### Phase 1: Few-shot Learning（当前）
- ✅ 提取 Golden Examples
- ✅ 动态注入 Prompt
- ⏳ A/B 测试评估

### Phase 2: Prompt Engineering（1-2周）
- 分析高质量案例特征
- 优化 Prompt 模板
- 添加负面示例（避免常见错误）

### Phase 3: 数据收集（持续）
- 批量对比生成
- 构建 1000+ Golden Dataset
- 标注质量标签

### Phase 4: 模型微调（1-2月）
- LoRA 微调本地模型
- 使用 Gemini 结果作为训练数据
- 领域适配（三语学习卡片生成）

### Phase 5: 强化学习（长期）
- RLHF（基于人类反馈）
- 在线学习循环
- 自动质量优化

---

## 🛠️ 工具和脚本

### 已创建
- ✅ `services/goldenExamplesService.js` - Golden Examples 服务
- ✅ `docs/QUALITY_IMPROVEMENT_GUIDE.md` - 本文档

### 待创建（可选）
- `scripts/collect-golden-dataset.sh` - 批量收集数据
- `scripts/analyze-quality-patterns.js` - 分析质量特征
- `scripts/batch-test.sh` - 批量测试
- `scripts/compare-results.js` - 对比测试结果

---

## 📝 注意事项

1. **Token 成本**：启用 Few-shot 会增加 20-30% token 消耗，但质量提升显著
2. **缓存策略**：Golden Examples 可以缓存，避免每次查询数据库
3. **动态更新**：定期重新提取 Golden Examples，保持新鲜度
4. **过拟合风险**：避免使用过少的示例（建议 > 50 个候选池）

---

**维护者**: Three LANS Team
**最后更新**: 2026-02-06
