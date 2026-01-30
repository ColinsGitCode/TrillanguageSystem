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
User Input → Prompt Engine (CoT + Few-shot) → LLM (Gemini API) → JSON Response → HTML Renderer → File Manager → TTS Service → Audio Files
```

### Core Services (services/)

- **promptEngine.js** - Builds optimized LLM prompts with Chain of Thought reasoning, Few-shot examples, and quality standards. Implements complete prompt engineering optimization for accurate translations and natural example sentences.
- **geminiService.js** - Gemini API communication with native API format. Supports both text generation and multimodal OCR. Handles JSON extraction from markdown fences and control character escaping.
- **htmlRenderer.js** - Markdown→HTML conversion using marked.js. Orchestrates Japanese furigana conversion and audio tag injection.
- **japaneseFurigana.js** - Kuroshiro wrapper for kanji→ruby tag conversion. Lazy-loaded singleton.
- **ttsService.js** - Dual TTS: Kokoro (English) and VOICEVOX (Japanese). Processes audio tasks sequentially.
- **fileManager.js** - YYYYMMDD folder organization with duplicate handling via "(2)", "(3)" suffixes.

### API Routes (server.js)

- `POST /api/generate` - Generate trilingual card (4-second rate limit per IP)
- `POST /api/ocr` - OCR image recognition using Gemini Vision API
- `GET /api/folders` - List date folders
- `GET /api/folders/:folder/files` - List files in folder
- `GET /api/folders/:folder/files/:file` - Get file content

### Frontend (public/)

Vanilla JS with marked.js (markdown) and DOMPurify (XSS sanitization). Grid layout with folder sidebar and file panel.

## Key Conventions

**Prompt Engineering** (services/promptEngine.js):
- Implements Chain of Thought (CoT) 5-step reasoning process
- Includes 3 Few-shot examples: daily vocabulary, technical terms, ambiguous words
- Enforces example sentence quality standards (5 dimensions: authenticity, length, difficulty, naturalness, diversity)
- Handles polysemy disambiguation and context understanding
- Built-in quality self-check mechanism

**Legacy templates** (`codex_prompt/`):
- `phrase_3LANS_markdown.md` - Original Markdown output spec (deprecated, kept for reference)
- `phrase_3LANS_html.md` - Original HTML output spec (deprecated, kept for reference)
- Current system uses programmatic prompt generation in promptEngine.js

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

**Gemini API (Current):**
- `GEMINI_API_KEY` - Get from https://aistudio.google.com/app/apikey
- `GEMINI_MODEL` - Model selection (default: `gemini-1.5-flash-latest`)
- `GEMINI_BASE_URL` - API endpoint (default: Google's official endpoint)
- `LLM_MAX_TOKENS` - Max output tokens (recommended: 2048 for full optimization)
- `LLM_TEMPERATURE` - Randomness control (recommended: 0.2)

**Local LLM (Archived):**
- `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` - Local Qwen endpoint (commented out in .env)

**Other:**
- `TTS_EN_ENDPOINT`, `TTS_JA_ENDPOINT` - TTS service endpoints
- `RECORDS_PATH` - Data storage path (default: `/data/trilingual_records`)
- `HTML_RENDER_MODE=local` - Use local markdown rendering

**Gemini Free Tier Quotas:**
- Gemini 1.5 Flash: 15 RPM, 1M TPM, 1,500 RPD
- Single card generation: ~2,500 tokens
- Single OCR: ~1,500 tokens

## Docker Services

- **3010**: Web viewer
- **8000**: Kokoro TTS (English)
- **50021**: VOICEVOX (Japanese)

Data volume maps to `/Users/xueguodong/Desktop/trilingual_records`
