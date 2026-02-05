# 🚀 模型对比功能快速上手指南

## 5 分钟快速开始

### 步骤 1: 启动服务

```bash
cd /Users/xueguodong/WorkTechDir/Three_LANS_PJ_CodeX
npm start
```

服务将在 http://localhost:3010 启动

### 步骤 2: 打开浏览器

访问 http://localhost:3010，您将看到更新后的界面。

### 步骤 3: 选择对比模式

在左侧生成面板顶部，您会看到三个按钮：

```
┌─────────────────────────────────┐
│  🏠 LOCAL  🤖 GEMINI  ⚡ COMPARE │
└─────────────────────────────────┘
```

点击 **⚡ COMPARE** 按钮启用对比模式。

### 步骤 4: 输入测试短语

在文本框中输入一个简单的测试短语，例如：
- `hello`
- `测试`
- `API`

### 步骤 5: 生成并查看结果

点击 **Generate** 按钮，系统会：
1. 同时调用 Gemini 和 Local LLM
2. 等待两个模型完成生成（约 3-5 秒）
3. 自动弹出对比窗口

### 步骤 6: 分析对比结果

对比窗口包含以下信息：

```
┌────────────────────────────────────────┐
│  🏆 Winner Badge                        │
│  显示哪个模型获胜及推荐理由                │
├────────────────────────────────────────┤
│  📊 对比指标                             │
│  ⚡ Speed: 1234ms vs 2456ms            │
│  ✨ Quality: 95 vs 88                  │
│  🔢 Tokens: 1270 vs 1450               │
│  💰 Cost: $0.00 vs $0.00               │
├─────────────┬──────────────────────────┤
│  GEMINI 列  │  LOCAL LLM 列             │
│  - 生成内容 │  - 生成内容               │
│  - 详细指标 │  - 详细指标               │
│  - Prompt   │  - Prompt                │
└─────────────┴──────────────────────────┘
```

## 🎯 常见使用场景

### 场景 1: 质量对比

**目的:** 比较两个模型的输出质量

**步骤:**
1. 选择 COMPARE 模式
2. 输入复杂的技术术语（如 "Docker"）
3. 查看质量评分和例句质量

**关注指标:**
- Quality Score
- Example Quality
- Accuracy

### 场景 2: 速度测试

**目的:** 了解哪个模型更快

**步骤:**
1. 选择 COMPARE 模式
2. 输入简单短语（如 "test"）
3. 查看响应时间对比

**关注指标:**
- Speed (ms)
- Total Time

### 场景 3: 成本分析

**目的:** 比较两个模型的使用成本

**步骤:**
1. 选择 COMPARE 模式
2. 输入长句子
3. 查看 Token 使用量和成本

**关注指标:**
- Tokens (total)
- Cost ($)

### 场景 4: Prompt 工程

**目的:** 查看不同模型如何理解相同的 Prompt

**步骤:**
1. 选择 COMPARE 模式
2. 生成内容
3. 在对比窗口中点击 "📋 Prompt" 查看完整提示词
4. 比较两个模型的响应差异

## 💡 高级技巧

### 技巧 1: 快速切换模式

模型选择会自动保存到 localStorage，刷新页面后仍保持选择。

### 技巧 2: 查看详细指标

在 CONTENT 标签和 INTEL 标签之间切换，查看：
- CONTENT: 生成的卡片内容
- INTEL: 详细的可观测性数据

### 技巧 3: 导出数据

在 INTEL 标签中，点击 "EXPORT JSON" 或 "EXPORT CSV" 导出指标数据。

### 技巧 4: API 调用

使用 curl 或 Postman 直接调用 API：

```bash
curl -X POST http://localhost:3010/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "phrase": "your phrase",
    "llm_provider": "local",
    "enable_compare": true
  }' | jq .
```

## 🔧 配置说明

### Gemini API 配置

如果要启用 Gemini 对比，需要配置 API key：

1. 获取 API key: https://aistudio.google.com/app/apikey
2. 编辑 `.env` 文件：

```bash
GEMINI_API_KEY=your_actual_api_key_here
GEMINI_MODEL=gemini-1.5-flash-latest
```

3. 重启服务器

### Local LLM 配置

Local LLM 默认使用 Qwen 模型，配置已在 `.env` 中：

```bash
LLM_BASE_URL=http://10.48.3.40:15800/v1
LLM_MODEL=qwen2_5_vl
```

## 🐛 常见问题

### Q1: Gemini 总是显示错误

**原因:** API key 未配置或无效

**解决:**
1. 检查 `.env` 中的 `GEMINI_API_KEY`
2. 确认 API key 有效且有配额
3. 查看服务器日志获取详细错误

### Q2: 对比窗口不显示

**原因:** JavaScript 错误或网络问题

**解决:**
1. 打开浏览器控制台（F12）查看错误
2. 刷新页面清除缓存
3. 检查网络请求是否成功

### Q3: 对比结果只有一个模型

**原因:** 另一个模型生成失败

**说明:** 这是正常行为！对比模式设计为容错：
- 即使一个模型失败，另一个仍会显示结果
- `comparison` 字段仅在两个都成功时出现

### Q4: 页面样式错乱

**解决:**
1. 清除浏览器缓存
2. 强制刷新（Ctrl+F5 / Cmd+Shift+R）
3. 检查 `public/styles.css` 是否正确加载

## 📊 性能优化建议

### 1. 减少等待时间

对比模式会并行调用两个模型，总耗时约为：
```
totalTime ≈ max(geminiTime, localTime) + 网络延迟
```

**建议:**
- 使用本地网络时延迟最小
- Gemini API 需要稳定的网络连接

### 2. 提高响应速度

**Local LLM:**
- 使用更快的硬件（GPU）
- 选择较小的模型（如 qwen2.5:3b）

**Gemini:**
- 使用 Flash 模型而非 Pro 模型
- 减少 Prompt 长度

### 3. 降低成本

**当前配置:**
- Gemini: 免费层（15 RPM）
- Local LLM: 完全免费

**注意事项:**
- Gemini 超过配额会收费
- 监控每日使用量

## 📈 最佳实践

### 1. 系统性对比

建议创建测试集，包含：
- ✅ 简单词汇（如 "hello"）
- ✅ 技术术语（如 "API"）
- ✅ 复杂短语（如 "machine learning algorithm"）
- ✅ 多语言混合（如 "日本語テスト"）

### 2. 记录结果

使用导出功能保存对比数据：
1. 生成对比结果
2. 切换到 INTEL 标签
3. 点击 "EXPORT JSON" 保存完整数据
4. 使用 Excel 或 Python 分析趋势

### 3. 持续监控

定期运行对比测试，监控：
- 质量评分趋势
- 响应时间变化
- 成本变化

## 🎓 学习资源

- **完整文档:** [MODEL_COMPARISON_FEATURE.md](./MODEL_COMPARISON_FEATURE.md)
- **更新日志:** [FEATURE_UPDATE_v2.1.md](./FEATURE_UPDATE_v2.1.md)
- **代码示例:** `public/js/modules/app.js`

## 🚀 下一步

1. 尝试不同类型的短语
2. 比较两个模型的优缺点
3. 根据需求选择最佳模型
4. 探索更多高级功能

---

**需要帮助?** 查看主文档或提交 Issue

**开始时间:** 现在就试试吧！🎉
