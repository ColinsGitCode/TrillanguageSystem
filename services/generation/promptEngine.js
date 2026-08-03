const fs = require('fs');
const path = require('path');
const {
    CURRENT_SCENARIO_EXPRESSION_COUNT,
} = require('../../lib/scenarioCardContract');

function buildScenarioAudioTaskExample() {
    const tasks = [];
    for (let index = 1; index <= CURRENT_SCENARIO_EXPRESSION_COUNT; index += 1) {
        tasks.push(
            { text: '...', lang: 'en', filename_suffix: `_en_${index}` },
            { text: '...', lang: 'ja', filename_suffix: `_ja_${index}` }
        );
    }
    return JSON.stringify(tasks, null, 4);
}

// ========== 提示词构建函数（优化版：~1500 tokens） ==========

/**
 * 构建优化后的三语翻译提示词
 * 优化目标：从 3740 tokens 降至 ~1500 tokens
 *
 * @param {Object} args - 参数对象
 * @param {string} args.phrase - 待翻译的短语
 * @param {string} args.filenameBase - 生成文件的基础名称
 * @returns {string} 完整的提示词
 */
function buildPrompt(args) {
    const phrase = args.phrase || '';
    const filenameBase = args.filenameBase || '';
    const cardType = String(args.cardType || 'trilingual').toLowerCase();

    if (cardType === 'scenario_phrase') {
        return `你是场景表达卡生成器。
输入场景: "${phrase}"
文件名基础: "${filenameBase}"

严格要求:
1) 只输出有效 JSON，不要任何额外文本。
2) markdown_content 必须为 Markdown，内容是一张“场景表达卡”，并且必须使用以下章节:
# 10字以内的场景主旨标题
## 1. 场景说明
- **原始场景**: ${phrase}
- 用中文说明场景目标、对象、语气和注意事项。
## 2. 常用表达
### 01.
- **中文**: ...
- **英文**: ...
- **日本語**: ...
- **使用提示**: ...
...
### ${String(CURRENT_SCENARIO_EXPRESSION_COUNT).padStart(2, '0')}.
- **中文**: ...
- **英文**: ...
- **日本語**: ...
- **使用提示**: ...

3) H1 标题必须由你总结输入场景主旨，不要照抄完整输入场景；去掉空格和标点后必须为 1-10 个字符，例如 空调维修预约、保育园交接。
4) 必须生成 ${CURRENT_SCENARIO_EXPRESSION_COUNT} 个常用表达，编号固定为 ### 01. 到 ### ${CURRENT_SCENARIO_EXPRESSION_COUNT}.，不要增加或减少。
5) 每个表达块必须包含中文、英文、日本語、使用提示；英文和日语表达要自然口语化。
6) 日语只写自然正文，不加括号假名或 <ruby>/<rt>/<rp>；读音由系统独立生成。
7) audio_tasks 必须含 ${CURRENT_SCENARIO_EXPRESSION_COUNT * 2} 项: 每个表达的英文和日语各 1 项。filename_suffix 固定为 _en_1 到 _en_${CURRENT_SCENARIO_EXPRESSION_COUNT}、_ja_1 到 _ja_${CURRENT_SCENARIO_EXPRESSION_COUNT}；text 去掉末尾标点；日语 text 不能含 ruby。
8) JSON 转义: markdown_content 换行用 \\n，双引号用 \\"。
禁止: <script>/<iframe>/<object>/<embed>。

JSON 结构:
{
  "markdown_content": "...",
  "audio_tasks": ${buildScenarioAudioTaskExample()}
}`;
    }

    if (cardType === 'grammar_ja') {
        return `你是日语语法学习卡片生成器。
输入内容: "${phrase}"
文件名基础: "${filenameBase}"

严格要求:
1) 只输出有效 JSON，不要任何额外文本。
2) markdown_content 必须为 Markdown，结构如下（必须使用“例句1/例句2/例句3”格式以便生成 TTS）:
# ${phrase}
## 1. 语法概述（中文）
- **语法点**: ...
- **核心结构**: ...
- **使用场景**: ...
- **注意事项**: ...
## 2. 日本語:
- **例句1**: 日文自然正文（不加括号假名或 HTML 注音）
  - 纯中文翻译（不含假名/注音/括号读音）
- **例句2**: 日文自然正文（不加括号假名或 HTML 注音）
  - 纯中文翻译（不含假名/注音/括号读音）
- **例句3**: 日文自然正文（不加括号假名或 HTML 注音）
  - 纯中文翻译（不含假名/注音/括号读音）
## 3. 常见误用（中文）
- ...

3) 语法说明只用中文；例句必须是日语。
4) 日语只写自然正文，不加括号假名或 <ruby>/<rt>/<rp>；读音由系统独立生成。纯片假名外来词保持原样。
5) audio_tasks 只允许日语例句，必须含3项且 filename_suffix 固定为 _ja_1/_ja_2/_ja_3。
6) JSON 转义: markdown_content 换行用 \\n，双引号用 \\"。
禁止: <script>/<iframe>/<object>/<embed>。

JSON 结构:
{
  "markdown_content": "...",
  "audio_tasks": [
    { "text": "...", "lang": "ja", "filename_suffix": "_ja_1" },
    { "text": "...", "lang": "ja", "filename_suffix": "_ja_2" },
    { "text": "...", "lang": "ja", "filename_suffix": "_ja_3" }
  ]
}`;
    }

    const strictCompactPrompt = `你是中英日三语学习卡片生成器。
输入短语: "${phrase}"
文件名基础: "${filenameBase}"

严格要求:
1) 只输出有效 JSON，不要任何额外文本。
2) markdown_content 必须为 Markdown，结构如下（必须使用“例句1/例句2”格式以便生成 TTS）:
# ${phrase}
## 1. 英文:
- **翻译**: 用英文给出自然、准确的 English equivalent；不要写中文释义
- **解释**: 用英文给出简洁的 English definition / usage explanation；不要写中文解释
- **例句1**: 英文句子
  - 中文翻译
- **例句2**: 英文句子
  - 中文翻译
## 2. 日本語:
- **翻訳**: ...（只写自然日语正文，不加括号假名或 HTML 注音）
- **解説**: ...（只写自然日语正文，不加括号假名或 HTML 注音）
- **例句1**: 日文自然正文（不加括号假名或 HTML 注音）
  - 纯中文翻译（不含假名/注音/括号读音）
- **例句2**: 日文自然正文（不加括号假名或 HTML 注音）
  - 纯中文翻译（不含假名/注音/括号读音）
## 3. 中文:
- **翻译**: ...
- **解释**: ...
- **语域**: 正式/口语/书面/通用 之一
- **辨析**: 若为多义词或易混淆词，简述用法区别；否则写"无"
(若为技术术语可加: ## 4. 技术概念简要说明)

3) 语言分离: 英文区的“翻译”“解释”和例句正文必须使用英文；英文例句下方的缩进译文保留中文，这是英文区唯一允许出现中文的位置。日文部分仅日文；日语例句后的中文翻译必须为纯中文且不含假名/注音/括号读音。完整中文释义统一放在“## 3. 中文”中，英文区不要重复中文释义。
4) 日语只写自然正文，不加括号假名或 <ruby>/<rt>/<rp>；英文说明只允许出现在“外来语标注”行。
5) audio_tasks 必须含4项: en1/en2/ja1/ja2。text 去掉末尾标点；日语 text 不能含 ruby；filename_suffix 固定为 _en_1/_en_2/_ja_1/_ja_2。
6) JSON 转义: markdown_content 换行用 \\n，双引号用 \\"。
禁止: <script>/<iframe>/<object>/<embed>。

JSON 结构:
{
  "markdown_content": "...",
  "audio_tasks": [
    { "text": "...", "lang": "en", "filename_suffix": "_en_1" },
    { "text": "...", "lang": "en", "filename_suffix": "_en_2" },
    { "text": "...", "lang": "ja", "filename_suffix": "_ja_1" },
    { "text": "...", "lang": "ja", "filename_suffix": "_ja_2" }
  ]
}`;

    return strictCompactPrompt;
}

function buildMarkdownPrompt(args) {
    const phrase = args.phrase || '';
    const cardType = String(args.cardType || 'trilingual').toLowerCase();
    let templatePath;
    if (cardType === 'scenario_phrase') {
        templatePath = process.env.SCENARIO_MARKDOWN_PROMPT_PATH || path.join(__dirname, '..', '..', 'prompts', 'phrase_scenario_expressions_markdown.md');
    } else if (cardType === 'grammar_ja') {
        templatePath = process.env.GRAMMAR_MARKDOWN_PROMPT_PATH || path.join(__dirname, '..', '..', 'prompts', 'phrase_ja_grammar_markdown.md');
    } else {
        templatePath = process.env.MARKDOWN_PROMPT_PATH || path.join(__dirname, '..', '..', 'prompts', 'phrase_3LANS_markdown.md');
    }

    let template = '';
    try {
        template = fs.readFileSync(templatePath, 'utf8');
    } catch (err) {
        // Fallback to minimal inline prompt if template missing
        if (cardType === 'scenario_phrase') {
            template = `你是场景表达卡生成器。\n输入场景: "{{ phrase }}"\n\n只输出 Markdown，不要输出 JSON 或额外解释。\nH1 标题必须总结场景主旨，去掉空格和标点后 10字以内，不能照抄完整输入场景。\n必须包含 ## 1. 场景说明 和 ## 2. 常用表达；场景说明中必须包含 - **原始场景**: {{ phrase }}；并生成 ### 01. 到 ### ${CURRENT_SCENARIO_EXPRESSION_COUNT}. 共 ${CURRENT_SCENARIO_EXPRESSION_COUNT} 个表达块。`;
        } else if (cardType === 'grammar_ja') {
            template = `你是日语语法学习卡片生成器。\n输入内容: "{{ phrase }}"\n\n只输出 Markdown，不要输出 JSON 或额外解释。`;
        } else {
            template = `你是中英日三语学习卡片生成器。\n输入短语: "{{ phrase }}"\n\n只输出 Markdown，不要输出 JSON 或额外解释。`;
        }
    }

    return template.replace(/\{\{\s*phrase\s*\}\}/g, phrase);
}

module.exports = { buildPrompt, buildMarkdownPrompt };
