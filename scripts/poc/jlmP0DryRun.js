#!/usr/bin/env node
'use strict';

// JLM-P0 dry run: exercises the `jlm-foreign-origin-v1` extraction contract.
//
// Two modes, both strictly read-only — this script never writes SQLite, never
// touches generation Markdown and never creates a proposal row. JLM-D2 owns
// storage; P0 only proves the contract and measures the second call.
//
//   node scripts/poc/jlmP0DryRun.js
//       Offline. Runs the committed fixtures, no network. Reproducible.
//
//   node scripts/poc/jlmP0DryRun.js --db=<records.db> [--limit=5]
//       Adds real-card candidate enumeration, read-only. Still no LLM call.
//
//   node scripts/poc/jlmP0DryRun.js --db=<records.db> --live [--limit=5]
//       Additionally issues the real second DeepSeek call per sampled card to
//       measure tokens, latency and failure rate. Requires DEEPSEEK_API_KEY.

const fs = require('node:fs');
const path = require('node:path');
const {
  REJECTION,
  SCHEMA_VERSION,
  evaluateExtraction,
  katakanaCandidates,
} = require('../../services/languageMetadata/domain/foreignOriginExtraction');

const EXTRACTION_VERSION = 'jlm-extract-v1';
const FIXTURE_PATH = path.join(__dirname, '../../tests/fixtures/jlm-p0-foreign-origin-fixtures.json');

function argValue(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

const dbPath = argValue('db');
const live = process.argv.includes('--live');
const limit = Math.max(1, Math.min(Number(argValue('limit')) || 5, 50));
const reportPath = argValue('report');

function runFixtures() {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
  const results = fixture.cases.map((testCase) => {
    const { accepted, rejected } = evaluateExtraction(testCase.payload, {
      segments: fixture.segments,
      targetKind: fixture.context.targetKind,
      targetId: fixture.context.targetId,
      sourceContentHash: fixture.context.sourceContentHash,
      extractionVersion: fixture.context.extractionVersion,
    });
    const actual = testCase.expect === 'accepted'
      ? (rejected.length === 0 && accepted.length > 0 ? 'accepted' : 'unexpected-rejection')
      : (rejected[0]?.reason || 'unexpected-acceptance');
    return { id: testCase.id, expected: testCase.expect, actual, pass: actual === testCase.expect };
  });
  return { version: fixture.version, results, passed: results.filter((r) => r.pass).length };
}

// Builds the exact prompt the second call would use. Kept here so P0 can report
// its token cost without any of it being wired into card generation.
function buildExtractionPrompt(segments) {
  const numbered = segments
    .map((segment, index) => `${index + 1}. ${segment.text}`)
    .join('\n');
  return [
    '你是日语外来语标注助手。下面是若干条日语正文片段，已按 1 开始编号。',
    '请找出其中来自外语的片假名词，并给出它的外语原词。',
    '',
    '严格要求：',
    `- 只输出 JSON，schema_version 固定为 "${SCHEMA_VERSION}"；`,
    '- segment_index 用上面的编号（从 1 开始）；',
    '- surface 必须与正文中出现的片假名完全一致，不要改写、不要补长音；',
    '- occurrence 表示该 surface 在该片段中的第几次出现，从 1 开始；',
    '- origin_language 只能是 en/fr/de/it/es/pt/nl/ru/la 之一；',
    '- confidence 只能是 high/medium/low；',
    '- 不确定的词直接不要输出，不要猜测；',
    '- 不要输出人名、地名等专有名词。',
    '',
    '输出格式：',
    `{"schema_version":"${SCHEMA_VERSION}","items":[{"segment_index":1,"surface":"データ","occurrence":1,"origin_term":"data","origin_language":"en","confidence":"high"}]}`,
    '',
    '日语片段：',
    numbered,
  ].join('\n');
}

function loadCards(database, cardLimit) {
  const { locateJapaneseSegments, stripMarkdownToJapaneseText } = require('../../services/pronunciation/pronunciationService');
  const rows = database.prepare(`
    SELECT id, phrase, content_hash, markdown_content
    FROM generations
    WHERE card_type <> 'textbook_track' AND markdown_content LIKE '%日本語%'
    ORDER BY id DESC
    LIMIT ?
  `).all(cardLimit);
  return rows.map((row) => {
    const plainText = stripMarkdownToJapaneseText(row.markdown_content);
    const segments = locateJapaneseSegments(row.markdown_content, plainText);
    return {
      generationId: row.id,
      phrase: row.phrase,
      contentHash: row.content_hash,
      segments,
      candidates: katakanaCandidates(segments),
    };
  });
}

async function runLive(cards) {
  const { generateJson } = require('../../services/llm/deepseekService');
  const observations = [];
  for (const card of cards) {
    const prompt = buildExtractionPrompt(card.segments);
    const startedAt = Date.now();
    try {
      const response = await generateJson(prompt);
      const latencyMs = Date.now() - startedAt;
      let payload = null;
      let parseError = null;
      try {
        payload = JSON.parse(response.text);
      } catch (error) {
        parseError = error.message;
      }
      const evaluation = payload
        ? evaluateExtraction(payload, {
          segments: card.segments,
          targetKind: 'generation',
          targetId: card.generationId,
          sourceContentHash: card.contentHash,
          extractionVersion: EXTRACTION_VERSION,
        })
        : { accepted: [], rejected: [{ reason: 'response-not-json' }] };
      observations.push({
        generationId: card.generationId,
        phrase: card.phrase,
        ok: true,
        latencyMs,
        model: response.model,
        usage: response.usage || null,
        parseError,
        candidateCount: card.candidates.length,
        acceptedCount: evaluation.accepted.length,
        rejectedCount: evaluation.rejected.length,
        rejectionReasons: [...new Set(evaluation.rejected.map((entry) => entry.reason))],
        accepted: evaluation.accepted.map((item) => ({
          surface: item.surface,
          originTerm: item.value.originTerm,
          confidence: item.confidence,
        })),
        // Which real katakana words the model simply did not report. This is the
        // difference between "rejected by validation" and "never proposed", and
        // it is the main driver of candidate coverage below 100%.
        missedSurfaces: (() => {
          const proposed = new Set(evaluation.accepted.map((item) => (
            `${item.segmentIndex}:${item.surface}:${item.occurrence}`
          )));
          return card.candidates
            .filter((candidate) => !proposed.has(
              `${candidate.segmentIndex}:${candidate.surface}:${candidate.occurrence}`
            ))
            .map((candidate) => candidate.surface);
        })(),
      });
    } catch (error) {
      observations.push({
        generationId: card.generationId,
        phrase: card.phrase,
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: error.code || error.message,
      });
    }
  }
  return observations;
}

function summarizeLive(observations) {
  const ok = observations.filter((entry) => entry.ok);
  const failed = observations.filter((entry) => !entry.ok);
  const latencies = ok.map((entry) => entry.latencyMs).sort((a, b) => a - b);
  const sum = (values) => values.reduce((total, value) => total + value, 0);
  const totalCandidates = sum(ok.map((entry) => entry.candidateCount));
  const totalAccepted = sum(ok.map((entry) => entry.acceptedCount));
  return {
    cards: observations.length,
    providerFailures: failed.length,
    latencyMsMedian: latencies.length ? latencies[Math.floor(latencies.length / 2)] : null,
    latencyMsMax: latencies.length ? latencies[latencies.length - 1] : null,
    // deepseekService.normalizeUsage reports { input, output, total }.
    inputTokensTotal: sum(ok.map((entry) => Number(entry.usage?.input || 0))),
    outputTokensTotal: sum(ok.map((entry) => Number(entry.usage?.output || 0))),
    tokensPerCardAverage: ok.length
      ? Math.round(sum(ok.map((entry) => Number(entry.usage?.total || 0))) / ok.length)
      : null,
    katakanaCandidates: totalCandidates,
    acceptedProposals: totalAccepted,
    candidateCoverage: totalCandidates ? Number((totalAccepted / totalCandidates).toFixed(4)) : null,
    rejectionReasons: [...new Set(ok.flatMap((entry) => entry.rejectionReasons))],
    missedSurfaces: [...new Set(ok.flatMap((entry) => entry.missedSurfaces || []))],
  };
}

async function main() {
  const report = { generatedAtUtc: new Date().toISOString(), mode: live ? 'live' : (dbPath ? 'read-only' : 'offline') };

  const fixtures = runFixtures();
  report.fixtures = fixtures;
  console.log(`用例集: ${fixtures.version}`);
  console.log(`合同用例: ${fixtures.passed}/${fixtures.results.length} 通过`);
  for (const result of fixtures.results.filter((entry) => !entry.pass)) {
    console.log(`  FAIL ${result.id}: 期望 ${result.expected}，实得 ${result.actual}`);
  }
  console.log(`拒绝原因种类: ${Object.keys(REJECTION).length}`);
  console.log('');

  if (!dbPath) {
    console.log('未提供 --db，跳过真实卡片枚举。本次为纯离线可复现运行，未联网、未读写数据库。');
  } else {
    const Database = require('better-sqlite3');
    const database = new Database(dbPath, { readonly: true });
    try {
      const cards = loadCards(database, limit);
      report.cards = cards.map((card) => ({
        generationId: card.generationId,
        phrase: card.phrase,
        segments: card.segments.length,
        katakanaCandidates: card.candidates.length,
        distinctSurfaces: [...new Set(card.candidates.map((item) => item.surface))].length,
      }));
      const totalCandidates = cards.reduce((total, card) => total + card.candidates.length, 0);
      console.log(`真实卡片样本: ${cards.length} 张（只读）`);
      console.log(`片假名候选: ${totalCandidates} 个`);
      console.log(`估算提取 prompt 字符数: ${cards.reduce((total, card) => total + buildExtractionPrompt(card.segments).length, 0)}`);
      console.log('');

      if (live) {
        console.log('LIVE 模式：将对每张样本卡发起一次真实第二段 LLM 调用（不写库）…');
        const observations = await runLive(cards);
        const summary = summarizeLive(observations);
        report.live = { summary, observations };
        console.log('');
        console.log(`provider 失败      : ${summary.providerFailures}/${summary.cards}`);
        console.log(`延迟中位/最大 (ms) : ${summary.latencyMsMedian} / ${summary.latencyMsMax}`);
        console.log(`输入/输出 tokens   : ${summary.inputTokensTotal} / ${summary.outputTokensTotal}`
          + ` (每卡均 ${summary.tokensPerCardAverage})`);
        console.log(`候选覆盖率        : ${summary.acceptedProposals}/${summary.katakanaCandidates}`
          + (summary.candidateCoverage === null ? '' : ` (${(summary.candidateCoverage * 100).toFixed(1)}%)`));
        console.log(`出现的拒绝原因    : ${summary.rejectionReasons.join(', ') || '（无）'}`);
        console.log(`模型未提出的候选  : ${summary.missedSurfaces.join('、') || '（无）'}`);
        console.log('');
        console.log('注意：候选覆盖率不等于确认覆盖率。以上 proposal 全部为 pending，未经人工确认。');
      } else {
        console.log('未加 --live，未发起任何 LLM 调用。');
      }
    } finally {
      database.close();
    }
  }

  console.log('');
  console.log('本次运行未写入 SQLite、未修改 Markdown、未创建 proposal 记录。');

  if (reportPath) {
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`报告已写入 ${reportPath}`);
  }
  if (fixtures.passed !== fixtures.results.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
