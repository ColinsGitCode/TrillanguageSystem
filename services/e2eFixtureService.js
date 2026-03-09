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

function buildTrainingPayload(phrase, cardType) {
  const safePhrase = escapeMarkdownText(phrase);
  const isGrammar = String(cardType || '').trim().toLowerCase() === 'grammar_ja';
  return {
    schemaVersion: 'training_pack_v1',
    phrase: safePhrase,
    cardType: isGrammar ? 'grammar_ja' : 'trilingual',
    enCollocations: [
      {
        id: 'en-1',
        pattern: `${safePhrase} workflow`,
        meaningZh: `${safePhrase} 工作流`,
        usageZh: '用于验证英文搭配区域是否正常渲染。',
        exampleEn: `The ${safePhrase} workflow should finish without external dependencies.`,
        exampleZh: `${safePhrase} 工作流应在没有外部依赖的情况下完成。`,
        distractors: [`${safePhrase} failure`, `${safePhrase} delay`],
        difficulty: 1
      },
      {
        id: 'en-2',
        pattern: 'queue state',
        meaningZh: '队列状态',
        usageZh: '用于验证任务队列相关训练项展示。',
        exampleEn: 'The queue state should move from running to success.',
        exampleZh: '队列状态应从运行中变为成功。',
        distractors: ['queue drop', 'queue crash'],
        difficulty: 1
      },
      {
        id: 'en-3',
        pattern: 'persistent highlight',
        meaningZh: '持久化高亮',
        usageZh: '用于验证刷新后高亮仍可恢复。',
        exampleEn: 'A persistent highlight should remain after reload.',
        exampleZh: '持久化高亮应在刷新后仍然保留。',
        distractors: ['volatile highlight', 'lost highlight'],
        difficulty: 2
      },
      {
        id: 'en-4',
        pattern: 'smoke test',
        meaningZh: '冒烟测试',
        usageZh: '用于验证 Playwright 基础回归链路。',
        exampleEn: 'This smoke test verifies the modal and training tab.',
        exampleZh: '这条冒烟测试会验证弹窗和 TRAIN 页。 ',
        distractors: ['unit test', 'manual note'],
        difficulty: 1
      }
    ],
    jaChunks: [
      {
        id: 'ja-1',
        chunk: '正常に表示される',
        reading: 'せいじょうにひょうじされる',
        meaningZh: '正常显示',
        usageZh: '用于验证卡片内容渲染。',
        exampleJa: 'カードが正常に表示されることを確認します。',
        exampleZh: '确认卡片能够正常显示。',
        grammarLabel: '副词 + 动词被动形',
        distractors: ['表示されない', '削除されるだけ'],
        difficulty: 1
      },
      {
        id: 'ja-2',
        chunk: '削除しても問題ない',
        reading: 'さくじょしてももんだいない',
        meaningZh: '删除也没问题',
        usageZh: '用于验证测试数据清理场景。',
        exampleJa: 'このテストカードは削除しても問題ないです。',
        exampleZh: '这张测试卡删除也没有问题。',
        grammarLabel: 'ても + 問題ない',
        distractors: ['削除してはいけない', '保存だけする'],
        difficulty: 1
      },
      {
        id: 'ja-3',
        chunk: 'キューに追加する',
        reading: 'きゅーについかする',
        meaningZh: '加入队列',
        usageZh: '用于验证后台任务队列流程。',
        exampleJa: '選択した語句をキューに追加します。',
        exampleZh: '把选中的短语加入队列。',
        grammarLabel: '名词 + に + 动词',
        distractors: ['キューを削除する', 'キューを閉じる'],
        difficulty: 1
      },
      {
        id: 'ja-4',
        chunk: '再読み込み後も残る',
        reading: 'さいよみこみごものこる',
        meaningZh: '刷新后仍保留',
        usageZh: '用于验证高亮恢复。',
        exampleJa: '標紅は再読み込み後も残る必要があります。',
        exampleZh: '标红在刷新后也需要保留。',
        grammarLabel: '名词 + 後も + 动词',
        distractors: ['再読み込みで消える', '一度だけ表示する'],
        difficulty: 2
      }
    ],
    quizzes: [
      {
        id: 'q-1',
        lang: 'en',
        type: 'cloze',
        question: 'A persistent ____ should remain after reload.',
        answer: 'highlight',
        choices: ['highlight', 'timeout', 'popup'],
        explanationZh: '此题用于验证高亮恢复相关词汇。',
        relatedUnitIds: ['en-3']
      },
      {
        id: 'q-2',
        lang: 'en',
        type: 'choice',
        question: 'Which phrase best matches queue progress validation?',
        answer: 'queue state',
        choices: ['queue state', 'manual step', 'empty card'],
        explanationZh: '此题用于验证任务队列相关训练项。',
        relatedUnitIds: ['en-2']
      },
      {
        id: 'q-3',
        lang: 'ja',
        type: 'cloze',
        question: '選択した語句を____追加します。',
        answer: 'キューに',
        choices: ['キューに', '画面に', '手動で'],
        explanationZh: '用于验证“加入队列”的日语表达。',
        relatedUnitIds: ['ja-3']
      },
      {
        id: 'q-4',
        lang: 'ja',
        type: 'choice',
        question: '標紅が保持される状態を表すのはどれですか。',
        answer: '再読み込み後も残る',
        choices: ['再読み込み後も残る', '削除しても問題ない', '正常に表示される'],
        explanationZh: '用于验证高亮持久化语块。',
        relatedUnitIds: ['ja-4']
      }
    ],
    quality: {
      selfConfidence: 1,
      coverageScore: 1,
      notes: 'E2E fixture payload'
    }
  };
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
  buildFixtureObservability,
  buildTrainingPayload
};
