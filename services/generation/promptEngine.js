const fs = require('fs');
const path = require('path');

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
# ${phrase}
## 1. 场景说明
- 用中文说明场景目标、对象、语气和注意事项。
## 2. 常用表达
### 01.
- **中文**: ...
- **英文**: ...
- **日本語**: ...
- **使用提示**: ...
...
### 12.
- **中文**: ...
- **英文**: ...
- **日本語**: ...
- **使用提示**: ...

3) 必须生成 12 个常用表达，编号固定为 ### 01. 到 ### 12.，不要增加或减少。
4) 每个表达块必须包含中文、英文、日本語、使用提示；英文和日语表达要自然口语化。
5) 日语汉字需加假名(例: 漢字(かな))；不要输出原始 <ruby> 标签。
6) audio_tasks 必须含 24 项: 每个表达的英文和日语各 1 项。filename_suffix 固定为 _en_1 到 _en_12、_ja_1 到 _ja_12；text 去掉末尾标点；日语 text 不能含 ruby。
7) JSON 转义: markdown_content 换行用 \\n，双引号用 \\"。
禁止: <script>/<iframe>/<object>/<embed>。

JSON 结构:
{
  "markdown_content": "...",
  "audio_tasks": [
    { "text": "...", "lang": "en", "filename_suffix": "_en_1" },
    { "text": "...", "lang": "ja", "filename_suffix": "_ja_1" },
    { "text": "...", "lang": "en", "filename_suffix": "_en_2" },
    { "text": "...", "lang": "ja", "filename_suffix": "_ja_2" },
    { "text": "...", "lang": "en", "filename_suffix": "_en_3" },
    { "text": "...", "lang": "ja", "filename_suffix": "_ja_3" },
    { "text": "...", "lang": "en", "filename_suffix": "_en_4" },
    { "text": "...", "lang": "ja", "filename_suffix": "_ja_4" },
    { "text": "...", "lang": "en", "filename_suffix": "_en_5" },
    { "text": "...", "lang": "ja", "filename_suffix": "_ja_5" },
    { "text": "...", "lang": "en", "filename_suffix": "_en_6" },
    { "text": "...", "lang": "ja", "filename_suffix": "_ja_6" },
    { "text": "...", "lang": "en", "filename_suffix": "_en_7" },
    { "text": "...", "lang": "ja", "filename_suffix": "_ja_7" },
    { "text": "...", "lang": "en", "filename_suffix": "_en_8" },
    { "text": "...", "lang": "ja", "filename_suffix": "_ja_8" },
    { "text": "...", "lang": "en", "filename_suffix": "_en_9" },
    { "text": "...", "lang": "ja", "filename_suffix": "_ja_9" },
    { "text": "...", "lang": "en", "filename_suffix": "_en_10" },
    { "text": "...", "lang": "ja", "filename_suffix": "_ja_10" },
    { "text": "...", "lang": "en", "filename_suffix": "_en_11" },
    { "text": "...", "lang": "ja", "filename_suffix": "_ja_11" },
    { "text": "...", "lang": "en", "filename_suffix": "_en_12" },
    { "text": "...", "lang": "ja", "filename_suffix": "_ja_12" }
  ]
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
- **例句1**: 日文句子（仅汉字注音，片假名外来词不要注音）
  - 纯中文翻译（不含假名/注音/括号读音）
- **例句2**: 日文句子（仅汉字注音，片假名外来词不要注音）
  - 纯中文翻译（不含假名/注音/括号读音）
- **例句3**: 日文句子（仅汉字注音，片假名外来词不要注音）
  - 纯中文翻译（不含假名/注音/括号读音）
## 3. 常见误用（中文）
- ...

3) 语法说明只用中文；例句必须是日语。
4) 日语汉字需加假名(例: 漢字(かんじ))；纯片假名外来词不要加读音，不要写成 プロジェクト(ぷろじぇくと)。中文说明中若提到日语词形，也统一写成 漢字(かな) 形式，不要直接输出 <ruby> 标签。
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
- **翻译**: ...
- **解释**: ...
- **例句1**: 英文句子
  - 中文翻译
- **例句2**: 英文句子
  - 中文翻译
## 2. 日本語:
- **翻訳**: ...（仅汉字注音；片假名外来词不注音、不加英文括号）
- **解説**: ...（汉字注音）
- **例句1**: 日文句子（仅汉字注音；片假名外来词不注音、不加英文括号）
  - 纯中文翻译（不含假名/注音/括号读音）
- **例句2**: 日文句子（仅汉字注音；片假名外来词不注音、不加英文括号）
  - 纯中文翻译（不含假名/注音/括号读音）
## 3. 中文:
- **翻译**: ...
- **解释**: ...
- **语域**: 正式/口语/书面/通用 之一
- **辨析**: 若为多义词或易混淆词，简述用法区别；否则写"无"
(若为技术术语可加: ## 4. 技术概念简要说明)

3) 语言分离: 英文部分仅英文; 日文部分仅日文; 日语例句后的中文翻译必须为纯中文且不含假名/注音/括号读音。
4) 日语汉字需加假名(例: 漢字(かんじ)); 纯片假名外来词不要加读音，也不要在日文句子里写英文括号；英文说明只允许出现在“外来语标注”行。
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
            template = `你是场景表达卡生成器。\n输入场景: "{{ phrase }}"\n\n只输出 Markdown，不要输出 JSON 或额外解释。\n必须包含 ## 1. 场景说明 和 ## 2. 常用表达，并生成 ### 01. 到 ### 12. 共 12 个表达块。`;
        } else if (cardType === 'grammar_ja') {
            template = `你是日语语法学习卡片生成器。\n输入内容: "{{ phrase }}"\n\n只输出 Markdown，不要输出 JSON 或额外解释。`;
        } else {
            template = `你是中英日三语学习卡片生成器。\n输入短语: "{{ phrase }}"\n\n只输出 Markdown，不要输出 JSON 或额外解释。`;
        }
    }

    return template.replace(/\{\{\s*phrase\s*\}\}/g, phrase);
}

module.exports = { buildPrompt, buildMarkdownPrompt };
