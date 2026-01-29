# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Trilingual Records Viewer (三语卡片生成系统) - A web application that generates trilingual (Chinese/English/Japanese) learning cards through AI-powered content generation and text-to-speech synthesis. Users input phrases and the system generates comprehensive learning materials with translations, definitions, example sentences, and synchronized audio.

## Commands

**Run locally:**
```bash
npm install
npm start          # Server on port 3010
```

**Docker (recommended):**
```bash
docker compose up -d --build    # Build and start all containers
docker compose ps               # Check status
docker compose logs -f          # Stream logs
docker compose down             # Stop and remove
```

**Test generation endpoint:**
```bash
curl -X POST http://localhost:3010/api/generate \
  -H "Content-Type: application/json" \
  -d '{"phrase":"hello world"}'
```

## Architecture

### Data Flow
```
User Input → Prompt Engine → LLM (Qwen) → JSON Response → HTML Renderer → File Manager → TTS Service → Audio Files
```

### Core Services (services/)

- **promptEngine.js** - Builds LLM prompts from templates in `codex_prompt/`. Replaces `{{ phrase }}` placeholder with user input.
- **geminiService.js** - LLM communication via OpenAI-compatible API. Handles JSON extraction from markdown fences and control character escaping.
- **htmlRenderer.js** - Markdown→HTML conversion using marked.js. Orchestrates Japanese furigana conversion and audio tag injection.
- **japaneseFurigana.js** - Kuroshiro wrapper for kanji→ruby tag conversion. Lazy-loaded singleton.
- **ttsService.js** - Dual TTS: Kokoro (English) and VOICEVOX (Japanese). Processes audio tasks sequentially.
- **fileManager.js** - YYYYMMDD folder organization with duplicate handling via "(2)", "(3)" suffixes.

### API Routes (server.js)

- `POST /api/generate` - Generate trilingual card (4-second rate limit per IP)
- `GET /api/folders` - List date folders
- `GET /api/folders/:folder/files` - List files in folder
- `GET /api/folders/:folder/files/:file` - Get file content

### Frontend (public/)

Vanilla JS with marked.js (markdown) and DOMPurify (XSS sanitization). Grid layout with folder sidebar and file panel.

## Key Conventions

**Prompt templates** (`codex_prompt/`):
- `phrase_3LANS_markdown.md` - Markdown output spec
- `phrase_3LANS_html.md` - HTML output spec
- Templates enforce strict JSON response structure

**LLM Response Structure:**
```json
{
  "markdown_content": "# Phrase\n## 1. English...",
  "html_content": "<!doctype html>...",
  "audio_tasks": [
    { "text": "sentence", "lang": "en", "filename_suffix": "_en_1" }
  ]
}
```

**File naming:** Safe characters only (alphanumeric, space, dash). Conflicts get "(2)", "(3)" suffixes.

**Japanese ruby in markdown:** `kanji(hiragana)` auto-converts to `<ruby>kanji<rt>hiragana</rt></ruby>`

**Security:** HTML validation forbids script/iframe/object/embed tags. CSP headers on HTML responses.

## Environment Variables

See `.env.example`. Key settings:
- `LLM_BASE_URL`, `LLM_MODEL` - Local LLM endpoint (OpenAI-compatible)
- `TTS_EN_ENDPOINT`, `TTS_JA_ENDPOINT` - TTS service endpoints
- `RECORDS_PATH` - Data storage path (default: `/data/trilingual_records`)
- `HTML_RENDER_MODE=local` - Use local markdown rendering

## Docker Services

- **3010**: Web viewer
- **8000**: Kokoro TTS (English)
- **50021**: VOICEVOX (Japanese)

Data volume maps to `/Users/xueguodong/Desktop/trilingual_records`
