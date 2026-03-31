# 三语卡片生成系统工程化设计方案

## 1. 概述
本方案旨在将现有的“HTML 档案查看器”升级为“三语学习卡片生成系统”。核心思想采用 **"Code as Prompt"**，利用 Gemini API 的强逻辑能力生成结构化文本与前端代码，并结合外部本地 TTS 容器生成高质量语音，最终自动归档为标准化的 HTML 学习卡片。

## 2. 架构设计

### 2.1 系统角色
*   **前端 (Web UI)**: 提供短语输入入口，展示生成进度，预览最终结果。
*   **应用后端 (Node.js)**: 业务编排中心。
    *   负责加载 Prompt 模版。
    *   负责调用 Gemini API。
    *   负责调度 TTS 引擎。
    *   负责文件系统的读写与归档。
*   **AI 逻辑引擎 (Gemini API)**:
    *   **模型**: Gemini 1.5 Flash (速度快、免费额度高) 或 1.5 Pro。
    *   **职责**: 解析用户输入的“短语”，生成三语（中/日/英）对照内容（Markdown），并根据设计规范生成最终的 HTML 代码。
*   **语音引擎 (Local TTS Containers)**:
    *   **英文**: Piper HTTP（轻量、速度快）
    *   **日文**: VOICEVOX Engine（更自然的日语语音）
    *   **接口**:
        *   Piper: `POST http://tts-en:5002/api/tts`
        *   VOICEVOX: `POST http://tts-ja:50021/audio_query` + `POST /synthesis`
    *   **职责**: 接收文本，生成 `.wav` 音频文件。

### 2.2 数据流向
1.  **用户输入**: 浏览器输入短语（如 "Take a rain check"）。
2.  **Prompt 组装**: 后端读取 `codex_prompt/phrase_3LANS_html.md`，注入变量 `$ARGUMENTS: { phrase: "Take a rain check" }`。
3.  **内容生成 (AI)**:
    *   后端请求 Gemini API。
    *   Gemini 返回结构化 JSON 内容：
        *   `markdown_content`: 包含音标、释义、例句的 Markdown。
        *   `html_content`: 包含完整 CSS 样式和布局的 HTML 代码（必须为 JSON 可解析字符串，确保换行/引号已转义）。
        *   `audio_tasks`: 需要生成的音频列表（例句文本 + 目标文件名后缀）。音频文件名由后端拼接为：`<base_filename><filename_suffix>.wav`。
4.  **音频合成 (TTS)**:
    *   后端解析 `audio_tasks`。
    *   并行调用本地 TTS 容器接口。
    *   获取音频流并保存为 `.wav` 文件至目标目录（Phase 2 先使用原始音频，不做转码）。
5.  **归档**:
    *   后端将 Markdown 和 HTML 写入 `/data/trilingual_records/<YYYYMMDD>/`。
    *   文件名采用安全化短语 slug + 时间戳，避免同日重复覆盖（如 `take_a_rain_check_20250129_235959.html`）。
6.  **反馈**: 前端收到成功响应，自动刷新列表并打开新生成的卡片。

## 3. 详细实现规范

### 3.1 目录结构变更
```text
/app
├── codex_prompt/
│   └── phrase_3LANS_html.md  <-- 核心 Prompt 模板
├── services/
│   ├── geminiService.js      <-- 封装 Gemini 调用
│   ├── ttsService.js         <-- 封装 TTS 容器调用
│   └── fileManager.js        <-- 文件路径与读写管理
├── server.js                 <-- 新增 /api/generate 路由
└── public/
    ├── index.html            <-- 新增输入框与生成按钮
    └── main.js               <-- 新增生成逻辑交互
```

### 3.2 外部 TTS 容器接口规范 (Phase 2)
后端将按语言路由到不同 TTS 容器：

**英文：Piper HTTP（单次 POST）**
**POST** `http://tts-en:5002/api/tts`
**Content-Type**: `application/json`

**Request Body**:
```json
{
  "text": "Could we take a rain check?",
  "voice": "en_US-amy",
  "speed": 1.0
}
```

**Response**: 音频二进制流 (audio/wav)

**日文：VOICEVOX Engine（两步）**
1) **POST** `http://tts-ja:50021/audio_query?text=...&speaker=2`  
2) **POST** `http://tts-ja:50021/synthesis?speaker=2`（Body 为上一步返回的 JSON）

**Response**: 音频二进制流 (audio/wav)

### 3.3 Prompt 设计策略 (Code as Prompt)
Prompt 将不仅仅是生成文本，我们将要求 Gemini 返回 **JSON 格式** 的结构化数据，以便程序处理。

**Prompt 尾部追加指令**:
> 请不要只输出 Markdown，你需要以 JSON 格式输出，结构如下：
> ```json
> {
>   "markdown_content": "...",
>   "html_content": "...",
>   "audio_tasks": [
>     { "text": "英文例句1...", "lang": "en", "filename_suffix": "_en_1" },
>     { "text": "日文例句1...", "lang": "ja", "filename_suffix": "_ja_1" }
>   ]
> }
> ```
>
> **输出约束补充**：
> - 只允许输出 JSON，不要包含多余文本或代码块标记。
> - `html_content` 必须是 JSON 可解析的字符串（必要时对换行、引号进行转义）。

## 4. 部署与环境

### 4.1 环境变量 (.env)
```bash
# Gemini 配置
GEMINI_API_KEY=AIzaSy...
GEMINI_MODEL=gemini-1.5-flash

# TTS 配置（英文 Piper + 日文 VOICEVOX）
TTS_EN_ENDPOINT=http://tts-en:5002/api/tts
TTS_EN_TYPE=piper
TTS_EN_VOICE=en_US-amy
TTS_EN_SPEED=1.0

TTS_JA_ENDPOINT=http://tts-ja:50021
TTS_JA_TYPE=voicevox
VOICEVOX_SPEAKER=2
```

### 4.2 Docker Compose 更新
将英文/日文 TTS 作为独立容器纳入同一网络：

```yaml
services:
  viewer:
    # ... 原有配置 ...
    environment:
      - TTS_EN_ENDPOINT=http://tts-en:5002/api/tts
      - TTS_EN_TYPE=piper
      - TTS_JA_ENDPOINT=http://tts-ja:50021
      - TTS_JA_TYPE=voicevox

  tts-en:
    image: artibex/piper-http:latest
    ports:
      - "5002:5002"

  tts-ja:
    image: voicevox/voicevox_engine:latest
    ports:
      - "50021:50021"
```

## 5. 开发路线图
1.  **Phase 1 (基础功能)**: 完成 Gemini API 对接，实现 Markdown 和 HTML 的生成与保存。暂不生成音频，HTML 中保留音频占位符。
2.  **Phase 2 (TTS 对接)**: 实现 `ttsService.js`，打通音频生成流程。
3.  **Phase 3 (前端优化)**: 增加生成进度的实时反馈（WebSocket 或 轮询）。

## 6. 安全与质量（Phase 3）
1. **HTML 安全约束**：
   - Prompt 明确禁止 `<script>/<iframe>/<object>/<embed>` 与外链资源。
   - 后端对 `html_content` 做简单校验，发现危险标签则拒绝保存。
2. **预览隔离**：
   - 预览 iframe 添加 `sandbox="allow-same-origin"`，禁止脚本执行。
   - 对 HTML 响应设置 CSP（禁用脚本、对象、外部资源）。
