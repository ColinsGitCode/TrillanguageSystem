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

function buildScenarioMarkdown(phrase) {
  const safePhrase = escapeMarkdownText(phrase);
  const expressions = [
    {
      zh: '早上好，我来送孩子上学。',
      en: 'Good morning, I am here to drop off my child.',
      ja: 'おはようございます。子供(こども)を送(おく)りに来(き)ました。',
      tip: '到达保育园后先主动说明来意。'
    },
    {
      zh: '昨晚有点咳嗽，但今天早上精神还不错。',
      en: 'There was a slight cough last night, but my child seems fine this morning.',
      ja: '昨夜(さくや)は少(すこ)し咳(せき)が出(で)ましたが、今朝(けさ)は元気(げんき)そうです。',
      tip: '把症状和当前状态一起说清楚。'
    },
    {
      zh: '如果白天咳嗽加重，请联系我。',
      en: 'If the cough gets worse during the day, please contact me.',
      ja: '日中(にっちゅう)に咳(せき)が強(つよ)くなったら、連絡(れんらく)してください。',
      tip: '明确希望老师在什么情况下联系。'
    },
    {
      zh: '体温早上量过，是三十六度八。',
      en: 'I checked the temperature this morning. It was 36.8 degrees.',
      ja: '今朝(けさ)体温(たいおん)を測(はか)ったら、三十六度八分(さんじゅうろくどはちぶ)でした。',
      tip: '健康信息尽量给出具体数字。'
    },
    {
      zh: '今天请先不要让孩子做剧烈运动。',
      en: 'Please avoid strenuous exercise for my child today.',
      ja: '今日(きょう)は激(はげ)しい運動(うんどう)を控(ひか)えさせてください。',
      tip: '请求照顾时用 please 或 ください 保持礼貌。'
    },
    {
      zh: '书包里放了备用口罩。',
      en: 'I put spare masks in the backpack.',
      ja: 'かばんの中(なか)に予備(よび)のマスクを入(い)れてあります。',
      tip: '说明物品位置，方便老师处理。'
    },
    {
      zh: '午睡时如果咳嗽，请让孩子喝点水。',
      en: 'If my child coughs during nap time, please offer some water.',
      ja: 'お昼寝(ひるね)の時(とき)に咳(せき)が出(で)たら、水(みず)を飲(の)ませてください。',
      tip: '给出简单、可执行的照护方式。'
    },
    {
      zh: '今天没有吃药，所以不需要喂药。',
      en: 'My child has not taken medicine today, so no medication is needed.',
      ja: '今日(きょう)は薬(くすり)を飲(の)んでいないので、投薬(とうやく)は不要(ふよう)です。',
      tip: '用不需要喂药避免老师误解。'
    },
    {
      zh: '如果需要提前接回，请给我打电话。',
      en: 'If early pickup is needed, please call me.',
      ja: '早(はや)めのお迎(むか)えが必要(ひつよう)なら、電話(でんわ)してください。',
      tip: '提前接回场景要给出联系方式动作。'
    },
    {
      zh: '我下午五点左右来接孩子。',
      en: 'I will pick up my child around five this afternoon.',
      ja: '午後(ごご)五時(ごじ)ごろ迎(むか)えに来(き)ます。',
      tip: '接送时间用 around 或 ごろ 表示大概时间。'
    },
    {
      zh: '谢谢您今天帮忙留意孩子的情况。',
      en: 'Thank you for keeping an eye on my child today.',
      ja: '今日(きょう)は子供(こども)の様子(ようす)を見(み)ていただき、ありがとうございます。',
      tip: '交代完事项后表达感谢。'
    },
    {
      zh: '我会在联络本里也写一下。',
      en: 'I will also write this in the communication notebook.',
      ja: '連絡帳(れんらくちょう)にも書(か)いておきます。',
      tip: '口头说明后再告知书面记录。'
    }
  ];

  const blocks = expressions.map((item, index) => {
    const number = String(index + 1).padStart(2, '0');
    return `### ${number}. 表达
- **中文**: ${item.zh}
- **英文**: ${item.en}
- **日本語**: ${item.ja}
- **使用提示**: ${item.tip}`;
  }).join('\n\n');

  return `# ${safePhrase}

## 1. 场景说明
- **角色**: 家长在保育园早晨送孩子，与老师沟通孩子昨晚咳嗽的情况。
- **语气**: 礼貌、简洁、具体，避免夸大病情。
- **目标**: 让老师了解孩子状态，并知道白天需要观察和联系的条件。

## 2. 常用表达
${blocks}
`;
}

function buildFixtureContent({ phrase, cardType }) {
  const normalizedCardType = String(cardType || '').trim().toLowerCase();
  return {
    markdown_content: normalizedCardType === 'scenario_phrase'
      ? buildScenarioMarkdown(phrase)
      : normalizedCardType === 'grammar_ja'
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
      provider: provider || 'deepseek',
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
