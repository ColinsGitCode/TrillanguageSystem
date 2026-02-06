import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as d3 from 'd3';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const dataPath = path.join(repoRoot, 'Docs', 'TestDocs', 'data', 'fewshot_dataset.json');
const outDir = path.join(repoRoot, 'Docs', 'TestDocs', 'charts');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const dataset = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const summary = dataset.summary || {};
const records = dataset.records || [];

const perPhrase = new Map();
const normalizePhrase = (phrase) => phrase.replace(/\s*\(\d+\)$/, '');
records.forEach((record) => {
  if (!record.phrase) return;
  const base = normalizePhrase(record.phrase);
  const entry = perPhrase.get(base) || { phrase: base };
  entry[record.variant] = record;
  perPhrase.set(base, entry);
});

const paired = Array.from(perPhrase.values()).filter((entry) => entry.baseline && entry.fewshot);
const deltas = paired.map((entry) => ({
  phrase: entry.phrase,
  deltaQuality: entry.fewshot.quality - entry.baseline.quality,
  deltaTokens: entry.fewshot.tokens - entry.baseline.tokens,
  deltaLatency: entry.fewshot.latency - entry.baseline.latency
}));

const chartDatasetPath = path.join(repoRoot, 'Docs', 'TestDocs', 'data', 'fewshot_chart_data.json');
const chartDataset = {
  summary,
  paired,
  deltas,
  generatedAt: new Date().toISOString()
};
fs.writeFileSync(chartDatasetPath, JSON.stringify(chartDataset, null, 2));

const palette = {
  baseline: '#2563eb',
  fewshot: '#16a34a',
  grid: '#e5e7eb',
  text: '#0f172a',
  muted: '#64748b'
};

function createSvg(width, height) {
  const dom = new JSDOM('<!DOCTYPE html><body></body>');
  const svg = d3.select(dom.window.document.body)
    .append('svg')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('width', width)
    .attr('height', height)
    .style('background', '#ffffff');
  return { dom, svg };
}

function addTitle(svg, title, width) {
  svg.append('text')
    .attr('x', width / 2)
    .attr('y', 28)
    .attr('text-anchor', 'middle')
    .attr('font-size', 16)
    .attr('font-weight', 700)
    .attr('fill', palette.text)
    .text(title);
}

function renderBarChart(filename, title, values, yLabel) {
  const width = 920;
  const height = 420;
  const margin = { top: 60, right: 40, bottom: 60, left: 70 };
  const { dom, svg } = createSvg(width, height);
  addTitle(svg, title, width);

  const chart = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const x = d3.scaleBand()
    .domain(values.map(d => d.label))
    .range([0, innerWidth])
    .padding(0.3);

  const y = d3.scaleLinear()
    .domain([0, d3.max(values, d => d.value) * 1.15])
    .nice()
    .range([innerHeight, 0]);

  chart.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x));

  chart.append('g')
    .call(d3.axisLeft(y));

  chart.append('g')
    .attr('stroke', palette.grid)
    .selectAll('line')
    .data(y.ticks(5))
    .enter()
    .append('line')
    .attr('x1', 0)
    .attr('x2', innerWidth)
    .attr('y1', d => y(d))
    .attr('y2', d => y(d));

  chart.selectAll('rect')
    .data(values)
    .enter()
    .append('rect')
    .attr('x', d => x(d.label))
    .attr('y', d => y(d.value))
    .attr('width', x.bandwidth())
    .attr('height', d => innerHeight - y(d.value))
    .attr('fill', d => d.color)
    .attr('rx', 6);

  chart.selectAll('text.bar-label')
    .data(values)
    .enter()
    .append('text')
    .attr('class', 'bar-label')
    .attr('x', d => x(d.label) + x.bandwidth() / 2)
    .attr('y', d => y(d.value) - 8)
    .attr('text-anchor', 'middle')
    .attr('font-size', 12)
    .attr('fill', palette.text)
    .text(d => d.value.toFixed(1));

  svg.append('text')
    .attr('x', margin.left)
    .attr('y', height - 12)
    .attr('font-size', 12)
    .attr('fill', palette.muted)
    .text(yLabel);

  fs.writeFileSync(path.join(outDir, filename), dom.window.document.body.innerHTML);
}

function renderDeltaChart() {
  const width = 980;
  const height = 460;
  const margin = { top: 60, right: 30, bottom: 120, left: 70 };
  const { dom, svg } = createSvg(width, height);
  addTitle(svg, 'Quality Delta per Phrase (Few-shot - Baseline)', width);

  if (!deltas.length) {
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', height / 2)
      .attr('text-anchor', 'middle')
      .attr('font-size', 14)
      .attr('fill', palette.muted)
      .text('No paired data available');
    fs.writeFileSync(path.join(outDir, 'fewshot_quality_delta.svg'), dom.window.document.body.innerHTML);
    return;
  }

  const chart = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const sorted = [...deltas].sort((a, b) => b.deltaQuality - a.deltaQuality);
  const x = d3.scaleBand()
    .domain(sorted.map(d => d.phrase))
    .range([0, innerWidth])
    .padding(0.2);

  const y = d3.scaleLinear()
    .domain([Math.min(0, d3.min(sorted, d => d.deltaQuality)), d3.max(sorted, d => d.deltaQuality) * 1.2])
    .nice()
    .range([innerHeight, 0]);

  chart.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x))
    .selectAll('text')
    .attr('transform', 'rotate(-35)')
    .style('text-anchor', 'end');

  chart.append('g').call(d3.axisLeft(y));

  chart.selectAll('rect')
    .data(sorted)
    .enter()
    .append('rect')
    .attr('x', d => x(d.phrase))
    .attr('y', d => y(Math.max(0, d.deltaQuality)))
    .attr('width', x.bandwidth())
    .attr('height', d => Math.abs(y(d.deltaQuality) - y(0)))
    .attr('fill', d => d.deltaQuality >= 0 ? '#16a34a' : '#dc2626')
    .attr('rx', 4);

  chart.append('line')
    .attr('x1', 0)
    .attr('x2', innerWidth)
    .attr('y1', y(0))
    .attr('y2', y(0))
    .attr('stroke', palette.muted)
    .attr('stroke-dasharray', '4 4');

  fs.writeFileSync(path.join(outDir, 'fewshot_quality_delta.svg'), dom.window.document.body.innerHTML);
}

function renderScatter() {
  const width = 940;
  const height = 460;
  const margin = { top: 60, right: 40, bottom: 60, left: 70 };
  const { dom, svg } = createSvg(width, height);
  addTitle(svg, 'Quality vs Tokens (Baseline vs Few-shot)', width);

  if (!records.length) {
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', height / 2)
      .attr('text-anchor', 'middle')
      .attr('font-size', 14)
      .attr('fill', palette.muted)
      .text('No records available');
    fs.writeFileSync(path.join(outDir, 'fewshot_quality_tokens_scatter.svg'), dom.window.document.body.innerHTML);
    return;
  }

  const chart = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const x = d3.scaleLinear()
    .domain([0, d3.max(records, d => d.tokens) * 1.1])
    .nice()
    .range([0, innerWidth]);

  const y = d3.scaleLinear()
    .domain([0, d3.max(records, d => d.quality) * 1.1])
    .nice()
    .range([innerHeight, 0]);

  chart.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x));

  chart.append('g').call(d3.axisLeft(y));

  chart.selectAll('circle')
    .data(records)
    .enter()
    .append('circle')
    .attr('cx', d => x(d.tokens))
    .attr('cy', d => y(d.quality))
    .attr('r', 6)
    .attr('fill', d => d.variant === 'baseline' ? palette.baseline : palette.fewshot)
    .attr('opacity', 0.8);

  const legend = svg.append('g').attr('transform', `translate(${width - 200}, 50)`);
  const legendData = [
    { label: 'Baseline', color: palette.baseline },
    { label: 'Few-shot', color: palette.fewshot }
  ];
  legend.selectAll('rect')
    .data(legendData)
    .enter()
    .append('rect')
    .attr('x', 0)
    .attr('y', (d, i) => i * 20)
    .attr('width', 12)
    .attr('height', 12)
    .attr('fill', d => d.color);

  legend.selectAll('text')
    .data(legendData)
    .enter()
    .append('text')
    .attr('x', 18)
    .attr('y', (d, i) => i * 20 + 10)
    .attr('font-size', 12)
    .attr('fill', palette.text)
    .text(d => d.label);

  svg.append('text')
    .attr('x', width / 2)
    .attr('y', height - 12)
    .attr('text-anchor', 'middle')
    .attr('font-size', 12)
    .attr('fill', palette.muted)
    .text('Tokens');

  svg.append('text')
    .attr('transform', 'rotate(-90)')
    .attr('x', -height / 2)
    .attr('y', 18)
    .attr('text-anchor', 'middle')
    .attr('font-size', 12)
    .attr('fill', palette.muted)
    .text('Quality Score');

  fs.writeFileSync(path.join(outDir, 'fewshot_quality_tokens_scatter.svg'), dom.window.document.body.innerHTML);
}

renderBarChart('fewshot_quality_bar.svg', 'Average Quality Score', [
  { label: 'Baseline', value: summary.baseline.avgQuality, color: palette.baseline },
  { label: 'Few-shot', value: summary.fewshot.avgQuality, color: palette.fewshot }
], 'Quality Score');

renderBarChart('fewshot_tokens_bar.svg', 'Average Tokens Used', [
  { label: 'Baseline', value: summary.baseline.avgTokens, color: palette.baseline },
  { label: 'Few-shot', value: summary.fewshot.avgTokens, color: palette.fewshot }
], 'Tokens');

renderBarChart('fewshot_latency_bar.svg', 'Average Latency (ms)', [
  { label: 'Baseline', value: summary.baseline.avgLatency, color: palette.baseline },
  { label: 'Few-shot', value: summary.fewshot.avgLatency, color: palette.fewshot }
], 'Latency (ms)');

renderDeltaChart();
renderScatter();

console.log('[fewshot] charts rendered to', outDir);
