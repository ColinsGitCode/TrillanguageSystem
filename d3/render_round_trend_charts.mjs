import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as d3 from 'd3';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultDataDir = path.join(repoRoot, 'Docs', 'TestDocs', 'data');
const outDir = path.join(repoRoot, 'Docs', 'TestDocs', 'charts');
fs.mkdirSync(outDir, { recursive: true });

function pickDatasetPath(inputPath) {
  if (inputPath) return path.resolve(repoRoot, inputPath);
  const files = fs.readdirSync(defaultDataDir)
    .filter((name) => /^round_trend_.+\.json$/.test(name))
    .map((name) => path.join(defaultDataDir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!files.length) {
    throw new Error('No round trend dataset found. Run export_round_trend_dataset.js first.');
  }
  return files[0];
}

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

function drawNoData(svg, width, height, title) {
  svg.append('text')
    .attr('x', width / 2)
    .attr('y', 30)
    .attr('text-anchor', 'middle')
    .attr('font-size', 16)
    .attr('font-weight', 700)
    .attr('fill', '#0f172a')
    .text(title);
  svg.append('text')
    .attr('x', width / 2)
    .attr('y', height / 2)
    .attr('text-anchor', 'middle')
    .attr('font-size', 14)
    .attr('fill', '#64748b')
    .text('No round data');
}

function finiteValues(values = []) {
  return values.filter((v) => Number.isFinite(v));
}

function renderQualityTrend(rounds, experimentId) {
  const width = 980;
  const height = 460;
  const margin = { top: 60, right: 40, bottom: 70, left: 70 };
  const { dom, svg } = createSvg(width, height);
  const title = `Local Quality Trend by Round (${experimentId})`;

  if (!rounds.length) {
    drawNoData(svg, width, height, title);
    fs.writeFileSync(path.join(outDir, `round_quality_trend_${experimentId}.svg`), dom.window.document.body.innerHTML);
    return;
  }

  const data = rounds
    .filter((r) => Number(r.sampleCount || 0) > 0)
    .map((r) => ({
    round: Number(r.roundNumber),
    quality: Number(r.avgQualityScore || 0),
    successRate: Number(r.sampleCount ? (r.successCount / r.sampleCount) * 100 : 0)
  })).sort((a, b) => a.round - b.round);

  svg.append('text')
    .attr('x', width / 2)
    .attr('y', 30)
    .attr('text-anchor', 'middle')
    .attr('font-size', 16)
    .attr('font-weight', 700)
    .attr('fill', '#0f172a')
    .text(title);

  const chart = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const x = d3.scaleLinear()
    .domain(d3.extent(data, (d) => d.round))
    .range([0, innerWidth]);
  const y = d3.scaleLinear()
    .domain([0, Math.max(100, d3.max(data, (d) => d.quality) * 1.1)])
    .nice()
    .range([innerHeight, 0]);

  chart.append('g').attr('transform', `translate(0,${innerHeight})`).call(d3.axisBottom(x).ticks(data.length).tickFormat(d3.format('d')));
  chart.append('g').call(d3.axisLeft(y));

  const line = d3.line().x((d) => x(d.round)).y((d) => y(d.quality));
  chart.append('path')
    .datum(data)
    .attr('fill', 'none')
    .attr('stroke', '#2563eb')
    .attr('stroke-width', 3)
    .attr('d', line);

  chart.selectAll('circle.quality')
    .data(data)
    .enter()
    .append('circle')
    .attr('class', 'quality')
    .attr('cx', (d) => x(d.round))
    .attr('cy', (d) => y(d.quality))
    .attr('r', 5)
    .attr('fill', '#2563eb');

  chart.selectAll('text.quality-label')
    .data(data)
    .enter()
    .append('text')
    .attr('class', 'quality-label')
    .attr('x', (d) => x(d.round))
    .attr('y', (d) => y(d.quality) - 10)
    .attr('text-anchor', 'middle')
    .attr('font-size', 11)
    .attr('fill', '#0f172a')
    .text((d) => d.quality.toFixed(1));

  svg.append('text')
    .attr('x', width / 2)
    .attr('y', height - 12)
    .attr('text-anchor', 'middle')
    .attr('font-size', 12)
    .attr('fill', '#64748b')
    .text('Round Number');

  svg.append('text')
    .attr('transform', 'rotate(-90)')
    .attr('x', -height / 2)
    .attr('y', 18)
    .attr('text-anchor', 'middle')
    .attr('font-size', 12)
    .attr('fill', '#64748b')
    .text('Average Quality Score');

  fs.writeFileSync(path.join(outDir, `round_quality_trend_${experimentId}.svg`), dom.window.document.body.innerHTML);
}

function renderTeacherGapTrend(rounds, experimentId) {
  const width = 980;
  const height = 460;
  const margin = { top: 60, right: 40, bottom: 70, left: 70 };
  const { dom, svg } = createSvg(width, height);
  const title = `Teacher Gap Trend by Round (${experimentId})`;

  const data = rounds
    .filter((r) => Number(r.sampleCount || 0) > 0)
    .filter((r) => r.teacherGap !== null && r.teacherGap !== undefined)
    .map((r) => ({
      round: Number(r.roundNumber),
      gap: Number(r.teacherGap || 0)
    }))
    .sort((a, b) => a.round - b.round);

  if (!data.length) {
    drawNoData(svg, width, height, title);
    fs.writeFileSync(path.join(outDir, `round_teacher_gap_${experimentId}.svg`), dom.window.document.body.innerHTML);
    return;
  }

  svg.append('text')
    .attr('x', width / 2)
    .attr('y', 30)
    .attr('text-anchor', 'middle')
    .attr('font-size', 16)
    .attr('font-weight', 700)
    .attr('fill', '#0f172a')
    .text(title);

  const chart = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const x = d3.scaleLinear()
    .domain(d3.extent(data, (d) => d.round))
    .range([0, innerWidth]);
  const yExtent = d3.extent(data, (d) => d.gap);
  const y = d3.scaleLinear()
    .domain([Math.min(-5, yExtent[0]), Math.max(5, yExtent[1])])
    .nice()
    .range([innerHeight, 0]);

  chart.append('g').attr('transform', `translate(0,${innerHeight})`).call(d3.axisBottom(x).ticks(data.length).tickFormat(d3.format('d')));
  chart.append('g').call(d3.axisLeft(y));

  chart.append('line')
    .attr('x1', 0)
    .attr('x2', innerWidth)
    .attr('y1', y(0))
    .attr('y2', y(0))
    .attr('stroke', '#94a3b8')
    .attr('stroke-dasharray', '4 4');

  const line = d3.line().x((d) => x(d.round)).y((d) => y(d.gap));
  chart.append('path')
    .datum(data)
    .attr('fill', 'none')
    .attr('stroke', '#16a34a')
    .attr('stroke-width', 3)
    .attr('d', line);

  chart.selectAll('circle.gap')
    .data(data)
    .enter()
    .append('circle')
    .attr('class', 'gap')
    .attr('cx', (d) => x(d.round))
    .attr('cy', (d) => y(d.gap))
    .attr('r', 5)
    .attr('fill', '#16a34a');

  fs.writeFileSync(path.join(outDir, `round_teacher_gap_${experimentId}.svg`), dom.window.document.body.innerHTML);
}

function renderQualityTokenDual(rounds, experimentId) {
  const width = 1020;
  const height = 480;
  const margin = { top: 60, right: 80, bottom: 70, left: 70 };
  const { dom, svg } = createSvg(width, height);
  const title = `Quality vs Tokens by Round (${experimentId})`;

  if (!rounds.length) {
    drawNoData(svg, width, height, title);
    fs.writeFileSync(path.join(outDir, `round_quality_tokens_${experimentId}.svg`), dom.window.document.body.innerHTML);
    return;
  }

  const data = rounds
    .filter((r) => Number(r.sampleCount || 0) > 0)
    .map((r) => ({
    round: Number(r.roundNumber),
    quality: Number(r.avgQualityScore || 0),
    tokens: Number(r.avgTokensTotal || 0)
  })).sort((a, b) => a.round - b.round);

  svg.append('text')
    .attr('x', width / 2)
    .attr('y', 30)
    .attr('text-anchor', 'middle')
    .attr('font-size', 16)
    .attr('font-weight', 700)
    .attr('fill', '#0f172a')
    .text(title);

  const chart = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const x = d3.scaleLinear()
    .domain(d3.extent(data, (d) => d.round))
    .range([0, innerWidth]);
  const yLeft = d3.scaleLinear()
    .domain([0, Math.max(100, d3.max(data, (d) => d.quality) * 1.1)])
    .nice()
    .range([innerHeight, 0]);
  const yRight = d3.scaleLinear()
    .domain([0, d3.max(data, (d) => d.tokens) * 1.2 || 1])
    .nice()
    .range([innerHeight, 0]);

  chart.append('g').attr('transform', `translate(0,${innerHeight})`).call(d3.axisBottom(x).ticks(data.length).tickFormat(d3.format('d')));
  chart.append('g').call(d3.axisLeft(yLeft));
  chart.append('g').attr('transform', `translate(${innerWidth},0)`).call(d3.axisRight(yRight));

  const qualityLine = d3.line().x((d) => x(d.round)).y((d) => yLeft(d.quality));
  const tokenLine = d3.line().x((d) => x(d.round)).y((d) => yRight(d.tokens));

  chart.append('path')
    .datum(data)
    .attr('fill', 'none')
    .attr('stroke', '#2563eb')
    .attr('stroke-width', 3)
    .attr('d', qualityLine);

  chart.append('path')
    .datum(data)
    .attr('fill', 'none')
    .attr('stroke', '#f59e0b')
    .attr('stroke-width', 3)
    .attr('d', tokenLine);

  const legend = svg.append('g').attr('transform', `translate(${width - 220}, 56)`);
  const legendRows = [
    { name: 'Quality', color: '#2563eb' },
    { name: 'Tokens', color: '#f59e0b' }
  ];

  legend.selectAll('rect')
    .data(legendRows)
    .enter()
    .append('rect')
    .attr('x', 0)
    .attr('y', (d, i) => i * 18)
    .attr('width', 12)
    .attr('height', 12)
    .attr('fill', (d) => d.color);

  legend.selectAll('text')
    .data(legendRows)
    .enter()
    .append('text')
    .attr('x', 18)
    .attr('y', (d, i) => i * 18 + 10)
    .attr('font-size', 12)
    .attr('fill', '#0f172a')
    .text((d) => d.name);

  fs.writeFileSync(path.join(outDir, `round_quality_tokens_${experimentId}.svg`), dom.window.document.body.innerHTML);
}

function renderDeltaEfficiency(roundMetrics, experimentId) {
  const width = 1080;
  const height = 480;
  const margin = { top: 70, right: 80, bottom: 80, left: 70 };
  const { dom, svg } = createSvg(width, height);
  const title = `Few-shot Gain & Efficiency (${experimentId})`;

  const data = (roundMetrics || [])
    .filter((r) => Number(r.sampleCount || 0) > 0)
    .map((r) => ({
      round: Number(r.roundNumber),
      roundName: String(r.roundName || `R${r.roundNumber}`),
      deltaQuality: Number(r.deltaQuality || 0),
      gainPer1k: Number.isFinite(Number(r.gainPer1kExtraTokens)) ? Number(r.gainPer1kExtraTokens) : null
    }))
    .sort((a, b) => a.round - b.round);

  if (!data.length) {
    drawNoData(svg, width, height, title);
    fs.writeFileSync(path.join(outDir, `round_gain_efficiency_${experimentId}.svg`), dom.window.document.body.innerHTML);
    return;
  }

  svg.append('text')
    .attr('x', width / 2)
    .attr('y', 30)
    .attr('text-anchor', 'middle')
    .attr('font-size', 16)
    .attr('font-weight', 700)
    .attr('fill', '#0f172a')
    .text(title);

  const chart = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const x = d3.scaleBand()
    .domain(data.map((d) => d.roundName))
    .range([0, innerWidth])
    .padding(0.25);

  const deltaValues = data.map((d) => d.deltaQuality);
  const effValues = finiteValues(data.map((d) => d.gainPer1k));
  const yLeft = d3.scaleLinear()
    .domain([Math.min(-5, d3.min(deltaValues) || 0), Math.max(5, d3.max(deltaValues) || 0)])
    .nice()
    .range([innerHeight, 0]);
  const yRight = d3.scaleLinear()
    .domain([Math.min(-5, d3.min(effValues) || 0), Math.max(5, d3.max(effValues) || 0)])
    .nice()
    .range([innerHeight, 0]);

  chart.append('g').attr('transform', `translate(0,${innerHeight})`).call(d3.axisBottom(x));
  chart.append('g').call(d3.axisLeft(yLeft));
  chart.append('g').attr('transform', `translate(${innerWidth},0)`).call(d3.axisRight(yRight));

  chart.append('line')
    .attr('x1', 0)
    .attr('x2', innerWidth)
    .attr('y1', yLeft(0))
    .attr('y2', yLeft(0))
    .attr('stroke', '#94a3b8')
    .attr('stroke-dasharray', '4 4');

  chart.selectAll('rect.delta')
    .data(data)
    .enter()
    .append('rect')
    .attr('class', 'delta')
    .attr('x', (d) => x(d.roundName))
    .attr('y', (d) => d.deltaQuality >= 0 ? yLeft(d.deltaQuality) : yLeft(0))
    .attr('width', x.bandwidth())
    .attr('height', (d) => Math.abs(yLeft(d.deltaQuality) - yLeft(0)))
    .attr('fill', (d) => d.deltaQuality >= 0 ? '#16a34a' : '#dc2626')
    .attr('opacity', 0.85);

  const lineData = data.filter((d) => d.gainPer1k !== null);
  if (lineData.length > 1) {
    const line = d3.line()
      .x((d) => x(d.roundName) + x.bandwidth() / 2)
      .y((d) => yRight(d.gainPer1k));

    chart.append('path')
      .datum(lineData)
      .attr('fill', 'none')
      .attr('stroke', '#2563eb')
      .attr('stroke-width', 2.5)
      .attr('d', line);
  }

  chart.selectAll('circle.eff')
    .data(lineData)
    .enter()
    .append('circle')
    .attr('class', 'eff')
    .attr('cx', (d) => x(d.roundName) + x.bandwidth() / 2)
    .attr('cy', (d) => yRight(d.gainPer1k))
    .attr('r', 4.5)
    .attr('fill', '#2563eb');

  const legend = svg.append('g').attr('transform', `translate(${width - 280}, 56)`);
  const legendRows = [
    { name: 'Quality Gain vs Baseline', color: '#16a34a', type: 'rect' },
    { name: 'Gain per 1k Extra Tokens', color: '#2563eb', type: 'line' }
  ];
  legend.selectAll('rect')
    .data(legendRows.filter((r) => r.type === 'rect'))
    .enter()
    .append('rect')
    .attr('x', 0)
    .attr('y', (d, i) => i * 18)
    .attr('width', 12)
    .attr('height', 12)
    .attr('fill', (d) => d.color);
  legend.selectAll('line')
    .data(legendRows.filter((r) => r.type === 'line'))
    .enter()
    .append('line')
    .attr('x1', 0)
    .attr('x2', 14)
    .attr('y1', 28)
    .attr('y2', 28)
    .attr('stroke', '#2563eb')
    .attr('stroke-width', 2.5);
  legend.selectAll('text')
    .data(legendRows)
    .enter()
    .append('text')
    .attr('x', 20)
    .attr('y', (d, i) => i * 18 + 10)
    .attr('font-size', 12)
    .attr('fill', '#0f172a')
    .text((d) => d.name);

  fs.writeFileSync(path.join(outDir, `round_gain_efficiency_${experimentId}.svg`), dom.window.document.body.innerHTML);
}

function renderAlignmentStability(roundMetrics, experimentId) {
  const width = 1080;
  const height = 480;
  const margin = { top: 70, right: 80, bottom: 80, left: 70 };
  const { dom, svg } = createSvg(width, height);
  const title = `Teacher Alignment & Stability (${experimentId})`;

  const data = (roundMetrics || [])
    .filter((r) => Number(r.sampleCount || 0) > 0)
    .map((r) => ({
      round: Number(r.roundNumber),
      align: Number.isFinite(Number(r.teacherAlignmentPct)) ? Number(r.teacherAlignmentPct) : null,
      stability: Number.isFinite(Number(r.qualityCvPct)) ? Number(r.qualityCvPct) : null
    }))
    .sort((a, b) => a.round - b.round);

  const valid = data.filter((d) => d.align !== null || d.stability !== null);
  if (!valid.length) {
    drawNoData(svg, width, height, title);
    fs.writeFileSync(path.join(outDir, `round_alignment_stability_${experimentId}.svg`), dom.window.document.body.innerHTML);
    return;
  }

  svg.append('text')
    .attr('x', width / 2)
    .attr('y', 30)
    .attr('text-anchor', 'middle')
    .attr('font-size', 16)
    .attr('font-weight', 700)
    .attr('fill', '#0f172a')
    .text(title);

  const chart = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const x = d3.scaleLinear()
    .domain(d3.extent(data, (d) => d.round))
    .range([0, innerWidth]);
  const alignValues = finiteValues(data.map((d) => d.align));
  const stabilityValues = finiteValues(data.map((d) => d.stability));
  const yLeft = d3.scaleLinear()
    .domain([Math.min(0, d3.min(alignValues) || 0), Math.max(100, d3.max(alignValues) || 100)])
    .nice()
    .range([innerHeight, 0]);
  const yRight = d3.scaleLinear()
    .domain([0, Math.max(20, d3.max(stabilityValues) || 0)])
    .nice()
    .range([innerHeight, 0]);

  chart.append('g').attr('transform', `translate(0,${innerHeight})`).call(d3.axisBottom(x).ticks(data.length).tickFormat(d3.format('d')));
  chart.append('g').call(d3.axisLeft(yLeft));
  chart.append('g').attr('transform', `translate(${innerWidth},0)`).call(d3.axisRight(yRight));

  const alignData = data.filter((d) => d.align !== null);
  if (alignData.length > 1) {
    const alignLine = d3.line().x((d) => x(d.round)).y((d) => yLeft(d.align));
    chart.append('path')
      .datum(alignData)
      .attr('fill', 'none')
      .attr('stroke', '#7c3aed')
      .attr('stroke-width', 2.5)
      .attr('d', alignLine);
  }
  chart.selectAll('circle.align')
    .data(alignData)
    .enter()
    .append('circle')
    .attr('class', 'align')
    .attr('cx', (d) => x(d.round))
    .attr('cy', (d) => yLeft(d.align))
    .attr('r', 4.5)
    .attr('fill', '#7c3aed');

  const stabilityData = data.filter((d) => d.stability !== null);
  if (stabilityData.length > 1) {
    const stabilityLine = d3.line().x((d) => x(d.round)).y((d) => yRight(d.stability));
    chart.append('path')
      .datum(stabilityData)
      .attr('fill', 'none')
      .attr('stroke', '#f59e0b')
      .attr('stroke-width', 2.5)
      .attr('d', stabilityLine);
  }
  chart.selectAll('rect.stability')
    .data(stabilityData)
    .enter()
    .append('rect')
    .attr('x', (d) => x(d.round) - 4)
    .attr('y', (d) => yRight(d.stability) - 4)
    .attr('width', 8)
    .attr('height', 8)
    .attr('fill', '#f59e0b');

  fs.writeFileSync(path.join(outDir, `round_alignment_stability_${experimentId}.svg`), dom.window.document.body.innerHTML);
}

function renderGainTokenScatter(roundMetrics, experimentId) {
  const width = 980;
  const height = 500;
  const margin = { top: 60, right: 40, bottom: 70, left: 80 };
  const { dom, svg } = createSvg(width, height);
  const title = `Gain vs Extra Tokens Scatter (${experimentId})`;

  const data = (roundMetrics || [])
    .filter((r) => Number(r.sampleCount || 0) > 0)
    .map((r) => ({
      round: Number(r.roundNumber),
      roundName: String(r.roundName || `R${r.roundNumber}`),
      deltaTokens: Number(r.deltaTokens || 0),
      deltaQuality: Number(r.deltaQuality || 0),
      latency: Number(r.avgLatencyMs || 0)
    }));

  if (!data.length) {
    drawNoData(svg, width, height, title);
    fs.writeFileSync(path.join(outDir, `round_gain_tokens_scatter_${experimentId}.svg`), dom.window.document.body.innerHTML);
    return;
  }

  svg.append('text')
    .attr('x', width / 2)
    .attr('y', 30)
    .attr('text-anchor', 'middle')
    .attr('font-size', 16)
    .attr('font-weight', 700)
    .attr('fill', '#0f172a')
    .text(title);

  const chart = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const xExtent = d3.extent(data, (d) => d.deltaTokens);
  const yExtent = d3.extent(data, (d) => d.deltaQuality);
  const x = d3.scaleLinear()
    .domain([Math.min(-50, xExtent[0] || 0), Math.max(50, xExtent[1] || 0)])
    .nice()
    .range([0, innerWidth]);
  const y = d3.scaleLinear()
    .domain([Math.min(-5, yExtent[0] || 0), Math.max(5, yExtent[1] || 0)])
    .nice()
    .range([innerHeight, 0]);
  const size = d3.scaleSqrt()
    .domain(d3.extent(data, (d) => d.latency))
    .range([6, 20]);

  chart.append('g').attr('transform', `translate(0,${innerHeight})`).call(d3.axisBottom(x));
  chart.append('g').call(d3.axisLeft(y));
  chart.append('line')
    .attr('x1', 0).attr('x2', innerWidth)
    .attr('y1', y(0)).attr('y2', y(0))
    .attr('stroke', '#cbd5e1').attr('stroke-dasharray', '4 4');
  chart.append('line')
    .attr('x1', x(0)).attr('x2', x(0))
    .attr('y1', 0).attr('y2', innerHeight)
    .attr('stroke', '#cbd5e1').attr('stroke-dasharray', '4 4');

  chart.selectAll('circle.point')
    .data(data)
    .enter()
    .append('circle')
    .attr('cx', (d) => x(d.deltaTokens))
    .attr('cy', (d) => y(d.deltaQuality))
    .attr('r', (d) => size(d.latency))
    .attr('fill', (d) => (d.deltaQuality >= 0 ? '#16a34a' : '#dc2626'))
    .attr('opacity', 0.6);

  chart.selectAll('text.point')
    .data(data)
    .enter()
    .append('text')
    .attr('x', (d) => x(d.deltaTokens) + 8)
    .attr('y', (d) => y(d.deltaQuality) - 6)
    .attr('font-size', 11)
    .attr('fill', '#0f172a')
    .text((d) => d.roundName);

  svg.append('text')
    .attr('x', width / 2)
    .attr('y', height - 10)
    .attr('text-anchor', 'middle')
    .attr('font-size', 12)
    .attr('fill', '#475569')
    .text('Delta Tokens vs Baseline');

  svg.append('text')
    .attr('transform', 'rotate(-90)')
    .attr('x', -height / 2)
    .attr('y', 18)
    .attr('text-anchor', 'middle')
    .attr('font-size', 12)
    .attr('fill', '#475569')
    .text('Delta Quality vs Baseline');

  fs.writeFileSync(path.join(outDir, `round_gain_tokens_scatter_${experimentId}.svg`), dom.window.document.body.innerHTML);
}

function main() {
  const inputArg = process.argv[2] || '';
  const datasetPath = pickDatasetPath(inputArg);
  const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
  const rounds = Array.isArray(dataset.rounds) ? dataset.rounds : [];
  const roundMetrics = Array.isArray(dataset.roundMetrics) ? dataset.roundMetrics : [];
  const experimentId = String(dataset.experimentId || path.basename(datasetPath).replace(/^round_trend_|\.json$/g, ''));

  renderQualityTrend(rounds, experimentId);
  renderTeacherGapTrend(rounds, experimentId);
  renderQualityTokenDual(rounds, experimentId);
  renderDeltaEfficiency(roundMetrics, experimentId);
  renderAlignmentStability(roundMetrics, experimentId);
  renderGainTokenScatter(roundMetrics, experimentId);
  console.log(`[round-charts] rendered for experiment=${experimentId}`);
}

main();
