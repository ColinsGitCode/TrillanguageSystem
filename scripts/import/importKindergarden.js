#!/usr/bin/env node
'use strict';

/**
 * scripts/import/importKindergarden.js
 *
 * 批量把「保育园联络簿常用日语词汇与语法」导入生成队列。
 * 来源: Docs/kindergarden_保育园联络簿常用日语词汇与语法总结.md
 *
 * 用法:
 *   node scripts/import/importKindergarden.js              # dry-run（仅预览，不入队）
 *   node scripts/import/importKindergarden.js --apply      # 正式入队
 *   node scripts/import/importKindergarden.js --apply --server=http://localhost:3010
 *
 * 生成完成后，在 Knowledge Hub 依次点击：
 *   「重建索引」→「重建分类」完成语义归类。
 */

// ─── 卡片数据：27 张三语词汇卡 + 3 张日语语法卡 = 30 张 ───────────────────────

const PHRASES = [
  // ── 一、常用健康表达（9 张 trilingual） ──────────────────────────────────────
  { phrase: '元気に過ごしています',                          card_type: 'trilingual' },
  { phrase: '食欲も良好です',                               card_type: 'trilingual' },
  { phrase: 'ぐっすり眠れました',                            card_type: 'trilingual' },
  { phrase: '機嫌よく過ごしていました',                       card_type: 'trilingual' },
  { phrase: '鼻水の症状があります',                          card_type: 'trilingual' },
  { phrase: '咳の症状があります',                            card_type: 'trilingual' },
  { phrase: '便秘気味です',                                 card_type: 'trilingual' },
  { phrase: '薬を服用しています',                            card_type: 'trilingual' },
  { phrase: '引き続き様子を見ています',                       card_type: 'trilingual' },

  // ── 二、常用睡眠表达（5 张 trilingual） ──────────────────────────────────────
  { phrase: '昨夜は早めに就寝しました',                       card_type: 'trilingual' },
  { phrase: '今朝は元気に起きました',                         card_type: 'trilingual' },
  { phrase: '睡眠リズムが安定しています',                      card_type: 'trilingual' },
  { phrase: '夜間は安眠できました',                           card_type: 'trilingual' },
  { phrase: '睡眠はやや浅めでした',                           card_type: 'trilingual' },

  // ── 三、常用饮食表达（5 张 trilingual） ──────────────────────────────────────
  { phrase: '食欲もあります',                                card_type: 'trilingual' },
  { phrase: '食欲・元気ともに良好です',                        card_type: 'trilingual' },
  { phrase: 'たくさん食べました',                             card_type: 'trilingual' },
  { phrase: '食事量はやや少なめでした',                        card_type: 'trilingual' },
  { phrase: '水分補給を心がけています',                        card_type: 'trilingual' },

  // ── 四、成长记录表达（5 张 trilingual） ──────────────────────────────────────
  { phrase: '最近は言葉が増えてきました',                      card_type: 'trilingual' },
  { phrase: '発音がはっきりしてきました',                      card_type: 'trilingual' },
  { phrase: '一人で遊ぶようになってきました',                   card_type: 'trilingual' },
  { phrase: '絵本に興味を持っています',                        card_type: 'trilingual' },
  { phrase: '真似をするようになりました',                      card_type: 'trilingual' },

  // ── 七、常用结尾（3 张 trilingual） ──────────────────────────────────────────
  { phrase: '本日もどうぞよろしくお願いいたします',               card_type: 'trilingual' },
  { phrase: '引き続き様子を見ていきたいと思います',               card_type: 'trilingual' },
  { phrase: 'ご迷惑をおかけしますが、よろしくお願いいたします',    card_type: 'trilingual' },

  // ── 五、常用语法（3 张 grammar_ja） ───────────────────────────────────────────
  { phrase: '〜ている',               card_type: 'grammar_ja' },
  { phrase: '〜ようです',             card_type: 'grammar_ja' },
  { phrase: '〜ようになってきました',   card_type: 'grammar_ja' },
];

// ─── CLI 参数 ─────────────────────────────────────────────────────────────────

const APPLY      = process.argv.includes('--apply');
const serverArg  = process.argv.find((a) => a.startsWith('--server='));
const SERVER     = serverArg ? serverArg.slice('--server='.length).replace(/\/$/, '') : 'http://localhost:3010';
const DELAY_MS   = 600;   // 每次入队之间的延迟，避免超速
const TARGET_FOLDER = '保育园联络簿';

// ─── 入队逻辑 ─────────────────────────────────────────────────────────────────

async function enqueueOne(item) {
  const res = await fetch(`${SERVER}/api/generation-jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      phrase:         item.phrase,
      card_type:      item.card_type,
      target_folder:  TARGET_FOLDER,
    }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const trilingual = PHRASES.filter((p) => p.card_type === 'trilingual').length;
  const grammar    = PHRASES.filter((p) => p.card_type === 'grammar_ja').length;

  console.log('═══════════════════════════════════════════════════');
  console.log('  保育园联络簿 批量导入');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  服务器      : ${SERVER}`);
  console.log(`  目标文件夹  : ${TARGET_FOLDER}`);
  console.log(`  模式        : ${APPLY ? 'APPLY（正式入队）' : 'DRY-RUN（预览，加 --apply 执行）'}`);
  console.log(`  卡片总数    : ${PHRASES.length}  （trilingual ${trilingual} + grammar_ja ${grammar}）`);
  console.log('───────────────────────────────────────────────────');

  // ── dry-run：仅列出清单 ─────────────────────────────────────────────────────
  if (!APPLY) {
    const byType = { trilingual: [], grammar_ja: [] };
    for (const item of PHRASES) byType[item.card_type].push(item.phrase);

    console.log('\n  【三语词汇卡 trilingual】');
    byType.trilingual.forEach((p, i) => console.log(`    ${String(i + 1).padStart(2, '0')}. ${p}`));

    console.log('\n  【日语语法卡 grammar_ja】');
    byType.grammar_ja.forEach((p, i) => console.log(`    ${String(i + 1).padStart(2, '0')}. ${p}`));

    console.log('\n  提示: 加 --apply 开始入队。');
    return;
  }

  // ── apply：逐条入队 ─────────────────────────────────────────────────────────
  const stats = { queued: 0, duplicate: 0, error: 0 };

  for (const [i, item] of PHRASES.entries()) {
    const idx = `[${String(i + 1).padStart(2, '0')}/${PHRASES.length}]`;
    try {
      const { status, body } = await enqueueOne(item);
      if (status === 200) {
        stats.queued += 1;
        console.log(`${idx} ✓ 入队  [${item.card_type.padEnd(11)}] ${item.phrase}  (job #${body.job?.id})`);
      } else if (status === 409) {
        stats.duplicate += 1;
        console.log(`${idx} ⊖ 已存在 [${item.card_type.padEnd(11)}] ${item.phrase}`);
      } else {
        stats.error += 1;
        console.error(`${idx} ✗ HTTP ${status}: ${body.error || JSON.stringify(body)}`);
      }
    } catch (err) {
      stats.error += 1;
      console.error(`${idx} ✗ 网络错误: ${err.message}`);
    }
    if (i < PHRASES.length - 1) await sleep(DELAY_MS);
  }

  // ── 汇总 ────────────────────────────────────────────────────────────────────
  console.log('───────────────────────────────────────────────────');
  console.log(`  成功入队    : ${stats.queued}`);
  console.log(`  已存在跳过  : ${stats.duplicate}`);
  console.log(`  错误        : ${stats.error}`);
  console.log('═══════════════════════════════════════════════════');

  if (stats.queued > 0) {
    console.log('\n  后续步骤：');
    console.log('  1. 在 Dashboard / Generation Jobs 面板等待生成完成');
    console.log('  2. 打开 Knowledge Hub → 「重建索引」（index job）');
    console.log('  3. Knowledge Hub → 「重建分类」（cluster job）完成语义归类');
    console.log(`  4. 在 Knowledge Hub 切到「主题领域」或「句式功能」轴浏览 ${TARGET_FOLDER} 卡片`);
  }
  if (stats.error > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[fatal]', err.message);
  process.exit(1);
});
