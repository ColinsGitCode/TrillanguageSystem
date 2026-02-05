const fs = require('fs');
const path = require('path');

// ========== Few-shot 示例库（优化后保留2个核心示例） ==========
const FEWSHOT_EXAMPLES = {
    // 示例 1: 日常词汇
    daily: {
        input: "打招呼",
        output: `# 打招呼

## 1. 英文:
- **翻译**: greet / say hello
- **解释**: A polite action of acknowledging someone
- **例句1**: Hey, I just wanted to greet the new neighbors.
  - 嘿，我只是想跟新邻居打个招呼。
- **例句2**: Don't forget to greet your teacher.
  - 别忘了跟老师打招呼。

## 2. 日本語:
- **翻訳**: 挨拶(あいさつ)する
- **解説**: 人(ひと)に会(あ)った時(とき)に声(こえ)をかける行為(こうい)
- **例句1**: 朝(あさ)、会社(かいしゃ)で挨拶(あいさつ)するのは基本(きほん)だよ。
  - 早上在公司打招呼是基本礼仪。
- **例句2**: 彼(かれ)はいつも笑顔(えがお)で挨拶(あいさつ)してくれる。
  - 他总是笑着打招呼。

## 3. 中文:
- **翻译**: 打招呼 [原文]
- **解释**: 见面时表示问候的礼貌行为`
    },

    // 示例 2: 技术术语
    technical: {
        input: "API",
        output: `# API

## 1. 英文:
- **翻译**: API (Application Programming Interface) [原文]
- **解释**: Rules allowing different software to communicate
- **例句1**: We need to integrate their payment API.
  - 我们需要集成他们的支付 API。
- **例句2**: This API documentation is well written.
  - 这个 API 文档写得很好。

## 2. 日本語:
- **翻訳**: API（エーピーアイ）
- **解説**: ソフトウェア同士(どうし)が通信(つうしん)するルール集(しゅう)
- **例句1**: この API(エーピーアイ)を使(つか)えば、データを取得(しゅとく)できます。
  - 使用这个 API 就能获取数据。
- **例句2**: REST API(レスト・エーピーアイ)を勉強(べんきょう)してる。
  - 我正在学习 REST API。

## 3. 中文:
- **翻译**: 应用程序编程接口
- **解释**: 允许不同软件系统相互通信的规则`
    }
};

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
- **翻訳**: ...（汉字注音，片假名外来语标英文）
- **解説**: ...（汉字注音）
- **例句1**: 日文句子（汉字注音，外来语标英文）
  - 纯中文翻译（不含假名/注音/括号读音）
- **例句2**: 日文句子（汉字注音，外来语标英文）
  - 纯中文翻译（不含假名/注音/括号读音）
## 3. 中文:
- **翻译**: ...
- **解释**: ...
(若为技术术语可加: ## 4. 技术概念简要说明)

3) 语言分离: 英文部分仅英文; 日文部分仅日文; 日语例句后的中文翻译必须为纯中文且不含假名/注音/括号读音。
4) 日语汉字需加假名(例: 漢字(かんじ)); 片假名外来语标英文(例: テスト(test))。
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
    const templatePath = process.env.MARKDOWN_PROMPT_PATH || path.join(__dirname, '..', 'prompts', 'phrase_3LANS_markdown.md');
    let template = '';
    try {
        template = fs.readFileSync(templatePath, 'utf8');
    } catch (err) {
        // Fallback to minimal inline prompt if template missing
        template = `你是中英日三语学习卡片生成器。\n输入短语: \"{{ phrase }}\"\n\n只输出 Markdown，不要输出 JSON 或额外解释。`;
    }

    return template.replace(/\{\{\s*phrase\s*\}\}/g, phrase);
}

module.exports = { buildPrompt, buildMarkdownPrompt };
