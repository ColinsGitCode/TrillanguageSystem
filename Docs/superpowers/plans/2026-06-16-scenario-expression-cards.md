# Scenario Expression Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `scenario_phrase` card type that generates 12 Chinese / English / Japanese common expressions for one user-described scene, with ruby and audio playback.

**Architecture:** Keep the existing `/api/generation-jobs` -> `/api/generate` -> Markdown render -> file/DB save flow. Add `scenario_phrase` as a first-class card type, add scenario Markdown parsing/validation branches, and update UI labels through a small frontend card-type config instead of scattered conditionals.

**Tech Stack:** Node.js, Express, better-sqlite3, marked, vanilla ES modules, Playwright, Docker Compose.

---

## File Structure

- Modify: `lib/serverConfig.js`
  - Owns server-side card-type normalization.
- Modify: `lib/generationHelpers.js`
  - Owns response validation and Gemini markdown shape validation.
- Modify: `services/generation/htmlRenderer.js`
  - Owns ruby conversion, audio-task extraction, and audio-tag injection.
- Modify: `services/generation/promptEngine.js`
  - Owns card-type prompt routing.
- Create: `prompts/phrase_scenario_expressions_markdown.md`
  - Scenario expression Markdown prompt.
- Modify: `services/fixtures/e2eFixtureService.js`
  - Deterministic scenario fixture for tests and E2E mode.
- Modify: `services/storage/fileManager.js`
  - Preserves scenario metadata for file-list cards.
- Modify: `services/storage/databaseHelpers.js`
  - Preserves scenario card type for `generations.card_type`.
- Modify: `services/storage/db/knowledgeRelations.js`
  - Excludes `scenario_phrase` from Knowledge source-card selection in MVP.
- Modify: `services/storage/db/cardSrs.js`
  - Excludes `scenario_phrase` from SRS queue, stats, and direct review in MVP.
- Modify: `routes/generate.js`
  - Passes card type into validation.
- Modify: `public/index.html`
  - Adds the third card-type button.
- Modify: `public/js/modules/store.js`
  - Updates the documented card-type state comment.
- Modify: `public/js/modules/app.js`
  - Adds frontend card-type config and updates labels, queue, file list, history, and modal metadata.
- Modify: `public/styles.css`
  - Adds three-button selector layout and scenario visual states.
- Modify: `tests/unit/serverConfig.test.js`
  - Tests normalization.
- Modify: `tests/unit/generationHelpers.test.js`
  - Tests scenario validation.
- Modify: `tests/unit/htmlRenderer.test.js`
  - Tests scenario audio extraction, ruby cleanup, and audio injection.
- Create: `tests/unit/promptEngine.test.js`
  - Tests scenario prompt routing.
- Modify: `tests/unit/databaseService.test.js`
  - Tests Knowledge/SRS exclusion.
- Modify: `tests/integration/generate.test.js`
  - Tests `/api/generate` scenario persistence in E2E fixture mode.
- Modify: `tests/integration/generationJobs.test.js`
  - Tests queued scenario jobs keep `scenario_phrase`.
- Modify: `tests/e2e/frontend-regression.spec.js`
  - Tests scenario UI selection and generated card display.

---

### Task 1: Preserve `scenario_phrase` In Shared Card-Type Normalization

**Files:**
- Modify: `lib/serverConfig.js`
- Modify: `tests/unit/serverConfig.test.js`

- [ ] **Step 1: Write the failing normalization test**

Add this case inside `test.describe('serverConfig.normalizeCardType', ...)` in `tests/unit/serverConfig.test.js`:

```js
test.it('keeps scenario_phrase', () => {
  assert.equal(cfg.normalizeCardType('scenario_phrase'), 'scenario_phrase');
  assert.equal(cfg.normalizeCardType('  SCENARIO_PHRASE '), 'scenario_phrase');
});
```

- [ ] **Step 2: Run the targeted test and confirm it fails**

Run:

```bash
node --test tests/unit/serverConfig.test.js
```

Expected: the new test fails because `normalizeCardType('scenario_phrase')` currently returns `trilingual`.

- [ ] **Step 3: Implement the shared normalizer**

Replace `normalizeCardType` in `lib/serverConfig.js` with:

```js
const SUPPORTED_CARD_TYPES = new Set(['trilingual', 'grammar_ja', 'scenario_phrase']);

function normalizeCardType(cardType) {
  const normalized = String(cardType || 'trilingual').trim().toLowerCase();
  return SUPPORTED_CARD_TYPES.has(normalized) ? normalized : 'trilingual';
}
```

Export `SUPPORTED_CARD_TYPES` if later tasks need it:

```js
module.exports = {
  PORT,
  RECORDS_PATH,
  DEFAULT_LLM_PROVIDER,
  DEFAULT_GEMINI_MODEL,
  E2E_TEST_MODE,
  SUPPORTED_CARD_TYPES,
  toNumberOr,
  normalizeLlmProvider,
  normalizeCardType,
  normalizeSourceMode,
  sanitizeGeminiModelName,
  resolveGeminiModel,
};
```

- [ ] **Step 4: Run the targeted test and confirm it passes**

Run:

```bash
node --test tests/unit/serverConfig.test.js
```

Expected: all tests in `serverConfig.test.js` pass.

- [ ] **Step 5: Commit**

```bash
git add lib/serverConfig.js tests/unit/serverConfig.test.js
git commit -m "feat: preserve scenario card type"
```

---

### Task 2: Add Scenario Markdown Audio Extraction And Validation

**Files:**
- Modify: `services/generation/htmlRenderer.js`
- Modify: `lib/generationHelpers.js`
- Modify: `tests/unit/htmlRenderer.test.js`
- Modify: `tests/unit/generationHelpers.test.js`

- [ ] **Step 1: Write failing scenario audio tests**

Update the import in `tests/unit/htmlRenderer.test.js`:

```js
const {
  buildAudioTasksFromMarkdown,
  prepareMarkdownForCard
} = require('../../services/generation/htmlRenderer');
```

Add this helper and tests inside `test.describe('buildAudioTasksFromMarkdown', ...)`:

```js
function scenarioMarkdown(count = 12) {
  const blocks = [];
  for (let i = 1; i <= count; i += 1) {
    const n = String(i).padStart(2, '0');
    blocks.push([
      `### ${n}. 今天请帮忙观察一下`,
      '- **中文**: 今天请帮忙观察一下。',
      `- **英文**: Could you keep an eye on him today? ${i}`,
      `- **日本語**: 今日(きょう)、少(すこ)し様子(ようす)を見(み)ていただけますか。${i}`,
      '- **使用提示**: 对老师或照护者的礼貌请求。'
    ].join('\n'));
  }
  return [
    '# 保育园早上送孩子，说明昨晚有点咳嗽',
    '## 1. 场景说明',
    '- **角色**: 家长 → 老师',
    '- **语气**: 礼貌、简洁、自然',
    '- **目标**: 告知孩子状态，并请求观察',
    '## 2. 常用表达',
    blocks.join('\n\n')
  ].join('\n');
}

test.it('extracts 24 scenario expression audio tasks with deterministic suffixes', () => {
  const tasks = buildAudioTasksFromMarkdown(scenarioMarkdown());
  assert.equal(tasks.length, 24);
  assert.deepEqual(
    tasks.slice(0, 4).map((task) => `${task.lang}:${task.filename_suffix}`),
    ['en:_en_1', 'ja:_ja_1', 'en:_en_2', 'ja:_ja_2']
  );
  assert.equal(tasks[23].filename_suffix, '_ja_12');
});

test.it('strips explicit Japanese readings before TTS text is built', () => {
  const jaTask = buildAudioTasksFromMarkdown(scenarioMarkdown())[1];
  assert.equal(jaTask.lang, 'ja');
  assert.ok(!jaTask.text.includes('(きょう)'));
  assert.ok(!jaTask.text.includes('(すこ)'));
  assert.match(jaTask.text, /今日、少し様子を見ていただけますか。1/);
});

test.it('injects audio tags into scenario English and Japanese lines', async () => {
  const markdown = scenarioMarkdown(1);
  const audioTasks = buildAudioTasksFromMarkdown(markdown);
  const prepared = await prepareMarkdownForCard(markdown, { baseName: 'scenario-card', audioTasks });
  assert.match(prepared, /scenario-card_en_1\.(mp3|wav|m4a)/);
  assert.match(prepared, /scenario-card_ja_1\.(mp3|wav|m4a)/);
});
```

- [ ] **Step 2: Write failing scenario validation tests**

In `tests/unit/generationHelpers.test.js`, add this helper near the existing `trilingualCard()` helper:

```js
function scenarioCard(count = 12) {
  const blocks = [];
  for (let i = 1; i <= count; i += 1) {
    const n = String(i).padStart(2, '0');
    blocks.push([
      `### ${n}. 表达 ${i}`,
      `- **中文**: 中文表达 ${i}。`,
      `- **英文**: English expression ${i}.`,
      `- **日本語**: 日本語(にほんご)の表現(ひょうげん) ${i}。`,
      `- **使用提示**: 使用提示 ${i}。`
    ].join('\n'));
  }
  return [
    '# 场景标题',
    '## 1. 场景说明',
    '- **角色**: 家长 → 老师',
    '- **语气**: 礼貌、简洁、自然',
    '- **目标**: 告知并请求观察',
    '## 2. 常用表达',
    blocks.join('\n\n')
  ].join('\n');
}
```

Add these tests inside `test.describe('validateGeneratedContent', ...)`:

```js
test.it('accepts a complete scenario_phrase card with 12 expressions', () => {
  assert.deepEqual(
    validateGeneratedContent({ markdown_content: scenarioCard() }, {
      allowMissingHtml: true,
      cardType: 'scenario_phrase'
    }),
    []
  );
});

test.it('rejects a scenario_phrase card with fewer than 12 expressions', () => {
  assert.deepEqual(
    validateGeneratedContent({ markdown_content: scenarioCard(11) }, {
      allowMissingHtml: true,
      cardType: 'scenario_phrase'
    }),
    ['scenario_phrase requires exactly 12 expression blocks']
  );
});
```

Add these tests inside `test.describe('validateSanitizedGeminiCardResponse', ...)`:

```js
test.it('accepts a well-formed scenario_phrase card', () => {
  assert.equal(
    validateSanitizedGeminiCardResponse({ markdown: scenarioCard() }, 'scenario_phrase'),
    true
  );
});

test.it('rejects scenario_phrase markdown with missing expression audio lines', () => {
  const markdown = scenarioCard().replace('- **英文**: English expression 12.', '- **English**: Missing label.');
  assert.equal(
    validateSanitizedGeminiCardResponse({ markdown }, 'scenario_phrase'),
    false
  );
});
```

- [ ] **Step 3: Run targeted tests and confirm they fail**

Run:

```bash
node --test tests/unit/htmlRenderer.test.js tests/unit/generationHelpers.test.js
```

Expected: the scenario tests fail because scenario extraction, audio injection, and validation do not exist yet.

- [ ] **Step 4: Implement scenario audio extraction and audio injection**

In `services/generation/htmlRenderer.js`, add these helpers near `stripMarkup`:

```js
function stripAudioTaskText(text) {
  return stripMarkup(applyExplicitRuby(text));
}

function isScenarioExpressionsHeader(header) {
  return /常用表达|場面表現|シーン表現|scenario expressions/i.test(String(header || ''));
}

function getScenarioLineMatch(line) {
  const match = String(line || '').match(/^\s*-\s*\*\*(英文|日本語)\*\*:\s*(.+)$/);
  if (!match) return null;
  return {
    lang: match[1] === '英文' ? 'en' : 'ja',
    text: match[2]
  };
}
```

Replace `buildAudioTasksFromMarkdown` with:

```js
function buildAudioTasksFromMarkdown(markdown) {
  const tasks = [];
  if (!markdown) return tasks;
  const lines = String(markdown).split(/\r?\n/);
  let currentLang = null;
  let inScenarioExpressions = false;
  let currentScenarioIndex = null;

  lines.forEach((line) => {
    const headerMatch = line.match(/^##\s*\d+\.\s*(.+)\s*$/);
    if (headerMatch) {
      const header = headerMatch[1];
      inScenarioExpressions = isScenarioExpressionsHeader(header);
      currentScenarioIndex = null;
      if (/英文/i.test(header)) currentLang = 'en';
      else if (/日本語|日语/i.test(header)) currentLang = 'ja';
      else currentLang = null;
    }

    if (inScenarioExpressions) {
      const scenarioHeading = line.match(/^###\s*(\d{1,2})\.\s+.+$/);
      if (scenarioHeading) {
        currentScenarioIndex = String(Number(scenarioHeading[1]));
        return;
      }

      const scenarioLine = getScenarioLineMatch(line);
      if (scenarioLine && currentScenarioIndex) {
        const cleanText = stripAudioTaskText(scenarioLine.text);
        if (cleanText) {
          tasks.push({
            text: cleanText,
            lang: scenarioLine.lang,
            filename_suffix: `_${scenarioLine.lang}_${currentScenarioIndex}`,
          });
        }
      }
      return;
    }

    const exampleMatch = line.match(/^\s*-\s*\*\*例句(\d+)\*\*:\s*(.+)$/);
    if (exampleMatch && currentLang) {
      const index = exampleMatch[1];
      const rawText = exampleMatch[2];
      const cleanText = stripAudioTaskText(rawText);
      if (cleanText) {
        tasks.push({
          text: cleanText,
          lang: currentLang,
          filename_suffix: `_${currentLang}_${index}`,
        });
      }
    }
  });
  return tasks;
}
```

Inside `injectAudioTags`, add the same scenario tracking and branch. The final loop body should keep existing `例句` behavior and add this before the `exampleMatch` branch:

```js
    if (headerMatch) {
      const header = headerMatch[1];
      inScenarioExpressions = isScenarioExpressionsHeader(header);
      currentScenarioIndex = null;
      if (/英文/i.test(header)) currentLang = 'en';
      else if (/日本語|日语/i.test(header)) currentLang = 'ja';
      else currentLang = null;
    }

    if (inScenarioExpressions) {
      const scenarioHeading = line.match(/^###\s*(\d{1,2})\.\s+.+$/);
      if (scenarioHeading) {
        currentScenarioIndex = String(Number(scenarioHeading[1]));
        output.push(line);
        return;
      }

      const scenarioLine = getScenarioLineMatch(line);
      if (scenarioLine && currentScenarioIndex) {
        const suffixKey = `${scenarioLine.lang}:${scenarioLine.lang}_${currentScenarioIndex}`;
        const audioMeta = audioMap.get(suffixKey) || {
          suffix: `_${scenarioLine.lang}_${currentScenarioIndex}`,
          extension: getPreferredAudioExtension(scenarioLine.lang),
        };
        output.push(`${line} <audio src="${baseName}${audioMeta.suffix}.${audioMeta.extension}"></audio>`);
        return;
      }
    }
```

Also update `normalizeJapaneseRuby` so scenario lines get ruby even though they are not under a `## 日本語` section. Add this branch before `if (!inJapanese)`:

```js
    const scenarioJapaneseLine = line.match(/^(\s*-\s*\*\*日本語\*\*:\s*)(.+)$/);
    if (scenarioJapaneseLine) {
      if (line.includes('<ruby>') || line.includes('<rt>')) {
        output.push(line);
        continue;
      }
      const content = stripKatakanaReadings(scenarioJapaneseLine[2]);
      const converted = await toRuby(content);
      output.push(`${scenarioJapaneseLine[1]}${converted}`);
      continue;
    }
```

- [ ] **Step 5: Implement scenario validation**

In `lib/generationHelpers.js`, add:

```js
function getScenarioExpressionCount(markdown) {
  return (String(markdown || '').match(/^###\s*\d{1,2}\.\s+.+$/gm) || []).length;
}

function hasScenarioSections(markdown) {
  return markdown.includes('## 1. 场景说明') && markdown.includes('## 2. 常用表达');
}

function validateScenarioMarkdown(markdown) {
  if (!hasScenarioSections(markdown)) return ['scenario_phrase requires 场景说明 and 常用表达 sections'];
  if (getScenarioExpressionCount(markdown) !== 12) return ['scenario_phrase requires exactly 12 expression blocks'];
  const audioTasks = buildAudioTasksFromMarkdown(markdown);
  if (audioTasks.length !== 24) return ['scenario_phrase requires 12 English and 12 Japanese audio lines'];
  return [];
}
```

Update `validateGeneratedContent` after the `markdown_content` empty check:

```js
  const cardType = String(options.cardType || 'trilingual').trim().toLowerCase();
  if (cardType === 'scenario_phrase' && typeof content.markdown_content === 'string') {
    errors.push(...validateScenarioMarkdown(content.markdown_content));
  }
```

Update `validateSanitizedGeminiCardResponse` before the `requiredSections` branch:

```js
  if (cardType === 'scenario_phrase') {
    return validateScenarioMarkdown(markdown).length === 0;
  }
```

- [ ] **Step 6: Run targeted tests and confirm they pass**

Run:

```bash
node --test tests/unit/htmlRenderer.test.js tests/unit/generationHelpers.test.js
```

Expected: all targeted tests pass.

- [ ] **Step 7: Commit**

```bash
git add services/generation/htmlRenderer.js lib/generationHelpers.js tests/unit/htmlRenderer.test.js tests/unit/generationHelpers.test.js
git commit -m "feat: parse scenario expression markdown"
```

---

### Task 3: Add Scenario Prompt Routing

**Files:**
- Modify: `services/generation/promptEngine.js`
- Create: `prompts/phrase_scenario_expressions_markdown.md`
- Create: `tests/unit/promptEngine.test.js`

- [ ] **Step 1: Write failing prompt routing tests**

Create `tests/unit/promptEngine.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPrompt, buildMarkdownPrompt } = require('../../services/generation/promptEngine');

test.describe('promptEngine scenario_phrase routing', () => {
  test.it('buildMarkdownPrompt uses the scenario expression template', () => {
    const prompt = buildMarkdownPrompt({
      phrase: '保育园早上送孩子，说明昨晚有点咳嗽',
      cardType: 'scenario_phrase'
    });
    assert.match(prompt, /场景表达卡/);
    assert.match(prompt, /## 2\. 常用表达/);
    assert.match(prompt, /### 12\./);
    assert.match(prompt, /保育园早上送孩子/);
  });

  test.it('buildPrompt JSON mode requests scenario_phrase JSON with 24 audio tasks', () => {
    const prompt = buildPrompt({
      phrase: '保育园早上送孩子，说明昨晚有点咳嗽',
      filenameBase: 'scenario-fixture',
      cardType: 'scenario_phrase'
    });
    assert.match(prompt, /场景表达卡/);
    assert.match(prompt, /12 个常用表达/);
    assert.match(prompt, /_en_12/);
    assert.match(prompt, /_ja_12/);
  });
});
```

- [ ] **Step 2: Run the targeted test and confirm it fails**

Run:

```bash
node --test tests/unit/promptEngine.test.js
```

Expected: the file fails because no scenario template or JSON prompt branch exists.

- [ ] **Step 3: Add Markdown prompt template**

Create `prompts/phrase_scenario_expressions_markdown.md`:

```markdown
你是中英日三语场景表达卡生成器。

输入场景: "{{ phrase }}"

只输出 Markdown，不要输出 JSON，不要输出额外解释。

必须生成一张“场景表达卡”，用于真实生活中的高频表达学习。

严格结构:

# 一个自然、具体、简短的场景标题

## 1. 场景说明
- **角色**: 写出说话关系，例如 家长 → 老师
- **语气**: 写出语气，例如 礼貌、简洁、自然
- **目标**: 写出沟通目的

## 2. 常用表达

### 01. 表达标题
- **中文**: 中文表达。
- **英文**: Natural English expression.
- **日本語**: 自然な日本語(にほんご)表現(ひょうげん)。
- **使用提示**: 用中文说明什么时候使用。

继续输出到:

### 12. 表达标题
- **中文**: 中文表达。
- **英文**: Natural English expression.
- **日本語**: 自然な日本語(にほんご)表現(ひょうげん)。
- **使用提示**: 用中文说明什么时候使用。

内容要求:
- 必须正好输出 12 个表达块，编号从 01 到 12。
- 每个表达块必须包含中文、英文、日本語、使用提示四行。
- 英文必须自然、口语可用。
- 日本語必须自然、礼貌，并给汉字加显式读音，格式为 漢字(かな)。
- 纯片假名外来词不要加读音。
- 不要输出 <ruby> 标签。
- 如果输入场景过宽，先在标题和表达内容中收敛成一个具体高频场景。
- 禁止输出 <script>、<iframe>、<object>、<embed>。
```

- [ ] **Step 4: Implement prompt routing**

In `services/generation/promptEngine.js`, add a JSON branch before the grammar branch:

```js
    if (cardType === 'scenario_phrase') {
        return `你是中英日三语场景表达卡生成器。
输入场景: "${phrase}"
文件名基础: "${filenameBase}"

严格要求:
1) 只输出有效 JSON，不要任何额外文本。
2) markdown_content 必须为 Markdown，必须生成一张场景表达卡，包含:
# 场景标题
## 1. 场景说明
- **角色**: ...
- **语气**: ...
- **目标**: ...
## 2. 常用表达
### 01. ...
- **中文**: ...
- **英文**: ...
- **日本語**: ...
- **使用提示**: ...
一直输出到 ### 12.
3) 必须正好输出 12 个常用表达块，每个表达块必须有中文、英文、日本語、使用提示。
4) 日本語必须自然、礼貌，并给汉字加显式读音，格式为 漢字(かな)；纯片假名外来词不要加读音；不要输出 <ruby> 标签。
5) audio_tasks 必须含 24 项，filename_suffix 固定为 _en_1 到 _en_12、_ja_1 到 _ja_12；text 必须去掉读音括号和 markdown。
6) JSON 转义: markdown_content 换行用 \\n，双引号用 \\"。
禁止: <script>/<iframe>/<object>/<embed>。

JSON 结构:
{
  "markdown_content": "...",
  "audio_tasks": [
    { "text": "...", "lang": "en", "filename_suffix": "_en_1" },
    { "text": "...", "lang": "ja", "filename_suffix": "_ja_1" },
    { "text": "...", "lang": "en", "filename_suffix": "_en_2" },
    { "text": "...", "lang": "ja", "filename_suffix": "_ja_2" },
    { "text": "...", "lang": "en", "filename_suffix": "_en_12" },
    { "text": "...", "lang": "ja", "filename_suffix": "_ja_12" }
  ]
}`;
    }
```

Then update `buildMarkdownPrompt` template selection:

```js
    const templatePath = cardType === 'grammar_ja'
        ? (process.env.GRAMMAR_MARKDOWN_PROMPT_PATH || path.join(__dirname, '..', '..', 'prompts', 'phrase_ja_grammar_markdown.md'))
        : cardType === 'scenario_phrase'
            ? (process.env.SCENARIO_MARKDOWN_PROMPT_PATH || path.join(__dirname, '..', '..', 'prompts', 'phrase_scenario_expressions_markdown.md'))
            : (process.env.MARKDOWN_PROMPT_PATH || path.join(__dirname, '..', '..', 'prompts', 'phrase_3LANS_markdown.md'));
```

Update the fallback template:

```js
        template = cardType === 'grammar_ja'
            ? `你是日语语法学习卡片生成器。\n输入内容: "{{ phrase }}"\n\n只输出 Markdown，不要输出 JSON 或额外解释。`
            : cardType === 'scenario_phrase'
                ? `你是中英日三语场景表达卡生成器。\n输入场景: "{{ phrase }}"\n\n只输出 Markdown，生成正好 12 个场景常用表达。`
                : `你是中英日三语学习卡片生成器。\n输入短语: "{{ phrase }}"\n\n只输出 Markdown，不要输出 JSON 或额外解释。`;
```

- [ ] **Step 5: Run the targeted test and confirm it passes**

Run:

```bash
node --test tests/unit/promptEngine.test.js
```

Expected: all promptEngine tests pass.

- [ ] **Step 6: Commit**

```bash
git add services/generation/promptEngine.js prompts/phrase_scenario_expressions_markdown.md tests/unit/promptEngine.test.js
git commit -m "feat: route scenario expression prompts"
```

---

### Task 4: Add Scenario Fixture, Route Validation, And Persistence

**Files:**
- Modify: `services/fixtures/e2eFixtureService.js`
- Modify: `routes/generate.js`
- Modify: `services/storage/fileManager.js`
- Modify: `services/storage/databaseHelpers.js`
- Modify: `tests/integration/generate.test.js`
- Modify: `tests/integration/generationJobs.test.js`

- [ ] **Step 1: Write failing integration tests for scenario generation**

Add this test inside `tests/integration/generate.test.js`:

```js
test.it('generates and persists a scenario_phrase card through the E2E fixture', async () => {
  const res = await api('POST', '/api/generate', {
    headers: { 'X-Generation-Job-Worker': '1' },
    body: {
      phrase: '保育园早上送孩子，说明昨晚有点咳嗽',
      card_type: 'scenario_phrase'
    }
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.card_type, 'scenario_phrase');
  assert.equal(res.body.llm_output.audio_tasks.length, 24);
  assert.equal(
    (res.body.llm_output.markdown_content.match(/^###\s+\d{2}\./gm) || []).length,
    12
  );

  const hist = await api('GET', '/api/history?page=1&limit=10');
  assert.equal(hist.status, 200);
  const found = hist.body.records.find((r) => r.id === res.body.generationId);
  assert.ok(found, 'scenario generation should appear in history');
  assert.equal(found.card_type, 'scenario_phrase');
});
```

Add this test inside `tests/integration/generationJobs.test.js`:

```js
test.it('POST preserves scenario_phrase job type', async () => {
  const created = await api('POST', '/api/generation-jobs', {
    body: {
      phrase: '机场值机时询问行李额度',
      card_type: 'scenario_phrase'
    }
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.job.jobType, 'scenario_phrase');

  const detail = await api('GET', `/api/generation-jobs/${created.body.job.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.job.jobType, 'scenario_phrase');
});
```

- [ ] **Step 2: Run integration tests and confirm they fail**

Run:

```bash
node --test tests/integration/generate.test.js tests/integration/generationJobs.test.js
```

Expected: scenario fixture and persistence assertions fail because the fixture and metadata helpers still collapse the type.

- [ ] **Step 3: Add scenario fixture Markdown**

In `services/fixtures/e2eFixtureService.js`, add:

```js
function buildScenarioMarkdown(phrase) {
  const safePhrase = escapeMarkdownText(phrase);
  const blocks = [];
  for (let i = 1; i <= 12; i += 1) {
    const n = String(i).padStart(2, '0');
    blocks.push([
      `### ${n}. 今天请帮忙观察一下 ${i}`,
      `- **中文**: 今天请帮忙观察一下。`,
      `- **英文**: Could you keep an eye on him today? ${i}`,
      `- **日本語**: 今日(きょう)、少(すこ)し様子(ようす)を見(み)ていただけますか。${i}`,
      `- **使用提示**: 适合在“${safePhrase}”这个场景下礼貌请求对方留意。`
    ].join('\n'));
  }
  return `# ${safePhrase}

## 1. 场景说明
- **角色**: 家长 → 老师
- **语气**: 礼貌、简洁、自然
- **目标**: 告知孩子状态，并请求观察

## 2. 常用表达
${blocks.join('\n\n')}
`;
}
```

Update `buildFixtureContent`:

```js
function buildFixtureContent({ phrase, cardType }) {
  const normalizedType = String(cardType || '').trim().toLowerCase();
  const markdownContent = normalizedType === 'grammar_ja'
    ? buildGrammarMarkdown(phrase)
    : normalizedType === 'scenario_phrase'
      ? buildScenarioMarkdown(phrase)
      : buildTrilingualMarkdown(phrase);
  return {
    markdown_content: markdownContent,
    html_content: '',
    audio_tasks: []
  };
}
```

- [ ] **Step 4: Preserve scenario metadata in files and DB helpers**

In `services/storage/fileManager.js`, require the normalizer:

```js
const { normalizeCardType } = require('../../lib/serverConfig');
```

Update `getDisplayMeta`:

```js
    const cardType = normalizeCardType(meta?.cardType || 'trilingual');
```

Update `saveGeneratedFiles`:

```js
    const cardType = normalizeCardType(options.cardType || 'trilingual');
```

In `services/storage/databaseHelpers.js`, require and use the normalizer:

```js
const { normalizeCardType } = require('../../lib/serverConfig');
```

Replace the `normalizedCardType` calculation:

```js
  const normalizedCardType = normalizeCardType(cardType);
```

- [ ] **Step 5: Pass card type into route validation**

In `routes/generate.js`, replace:

```js
    const validationErrors = validateGeneratedContent(content, { allowMissingHtml: true });
```

with:

```js
    const validationErrors = validateGeneratedContent(content, { allowMissingHtml: true, cardType });
```

- [ ] **Step 6: Run integration tests and confirm they pass**

Run:

```bash
node --test tests/integration/generate.test.js tests/integration/generationJobs.test.js
```

Expected: all targeted integration tests pass.

- [ ] **Step 7: Commit**

```bash
git add services/fixtures/e2eFixtureService.js routes/generate.js services/storage/fileManager.js services/storage/databaseHelpers.js tests/integration/generate.test.js tests/integration/generationJobs.test.js
git commit -m "feat: persist scenario expression cards"
```

---

### Task 5: Exclude Scenario Cards From Knowledge Hub And SRS MVP Paths

**Files:**
- Modify: `services/storage/db/knowledgeRelations.js`
- Modify: `services/storage/db/cardSrs.js`
- Modify: `tests/unit/databaseService.test.js`

- [ ] **Step 1: Write failing Knowledge exclusion test**

Extend the existing `getKnowledgeSourceCards filters by folderFrom/folderTo + cardTypes + limit` test in `tests/unit/databaseService.test.js`:

```js
      newGenId(db, { folderName: '20260401', cardType: 'scenario_phrase', requestId: 'rid_src_scenario' });

      const all = db.getKnowledgeSourceCards({});
      assert.equal(all.length, 3);
      assert.ok(all.every((row) => row.card_type !== 'scenario_phrase'));

      const scenarioOnly = db.getKnowledgeSourceCards({ cardTypes: ['scenario_phrase'] });
      assert.equal(scenarioOnly.length, 0);
```

Keep the existing `ranged`, `onlyTri`, and `limited` assertions after this block.

- [ ] **Step 2: Write failing SRS exclusion tests**

Add this test inside `test.describe('databaseService — card_srs (spaced repetition)', ...)`:

```js
test.it('excludes scenario_phrase cards from MVP SRS queue, stats, and review', () => {
  const db = freshDb();
  try {
    const tri = newGenId(db, { phrase: 'tri', baseFilename: 'tri', cardType: 'trilingual', requestId: 'rid_srs_tri' });
    const scenario = newGenId(db, { phrase: 'scenario', baseFilename: 'scenario', cardType: 'scenario_phrase', requestId: 'rid_srs_scenario' });

    const queue = db.getSrsQueue({ limit: 50 });
    assert.deepEqual(queue.map((card) => card.generationId), [tri]);

    const stats = db.getSrsStats();
    assert.equal(stats.newCount, 1);

    assert.equal(db.reviewCardSrs(scenario, 'good'), null);
    assert.equal(db.getCardSrsState(scenario), null);
  } finally { db.close(); }
});
```

- [ ] **Step 3: Run targeted database tests and confirm they fail**

Run:

```bash
node --test tests/unit/databaseService.test.js
```

Expected: the new assertions fail because Knowledge and SRS include every generation by default.

- [ ] **Step 4: Implement Knowledge exclusion**

In `services/storage/db/knowledgeRelations.js`, add:

```js
const KNOWLEDGE_SUPPORTED_CARD_TYPES = ['trilingual', 'grammar_ja'];

function normalizeKnowledgeCardTypes(cardTypes) {
  const requested = Array.isArray(cardTypes) && cardTypes.length > 0
    ? cardTypes
    : KNOWLEDGE_SUPPORTED_CARD_TYPES;
  return requested
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => KNOWLEDGE_SUPPORTED_CARD_TYPES.includes(value));
}
```

Replace the current `if (Array.isArray(scope.cardTypes) && scope.cardTypes.length > 0)` block with:

```js
  const cardTypes = normalizeKnowledgeCardTypes(scope.cardTypes);
  if (!cardTypes.length) return [];
  const placeholders = cardTypes.map((_, idx) => `@cardType${idx}`);
  cardTypes.forEach((value, idx) => {
    params[`cardType${idx}`] = value;
  });
  conditions.push(`g.card_type IN (${placeholders.join(', ')})`);
```

- [ ] **Step 5: Implement SRS exclusion**

In `services/storage/db/cardSrs.js`, add:

```js
const SRS_SUPPORTED_CARD_TYPES = ['trilingual', 'grammar_ja'];

function normalizeSrsCardType(cardType) {
  const ct = String(cardType || '').trim().toLowerCase();
  if (!ct || ct === 'all') return '';
  return SRS_SUPPORTED_CARD_TYPES.includes(ct) ? ct : '__unsupported__';
}
```

Update `review` to fetch and check the card type:

```js
  const gen = db.prepare('SELECT id, card_type FROM generations WHERE id = ?').get(gid);
  if (!gen || !SRS_SUPPORTED_CARD_TYPES.includes(String(gen.card_type || '').toLowerCase())) return null;
```

Update `getQueue`:

```js
  const ct = normalizeSrsCardType(cardType);
  const where = ["(s.id IS NULL OR s.due_date <= date('now'))"];
  const params = { limit: safeLimit };
  if (ct === '__unsupported__') return [];
  if (ct) {
    where.push('lower(g.card_type) = @cardType');
    params.cardType = ct;
  } else {
    where.push(`lower(g.card_type) IN ('trilingual', 'grammar_ja')`);
  }
```

Update `getStats` so `new_count` ignores scenario cards:

```js
      (SELECT COUNT(*) FROM generations g
       WHERE lower(g.card_type) IN ('trilingual', 'grammar_ja')
       AND NOT EXISTS (SELECT 1 FROM card_srs s WHERE s.generation_id = g.id)) AS new_count,
```

- [ ] **Step 6: Run targeted database tests and confirm they pass**

Run:

```bash
node --test tests/unit/databaseService.test.js
```

Expected: all database tests pass.

- [ ] **Step 7: Commit**

```bash
git add services/storage/db/knowledgeRelations.js services/storage/db/cardSrs.js tests/unit/databaseService.test.js
git commit -m "feat: exclude scenario cards from review indexes"
```

---

### Task 6: Add Frontend Scenario Type Selection And Labels

**Files:**
- Modify: `public/index.html`
- Modify: `public/js/modules/store.js`
- Modify: `public/js/modules/app.js`
- Modify: `public/styles.css`

- [ ] **Step 1: Add the third selector button**

In `public/index.html`, change:

```html
<div class="selector-buttons selector-buttons-two">
```

to:

```html
<div class="selector-buttons selector-buttons-three">
```

Add this button after the grammar button:

```html
<button class="card-type-btn" data-card-type="scenario_phrase" title="按具体场景生成中英日常用表达" data-testid="card-type-scenario">
  <span class="model-icon">🎭</span>
  <span>场景表达</span>
</button>
```

- [ ] **Step 2: Update store card-type documentation**

In `public/js/modules/store.js`, update the comment:

```js
            cardType: localStorage.getItem('card_type') || 'trilingual', // 'trilingual' | 'grammar_ja' | 'scenario_phrase'
```

- [ ] **Step 3: Add frontend card-type config**

In `public/js/modules/app.js`, add this near the constants:

```js
const CARD_TYPE_CONFIG = {
    trilingual: {
        key: 'trilingual',
        selectorHint: '三语学习卡片',
        hintClass: 'mode-gemini',
        generateText: 'Generate',
        placeholder: '输入短语或句子...',
        queueLabel: '三语',
        fileClass: 'trilingual',
        fileCornerClass: 'corner-trilingual',
        fileCornerText: '三语卡',
        modalMetaLabel: 'TRILINGUAL',
        modalTabLabel: '三语卡片',
        historyLabel: '🧩 三语',
        knowledgeEnabled: true
    },
    grammar_ja: {
        key: 'grammar_ja',
        selectorHint: '日语语法卡片',
        hintClass: 'mode-grammar',
        generateText: 'Generate Grammar Card',
        placeholder: '输入日语语法点或句型...',
        queueLabel: '语法',
        fileClass: 'grammar',
        fileCornerClass: 'corner-grammar',
        fileCornerText: '语法卡',
        modalMetaLabel: 'JA GRAMMAR',
        modalTabLabel: '语法卡片',
        historyLabel: '📘 语法',
        knowledgeEnabled: true
    },
    scenario_phrase: {
        key: 'scenario_phrase',
        selectorHint: '场景常用表达',
        hintClass: 'mode-scenario',
        generateText: 'Generate Scenario Card',
        placeholder: '描述一个具体场景，例如：保育园早上送孩子，说明昨晚有点咳嗽...',
        queueLabel: '场景',
        fileClass: 'scenario',
        fileCornerClass: 'corner-scenario',
        fileCornerText: '场景卡',
        modalMetaLabel: 'SCENARIO EXPRESSIONS',
        modalTabLabel: '场景表达卡',
        historyLabel: '🎭 场景',
        knowledgeEnabled: false
    }
};
```

Replace frontend `normalizeCardType` and `getCardTypeLabel` with:

```js
function normalizeCardType(cardType) {
    const normalized = String(cardType || 'trilingual').trim().toLowerCase();
    return CARD_TYPE_CONFIG[normalized] ? normalized : 'trilingual';
}

function getCardTypeConfig(cardType) {
    return CARD_TYPE_CONFIG[normalizeCardType(cardType)];
}

function getCardTypeLabel(cardType) {
    return getCardTypeConfig(cardType).selectorHint;
}
```

- [ ] **Step 4: Update selector, generator, files, queue, modal, and history to use the config**

In `initCardTypeSelector`, replace the UI update body with:

```js
        const config = getCardTypeConfig(rawType);
        const cardType = config.key;
        store.setState({ cardType });
        buttons.forEach((btn) => btn.classList.toggle('active', btn.dataset.cardType === cardType));
        hint.textContent = config.selectorHint;
        hint.className = `selector-hint ${config.hintClass}`;
        els.genBtn.textContent = config.generateText;
        els.phraseInput.placeholder = config.placeholder;
```

In `updateGenUI`, replace the `idleText` calculation:

```js
    const idleText = getCardTypeConfig(store.get('cardType')).generateText;
```

In `renderFiles`, replace class and corner logic:

```js
        const config = getCardTypeConfig(item.cardType || item.card_type || 'trilingual');
        const cardType = config.key;
        btn.className = `list-item-btn card-type-${config.fileClass}`;
        btn.dataset.testid = `file-${cardType}-${String(item.title || item.file || '').trim()}`;
        btn.innerHTML = `
          <span class="file-item-corner ${config.fileCornerClass}">${config.fileCornerText}</span>
          <span class="file-item-title">${escapeHtml(item.title || '')}</span>
        `;
```

In `renderHeroTaskQueueStatus`, replace both queue type ternaries with:

```js
        const cardType = getCardTypeConfig(activeTask.cardType).queueLabel;
```

and:

```js
    const runningType = runningTask ? getCardTypeConfig(runningTask.cardType).queueLabel : '';
```

In `renderGenerationQueuePanel`, replace the item label:

```js
            const cardType = normalizeCardType(task.cardType || 'trilingual');
            const cardTypeLabel = getCardTypeConfig(cardType).queueLabel;
```

In `renderCardModal`, replace the modal labels:

```js
    const cardTypeConfig = getCardTypeConfig(cardType);
    const cardTypeMetaLabel = cardTypeConfig.modalMetaLabel;
    const cardTypeTabLabel = cardTypeConfig.modalTabLabel;
    const knowledgeEnabled = Boolean(generationId && cardTypeConfig.knowledgeEnabled);
```

Then replace the Knowledge tab condition:

```js
                    ${knowledgeEnabled ? '<button class="tab-btn" data-target="cardKnowledge" data-testid="tab-knowledge" style="font-size:12px; padding: 4px 12px; color: #1d4ed8;">KNOWLEDGE</button>' : ''}
```

and the Knowledge panel condition:

```js
            ${knowledgeEnabled ? '<div id="cardKnowledge" class="mc-body" style="display:none;"></div>' : ''}
```

In `renderHistory`, replace the label ternary:

```js
                <span>${getCardTypeConfig(r.card_type).historyLabel}</span>
```

- [ ] **Step 5: Add styles for the three-option selector and scenario cards**

In `public/styles.css`, replace `.selector-buttons-two` with:

```css
.selector-buttons-two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.selector-buttons-three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
```

Add:

```css
.selector-hint.mode-scenario {
  background: rgba(20, 184, 166, 0.12);
  color: #0f766e;
  border: 1px solid rgba(20, 184, 166, 0.32);
}

.card-type-btn[data-card-type="scenario_phrase"].active {
  border-color: #0f766e;
  background: linear-gradient(135deg, rgba(20, 184, 166, 0.14), rgba(34, 197, 94, 0.1));
  color: #0f766e;
  box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.12);
}

.file-list .list-item-btn.card-type-scenario {
  background: linear-gradient(180deg, #ecfdf5 0%, #d9fbe8 100%);
  border-color: #86efac;
}

.file-list .list-item-btn.card-type-scenario:hover {
  border-color: #22c55e;
  box-shadow: 0 12px 26px rgba(34, 197, 94, 0.18);
}

.file-list .list-item-btn.card-type-scenario.active {
  border-color: #16a34a;
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.22), 0 12px 24px rgba(34, 197, 94, 0.18);
}

.file-list .list-item-btn .file-item-corner.corner-scenario {
  color: #0f766e;
  background: #dcfce7;
  border-color: #86efac;
}
```

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/js/modules/store.js public/js/modules/app.js public/styles.css
git commit -m "feat: add scenario card type UI"
```

---

### Task 7: Add E2E Coverage For Scenario Card UI Flow

**Files:**
- Modify: `tests/e2e/frontend-regression.spec.js`

- [ ] **Step 1: Add selector assertions to the existing layout test**

In test `01 首页、卡片类型、历史入口与移动端布局稳定`, after the grammar selector assertions, add:

```js
    await page.getByTestId('card-type-scenario').click();
    await expect(page.getByTestId('generate-btn')).toHaveText('Generate Scenario Card');
    await expect(page.getByTestId('phrase-input')).toHaveAttribute('placeholder', /描述一个具体场景/);
    await expect(page.getByTestId('card-type-scenario')).toHaveClass(/active/);
```

Keep the existing switch back to trilingual afterward.

- [ ] **Step 2: Add a scenario generation E2E test**

Add this test after the existing generated-card test:

```js
  test('04 场景表达卡可生成、展示、播放入口可渲染且不显示 Knowledge 标签', async ({ page, request }) => {
    const diagnostics = collectDiagnostics(page);
    const phrase = `PW scenario expression ${Date.now()}`;
    let folder = '';

    await page.goto('/');
    await page.getByTestId('card-type-scenario').click();
    await page.getByTestId('phrase-input').fill(phrase);
    await page.getByTestId('generate-btn').click();

    await expect(page.getByTestId('hero-queue-state')).toHaveText(/RUNNING|QUEUED/, { timeout: 10_000 });
    await page.getByTestId('hero-queue-status').click();
    await expect(page.getByTestId('queue-task-item').filter({ hasText: phrase }).first()).toContainText('场景');
    await waitForQueueIdle(page);

    folder = await openFirstFolder(page);
    const fileButton = page.getByTestId('file-list').locator('button').filter({ hasText: phrase }).first();
    await expect(fileButton).toContainText('场景卡');
    await fileButton.click();

    await expect(page.getByTestId('card-modal')).toBeVisible();
    await expect(page.getByTestId('card-modal-container')).toContainText('SCENARIO EXPRESSIONS');
    await expect(page.getByTestId('card-content-panel')).toContainText('CARD TYPE · 场景表达卡');
    await expect(page.getByTestId('card-content-panel').locator('h3')).toHaveCount(12);
    await expect.poll(() => page.locator('.audio-btn').count()).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId('tab-knowledge')).toHaveCount(0);

    await page.getByTestId('card-modal-close').click();
    await deleteRecord(request, folder, phrase);
    await expectNoDiagnostics(diagnostics);
  });
```

Renumber the following test title from `04` to `05` so serial output remains readable.

- [ ] **Step 3: Run the targeted E2E spec**

Run:

```bash
npm run test:e2e -- tests/e2e/frontend-regression.spec.js
```

Expected: the updated frontend regression spec passes.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/frontend-regression.spec.js
git commit -m "test: cover scenario expression card UI"
```

---

### Task 8: Full Verification And Container Rebuild

**Files:**
- No source files expected.

- [ ] **Step 1: Run lint**

Run:

```bash
npm run lint
```

Expected: command exits with code `0`.

- [ ] **Step 2: Run unit tests**

Run:

```bash
npm run test:unit
```

Expected: command exits with code `0`.

- [ ] **Step 3: Run integration tests**

Run:

```bash
npm run test:integration
```

Expected: command exits with code `0`.

- [ ] **Step 4: Run E2E tests**

Run:

```bash
npm run test:e2e
```

Expected: command exits with code `0`.

- [ ] **Step 5: Rebuild all containers**

Run:

```bash
docker compose build --no-cache
docker compose up -d --force-recreate --build
```

Expected: all project containers rebuild and start successfully.

- [ ] **Step 6: Verify live app health**

Run:

```bash
curl -fsS http://127.0.0.1:3010/api/health
curl -fsS -o /tmp/three-lans-index.html -w '%{http_code}\n' http://127.0.0.1:3010/
curl -fsS -o /tmp/three-lans-knowledge-hub.html -w '%{http_code}\n' http://127.0.0.1:3010/knowledge-hub.html
```

Expected:

```text
overallStatus contains "online"
200
200
```

- [ ] **Step 7: Inspect git status**

Run:

```bash
git status --short --branch
```

Expected: no unstaged source/test changes from the implementation tasks. Untracked `.superpowers/` and the unrelated kindergarden document may remain untracked unless the user separately asks to clean or commit them.
