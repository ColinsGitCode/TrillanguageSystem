const fs = require('fs');
const path = require('path');

function formatNum(value, digits = 2) {
  if (value === null || value === undefined || value === '') return '-';
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return num.toFixed(digits);
}

function formatPct(value, digits = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return `${num.toFixed(digits)}%`;
}

function buildKpiSummary(kpi) {
  return [
    `- 可见提升轮次数: **${kpi.improvedRoundCount || 0}/${kpi.totalRounds || 0}**（${formatPct(kpi.improvementRatioPct)})`,
    `- 平均 Teacher 对齐率: **${formatPct(kpi.avgTeacherAlignmentPct)}**`,
    `- 平均稳定性 CV: **${formatPct(kpi.avgStabilityCvPct)}**`,
    `- few-shot 作用可见: **${kpi.fewshotEffectVisible ? '是' : '否'}**`,
    `- 最佳质量轮次: **${kpi.bestQualityRound ? `${kpi.bestQualityRound.roundName} (${formatNum(kpi.bestQualityRound.avgQualityScore, 1)})` : '-'}**`,
    `- 最佳效率轮次: **${kpi.bestEfficiencyRound ? `${kpi.bestEfficiencyRound.roundName} (${formatNum(kpi.bestEfficiencyRound.gainPer1kExtraTokens, 2)})` : '-'}**`
  ].join('\n');
}

function buildRoundTable(roundMetrics = []) {
  const header = [
    '| Round | Avg Quality | ΔQuality | Avg Tokens | ΔTokens | Gain/1kExtraTokens | Teacher Align | Quality SD |',
    '|---|---:|---:|---:|---:|---:|---:|---:|'
  ];
  const rows = roundMetrics
    .filter((row) => Number(row.sampleCount || 0) > 0)
    .map((row) => [
      row.roundName || row.roundNumber,
      formatNum(row.avgQualityScore, 2),
      formatNum(row.deltaQuality, 2),
      formatNum(row.avgTokensTotal, 2),
      formatNum(row.deltaTokens, 2),
      formatNum(row.gainPer1kExtraTokens, 2),
      formatPct(row.teacherAlignmentPct, 1),
      formatNum(row.qualityStdDev, 2)
    ]);
  return [...header, ...rows.map((cells) => `| ${cells.join(' | ')} |`)].join('\n');
}

function main() {
  const experimentId = process.argv[2];
  const outputPathArg = process.argv[3];

  if (!experimentId) {
    console.error('Usage: node scripts/generate_round_kpi_report.js <experimentId> [outputPath]');
    process.exit(1);
  }

  const dataDir = path.join('Docs', 'TestDocs', 'data');
  const datasetPath = path.join(dataDir, `round_trend_${experimentId}.json`);
  if (!fs.existsSync(datasetPath)) {
    console.error(`Dataset not found: ${datasetPath}`);
    process.exit(1);
  }

  const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
  const roundMetrics = Array.isArray(dataset.roundMetrics) ? dataset.roundMetrics : [];
  const kpiSummary = dataset.kpiSummary || {};
  const outputPath = outputPathArg || path.join('Docs', 'TestDocs', `fewshot_round_kpi_report_${experimentId}.md`);

  const report = [
    `# Few-shot 轮次实验报告（${experimentId}）`,
    '',
    `- 生成时间: ${dataset.generatedAt || new Date().toISOString()}`,
    '',
    '## KPI 总览',
    '',
    buildKpiSummary(kpiSummary),
    '',
    '## 轮次指标表',
    '',
    buildRoundTable(roundMetrics),
    '',
    '## 图表',
    '',
    `![](charts/round_quality_trend_${experimentId}.svg)`,
    '',
    `![](charts/round_gain_efficiency_${experimentId}.svg)`,
    '',
    `![](charts/round_alignment_stability_${experimentId}.svg)`,
    '',
    `![](charts/round_gain_tokens_scatter_${experimentId}.svg)`,
    '',
    '## 数据文件',
    '',
    `- Docs/TestDocs/data/round_trend_${experimentId}.json`,
    `- Docs/TestDocs/data/round_metrics_${experimentId}.csv`,
    `- Docs/TestDocs/data/round_kpi_summary_${experimentId}.json`
  ].join('\n');

  fs.writeFileSync(outputPath, report, 'utf8');
  console.log(`[round-report] generated: ${outputPath}`);
}

main();
