# DeepSeek V4 Flash Migration Design

Date: 2026-06-16

## Goal

Replace the current Gemini-based LLM chain with DeepSeek V4 Flash as the only supported runtime LLM provider for generation and knowledge-analysis tasks.

The migration must remove Gemini CLI, Gemini proxy, Gemini gateway, Gemini auth setup, Gemini health checks, Gemini-facing frontend copy, and Gemini-specific tests. New generation tasks should use `deepseek-v4-flash` through DeepSeek's OpenAI-compatible chat-completions API.

## Decision

Use **option B: completely delete the Gemini chain**.

The Gemini CLI dependency is being retired, so the application should not keep Gemini as a fallback path. Keeping a dormant fallback would keep obsolete health checks, container services, UI setup paths, and tests alive, which would make future failures harder to diagnose.

## External API Contract

DeepSeek's official API documentation describes an OpenAI-compatible API surface:

- Base URL: `https://api.deepseek.com`
- Chat completion endpoint: `POST /chat/completions`
- Target model: `deepseek-v4-flash`
- JSON output is supported through `response_format`

The implementation should use these configuration keys:

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`, defaulting to `https://api.deepseek.com`
- `DEEPSEEK_MODEL`, defaulting to `deepseek-v4-flash`
- `DEEPSEEK_TIMEOUT_MS`, defaulting to the current generation timeout policy
- `DEEPSEEK_THINKING`, defaulting to `disabled` for predictable card output

The real API key must never be committed to the repository. `.env.example` and docs may mention the variable name but must use placeholders only.

References:

- <https://api-docs.deepseek.com/>
- <https://api-docs.deepseek.com/api/create-chat-completion>
- <https://api-docs.deepseek.com/quick_start/pricing>

## Scope

In scope:

- Runtime card generation.
- Scenario expression card generation.
- Knowledge local analysis tasks that currently call Gemini.
- Queue metadata and generation job defaults.
- Health checks.
- Docker Compose service graph.
- Frontend setup/status/error copy.
- Unit, integration, and E2E tests.
- Operational docs and `.env.example`.

Out of scope:

- Rewriting the card renderer, TTS pipeline, or storage layer.
- Migrating historical database rows that already say `llm_provider='gemini'`.
- Adding a second LLM provider abstraction for future vendors.
- Building a DeepSeek admin console or key-management UI.

Historical records may still display their stored provider value. The application should stop creating new Gemini records.

## Architecture

The application keeps its existing generation flow:

`frontend -> /api/generation-jobs -> worker -> /api/generate -> markdown/html rendering -> file and DB save`

Only the LLM execution segment changes:

`cardGenerationService -> deepseekService -> DeepSeek /chat/completions`

`deepseekService` is responsible for HTTP request construction, timeout handling, JSON parsing, response extraction, and mapping provider failures into the existing retry/error categories.

The generation pipeline should continue to validate model output before saving. Gemini-named validation helpers should be renamed to provider-neutral names where practical, such as `validateSanitizedCardResponse`, so the remaining code does not contain obsolete Gemini concepts.

## Backend Changes

### Configuration

`lib/serverConfig.js` should make DeepSeek the only normalized runtime provider:

- `DEFAULT_LLM_PROVIDER = 'deepseek'`
- `DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash'`
- `normalizeLlmProvider()` returns `deepseek`
- Gemini model sanitizers and resolvers are removed or replaced with DeepSeek equivalents

New generation and job defaults should write `llm_provider='deepseek'` and `llm_model='deepseek-v4-flash'`.

### LLM Service

Create `services/llm/deepseekService.js`.

Responsibilities:

- Build `POST /chat/completions` requests.
- Send `Authorization: Bearer ${DEEPSEEK_API_KEY}`.
- Use `model: deepseek-v4-flash` by default.
- Support Markdown and JSON response modes.
- Pass `response_format: { "type": "json_object" }` only for JSON-mode calls.
- Disable thinking output by default when supported by the API configuration.
- Extract `choices[0].message.content`.
- Return provider-neutral metadata such as provider, model, elapsed time, and token usage when present.

Remove these Gemini-only services when no longer referenced:

- `services/llm/geminiCliService.js`
- `services/llm/geminiProxyService.js`
- `services/llm/geminiGatewayServer.js`
- `services/llm/geminiAuthService.js`
- `services/llm/geminiProcessUtils.js`
- `services/llm/geminiTimeouts.js`
- `services/llm/geminiErrors.js`
- `services/llm/geminiService.js`

If shared timeout or error helpers are still useful, rename them to provider-neutral filenames before reuse.

### Generation Service

`services/generation/cardGenerationService.js` should no longer branch between Gemini CLI, Gemini proxy, and Gemini API modes. It should call DeepSeek through a single service path.

Required behavior:

- Preserve current prompt generation and output validation.
- Preserve current audio task generation and TTS behavior.
- Preserve scenario-expression support added on the current base branch.
- Do not save partial cards when DeepSeek output fails validation.
- Keep E2E fixture mode deterministic and local.

### Knowledge Tasks

Knowledge-analysis jobs that currently use Gemini execution should switch to DeepSeek:

- `services/knowledge/tasks/cluster.js`
- `services/knowledge/tasks/synonymBoundary.js`

The env fallback chain should become:

- `KNOWLEDGE_CLUSTER_MODEL || DEEPSEEK_MODEL || deepseek-v4-flash`
- `KNOWLEDGE_SYNONYM_MODEL || DEEPSEEK_MODEL || deepseek-v4-flash`

Gemini proxy-specific options should be removed from those tasks.

### Health Routes

Remove Gemini setup/auth endpoints:

- `/api/gemini/auth/status`
- `/api/gemini/auth/start`
- `/api/gemini/auth/submit`
- `/api/gemini/auth/cancel`

Health should report DeepSeek API configuration and reachability instead of Gemini gateway and host executor status.

Recommended service name:

- `DeepSeek API`

If `DEEPSEEK_API_KEY` is missing, health should report the service as unavailable with a clear configuration message. It should not attempt a live provider call without a key.

### Docker

`docker-compose.yml` should remove:

- `gemini-proxy` service
- `viewer.depends_on.gemini-proxy`
- `GEMINI_MODE`
- `GEMINI_PROXY_URL`
- `GEMINI_PROXY_*`
- `GEMINI_HOST_EXECUTOR_URL`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`

`viewer` should receive DeepSeek configuration through environment variables:

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_MODEL`
- `DEEPSEEK_TIMEOUT_MS`

Delete `Dockerfile.gemini-gateway` and Gemini infra scripts if no remaining command references them.

## Frontend Changes

The frontend should remove Gemini-specific setup UX and copy:

- Gemini auth/setup modal.
- Gemini Host Executor and Gemini Gateway warning text.
- Gemini model labels.
- API client helpers for `/api/gemini/auth/*`.

Replace user-facing status with DeepSeek wording:

- Teacher model: `DeepSeek V4 Flash`
- Unconfigured state: `DeepSeek API key is not configured`
- Unreachable state: `DeepSeek API unavailable`

The scenario expression card UI from the base feature branch remains unchanged, except that generation is powered by DeepSeek.

## Error Handling

Provider errors should be mapped into stable application categories:

- Missing API key: non-retryable configuration error.
- HTTP 400/401/403: non-retryable provider request/auth error.
- HTTP 408/429/500/502/503/504: retryable provider capacity or availability error.
- Network timeout: retryable timeout error.
- Empty `choices[0].message.content`: non-retryable invalid provider response.
- Invalid generated Markdown/JSON: non-retryable validation error, do not save.

Existing retry/backoff behavior should be preserved where it already protects queue execution.

## Testing Plan

Unit tests:

- DeepSeek service builds request body, headers, model, timeout, and JSON response format.
- DeepSeek service extracts content and token metadata.
- DeepSeek service maps 4xx, 429, 5xx, timeout, and empty response cases.
- Server config defaults to DeepSeek and rejects Gemini as a normalized provider.
- Generation helpers no longer expose Gemini-named validation APIs.
- Knowledge task model fallback uses DeepSeek variables.

Integration tests:

- `/api/generate` persists `llm_provider='deepseek'`.
- Generation jobs default to DeepSeek metadata.
- `/api/health` reports DeepSeek API status and no Gemini services.
- Removed Gemini auth routes return 404.

E2E tests:

- Home page no longer shows Gemini setup or Gemini host/gateway warnings.
- Teacher model label shows DeepSeek V4 Flash.
- Scenario expression generation still opens a learning card.
- Queue detail and generation history show DeepSeek metadata where visible.

Regression commands:

- `npm run lint`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:e2e`
- `docker compose up -d --force-recreate --build`
- `curl -fsS http://127.0.0.1:3010/api/health`
- `curl -fsS http://127.0.0.1:3010/knowledge-hub.html`

## Acceptance Criteria

- No runtime code path starts or calls Gemini CLI.
- No Docker service named `gemini-proxy` remains.
- No frontend setup flow asks the user to authenticate Gemini.
- New generation jobs use `llm_provider='deepseek'`.
- Default model is `deepseek-v4-flash`.
- Missing DeepSeek key produces a clear configuration error.
- Scenario expression cards still generate, render, and play audio in E2E fixture mode.
- Full lint, unit, integration, E2E, and container rebuild checks pass.
- The repository contains no committed DeepSeek API key.

## Self-Review Notes

- No Gemini fallback is retained.
- Historical Gemini database rows are allowed only as stored history.
- The scope is one migration layer, not a general provider plugin architecture.
- The real DeepSeek key is intentionally excluded from all committed files.
