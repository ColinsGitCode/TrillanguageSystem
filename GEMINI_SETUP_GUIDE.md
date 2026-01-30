# Gemini API 配置指南

## 📋 快速开始

### 1. 获取 Gemini API Key（2 分钟）

1. 访问 [Google AI Studio](https://aistudio.google.com/app/apikey)
2. 使用 Google 账号登录
3. 点击 **"Get API Key"** → **"Create API Key"**
4. 选择项目（或创建新项目）
5. 复制生成的 API Key（格式：`AIzaSy...`）

> ⚠️ **重要**：API Key 是私密信息，不要提交到 git 仓库或公开分享

---

### 2. 配置环境变量（1 分钟）

#### 方法 A：直接修改 .env 文件

```bash
# 复制示例配置
cp .env.example .env

# 编辑 .env 文件
# 将 YOUR_GEMINI_API_KEY_HERE 替换为你的实际 API Key
```

编辑后的 `.env` 文件应包含：

```bash
GEMINI_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
GEMINI_MODEL=gemini-1.5-flash-latest
LLM_MAX_TOKENS=2048
LLM_TEMPERATURE=0.2
```

#### 方法 B：使用命令行（临时测试）

```bash
export GEMINI_API_KEY="你的API_Key"
npm start
```

---

### 3. 验证配置（1 分钟）

#### 测试 1：文本生成

```bash
curl -X POST http://localhost:3010/api/generate \
  -H "Content-Type: application/json" \
  -d '{"phrase":"hello"}'
```

**期望结果：**
```json
{
  "success": true,
  "files": {
    "markdown": "/data/trilingual_records/20260130/hello.md",
    "html": "/data/trilingual_records/20260130/hello.html"
  }
}
```

#### 测试 2：OCR 图片识别

创建测试脚本 `test_ocr.sh`：

```bash
#!/bin/bash
# 将图片转换为 base64（替换为你的图片路径）
IMAGE_BASE64=$(base64 -i your_image.png | tr -d '\n')

curl -X POST http://localhost:3010/api/ocr \
  -H "Content-Type: application/json" \
  -d "{\"image\":\"data:image/png;base64,$IMAGE_BASE64\"}"
```

**期望结果：**
```json
{
  "text": "识别出的文字内容"
}
```

---

## 🔍 常见问题排查

### 问题 1：API Key 未配置错误

**错误信息：**
```
GEMINI_API_KEY is not configured. Please set it in .env file.
```

**解决方法：**
1. 检查 `.env` 文件是否存在
2. 确认 `GEMINI_API_KEY` 已设置且不为空
3. 重启服务：`npm start`

---

### 问题 2：API 请求失败 403

**错误信息：**
```
Gemini API request failed: 403 API key not valid
```

**可能原因：**
- API Key 复制错误（包含空格或换行）
- API Key 已过期或被撤销
- 未启用 Generative Language API

**解决方法：**
1. 重新复制 API Key（确保无空格）
2. 在 [API Studio](https://aistudio.google.com/app/apikey) 检查 Key 状态
3. 创建新的 API Key

---

### 问题 3：配额超限 429

**错误信息：**
```
Gemini API request failed: 429 Resource exhausted
```

**解决方法：**
1. 检查当前配额使用情况（访问 Google Cloud Console）
2. 等待配额重置（每分钟/每天重置）
3. 考虑升级到付费层级

**Gemini 免费层限额：**
- **Gemini 1.5 Flash**: 15 RPM, 1M TPM, 1,500 RPD
- **Gemini 1.5 Pro**: 2 RPM, 32K TPM, 50 RPD

---

### 问题 4：响应过长被截断

**错误信息：**
```
Warning: Response may be truncated
```

**解决方法：**
增加 `LLM_MAX_TOKENS` 配置：

```bash
# .env
LLM_MAX_TOKENS=4096  # 从 2048 增加到 4096
```

---

## 📊 性能优化建议

### 1. 选择合适的模型

| 模型 | 速度 | 质量 | 免费配额 | 推荐场景 |
|------|------|------|---------|---------|
| gemini-1.5-flash-latest | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 1,500/day | 日常使用 ✅ |
| gemini-1.5-pro-latest | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 50/day | 高质量需求 |

**推荐配置：** gemini-1.5-flash-latest（性价比最高）

---

### 2. Temperature 调优

```bash
# .env
LLM_TEMPERATURE=0.2   # 推荐值（更确定，更稳定）
# LLM_TEMPERATURE=0.5  # 更多样化（但可能不一致）
# LLM_TEMPERATURE=0.0  # 完全确定性（适合测试）
```

---

### 3. 监控 Token 使用量

在服务端日志中查看：

```bash
docker compose logs -f app
```

查找：
```
[Gemini] Response received, length: XXXX
```

**优化建议：**
- 单次请求 < 3,000 tokens → 正常 ✅
- 单次请求 > 5,000 tokens → 考虑简化提示词 ⚠️

---

## 🔄 切换回本地 Qwen（可选）

如需切换回本地 LLM：

### 1. 修改 .env

```bash
# 注释掉 Gemini 配置
# GEMINI_API_KEY=...
# GEMINI_MODEL=...

# 启用本地 Qwen 配置
LLM_BASE_URL=http://10.48.3.40:15800/v1
LLM_API_KEY=EMPTY
LLM_MODEL=qwen2_5_vl
```

### 2. 修改 services/geminiService.js

需要恢复 OpenAI 兼容格式的代码（已封存在注释中）

---

## 📈 使用统计和监控

### 查看 Gemini API 使用情况

1. 访问 [Google Cloud Console](https://console.cloud.google.com/)
2. 导航到 **APIs & Services** → **Dashboard**
3. 查看 **Generative Language API** 使用统计

### 设置配额告警

在 Google Cloud Console 中设置：
- 每日请求数告警（如超过 1,000 次）
- Token 使用量告警

---

## 🎯 测试短语集

使用以下短语测试系统质量：

### 基础测试（5 个）
1. "hello" - 简单英文
2. "你好" - 简单中文
3. "こんにちは" - 简单日语
4. "API" - 技术术语
5. "run" - 多义词

### 进阶测试（10 个）
6. "打招呼" - 日常动词
7. "效率" - 抽象名词
8. "machine learning" - 复合技术词
9. "頑張って" - 日语习语
10. "get" - 高度多义词
11. "微服务" - 专业术语
12. "breakfast" - 日常名词
13. "データベース" - 日语外来语
14. "embarrassed" - 情感词汇
15. "open source" - 技术概念

---

## 🆘 获取帮助

### 官方文档
- [Gemini API 文档](https://ai.google.dev/docs)
- [定价和配额](https://ai.google.dev/pricing)
- [API 参考](https://ai.google.dev/api)

### 社区支持
- [GitHub Issues](https://github.com/your-repo/issues)
- [Discord 服务器](https://discord.gg/...)

---

## ✅ 配置检查清单

在开始使用前，确认：

- [ ] 已获取 Gemini API Key
- [ ] `.env` 文件已正确配置
- [ ] `GEMINI_API_KEY` 已设置且有效
- [ ] `LLM_MAX_TOKENS` 设置为 2048 或更高
- [ ] 服务成功启动（`npm start` 或 `docker compose up`）
- [ ] 文本生成测试通过
- [ ] OCR 测试通过（可选）
- [ ] 生成的卡片质量符合预期

---

**配置完成后，你就可以开始使用优化后的三语卡片生成系统了！** 🎉
