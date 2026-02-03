# Gemini API 集成封存说明

## 📦 封存信息

- **封存日期**: 2026-02-03
- **原因**: 转向本地LLM方案（Qwen2.5等开源模型）
- **状态**: 代码保留但不再主动维护

## 🔄 迁移说明

### 从 Gemini 迁移到本地 LLM

**主要变更：**
1. ✅ 默认provider从 `gemini` 改为 `local`
2. ✅ Prompt优化：从3740 tokens降至1352 tokens（-64%）
3. ✅ 本地LLM完全兼容4K上下文模型
4. ✅ 对比模式已禁用（前端UI隐藏）

### 性能对比

| 指标 | Gemini 2.5 Flash | Qwen2.5 (本地) |
|------|------------------|----------------|
| **速度** | ~12秒 | ~6秒 ✅ |
| **成本** | $0.0001/次 | 免费 ✅ |
| **质量评分** | 88/100 | 64/100 ⚠️ |
| **隐私** | 数据上传 | 完全本地 ✅ |
| **依赖** | 网络+API Key | 仅本地模型 ✅ |

### 优缺点分析

**本地LLM优势：**
- ✅ 完全离线，隐私安全
- ✅ 零成本，无配额限制
- ✅ 速度更快（无网络延迟）
- ✅ 可定制化（模型选择、参数调优）

**本地LLM劣势：**
- ⚠️ 质量略低（64分 vs 88分）
- ⚠️ 需要本地计算资源
- ⚠️ 模型管理复杂度

## 🔧 如何重新启用 Gemini

如果未来需要重新启用Gemini API：

### 1. 恢复配置

编辑 `.env` 文件：

```bash
# 取消注释以下配置
GEMINI_API_KEY=your_api_key_here
GEMINI_MODEL=gemini-2.5-flash
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
```

### 2. 修改默认provider

**后端** (`server.js` 第201行)：
```javascript
const { phrase, llm_provider = 'gemini', enable_compare = false } = req.body;
```

**前端** (`public/main.js` 第45行)：
```javascript
llmProvider: localStorage.getItem('llm_provider') || 'gemini',
```

### 3. 重新启用对比模式

编辑 `public/index.html` 第119行，移除 `style="display: none;"`：

```html
<div class="comparison-controls">
  <label class="comparison-toggle">
    <input type="checkbox" id="enableCompare" />
    <span>启用对比模式 (Gemini vs Local LLM)</span>
  </label>
</div>
```

### 4. 重启服务

```bash
npm start
```

## 📁 受影响的文件

### 已标记为封存
- ✅ `services/geminiService.js` - 添加封存标记
- ✅ `.env` - Gemini配置已注释
- ✅ `server.js` - 默认provider改为local
- ✅ `public/main.js` - 默认provider改为local
- ✅ `public/index.html` - 对比模式已隐藏

### 保持活跃
- ✅ `services/localLlmService.js` - 主要LLM服务
- ✅ `services/promptEngine.js` - 优化后的Prompt引擎
- ✅ `services/healthCheckService.js` - 自动跳过Gemini检查

## 🎯 推荐的本地模型

基于多语言翻译需求（中英日），推荐以下模型：

### 1️⃣ Qwen2.5-7B-Instruct ⭐⭐⭐⭐⭐
- **参数**: 7B
- **上下文**: 32K-128K
- **优势**: 中日文支持最佳，社区活跃
- **速度**: M4上 ~15 tok/s (Q4量化)

### 2️⃣ Phi-3-medium-14B ⭐⭐⭐⭐
- **参数**: 14B
- **上下文**: 128K
- **优势**: 微软出品，质量接近GPT-3.5
- **速度**: M4上 ~10 tok/s (Q4量化)

### 3️⃣ NLLB-3.3B ⭐⭐⭐
- **参数**: 3.3B
- **上下文**: 1K
- **优势**: Meta翻译专用模型
- **速度**: M4上 ~30 tok/s

## 📊 Prompt优化细节

### 优化前（Gemini时代）
- System Role: ~200 tokens
- Chain of Thought (5步): ~500 tokens
- Few-shot Examples (4个): ~2000 tokens
- Quality Standards: ~600 tokens
- Output Format: ~440 tokens
- **Total: ~3740 tokens**

### 优化后（本地LLM时代）
- System Role: ~50 tokens
- Chain of Thought (3步): ~150 tokens
- Few-shot Examples (2个): ~800 tokens
- Core Requirements: ~200 tokens
- Output Format: ~152 tokens
- **Total: ~1352 tokens (-64%)**

## 📝 版本历史

- **v1.0 (2026-01-28)**: 初始Gemini集成
- **v2.0 (2026-01-29)**: Prompt工程优化（CoT + Few-shot）
- **v3.0 (2026-02-02)**: 可观测性功能（Token统计、质量评分）
- **v4.0 (2026-02-03)**: 封存Gemini，转向本地LLM

## 🔗 相关文档

- [可观测性及多模型对比功能设计](./DesignDocs/可观测性及多模型对比功能.md)
- [Code as Prompt 深度分析](./code_as_prompt_deep_dive.md)
- [本地LLM服务实现](../services/localLlmService.js)
- [Prompt优化引擎](../services/promptEngine.js)

---

**最后更新**: 2026-02-03
**维护状态**: ⚠️ 已封存，仅保留参考
**责任人**: AI Agent Team
