const fs = require('fs');
const path = require('path');

const PROMPT_MARKDOWN_PATH = path.join(__dirname, '../codex_prompt/phrase_3LANS_markdown.md');

/**
 * 构建结构化的三语翻译提示词
 *
 * @param {Object} args - 参数对象
 * @param {string} args.phrase - 待翻译的短语
 * @param {string} args.filenameBase - 生成文件的基础名称
 * @returns {string} 完整的提示词
 */
function buildPrompt(args) {
    const phrase = args.phrase || '';
    const filenameBase = args.filenameBase || '';

    // 读取模板文件（用于参考格式）
    let templateReference = '';
    if (fs.existsSync(PROMPT_MARKDOWN_PATH)) {
        templateReference = fs.readFileSync(PROMPT_MARKDOWN_PATH, 'utf-8');
    }

    // ========== 系统角色定义 ==========
    const systemRole = `你是一位专业的多语言翻译助手，精通中文、英文、日语三种语言。
你的任务是为用户提供准确、自然、地道的三语翻译和解释。`;

    // ========== 任务描述 ==========
    const taskDescription = `
## 任务
为以下短语生成三语学习卡片内容：

**输入短语**: "${phrase}"

## 处理规则

### 1. 语言识别
- 判断输入短语的主要语言（中文/英文/日语）
- 如果短语存在拼写错误，请先修正再处理

### 2. 翻译要求
- 为三种语言（英文、日语、中文）分别提供翻译和解释
- 如果输入语言是其中之一，该语言栏标注"原文"并给出必要解释
- 翻译要自然、地道，符合母语使用习惯

### 3. 例句要求（英文和日语各2句）
- 例句必须是**日常口语风格**，这非常重要
- 每个例句附带简要中文翻译
- 例句要能体现短语的实际使用场景

### 4. 日语特殊要求
- 所有汉字必须标注假名读音，使用 ruby 格式：汉字(假名)
  - 例如：勉強(べんきょう)、食べる(たべる)
- 片假名外来语需在括号中标注对应英语
  - 例如：コンピュータ(computer)
- 英文缩写（如 IT、API）不需要注音

### 5. 技术概念（可选）
- 如果短语是 IT/技术领域相关名词，用中文给出简要说明（约200字）
`;

    // ========== 输出格式 ==========
    const outputFormat = `
## 输出格式要求

请严格按照以下 Markdown 格式输出：

\`\`\`markdown
# ${phrase}

## 1. 英文:
- **翻译**: [英文翻译]
- **解释**: [一句话英文解释，不超过20词]
- **例句1**: [日常口语风格的英文例句]
  - [例句的中文翻译]
- **例句2**: [日常口语风格的英文例句]
  - [例句的中文翻译]

## 2. 日本語:
- **翻訳**: [日语翻译，汉字需注音如：漢字(かんじ)]
- **解説**: [日语解释，汉字需注音]
- **例句1**: [日语例句，汉字需注音，外来语需标注英语]
  - [例句的中文翻译]
- **例句2**: [日语例句，汉字需注音，外来语需标注英语]
  - [例句的中文翻译]

## 3. 中文:
- **翻译**: [中文翻译]
- **解释**: [一句话中文解释]

## 4. 技术概念简要说明
[如果是技术术语，提供200字左右的中文说明；否则可省略此节]
\`\`\`
`;

    // ========== JSON 输出指令 ==========
    const jsonInstruction = `
## 关键输出要求

你必须返回一个有效的 JSON 对象，不要包含 markdown 代码块标记。

JSON 结构：
{
  "markdown_content": "完整的 Markdown 内容（按上述格式）",
  "audio_tasks": [
    { "text": "英文例句1原文", "lang": "en", "filename_suffix": "_en_1" },
    { "text": "英文例句2原文", "lang": "en", "filename_suffix": "_en_2" },
    { "text": "日语例句1原文（不含ruby标签的纯文本）", "lang": "ja", "filename_suffix": "_ja_1" },
    { "text": "日语例句2原文（不含ruby标签的纯文本）", "lang": "ja", "filename_suffix": "_ja_2" }
  ]
}

**重要说明**：
- markdown_content 中的换行用 \\n 转义
- markdown_content 中的双引号用 \\" 转义
- audio_tasks 中的日语文本不要包含 ruby 标签，只要纯文本
- 文件名基础: "${filenameBase}"

## 安全约束
- 禁止包含 <script>、<iframe>、<object>、<embed> 标签
- 禁止引用外部资源
`;

    // ========== 组合完整提示词 ==========
    return `${systemRole}

${taskDescription}

${outputFormat}

${jsonInstruction}`;
}

module.exports = { buildPrompt };
