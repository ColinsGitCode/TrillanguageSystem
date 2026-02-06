const fs = require('fs');
const path = require('path');

function loadJsonl(filePath) {
  const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).filter(Boolean);
  return lines.map((line) => {
    try { return JSON.parse(line); } catch (e) { return null; }
  }).filter(Boolean);
}

function extractPhrase(obj) {
  const baseName = obj?.result?.baseName;
  if (baseName) return baseName;
  const md = obj?.llm_output?.markdown_content || '';
  const match = md.match(/^#\s+(.+)$/m);
  if (match) return match[1].trim();
  return 'unknown';
}

function extractRecord(obj, variant) {
  const obs = obj.observability || {};
  const phrase = extractPhrase(obj);
  const quality = obs.quality?.score || 0;
  const tokens = obs.tokens?.total || 0;
  const latency = obs.performance?.totalTime || 0;
  const outputChars = (obj.llm_output?.markdown_content || '').length;
  return { phrase, variant, quality, tokens, latency, outputChars };
}

function summarize(records) {
  const stats = {
    count: records.length,
    avgQuality: 0,
    avgTokens: 0,
    avgLatency: 0,
    avgOutputChars: 0
  };
  if (!records.length) return stats;
  let q = 0, t = 0, l = 0, c = 0;
  records.forEach((r) => {
    q += r.quality;
    t += r.tokens;
    l += r.latency;
    c += r.outputChars;
  });
  stats.avgQuality = q / records.length;
  stats.avgTokens = t / records.length;
  stats.avgLatency = l / records.length;
  stats.avgOutputChars = c / records.length;
  return stats;
}

function writeCsv(filePath, rows, columns) {
  const header = columns.join(',');
  const lines = rows.map((r) => columns.map((c) => JSON.stringify(r[c] ?? '')).join(','));
  fs.writeFileSync(filePath, [header, ...lines].join('\n'));
}

const baselineFile = process.argv[2];
const enhancedFile = process.argv[3];
const outDir = process.argv[4] || path.join('Docs', 'TestDocs', 'data');

if (!baselineFile || !enhancedFile) {
  console.error('Usage: node scripts/build_fewshot_dataset.js <baseline.jsonl> <enhanced.jsonl> [outDir]');
  process.exit(1);
}

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const baselineRaw = loadJsonl(baselineFile);
const enhancedRaw = loadJsonl(enhancedFile);

const baseline = baselineRaw.map((r) => extractRecord(r, 'baseline'));
const enhanced = enhancedRaw.map((r) => extractRecord(r, 'fewshot'));

const records = [...baseline, ...enhanced];

const baselineMap = new Map();
const enhancedMap = new Map();

baseline.forEach((r) => baselineMap.set(r.phrase, r));
enhanced.forEach((r) => enhancedMap.set(r.phrase, r));

const phrases = Array.from(new Set([...baselineMap.keys(), ...enhancedMap.keys()]));
const deltas = phrases.map((phrase) => {
  const base = baselineMap.get(phrase);
  const enh = enhancedMap.get(phrase);
  return {
    phrase,
    deltaQuality: (enh?.quality || 0) - (base?.quality || 0),
    deltaTokens: (enh?.tokens || 0) - (base?.tokens || 0),
    deltaLatency: (enh?.latency || 0) - (base?.latency || 0)
  };
});

const summary = {
  baseline: summarize(baseline),
  fewshot: summarize(enhanced)
};

const dataset = { summary, records, deltas };

fs.writeFileSync(path.join(outDir, 'fewshot_dataset.json'), JSON.stringify(dataset, null, 2));
fs.writeFileSync(path.join(outDir, 'fewshot_summary.json'), JSON.stringify(summary, null, 2));

writeCsv(path.join(outDir, 'fewshot_records.csv'), records, ['phrase', 'variant', 'quality', 'tokens', 'latency', 'outputChars']);
writeCsv(path.join(outDir, 'fewshot_deltas.csv'), deltas, ['phrase', 'deltaQuality', 'deltaTokens', 'deltaLatency']);

console.log('[fewshot] dataset saved to', outDir);
