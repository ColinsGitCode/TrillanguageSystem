# Scenario Expression Card Design

Date: 2026-06-16

## Goal

Add a new learning-card feature that generates common expressions for a specific real-world scenario. The long-term direction is a scenario card that can contain both common expressions and sample dialogue. The first implementation must land the simpler and more stable subset: a scenario expression card.

The user enters one natural-language scenario description, such as:

`保育园早上送孩子，跟老师说明昨晚有点咳嗽`

The system generates one saved learning card containing 12 reusable Chinese / English / Japanese expressions. Japanese text must support ruby annotation and English/Japanese lines must support the existing audio playback flow.

## MVP Scope

The first version adds a third card type:

- Internal `card_type`: `scenario_phrase`
- UI label: `场景表达`
- Card label: `场景表达卡`
- Modal metadata label: `SCENARIO EXPRESSIONS`

The card is generated from one natural-language scenario description. No structured form is introduced in the first version.

The generated card contains:

1. Scenario title.
2. Scenario summary:
   - role relationship, such as `家长 → 老师`
   - tone, such as `礼貌、简洁、自然`
   - purpose, such as `告知孩子状态，并请求观察`
3. Exactly 12 common expressions.
4. For each expression:
   - Chinese meaning
   - English expression
   - Japanese expression with explicit `漢字(かな)` readings where needed
   - short usage note
   - English audio task
   - Japanese audio task

## Explicit Non-Goals

The MVP does not include:

- Full scenario dialogue generation.
- A dedicated Scenario page.
- A new Scenario-specific database table.
- Per-expression structured persistence.
- Knowledge Hub indexing for `scenario_phrase`.
- SRS/review queue integration for `scenario_phrase`.
- Automatic rejection of broad scenarios such as `旅游`.

These are left out because scenario expression cards have a different review grain from ordinary phrase cards. The first version should prove the generation, ruby, audio, save, list, and modal path before deciding whether review should happen at card level or expression level.

## Recommended Approach

Use the existing generation pipeline and add `scenario_phrase` as a first-class card type.

Current card types are `trilingual` and `grammar_ja`. The new type should be handled by the same card-type normalization, generation queue, prompt routing, file saving, DB insert, history listing, file listing, and modal rendering surfaces.

This approach keeps the blast radius controlled:

- Existing `/api/generation-jobs` remains the queue entry point.
- Existing `/api/generate` remains the generation executor.
- Existing Markdown-to-HTML renderer keeps ruby and audio injection centralized.
- Existing `generations.card_type` stores the new type.
- Existing card modal remains the display surface.

## Frontend Design

The home generation panel adds a third card type button next to `三语卡片` and `日语语法`.

When selected:

- `store.cardType` becomes `scenario_phrase`.
- `cardTypeHint` shows `场景常用表达`.
- Textarea placeholder becomes:
  `描述一个具体场景，例如：保育园早上送孩子，说明昨晚有点咳嗽...`
- Generate button text becomes `Generate Scenario Card`.
- Queue type label becomes `场景`.
- File-list corner badge becomes `场景卡`.
- Modal card metadata becomes `SCENARIO EXPRESSIONS`.
- Modal content ticker becomes `CARD TYPE · 场景表达卡`.

The first version should not add a new page or a new modal renderer. It should rely on well-structured Markdown rendered inside the current `renderCardModal` content tab.

## Generated Markdown Shape

The scenario prompt must force predictable Markdown so the renderer and tests can inspect it. Recommended shape:

```markdown
# 保育园早上送孩子，说明昨晚有点咳嗽

## 1. 场景说明
- **角色**: 家长 → 老师
- **语气**: 礼貌、简洁、自然
- **目标**: 告知孩子状态，并请求观察

## 2. 常用表达
### 01. 昨晚有点咳嗽
- **中文**: 昨晚有点咳嗽。
- **英文**: He had a slight cough last night.
- **日本語**: 昨夜(さくや)、少(すこ)し咳(せき)が出(で)ました。
- **使用提示**: 轻微症状说明，不需要显得紧急。

### 02. 今天请帮忙观察一下
- **中文**: 今天请帮忙观察一下。
- **英文**: Could you keep an eye on him today?
- **日本語**: 今日(きょう)、少(すこ)し様子(ようす)を見(み)ていただけますか。
- **使用提示**: 对老师或照护者的礼貌请求。
```

The output must continue through `### 12`.

## Audio Task Rules

The scenario card must produce 24 audio tasks:

- English:
  - `_en_1` through `_en_12`
  - extracted from `- **英文**: ...`
  - language `en`
- Japanese:
  - `_ja_1` through `_ja_12`
  - extracted from `- **日本語**: ...`
  - language `ja`

Audio task text must be stripped of markup and ruby annotations before TTS. The existing post-processing and `stripMarkup` behavior should continue to remove `<ruby>`/`<rt>` where present.

The existing renderer injects audio tags based on `audio_tasks`, and the existing client replaces audio tags with playable buttons in the modal.

## Backend Design

Required backend changes:

- `lib/serverConfig.normalizeCardType`
  - Preserve `scenario_phrase` in addition to `grammar_ja`.
  - Continue defaulting unknown values to `trilingual`.
- `services/generation/promptEngine`
  - Add scenario prompt routing for JSON mode and Markdown mode.
  - Add a new Markdown template path:
    `prompts/phrase_scenario_expressions_markdown.md`.
- `services/generation/htmlRenderer.buildAudioTasksFromMarkdown`
  - Keep existing `例句` extraction for `trilingual` and `grammar_ja`.
  - Add extraction for scenario expression sections:
    `- **英文**:` and `- **日本語**:` under numbered `### NN.` blocks.
  - Return deterministic suffixes by expression number.
- `services/fixtures/e2eFixtureService`
  - Add deterministic scenario card fixture Markdown.
  - Include 12 expression blocks.
- `routes/generate`
  - No new route is needed.
  - Existing `card_type` request field should pass through as `scenario_phrase`.
- DB and file saving
  - No schema change is required.
  - `generations.card_type` stores `scenario_phrase`.
  - metadata JSON stores `card_type=scenario_phrase`.

## Knowledge Hub And SRS Behavior

For MVP, `scenario_phrase` cards are saved and visible in file lists/history, but they do not enter Knowledge Hub or SRS.

Implementation should avoid accidentally classifying scenario cards as regular `trilingual` cards. If Knowledge Hub source-card queries include all card types by default, follow-up implementation should either:

- filter `scenario_phrase` out of Knowledge Hub jobs for MVP, or
- leave it unindexed until explicit support exists.

The intended behavior is explicit exclusion from Knowledge Hub/SRS in the first release.

## Error Handling

- If Gemini output has fewer than 12 expression blocks, generation should fail validation and not save a partial card.
- If one or more TTS tasks fail, the card may still be saved, consistent with the existing audio behavior; unavailable audio simply should not create a playable button.
- If Japanese output lacks explicit `漢字(かな)`, the existing Japanese ruby normalizer can still attempt conversion inside the Japanese section.
- If the scenario is too broad, the prompt should ask Gemini to narrow it to a concrete, high-frequency practical scene. UI-level specificity validation is not in MVP.

## Testing Plan

Unit tests:

- `normalizeCardType('scenario_phrase')` returns `scenario_phrase`.
- Unknown card types still normalize to `trilingual`.
- Prompt engine selects the scenario Markdown template.
- `buildAudioTasksFromMarkdown` extracts 24 scenario audio tasks.
- Scenario fixture generates 12 expression blocks.

Integration tests:

- `/api/generate` E2E fixture supports `card_type=scenario_phrase`.
- Generation job persists `job_type=scenario_phrase`.
- History returns records with `card_type=scenario_phrase`.

E2E tests:

- Home page shows the third card type button.
- Selecting scenario type updates hint, placeholder, and generate button text.
- Generating a scenario card creates a file-list entry with `场景卡`.
- Opening the card modal shows `SCENARIO EXPRESSIONS`.
- Content contains 12 expression headings.
- At least one English and one Japanese audio control render.
- Queue panel labels the task as `场景`.

Regression commands:

- `npm run lint`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:e2e`

## Acceptance Criteria

- A user can enter one natural-language scenario and generate a saved scenario expression card.
- The card contains exactly 12 common expressions.
- Each expression has Chinese, English, Japanese, and a usage note.
- Japanese text displays ruby annotation after rendering.
- English and Japanese expressions use the existing audio playback chain.
- The card appears in file list and history with a scenario-specific label.
- The card opens in the existing learning-card modal.
- The card is not included in Knowledge Hub or SRS in MVP.
- The full automated test suite passes.
- Rebuilt containers serve the updated UI successfully.
