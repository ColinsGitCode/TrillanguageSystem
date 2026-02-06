const fs = require('fs');

function loadJsonl(filePath) {
  const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).filter(Boolean);
  return lines.map(line => {
    try { return JSON.parse(line); } catch (e) { return null; }
  }).filter(Boolean);
}

function summarize(records) {
  const stats = {
    count: records.length,
    avgQuality: 0,
    avgTokens: 0,
    avgLatency: 0,
    success: 0
  };
  if (!records.length) return stats;

  let qualitySum = 0;
  let tokenSum = 0;
  let latencySum = 0;
  let success = 0;

  records.forEach(r => {
    const obs = r.observability || {};
    qualitySum += obs.quality?.score || 0;
    tokenSum += obs.tokens?.total || 0;
    latencySum += obs.performance?.totalTime || 0;
    if (r.success !== false) success += 1;
  });

  stats.avgQuality = qualitySum / records.length;
  stats.avgTokens = tokenSum / records.length;
  stats.avgLatency = latencySum / records.length;
  stats.success = success / records.length;
  return stats;
}

const [baselineFile, enhancedFile] = process.argv.slice(2);
if (!baselineFile || !enhancedFile) {
  console.error('Usage: node scripts/compare-results.js <baseline.jsonl> <enhanced.jsonl>');
  process.exit(1);
}

const baseline = loadJsonl(baselineFile);
const enhanced = loadJsonl(enhancedFile);

const baseStats = summarize(baseline);
const enhStats = summarize(enhanced);

const diff = {
  avgQuality: enhStats.avgQuality - baseStats.avgQuality,
  avgTokens: enhStats.avgTokens - baseStats.avgTokens,
  avgLatency: enhStats.avgLatency - baseStats.avgLatency,
  successRate: enhStats.success - baseStats.success
};

const output = {
  baseline: baseStats,
  enhanced: enhStats,
  diff
};

console.log(JSON.stringify(output, null, 2));
