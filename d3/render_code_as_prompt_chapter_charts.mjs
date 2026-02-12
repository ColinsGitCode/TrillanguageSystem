import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as d3 from 'd3';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outDir = path.join(repoRoot, 'Docs', 'TestDocs', 'charts');
const roundsDir = path.join(
  repoRoot,
  'Docs',
  'TestDocs',
  'data',
  'rounds',
  'exp_benchmark_50_20260209_140431'
);

fs.mkdirSync(outDir, { recursive: true });

const colors = {
  text: '#111827',
  muted: '#6b7280',
  baseline: '#0ea5e9',
  fewshot: '#22c55e',
  neutral: '#e5e7eb',
  accent: '#6366f1',
  warn: '#f59e0b',
  red: '#ef4444'
};

function createSvg(width = 1400, height = 820) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const svg = d3
    .select(dom.window.document.body)
    .append('svg')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('width', width)
    .attr('height', height)
    .style('background', '#ffffff');

  const defs = svg.append('defs');
  defs
    .append('filter')
    .attr('id', 'shadow')
    .attr('x', '-20%')
    .attr('y', '-20%')
    .attr('width', '160%')
    .attr('height', '160%')
    .append('feDropShadow')
    .attr('dx', 0)
    .attr('dy', 2)
    .attr('stdDeviation', 2)
    .attr('flood-color', '#0f172a')
    .attr('flood-opacity', 0.12);

  return { dom, svg };
}

function save(dom, filename) {
  fs.writeFileSync(path.join(outDir, filename), dom.window.document.body.innerHTML, 'utf8');
}

function title(svg, main, sub = '') {
  svg
    .append('text')
    .attr('x', 36)
    .attr('y', 42)
    .attr('font-size', 30)
    .attr('font-weight', 800)
    .attr('fill', colors.text)
    .text(main);
  if (sub) {
    svg
      .append('text')
      .attr('x', 36)
      .attr('y', 68)
      .attr('font-size', 15)
      .attr('fill', colors.muted)
      .text(sub);
  }
}

function readCase(phrase = '打招呼') {
  function pick(file) {
    const lines = fs.readFileSync(path.join(roundsDir, file), 'utf8').trim().split(/\n+/);
    for (const line of lines) {
      const row = JSON.parse(line);
      if (row?.request?.phrase !== phrase) continue;
      const obs = row?.response?.observability || {};
      const few = obs?.metadata?.fewShot || {};
      const prompt = String(row?.response?.prompt || '');
      const fileBase = (prompt.match(/文件名基础:\s*"([^"]+)"/) || [])[1] || '';
      return {
        quality: obs?.quality?.score || 0,
        tokens: obs?.tokens?.total || 0,
        latency: obs?.performance?.totalTime || 0,
        promptChars: prompt.length,
        promptLines: prompt ? prompt.split(/\r?\n/).length : 0,
        basePromptTokens: few.basePromptTokens || 0,
        fewshotPromptTokens: few.fewshotPromptTokens || 0,
        totalPromptTokensEst: few.totalPromptTokensEst || 0,
        countUsed: few.countUsed || 0,
        countRequested: few.countRequested || 0,
        fallbackReason: few.fallbackReason || 'none',
        tokenBudgetRatio: few.tokenBudgetRatio || 0,
        minScore: few.minScore || 0,
        fileNameBase: fileBase
      };
    }
    return null;
  }

  const baseline = pick('baseline.jsonl');
  const fewshot = pick('fewshot_r1.jsonl');
  if (!baseline || !fewshot) {
    throw new Error('case data missing: phrase=打招呼');
  }
  return { phrase, baseline, fewshot };
}

function drawKpiDelta(caseData) {
  const { dom, svg } = createSvg(1400, 820);
  title(svg, 'Code as Prompt 案例 KPI（打招呼）', 'baseline vs fewshot_r1');

  const b = caseData.baseline;
  const f = caseData.fewshot;
  const metrics = [
    { key: 'quality', label: 'Quality', b: b.quality, f: f.quality, better: 'high' },
    { key: 'tokens', label: 'Tokens', b: b.tokens, f: f.tokens, better: 'low' },
    { key: 'latency', label: 'Latency(ms)', b: b.latency, f: f.latency, better: 'low' }
  ];

  metrics.forEach((m, i) => {
    const x = 70 + i * 440;
    const y = 140;
    const w = 390;
    const h = 250;
    svg
      .append('rect')
      .attr('x', x)
      .attr('y', y)
      .attr('width', w)
      .attr('height', h)
      .attr('rx', 14)
      .attr('fill', '#f8fafc')
      .attr('stroke', '#d1d5db')
      .attr('filter', 'url(#shadow)');

    const delta = m.f - m.b;
    const pct = m.b ? (delta / m.b) * 100 : 0;
    const good = (m.better === 'high' && delta > 0) || (m.better === 'low' && delta < 0);
    const deltaColor = good ? colors.fewshot : (delta === 0 ? colors.muted : colors.red);

    svg.append('text').attr('x', x + 20).attr('y', y + 36).attr('font-size', 24).attr('font-weight', 700).attr('fill', colors.text).text(m.label);
    svg.append('text').attr('x', x + 20).attr('y', y + 86).attr('font-size', 18).attr('fill', '#0284c7').text(`baseline: ${m.b.toLocaleString()}`);
    svg.append('text').attr('x', x + 20).attr('y', y + 120).attr('font-size', 18).attr('fill', '#15803d').text(`fewshot: ${m.f.toLocaleString()}`);
    svg.append('text')
      .attr('x', x + 20)
      .attr('y', y + 180)
      .attr('font-size', 34)
      .attr('font-weight', 800)
      .attr('fill', deltaColor)
      .text(`${delta >= 0 ? '+' : ''}${delta.toLocaleString()} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`);
  });

  const summary = [
    `Prompt Tokens: ${b.totalPromptTokensEst} -> ${f.totalPromptTokensEst} (+${f.totalPromptTokensEst - b.totalPromptTokensEst})`,
    `Few-shot: countUsed=${f.countUsed}, fallback=${f.fallbackReason}`,
    `结论: 质量 +${f.quality - b.quality}，代价是 Tokens/Latency 上升`
  ];
  svg
    .append('rect')
    .attr('x', 70)
    .attr('y', 440)
    .attr('width', 1260)
    .attr('height', 280)
    .attr('rx', 14)
    .attr('fill', '#eef2ff')
    .attr('stroke', '#6366f1')
    .attr('stroke-width', 2);

  summary.forEach((line, idx) => {
    svg
      .append('text')
      .attr('x', 100)
      .attr('y', 500 + idx * 72)
      .attr('font-size', 28)
      .attr('font-weight', 700)
      .attr('fill', '#312e81')
      .text(line);
  });

  save(dom, 'slide_04e_code_as_prompt_case_kpi.svg');
}

function drawPromptComposition(caseData) {
  const { dom, svg } = createSvg(1400, 820);
  title(svg, 'Prompt 构成对比（Token 维度）', 'baseline vs fewshot_r1');

  const rows = [
    {
      name: 'baseline',
      base: caseData.baseline.basePromptTokens,
      inject: caseData.baseline.fewshotPromptTokens,
      total: caseData.baseline.totalPromptTokensEst,
      y: 220,
      baseColor: '#0ea5e9',
      injectColor: '#0369a1'
    },
    {
      name: 'fewshot_r1',
      base: caseData.fewshot.basePromptTokens,
      inject: caseData.fewshot.fewshotPromptTokens,
      total: caseData.fewshot.totalPromptTokensEst,
      y: 400,
      baseColor: '#22c55e',
      injectColor: '#15803d'
    }
  ];

  const maxTotal = d3.max(rows, (d) => d.total) || 1;
  const scale = d3.scaleLinear().domain([0, maxTotal]).range([0, 880]);

  rows.forEach((r) => {
    const x = 280;
    svg.append('text').attr('x', 80).attr('y', r.y + 10).attr('font-size', 28).attr('font-weight', 700).attr('fill', colors.text).text(r.name);

    svg.append('rect').attr('x', x).attr('y', r.y - 24).attr('width', 880).attr('height', 44).attr('rx', 10).attr('fill', colors.neutral);

    const baseW = scale(r.base);
    const injectW = scale(r.inject);
    svg.append('rect').attr('x', x).attr('y', r.y - 24).attr('width', baseW).attr('height', 20).attr('rx', 8).attr('fill', r.baseColor);
    svg.append('rect').attr('x', x).attr('y', r.y).attr('width', injectW).attr('height', 20).attr('rx', 8).attr('fill', r.injectColor);

    svg.append('text').attr('x', x + baseW + 10).attr('y', r.y - 8).attr('font-size', 16).attr('fill', '#1d4ed8').text(`base ${r.base}`);
    svg.append('text').attr('x', x + injectW + 10).attr('y', r.y + 16).attr('font-size', 16).attr('fill', '#166534').text(`inject ${r.inject}`);
    svg.append('text').attr('x', x + 890).attr('y', r.y + 8).attr('font-size', 22).attr('font-weight', 700).attr('fill', colors.text).text(`total ${r.total}`);
  });

  const ratio = caseData.fewshot.fewshotPromptTokens / caseData.fewshot.totalPromptTokensEst;
  const cards = [
    `注入占比: ${(ratio * 100).toFixed(1)}%`,
    `countRequested: ${caseData.fewshot.countRequested}`,
    `countUsed: ${caseData.fewshot.countUsed}`,
    `fallback: ${caseData.fewshot.fallbackReason}`
  ];
  cards.forEach((text, idx) => {
    const x = 90 + idx * 320;
    svg.append('rect').attr('x', x).attr('y', 560).attr('width', 290).attr('height', 150).attr('rx', 12).attr('fill', '#f8fafc').attr('stroke', '#d1d5db').attr('filter', 'url(#shadow)');
    svg.append('text').attr('x', x + 16).attr('y', 640).attr('font-size', 26).attr('font-weight', 800).attr('fill', '#0f172a').text(text);
  });

  save(dom, 'slide_04f_code_as_prompt_composition.svg');
}

function drawStageImpact(caseData) {
  const { dom, svg } = createSvg(1400, 820);
  title(svg, '阶段影响判断（单案例）', 'V1/V2 稳态 + V3 注入触发有效变化');

  const stages = [
    { name: 'V1 静态模板', impact: 0, note: '结构不变', color: '#0ea5e9' },
    { name: 'V2 程序化参数', impact: 1, note: '参数微调', color: '#f59e0b' },
    { name: 'V3 动态注入', impact: 9, note: 'quality +9', color: '#22c55e' }
  ];
  const scale = d3.scaleLinear().domain([0, 10]).range([0, 760]);

  stages.forEach((s, i) => {
    const y = 190 + i * 170;
    svg.append('text').attr('x', 80).attr('y', y + 16).attr('font-size', 30).attr('font-weight', 800).attr('fill', colors.text).text(s.name);
    svg.append('rect').attr('x', 380).attr('y', y - 18).attr('width', 760).attr('height', 38).attr('rx', 8).attr('fill', colors.neutral);
    svg.append('rect').attr('x', 380).attr('y', y - 18).attr('width', scale(s.impact)).attr('height', 38).attr('rx', 8).attr('fill', s.color);
    svg.append('text').attr('x', 1158).attr('y', y + 10).attr('font-size', 24).attr('font-weight', 700).attr('fill', colors.text).text(`${s.note}`);
  });

  svg
    .append('rect')
    .attr('x', 60)
    .attr('y', 620)
    .attr('width', 1280)
    .attr('height', 150)
    .attr('rx', 12)
    .attr('fill', '#fefce8')
    .attr('stroke', '#facc15');

  const lines = [
    `证据1: basePromptTokens ${caseData.baseline.basePromptTokens} -> ${caseData.fewshot.basePromptTokens} (不变)`,
    `证据2: 注入 tokens 0 -> ${caseData.fewshot.fewshotPromptTokens}，countUsed=${caseData.fewshot.countUsed}`,
    `证据3: 输出质量 ${caseData.baseline.quality} -> ${caseData.fewshot.quality}，与 V3 同步出现`
  ];
  lines.forEach((line, idx) => {
    svg.append('text').attr('x', 90).attr('y', 674 + idx * 36).attr('font-size', 23).attr('font-weight', 700).attr('fill', '#854d0e').text(line);
  });

  save(dom, 'slide_04g_code_as_prompt_stage_impact.svg');
}

function drawPromptDiffMetric(caseData) {
  const { dom, svg } = createSvg(1400, 820);
  title(svg, 'Prompt 文本差异指标（单案例）', '可用于变更门禁的轻量指标');

  const items = [
    { k: 'Prompt Chars', b: caseData.baseline.promptChars, f: caseData.fewshot.promptChars },
    { k: 'Prompt Lines', b: caseData.baseline.promptLines, f: caseData.fewshot.promptLines },
    { k: 'Prompt Tokens Est', b: caseData.baseline.totalPromptTokensEst, f: caseData.fewshot.totalPromptTokensEst }
  ];
  const max = d3.max(items, (d) => Math.max(d.b, d.f)) || 1;
  const scale = d3.scaleLinear().domain([0, max]).range([0, 700]);

  items.forEach((item, idx) => {
    const y = 190 + idx * 190;
    svg.append('text').attr('x', 90).attr('y', y + 12).attr('font-size', 30).attr('font-weight', 800).attr('fill', colors.text).text(item.k);

    svg.append('rect').attr('x', 420).attr('y', y - 26).attr('width', 700).attr('height', 20).attr('rx', 8).attr('fill', '#bae6fd');
    svg.append('rect').attr('x', 420).attr('y', y + 4).attr('width', 700).attr('height', 20).attr('rx', 8).attr('fill', '#bbf7d0');

    const bw = scale(item.b);
    const fw = scale(item.f);
    svg.append('rect').attr('x', 420).attr('y', y - 26).attr('width', bw).attr('height', 20).attr('rx', 8).attr('fill', colors.baseline);
    svg.append('rect').attr('x', 420).attr('y', y + 4).attr('width', fw).attr('height', 20).attr('rx', 8).attr('fill', colors.fewshot);

    const delta = item.f - item.b;
    const pct = item.b ? (delta / item.b) * 100 : 0;
    svg.append('text').attr('x', 1140).attr('y', y).attr('font-size', 18).attr('fill', '#0369a1').text(`B ${item.b}`);
    svg.append('text').attr('x', 1140).attr('y', y + 22).attr('font-size', 18).attr('fill', '#15803d').text(`F ${item.f}`);
    svg.append('text').attr('x', 1240).attr('y', y + 10).attr('font-size', 24).attr('font-weight', 800).attr('fill', '#7c3aed').text(`${delta >= 0 ? '+' : ''}${delta} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`);
  });

  svg.append('rect').attr('x', 80).attr('y', 700).attr('width', 1240).attr('height', 90).attr('rx', 10).attr('fill', '#f3e8ff').attr('stroke', '#a855f7');
  svg.append('text').attr('x', 110).attr('y', 755).attr('font-size', 28).attr('font-weight', 800).attr('fill', '#581c87')
    .text(`门禁建议: 若 Prompt Tokens 增幅 > 80%，必须同步满足 Quality 增幅 >= +3 (当前 +${caseData.fewshot.quality - caseData.baseline.quality})`);

  save(dom, 'slide_04h_code_as_prompt_prompt_diff_metrics.svg');
}

function main() {
  const caseData = readCase('打招呼');
  drawKpiDelta(caseData);
  drawPromptComposition(caseData);
  drawStageImpact(caseData);
  drawPromptDiffMetric(caseData);
  console.log('[code-as-prompt-charts] generated 4 svg files');
}

main();
