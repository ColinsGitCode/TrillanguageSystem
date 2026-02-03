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

    const optimizedPrompt = `你是专业的中英日三语翻译助手，精通多语言翻译和例句创作。

## 推理步骤（内部思考）

**步骤1：语言识别**
- 识别输入语言（中/英/日）和词性
- 判断是否为多义词或技术术语

**步骤2：翻译策略**
- 选择直译/意译/音译策略
- 考虑文化差异和习语特点

**步骤3：例句与质量**
- 例句1偏正式/工作场景，例句2偏日常/轻松
- 使用口语表达，长度适中（英文8-15词，日语10-20字）

## 示例参考

### 示例1：日常词汇
输入："打招呼"

\`\`\`markdown
${FEWSHOT_EXAMPLES.daily.output}
\`\`\`

### 示例2：技术术语
输入："API"

\`\`\`markdown
${FEWSHOT_EXAMPLES.technical.output}

## 4. 技术概念简要说明
应用程序编程接口（API）是允许不同软件系统相互通信和交换数据的一组规则和协议。常见类型包括 REST API、GraphQL API 等。
\`\`\`

## 当前任务

**输入短语**: "${phrase}"

## 核心要求

**语言分离：**
- 英文部分例句必须是英语，日语部分例句必须是日语
- 日语例句后的中文翻译必须是纯中文（不含假名/注音/括号读音）

**日语规则：**
- 汉字必须注音：漢字(かんじ)
- 片假名外来语标注英文：テスト(test)、データ(data)
- 中文翻译禁止出现"汉字(かな)"形式

**输出格式（Markdown）：**
\`\`\`markdown
# ${phrase}

## 1. 英文:
- **翻译**: [英文翻译]
- **解释**: [简要说明，不超过15词]
- **例句1**: [英语句子]
  - [纯中文翻译]
- **例句2**: [英语句子]
  - [纯中文翻译]

## 2. 日本語:
- **翻訳**: [日语翻译，汉字注音，外来语标英文]
- **解説**: [日语解释，汉字注音]
- **例句1**: [日语句子，汉字注音，外来语标英文]
  - [纯中文翻译，无假名无注音]
- **例句2**: [日语句子，汉字注音，外来语标英文]
  - [纯中文翻译，无假名无注音]

## 3. 中文:
- **翻译**: [中文翻译]
- **解释**: [一句话解释]

## 4. 技术概念简要说明
[如果是技术术语，提供150字左右说明；否则省略]
\`\`\`

## JSON 输出

必须返回有效JSON，不要额外文本：

\`\`\`json
{
  "markdown_content": "完整Markdown内容（换行用\\\\n，引号用\\\\\\"）",
  "audio_tasks": [
    { "text": "英文例句1（无标点）", "lang": "en", "filename_suffix": "_en_1" },
    { "text": "英文例句2（无标点）", "lang": "en", "filename_suffix": "_en_2" },
    { "text": "日语例句1（无ruby标签纯文本）", "lang": "ja", "filename_suffix": "_ja_1" },
    { "text": "日语例句2（无ruby标签纯文本）", "lang": "ja", "filename_suffix": "_ja_2" }
  ]
}
\`\`\`

**禁止：** <script>、<iframe>、<object>、<embed> 标签

---

现在请生成内容。`;

    return optimizedPrompt;
}

module.exports = { buildPrompt };
