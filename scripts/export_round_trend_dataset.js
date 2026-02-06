const fs = require('fs');
const path = require('path');
const dbService = require('../services/databaseService');

function writeCsv(filePath, rows, columns) {
  const header = columns.join(',');
  const body = rows.map((row) => columns.map((key) => JSON.stringify(row[key] ?? '')).join(','));
  fs.writeFileSync(filePath, [header, ...body].join('\n'));
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function toNullableNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function safeDivide(numerator, denominator) {
  const n = Number(numerator);
  const d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return n / d;
}

function mean(values = []) {
  if (!values.length) return null;
  const total = values.reduce((acc, v) => acc + v, 0);
  return total / values.length;
}

function stdDev(values = [], avg) {
  if (!values.length) return null;
  const mu = Number.isFinite(avg) ? avg : mean(values);
  const variance = values.reduce((acc, v) => acc + (v - mu) * (v - mu), 0) / values.length;
  return Math.sqrt(variance);
}

function groupSamplesByRound(samples = []) {
  const map = new Map();
  for (const sample of samples) {
    const key = Number(sample.roundNumber);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(sample);
  }
  return map;
}

function computeDeltas(rounds) {
  if (!rounds.length) return [];
  const baseline = rounds.find((row) => Number(row.roundNumber) === 0) || rounds[0];
  return rounds.map((row) => ({
    roundNumber: row.roundNumber,
    roundName: row.roundName,
    deltaQuality: toNumber(row.avgQualityScore) - toNumber(baseline.avgQualityScore),
    deltaTokens: toNumber(row.avgTokensTotal) - toNumber(baseline.avgTokensTotal),
    deltaLatency: toNumber(row.avgLatencyMs) - toNumber(baseline.avgLatencyMs),
    deltaTeacherGap: toNumber(row.teacherGap) - toNumber(baseline.teacherGap)
  }));
}

function computeRoundMetrics(rounds, samples) {
  if (!rounds.length) return [];

  const sampleMap = groupSamplesByRound(samples);
  const baseline = rounds.find((row) => Number(row.roundNumber) === 0) || rounds[0];
  const baselineQuality = toNumber(baseline.avgQualityScore);
  const baselineTokens = toNumber(baseline.avgTokensTotal);
  const baselineLatency = toNumber(baseline.avgLatencyMs);

  let teacherGapReference = null;
  for (const row of rounds) {
    const gap = toNullableNumber(row.teacherGap);
    const score = toNumber(row.avgQualityScore);
    if (gap !== null && score > 0) {
      teacherGapReference = gap;
      break;
    }
  }

  return rounds.map((row) => {
    const roundNumber = Number(row.roundNumber);
    const rowSamples = sampleMap.get(roundNumber) || [];
    const localSamples = rowSamples.filter((s) => Number(s.isTeacher) !== 1);
    const qualitySeries = localSamples
      .filter((s) => Number(s.success) === 1)
      .map((s) => toNumber(s.qualityScore));
    const qualityMean = mean(qualitySeries);
    const qualitySd = stdDev(qualitySeries, qualityMean);
    const avgQuality = toNumber(row.avgQualityScore);
    const avgTokens = toNumber(row.avgTokensTotal);
    const avgLatency = toNumber(row.avgLatencyMs);
    const teacherAvgQuality = toNullableNumber(row.teacherAvgQuality);
    const teacherGap = toNullableNumber(row.teacherGap);
    const sampleCount = toNumber(row.sampleCount);
    const successCount = toNumber(row.successCount);
    const successRate = sampleCount > 0 ? (successCount / sampleCount) * 100 : 0;
    const deltaQuality = avgQuality - baselineQuality;
    const deltaTokens = avgTokens - baselineTokens;
    const deltaLatency = avgLatency - baselineLatency;

    const qualityPer1kTokens = safeDivide(avgQuality, avgTokens / 1000);
    const gainPer1kExtraTokens = deltaTokens > 0 ? safeDivide(deltaQuality, deltaTokens / 1000) : null;
    const tokenIncreasePct = baselineTokens > 0 ? safeDivide(deltaTokens, baselineTokens) * 100 : null;
    const latencyIncreasePct = baselineLatency > 0 ? safeDivide(deltaLatency, baselineLatency) * 100 : null;
    const teacherAlignmentPct = teacherAvgQuality
      ? safeDivide(avgQuality, teacherAvgQuality) * 100
      : null;
    const teacherGapClosurePct = (teacherGapReference !== null && teacherGap !== null)
      ? safeDivide(teacherGapReference - teacherGap, Math.abs(teacherGapReference)) * 100
      : null;

    return {
      roundNumber,
      roundName: row.roundName,
      sampleCount,
      successCount,
      successRate,
      avgQualityScore: avgQuality,
      avgTokensTotal: avgTokens,
      avgLatencyMs: avgLatency,
      deltaQuality,
      deltaTokens,
      deltaLatency,
      qualityPer1kTokens,
      gainPer1kExtraTokens,
      tokenIncreasePct,
      latencyIncreasePct,
      teacherAvgQuality,
      teacherGap,
      teacherAlignmentPct,
      teacherGapClosurePct,
      qualityStdDev: qualitySd,
      qualityCvPct: (qualitySd !== null && avgQuality > 0) ? (qualitySd / avgQuality) * 100 : null,
      fewshotEnabled: Number(row.fewshotEnabled) === 1,
      isImprovedVsBaseline: deltaQuality >= 1.5
    };
  });
}

function computeKpiSummary(roundMetrics = []) {
  if (!roundMetrics.length) return {};
  const localRounds = roundMetrics.filter((r) => r.sampleCount > 0);
  if (!localRounds.length) return {};

  const bestQuality = [...localRounds].sort((a, b) => b.avgQualityScore - a.avgQualityScore)[0] || null;
  const bestGain = [...localRounds].sort((a, b) => b.deltaQuality - a.deltaQuality)[0] || null;
  const bestEfficiency = [...localRounds]
    .filter((r) => r.gainPer1kExtraTokens !== null)
    .sort((a, b) => b.gainPer1kExtraTokens - a.gainPer1kExtraTokens)[0] || null;
  const improvedRounds = localRounds.filter((r) => r.isImprovedVsBaseline);
  const avgTeacherAlignment = mean(localRounds
    .map((r) => r.teacherAlignmentPct)
    .filter((v) => Number.isFinite(v)));
  const avgStabilityCv = mean(localRounds
    .map((r) => r.qualityCvPct)
    .filter((v) => Number.isFinite(v)));

  return {
    totalRounds: localRounds.length,
    improvedRoundCount: improvedRounds.length,
    improvementRatioPct: localRounds.length ? (improvedRounds.length / localRounds.length) * 100 : 0,
    bestQualityRound: bestQuality
      ? { roundNumber: bestQuality.roundNumber, roundName: bestQuality.roundName, avgQualityScore: bestQuality.avgQualityScore }
      : null,
    bestGainRound: bestGain
      ? { roundNumber: bestGain.roundNumber, roundName: bestGain.roundName, deltaQuality: bestGain.deltaQuality }
      : null,
    bestEfficiencyRound: bestEfficiency
      ? {
        roundNumber: bestEfficiency.roundNumber,
        roundName: bestEfficiency.roundName,
        gainPer1kExtraTokens: bestEfficiency.gainPer1kExtraTokens
      }
      : null,
    avgTeacherAlignmentPct: avgTeacherAlignment,
    avgStabilityCvPct: avgStabilityCv,
    fewshotEffectVisible: improvedRounds.length > 0
  };
}

function main() {
  const experimentId = process.argv[2];
  const outDir = process.argv[3] || path.join('Docs', 'TestDocs', 'data');

  if (!experimentId) {
    console.error('Usage: node scripts/export_round_trend_dataset.js <experimentId> [outDir]');
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const rounds = dbService.getExperimentRoundTrend(experimentId);
  const samples = dbService.getExperimentSamples(experimentId);
  const teacherRefs = dbService.getTeacherReferences(experimentId);
  const deltas = computeDeltas(rounds);
  const roundMetrics = computeRoundMetrics(rounds, samples);
  const kpiSummary = computeKpiSummary(roundMetrics);

  const dataset = {
    experimentId,
    rounds,
    samples,
    teacherRefs,
    deltas,
    roundMetrics,
    kpiSummary,
    generatedAt: new Date().toISOString()
  };

  fs.writeFileSync(path.join(outDir, `round_trend_${experimentId}.json`), JSON.stringify(dataset, null, 2));
  writeCsv(
    path.join(outDir, `round_trend_${experimentId}.csv`),
    rounds.map((row) => ({
      roundNumber: row.roundNumber,
      roundName: row.roundName,
      sampleCount: row.sampleCount,
      successCount: row.successCount,
      avgQualityScore: row.avgQualityScore,
      avgTokensTotal: row.avgTokensTotal,
      avgLatencyMs: row.avgLatencyMs,
      teacherAvgQuality: row.teacherAvgQuality,
      teacherGap: row.teacherGap
    })),
    ['roundNumber', 'roundName', 'sampleCount', 'successCount', 'avgQualityScore', 'avgTokensTotal', 'avgLatencyMs', 'teacherAvgQuality', 'teacherGap']
  );
  writeCsv(
    path.join(outDir, `round_deltas_${experimentId}.csv`),
    deltas,
    ['roundNumber', 'roundName', 'deltaQuality', 'deltaTokens', 'deltaLatency', 'deltaTeacherGap']
  );
  writeCsv(
    path.join(outDir, `round_metrics_${experimentId}.csv`),
    roundMetrics,
    [
      'roundNumber',
      'roundName',
      'sampleCount',
      'successCount',
      'successRate',
      'avgQualityScore',
      'avgTokensTotal',
      'avgLatencyMs',
      'deltaQuality',
      'deltaTokens',
      'deltaLatency',
      'qualityPer1kTokens',
      'gainPer1kExtraTokens',
      'tokenIncreasePct',
      'latencyIncreasePct',
      'teacherAvgQuality',
      'teacherGap',
      'teacherAlignmentPct',
      'teacherGapClosurePct',
      'qualityStdDev',
      'qualityCvPct',
      'fewshotEnabled',
      'isImprovedVsBaseline'
    ]
  );
  fs.writeFileSync(
    path.join(outDir, `round_kpi_summary_${experimentId}.json`),
    JSON.stringify(kpiSummary, null, 2)
  );

  console.log(`[round-trend] exported experiment=${experimentId} to ${outDir}`);
}

main();
