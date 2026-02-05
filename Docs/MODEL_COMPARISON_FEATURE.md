# 模型对比功能文档

## 📋 功能概述

三语卡片生成系统现已支持**双模型对比功能**，允许用户同时使用 GEMINI 和 LOCAL LLM 生成内容，并进行详细的性能和质量对比分析。

## 🎯 主要特性

### 1. 三种生成模式

- **🏠 LOCAL ONLY**: 仅使用本地 LLM (Qwen)
- **🤖 GEMINI ONLY**: 仅使用 Gemini API
- **⚡ COMPARE MODE**: 同时使用两个模型并对比结果

### 2. 对比维度

#### 性能指标
- ⚡ **Speed (速度)**: 响应时间对比 (ms)
- ✨ **Quality (质量)**: 综合质量评分 (0-100)
- 🔢 **Tokens**: Token 使用量对比
- 💰 **Cost (成本)**: 生成成本对比

#### 内容分析
- 📝 生成内容预览（双列展示）
- 📊 详细指标卡片
- 📋 Prompt 文本查看
- 🏆 Winner 推荐

### 3. 可视化展示

- **对比弹窗**: 双列布局清晰展示两个模型的输出
- **Winner Badge**: 自动判定优胜模型
- **指标卡片**: 视觉化对比速度、质量、token、成本
- **颜色编码**:
  - 🟦 Gemini - 蓝色渐变
  - 🟩 Local LLM - 绿色渐变
  - 🏆 Winner - 高亮显示

## 🚀 使用方法

### Web UI 操作

1. **选择模式**
   - 在生成面板顶部，点击模型选择器
   - 选择三种模式之一：LOCAL / GEMINI / COMPARE

2. **输入短语**
   - 在文本框中输入要生成的短语
   - 或使用图片识别功能

3. **生成并查看结果**
   - 点击 "Generate" 按钮
   - 对比模式会自动弹出对比弹窗
   - 查看双列对比结果和分析

### API 调用

```bash
# 对比模式 API 请求
curl -X POST http://localhost:3010/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "phrase": "hello world",
    "llm_provider": "local",
    "enable_compare": true
  }'
```

#### 响应结构

```json
{
  "phrase": "hello world",
  "gemini": {
    "success": true,
    "output": { "markdown_content": "...", "audio_tasks": [...] },
    "observability": {
      "tokens": { "input": 450, "output": 820, "total": 1270 },
      "cost": { "total": 0 },
      "quality": { "score": 95 },
      "performance": { "totalTime": 1234 },
      "prompt": { "text": "...", "full": "..." },
      "metadata": { "provider": "gemini", "model": "gemini-1.5-flash" }
    }
  },
  "local": {
    "success": true,
    "output": { ... },
    "observability": { ... }
  },
  "comparison": {
    "metrics": {
      "speed": { "gemini": 1234, "local": 2456 },
      "quality": { "gemini": 95, "local": 88 },
      "tokens": { "gemini": 1270, "local": 1450 },
      "cost": { "gemini": 0, "local": 0 }
    },
    "winner": "gemini",
    "recommendation": "Gemini wins on speed/quality balance.",
    "promptComparison": {
      "similarity": "identical",
      "geminiLength": 1095,
      "localLength": 1095
    }
  }
}
```

## 🏗️ 架构设计

### 前端组件

```
index.html
├── 模型选择器 UI (.model-selector)
│   ├── LOCAL 按钮
│   ├── GEMINI 按钮
│   └── COMPARE 按钮
│
app.js (modules/app.js)
├── initModelSelector() - 模型选择逻辑
├── handleCompareResult() - 对比结果处理
└── renderCompareModal() - 对比弹窗渲染
    ├── 对比摘要 (.compare-summary)
    ├── 双列内容 (.compare-columns)
    │   ├── GEMINI 列
    │   └── LOCAL 列
    └── 指标对比 (.compare-metrics-grid)
```

### 后端服务

```
server.js
├── POST /api/generate
│   └── handleComparisonMode(phrase)
│       ├── Promise.allSettled([
│       │   generateWithProvider(phrase, 'gemini'),
│       │   generateWithProvider(phrase, 'local')
│       │ ])
│       └── 对比分析逻辑
│
generateWithProvider(phrase, provider)
├── buildPrompt()
├── llmService.generateContent()
├── TokenCounter.calculateCost()
├── QualityChecker.check()
└── PromptParser.parse()
```

### 状态管理

```javascript
// store.js
state = {
  modelMode: 'local' | 'gemini' | 'compare',  // 当前模式
  llmProvider: 'local' | 'gemini',            // 单模式下的提供商
  isGenerating: boolean                        // 生成中状态
}
```

## 🎨 样式系统

### CSS 类命名

```css
/* 模型选择器 */
.model-selector           /* 选择器容器 */
.selector-buttons         /* 按钮组 */
.model-btn                /* 模型按钮 */
.model-btn.active         /* 激活状态 */

/* 对比弹窗 */
.compare-modal            /* 对比模态框 */
.compare-summary          /* 对比摘要 */
.compare-metrics-grid     /* 指标网格 */
.metric-row               /* 指标行 */
.metric-val.winner        /* 优胜指标 */

/* 双列布局 */
.compare-columns          /* 双列容器 */
.compare-column           /* 单列 */
.compare-column-header    /* 列头 */
.compare-content-section  /* 内容区域 */
```

## 📊 质量评分算法

```javascript
// Winner 判定逻辑
const geminiScore = quality.score * 0.7 + (5000 / totalTime) * 0.3
const localScore = quality.score * 0.7 + (5000 / totalTime) * 0.3

let winner = 'tie'
if (geminiScore > localScore + 5) winner = 'gemini'
if (localScore > geminiScore + 5) winner = 'local'
```

**权重分配:**
- 70% - 质量评分 (0-100)
- 30% - 速度归一化分数

**判定阈值:** 5 分差距

## 🔧 配置说明

### 环境变量

```bash
# Gemini 配置
GEMINI_API_KEY=your_api_key
GEMINI_MODEL=gemini-1.5-flash-latest

# Local LLM 配置
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=qwen2.5-coder:latest
LLM_MAX_TOKENS=2048
LLM_TEMPERATURE=0.2
```

### 启用/禁用模型

如果某个模型不可用，对比模式仍会正常工作：
- 成功的模型会正常显示结果
- 失败的模型会显示错误信息
- `comparison` 字段仅在两个都成功时存在

## 🧪 测试

### 自动化测试脚本

```bash
# 运行测试脚本
./test-compare.sh

# 预期输出
# ✅ LOCAL 单模型测试成功
# ✅ 对比模式测试成功
#    Winner: local
#    Speed: GEMINI=1234ms, LOCAL=2456ms
#    Quality: GEMINI=95, LOCAL=88
```

### 手动测试步骤

1. 启动服务器: `npm start`
2. 访问 http://localhost:3010
3. 选择 COMPARE 模式
4. 输入测试短语如 "hello"
5. 验证对比弹窗正确显示

## 📈 性能优化

### 并行处理
- 对比模式使用 `Promise.allSettled` 并行调用两个 LLM
- 即使一个失败，另一个仍可继续执行
- 总耗时 ≈ max(geminiTime, localTime)

### 前端优化
- 对比弹窗使用懒加载
- 大量数据使用滚动容器
- CSS 动画使用 GPU 加速

## 🐛 故障排查

### 常见问题

**Q: Gemini 总是失败**
- 检查 `GEMINI_API_KEY` 是否配置
- 验证 API key 是否有效
- 查看服务器日志获取详细错误

**Q: 对比结果不显示**
- 打开浏览器控制台查看错误
- 确认 `enable_compare=true` 已传递
- 检查后端返回的 JSON 结构

**Q: 样式显示异常**
- 清除浏览器缓存
- 确认 styles.css 已更新
- 检查 CSS 选择器是否正确

## 🚧 未来改进

- [ ] 支持更多模型（Claude, GPT-4, etc.）
- [ ] 提示词差异高亮显示
- [ ] 历史对比记录保存
- [ ] 导出对比报告 (PDF/CSV)
- [ ] 批量对比测试
- [ ] 自定义评分权重

## 📝 版本历史

- **v2.1.0** (2026-02-05)
  - ✅ 实现模型选择器 UI
  - ✅ 支持三种生成模式
  - ✅ 双模型并行对比
  - ✅ 对比结果可视化
  - ✅ Winner 自动判定
  - ✅ 完整的 observability 数据

---

**开发者:** Claude Code
**文档更新:** 2026-02-05
