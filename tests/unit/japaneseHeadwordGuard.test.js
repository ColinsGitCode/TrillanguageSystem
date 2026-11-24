'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyJapaneseHeadword,
  enforceJapaneseHeadwordInMarkdown,
  hasJapanesePromptHint,
} = require('../../services/generation/japaneseHeadwordGuard');
const {
  buildTokens,
  stripMarkdownToJapaneseText,
} = require('../../services/pronunciation/pronunciationService');

function buildCard({ phrase, jaHeadword, jaExplanation = '説明文です。', jaEx1 = '例文1です。', jaEx2 = '例文2です。' }) {
  return [
    `# ${phrase}`,
    '## 1. 英文:',
    '- **翻译**: measurement',
    '- **解释**: English explanation.',
    '- **例句1**: Sample sentence one.',
    '  - 示例翻译一。',
    '- **例句2**: Sample sentence two.',
    '  - 示例翻译二。',
    '## 2. 日本語:',
    `- **翻訳**: ${jaHeadword}`,
    `- **解説**: ${jaExplanation}`,
    `- **例句1**: ${jaEx1}`,
    '  - 示例翻译一。',
    `- **例句2**: ${jaEx2}`,
    '  - 示例翻译二。',
    '## 3. 中文:',
    '- **翻译**: 测量',
    '- **解释**: 中文说明。',
    '- **语域**: 书面',
    '- **辨析**: 无',
  ].join('\n');
}

function extractJaHeadword(markdown) {
  const m = String(markdown || '').match(/## 2\. 日本語:[\s\S]*?- \*\*翻訳\*\*:\s*(.+?)(?:\n|$)/u);
  return m ? m[1].trim() : '';
}

test.describe('japaneseHeadwordGuard', () => {
  test.it('detects Japanese prompt hints for Japanese kanji and kana words, not Chinese or English', () => {
    assert.equal(hasJapanesePromptHint('計測'), true);
    assert.equal(hasJapanesePromptHint('受領'), true);
    assert.equal(hasJapanesePromptHint('充実'), true);
    assert.equal(hasJapanesePromptHint('補足指標'), true);
    assert.equal(hasJapanesePromptHint('仕分け'), true);
    assert.equal(hasJapanesePromptHint('発注システム'), true);

    assert.equal(hasJapanesePromptHint('measurement'), false);
    assert.equal(hasJapanesePromptHint('测量'), false);
    assert.equal(hasJapanesePromptHint('确认'), false);
    assert.equal(hasJapanesePromptHint('配置'), false);
    assert.equal(hasJapanesePromptHint('全量测试'), false);
  });

  test.it('enforces exact Japanese kanji headword and guarantees accurate reading instead of a synonym', async () => {
    const { readingFromTokens } = await import('../../app/features/card-modal/card-layout.mjs');

    const regressions = [
      {
        phrase: '計測',
        badJa: '測定',
        jaEx1: 'まず計測してから設計しよう。',
        jaEx2: 'この機械、計測がちょっとずれてるみたい。',
        expectedReading: 'けいそく',
      },
      {
        phrase: '受領',
        badJa: '受け取ること。金品や書類などを受け取ることを表す。',
        jaEx1: '荷物はもう受領したよ。',
        jaEx2: '確認後に受領印を押します。',
        expectedReading: 'じゅりょう',
      },
      {
        phrase: '充実',
        badJa: '満たされていること、中身がぎっしり詰まっていること',
        jaEx1: '最近は仕事もプライベートもすごく充実している。',
        jaEx2: 'この本は中身が充実している。',
        expectedReading: 'じゅうじつ',
      },
      {
        phrase: '補足指標',
        badJa: '補助指標 / サブ指標',
        jaEx1: 'これはあくまで補足指標だから参考程度に見よう。',
        jaEx2: '会議では補足指標も見せよう。',
        expectedReading: 'ほそくしひょう',
      },
      {
        phrase: '翌月',
        badJa: '来月、次の月',
        jaEx1: '翌月の頭にまた連絡するね。',
        jaEx2: '家賃は翌月分を前払いする。',
        expectedReading: 'よくげつ',
      },
      {
        phrase: '仕分け',
        badJa: '物を種類や基準に従って分けること',
        jaEx1: '荷物の仕分けが終わった。',
        jaEx2: '領収書を仕分けしておこう。',
        expectedReading: 'しわけ',
      },
      {
        phrase: '発注システム',
        badJa: '注文を出したり管理したりするための仕組み',
        jaEx1: '新しい発注システムを導入した。',
        jaEx2: '発注システムが停止している。',
        expectedReading: 'はっちゅうシステム',
      },
      {
        phrase: '段落に分けて',
        badJa: 'break it into paragraphs',
        jaEx1: '読みやすいように段落に分けてください。',
        jaEx2: '長い文章は段落に分けて書こう。',
        expectedReading: 'だんらくにわけて',
      },
    ];

    for (const item of regressions) {
      const original = buildCard({
        phrase: item.phrase,
        jaHeadword: item.badJa,
        jaEx1: item.jaEx1,
        jaEx2: item.jaEx2,
      });
      const enforced = await enforceJapaneseHeadwordInMarkdown(original, {
        phrase: item.phrase,
        cardType: 'trilingual',
      });
      assert.equal(extractJaHeadword(enforced), item.phrase, `headword should be preserved for ${item.phrase}`);

      // Verify idempotency
      const twice = await enforceJapaneseHeadwordInMarkdown(enforced, {
        phrase: item.phrase,
        cardType: 'trilingual',
      });
      assert.equal(twice, enforced);

      // Verify pronunciation projection produces the exact reading of the input word
      const plain = stripMarkdownToJapaneseText(`- **翻訳**: ${extractJaHeadword(enforced)}`);
      const { tokens } = await buildTokens(plain, { allowLegacyRuby: false });
      const reading = readingFromTokens(plain, tokens, item.phrase);
      assert.equal(reading, item.expectedReading, `reading should be ${item.expectedReading} for ${item.phrase}`);
    }
  });

  test.it('does not overwrite Japanese translations for Simplified Chinese, shared-kanji Chinese, or English inputs', async () => {
    const preservedTranslations = [
      {
        phrase: '测量',
        jaHeadword: '測定',
        jaEx1: '部屋の長さを測定する。',
        jaEx2: '温度を測定してください。',
      },
      {
        phrase: '分拣人员排班表',
        jaHeadword: '仕分け担当者のシフト表',
        jaEx1: '仕分け担当者のシフト表を確認しよう。',
        jaEx2: '来週のシフト表を共有した。',
      },
      {
        phrase: '单一',
        jaHeadword: '単一',
        jaEx1: '単一の条件で検索する。',
        jaEx2: '単一障害点をなくす。',
      },
      {
        phrase: '配置',
        jaHeadword: '設定する',
        jaEx1: '新しいプリンターの設定を手伝ってくれる？',
        jaEx2: 'アプリを設定したよ。',
      },
      {
        phrase: '充足',
        jaHeadword: '十分な / 足りる',
        jaEx1: '時間は十分あるから、ゆっくり準備しよう。',
        jaEx2: 'この部屋は日光が十分に入る。',
      },
      {
        phrase: 'measurement',
        jaHeadword: '計測',
        jaEx1: 'まず計測してから設計しよう。',
        jaEx2: '計測結果を確認した。',
      },
    ];

    for (const item of preservedTranslations) {
      const md = buildCard(item);
      const cls = await classifyJapaneseHeadword(item.phrase, md);
      assert.equal(cls.preserve, false, `should not overwrite translation for ${item.phrase}`);
      const out = await enforceJapaneseHeadwordInMarkdown(md, {
        phrase: item.phrase,
        cardType: 'trilingual',
      });
      assert.equal(out, md);
    }
  });

  test.it('leaves non-trilingual card types untouched', async () => {
    const md = buildCard({ phrase: '計測', jaHeadword: '測定' });
    assert.equal(
      await enforceJapaneseHeadwordInMarkdown(md, { phrase: '計測', cardType: 'grammar_ja' }),
      md
    );
    assert.equal(
      await enforceJapaneseHeadwordInMarkdown(md, { phrase: '計測', cardType: 'scenario_phrase' }),
      md
    );
  });
});
