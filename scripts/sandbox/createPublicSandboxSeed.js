'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dbService = require('../../services/storage/databaseService');
const { contentHash } = require('../../services/dataPreparation/rules');

const recordsRoot = path.resolve(process.env.RECORDS_PATH || '');
const folderName = 'demo';
const folderPath = path.join(recordsRoot, folderName);

function observability() {
  return {
    tokensInput: 0,
    tokensOutput: 0,
    tokensTotal: 0,
    tokensCached: 0,
    costInput: 0,
    costOutput: 0,
    costTotal: 0,
    costCurrency: 'USD',
    quotaUsed: 0,
    quotaLimit: 0,
    quotaRemaining: 0,
    quotaResetAt: null,
    quotaPercentage: 0,
    performanceTotalMs: 0,
    performancePhases: '{}',
    qualityScore: 100,
    qualityChecks: '[]',
    qualityDimensions: '{}',
    qualityWarnings: '[]',
    promptFull: 'Synthetic public sandbox seed',
    promptParsed: '{}',
    llmOutput: '{}',
    llmFinishReason: 'seed',
    metadata: JSON.stringify({ source: 'public-sandbox-synthetic-v1' }),
  };
}

function scenarioMarkdown() {
  const expressions = [
    ['我想点一杯咖啡。', 'I would like a cup of coffee.', 'コーヒーを一杯お願いします。'],
    ['请给我菜单。', 'May I see the menu?', 'メニューを見せてください。'],
    ['今天的推荐是什么？', 'What do you recommend today?', '今日のおすすめは何ですか。'],
    ['我要一杯拿铁。', 'I will have a latte.', 'カフェラテをお願いします。'],
    ['请不要加糖。', 'No sugar, please.', '砂糖は入れないでください。'],
    ['可以换成燕麦奶吗？', 'Can I have oat milk instead?', 'オーツミルクに変えられますか。'],
    ['我要热的。', 'I would like it hot.', 'ホットでお願いします。'],
    ['我要冰的。', 'I would like it iced.', 'アイスでお願いします。'],
    ['中杯就好。', 'A medium is fine.', 'ミディアムで大丈夫です。'],
    ['我在这里喝。', 'I will have it here.', '店内で飲みます。'],
    ['我要带走。', 'To go, please.', '持ち帰りでお願いします。'],
    ['可以刷卡吗？', 'Can I pay by card?', 'カードで払えますか。'],
    ['请给我收据。', 'May I have a receipt?', 'レシートをください。'],
    ['一共多少钱？', 'How much is it altogether?', '全部でいくらですか。'],
    ['还需要等多久？', 'How long will it take?', 'どのくらいかかりますか。'],
    ['我的订单好了吗？', 'Is my order ready?', '注文はできましたか。'],
    ['这是我点的吗？', 'Is this my order?', 'これは私の注文ですか。'],
    ['味道很好。', 'It tastes great.', 'とてもおいしいです。'],
    ['谢谢你的帮助。', 'Thank you for your help.', '手伝ってくれてありがとうございます。'],
    ['下次见。', 'See you next time.', 'また今度。'],
  ];
  return [
    '# 咖啡店点单',
    '',
    '## 1. 场景说明',
    '- 在咖啡店点单、确认规格并付款。',
    '',
    '## 2. 常用表达',
    ...expressions.flatMap((item, index) => [
      '',
      `### ${String(index + 1).padStart(2, '0')}.`,
      `- **中文**: ${item[0]}`,
      `- **英文**: ${item[1]}`,
      `- **日文**: ${item[2]}`,
    ]),
  ].join('\n');
}

const cards = [
  {
    baseName: 'demo-handoff',
    phrase: 'handoff',
    cardType: 'trilingual',
    markdown: `# handoff

## 1. 英文:
- **Translation**: transfer of responsibility
- **Explanation**: the act of passing a task, responsibility, or control to another person
- **Example**: Let us do a quick handoff before the meeting.
- **例句翻译**: 开会前我们快速交接一下。

## 2. 日本語:
- **翻訳**: 引き継ぎ
- **説明**: 仕事や責任を別の人に渡すこと
- **例文**: 会議の前に簡単な<ruby>引<rt>ひ</rt></ruby>き<ruby>継<rt>つ</rt></ruby>ぎをしましょう。

## 3. 中文:
- **释义**: 工作、责任或控制权的交接。`,
  },
  {
    baseName: 'demo-grammar',
    phrase: '～ことになっている',
    cardType: 'grammar_ja',
    markdown: `# ～ことになっている

## 1. 语法说明
- 表示已经确定的规则、安排或制度。

## 2. 例句
- この<ruby>図書館<rt>としょかん</rt></ruby>では、<ruby>静<rt>しず</rt></ruby>かにすることになっています。
- 这家图书馆规定要保持安静。

## 3. 对比
- 「ことにしている」更强调说话人自己决定并保持的习惯。`,
  },
  {
    baseName: 'demo-cafe',
    phrase: '咖啡店点单',
    cardType: 'scenario_phrase',
    markdown: scenarioMarkdown(),
  },
];

function writeCardFiles(card, createdAt) {
  fs.mkdirSync(folderPath, { recursive: true });
  const mdPath = path.join(folderPath, `${card.baseName}.md`);
  const htmlPath = path.join(folderPath, `${card.baseName}.html`);
  const metaPath = path.join(folderPath, `${card.baseName}.meta.json`);
  fs.writeFileSync(mdPath, card.markdown, 'utf8');
  fs.writeFileSync(
    htmlPath,
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${card.phrase}</title><body><main>${card.phrase}</main></body></html>`,
    'utf8'
  );
  fs.writeFileSync(metaPath, JSON.stringify({
    phrase: card.phrase,
    card_type: card.cardType,
    source_mode: 'public-sandbox-seed',
    created_at: createdAt,
  }, null, 2), 'utf8');
  return { mdPath, htmlPath, metaPath };
}

function insertCard(card, index) {
  const createdAt = new Date(Date.now() + index * 1_000).toISOString();
  const files = writeCardFiles(card, createdAt);
  const hash = contentHash(card.markdown);
  return dbService.insertGeneration({
    generation: {
      phrase: card.phrase,
      phraseLanguage: card.cardType === 'grammar_ja' ? 'ja' : 'mixed',
      cardType: card.cardType,
      sourceMode: 'input',
      llmProvider: 'deepseek',
      llmModel: 'deepseek-v4-pro',
      folderName,
      baseFilename: card.baseName,
      mdFilePath: files.mdPath,
      htmlFilePath: files.htmlPath,
      metaFilePath: files.metaPath,
      markdownContent: card.markdown,
      contentHash: hash,
      enTranslation: null,
      jaTranslation: null,
      zhTranslation: card.phrase,
      generationDate: createdAt.slice(0, 10),
      requestId: `sandbox_seed_${index + 1}`,
    },
    observability: observability(),
    audioFiles: [],
    cardTags: [
      {
        namespace: 'src',
        value: 'public-sandbox',
        normalizedValue: 'public-sandbox',
        ruleVersion: 'public-sandbox-seed-v1',
        ruleKey: `seed:${card.baseName}`,
        evidenceJson: JSON.stringify({ synthetic: true }),
      },
      {
        namespace: 'qa',
        value: 'confirmed',
        normalizedValue: 'confirmed',
        ruleVersion: 'public-sandbox-seed-v1',
        ruleKey: `seed:${card.baseName}:qa`,
        evidenceJson: JSON.stringify({ synthetic: true }),
      },
    ],
    learningAdmission: {
      status: 'eligible',
      contentHash: hash,
      reasons: ['synthetic-public-sandbox'],
      decisionVersion: 'public-sandbox-seed-v1',
      stateVersion: 'learning-admission-v1',
      disposition: 'create-items',
    },
  });
}

try {
  const existing = dbService.getTotalCount({});
  if (existing === 0) cards.forEach(insertCard);
  process.stdout.write(JSON.stringify({ seeded: existing === 0, cards: existing === 0 ? cards.length : existing }));
  dbService.close();
} catch (error) {
  try { dbService.close(); } catch {}
  process.stderr.write(error.stack || String(error));
  process.exitCode = 1;
}
