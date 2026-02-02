const fs = require('fs');
const path = require('path');

// ========== Few-shot 示例库 ==========
const FEWSHOT_EXAMPLES = {
    // 示例 1: 日常简单词汇
    daily: {
        input: "打招呼",
        output: `# 打招呼

## 1. 英文:
- **翻译**: greet / say hello
- **解释**: A polite action of acknowledging someone when you meet them
- **例句1**: Hey, I just wanted to greet the new neighbors.
  - 嘿，我只是想跟新邻居打个招呼。
- **例句2**: Don't forget to greet your teacher when you see her.
  - 见到老师时别忘了打招呼。

## 2. 日本語:
- **翻訳**: 挨拶(あいさつ)する
- **解説**: 人(ひと)に会(あ)った時(とき)に礼儀(れいぎ)として声(こえ)をかける行為(こうい)
- **例句1**: 朝(あさ)、会社(かいしゃ)で同僚(どうりょう)に挨拶(あいさつ)するのは基本(きほん)だよ。
  - 早上在公司向同事打招呼是基本礼仪。
- **例句2**: 彼(かれ)はいつも笑顔(えがお)で挨拶(あいさつ)してくれる。
  - 他总是笑着跟我打招呼。

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
- **解释**: A set of rules allowing different software to communicate
- **例句1**: We need to integrate their payment API into our app.
  - 我们需要把他们的支付 API 集成到我们的应用里。
- **例句2**: This API documentation is really well written.
  - 这个 API 文档写得真不错。

## 2. 日本語:
- **翻訳**: API（エーピーアイ）/ アプリケーション・プログラミング・インターフェース
- **解説**: ソフトウェア同士(どうし)が通信(つうしん)するためのルール集(しゅう)
- **例句1**: この API(エーピーアイ)を使(つか)えば、簡単(かんたん)にデータを取得(しゅとく)できます。
  - 使用这个 API 就能轻松获取数据。
- **例句2**: REST API(レスト・エーピーアイ)の設計(せっけい)について勉強(べんきょう)してるんだ。
  - 我正在学习 REST API 的设计。

## 3. 中文:
- **翻译**: 应用程序编程接口
- **解释**: 允许不同软件系统相互通信的一组规则和协议

## 4. 技术概念简要说明
应用程序编程接口（API）是一组预定义的函数、协议和工具，允许不同的软件系统相互通信和交换数据。它定义了软件组件之间交互的方式，隐藏了内部实现细节，只暴露必要的接口。常见类型包括 REST API、GraphQL API 等。开发者通过调用 API 可以实现跨系统的功能集成，如第三方登录、支付、地图服务等。API 的设计质量直接影响系统的可维护性和扩展性。`
    },

    // 示例 3: 多义词
    ambiguous: {
        input: "run",
        output: `# run

## 1. 英文:
- **翻译**: run [原文]
- **解释**: To move fast on foot; also means to operate programs or manage businesses
- **例句1**: I usually run in the park every morning.
  - 我通常每天早上在公园跑步。
- **例句2**: Can you run this script and see if it works?
  - 你能运行这个脚本看看是否正常吗？

## 2. 日本語:
- **翻訳**: 走(はし)る / 実行(じっこう)する / 運営(うんえい)する
- **解説**: 足(あし)を速(はや)く動(うご)かして移動(いどう)すること、またはプログラムを動(うご)かすこと
- **例句1**: 毎朝(まいあさ)30分(ぷん)くらい走(はし)ってるよ。
  - 我每天早上跑步大约30分钟。
- **例句2**: このプログラムを実行(じっこう)してみて。
  - 试试运行这个程序。

## 3. 中文:
- **翻译**: 跑步 / 运行 / 经营
- **解释**: 快速移动的动作，也指程序执行或业务运营`
    },

    // 示例 4: 日语输入（重要：展示日语输入的正确格式）
    japanese: {
        input: "こんにちは",
        output: `# こんにちは

## 1. 英文:
- **翻译**: Hello / Hi
- **解释**: A common Japanese greeting used during the day
- **例句1**: Hello, how are you doing today?
  - 你好，你今天过得怎么样？
- **例句2**: Hi there, nice to meet you!
  - 嗨，很高兴见到你！

## 2. 日本語:
- **翻訳**: こんにちは [原文]
- **解説**: 昼間(ひるま)に使(つか)う一般的(いっぱんてき)な挨拶(あいさつ)
- **例句1**: こんにちは、お元気(げんき)ですか？
  - 你好，你还好吗？
- **例句2**: こんにちは、初(はじ)めまして！
  - 你好，初次见面！

## 3. 中文:
- **翻译**: 你好
- **解释**: 日语中白天使用的常见问候语`
    }
};

// ========== 提示词构建函数 ==========

/**
 * 构建完整的三语翻译提示词（完整优化版）
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
- **翻訳**: ...
- **解説**: ...
- **例句1**: 日文句子
  - 中文翻译
- **例句2**: 日文句子
  - 中文翻译
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

module.exports = { buildPrompt };
