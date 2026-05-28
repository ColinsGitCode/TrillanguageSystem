function escapeMarkdownText(value) {
  return String(value || '').replace(/\r?\n/g, ' ').trim();
}

function buildTrilingualMarkdown(phrase) {
  const safePhrase = escapeMarkdownText(phrase);
  return `# ${safePhrase}

## 1. 英文:
- **翻译**: ${safePhrase}
- **解释**: E2E 测试模式生成的稳定示例，用于验证 UI、队列与持久化链路。
- **例句1**: We use "${safePhrase}" as a deterministic Playwright smoke sample.
  - 我们把“${safePhrase}”作为稳定的 Playwright smoke 测试样本。
- **例句2**: The generated card for "${safePhrase}" should be safe to delete after the test.
  - “${safePhrase}”生成出的卡片在测试结束后应可安全删除。

## 2. 日本語:
- **翻訳**: ${safePhrase}
- **解説**: UI テスト用の固定サンプルです。生成・表示・削除の確認に使います。
- **例句1**: 「${safePhrase}」は Playwright の安定した検証用サンプルです。
  - “${safePhrase}”是 Playwright 的稳定验证样本。
- **例句2**: テスト後に「${safePhrase}」のカードを削除できる必要があります。
  - 测试后需要能够删除“${safePhrase}”这张卡片。

## 3. 中文:
- **翻译**: ${safePhrase}
- **解释**: 这是 E2E 测试模式下生成的固定内容，用于验证页面显示、任务队列和删除逻辑。
`;
}

function buildGrammarMarkdown(phrase) {
  const safePhrase = escapeMarkdownText(phrase);
  return `# ${safePhrase}

## 语法说明
- **中文讲解**: 这是 E2E 测试模式下的固定语法卡内容，用于验证语法卡生成、展示与删除链路。
- **核心语法点**: 句型「${safePhrase}」在此仅作为测试占位，不代表真实语法结论。

## 日语例句
- **例句1**: テストでは「${safePhrase}」という表現を使って画面の動作を確認します。
  - 测试中用“${safePhrase}”这个表达来确认页面行为。
- **例句2**: 「${safePhrase}」の語法カードが正常に作成されればテスト成功です。
  - 如果“${safePhrase}”的语法卡能正常生成，则测试成功。
`;
}

function buildFixtureContent({ phrase, cardType }) {
  return {
    markdown_content: String(cardType || '').trim().toLowerCase() === 'grammar_ja'
      ? buildGrammarMarkdown(phrase)
      : buildTrilingualMarkdown(phrase),
    html_content: '',
    audio_tasks: []
  };
}

function buildFixtureObservability({ provider, model, phrase, cardType, sourceMode }) {
  return {
    tokens: {
      input: 128,
      output: 256,
      total: 384,
      cached: 0
    },
    cost: {
      input: 0,
      output: 0,
      total: 0,
      currency: 'USD'
    },
    performance: {
      totalTime: 120,
      phases: {
        promptBuild: 10,
        llmCall: 50,
        jsonParse: 20,
        render: 20,
        save: 20
      }
    },
    quality: {
      score: 100,
      checks: [],
      dimensions: {
        completeness: 40,
        accuracy: 30,
        exampleQuality: 20,
        formatting: 10
      },
      warnings: []
    },
    prompt: {
      text: `E2E fixture prompt for ${safePreview(phrase)}`,
      mode: 'e2e-fixture'
    },
    metadata: {
      provider: provider || 'gemini',
      model: model || 'e2e-fixture',
      cardType: cardType || 'trilingual',
      sourceMode: sourceMode || 'input',
      e2eFixture: true
    }
  };
}

function safePreview(text) {
  return escapeMarkdownText(text).slice(0, 60) || 'fixture';
}

module.exports = {
  buildFixtureContent,
  buildFixtureObservability
};
