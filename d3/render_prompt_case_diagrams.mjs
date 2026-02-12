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

const palette = {
  text: '#1f2937',
  muted: '#64748b',
  link: '#475569',
  panel: '#f8fafc',
  panelStroke: '#cbd5e1',
  baseline: { fill: '#e0f2fe', stroke: '#0284c7' },
  fewshot: { fill: '#dcfce7', stroke: '#16a34a' },
  warn: { fill: '#fef3c7', stroke: '#d97706' },
  code: { fill: '#111827', stroke: '#374151', text: '#f9fafb' }
};

function createSvg(width, height) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const svg = d3
    .select(dom.window.document.body)
    .append('svg')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('width', width)
    .attr('height', height)
    .style('background-color', '#ffffff');

  const defs = svg.append('defs');
  defs
    .append('marker')
    .attr('id', 'arrow')
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 8)
    .attr('refY', 0)
    .attr('markerWidth', 7)
    .attr('markerHeight', 7)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0,-5L10,0L0,5')
    .attr('fill', palette.link);

  defs
    .append('filter')
    .attr('id', 'softShadow')
    .attr('x', '-20%')
    .attr('y', '-20%')
    .attr('width', '160%')
    .attr('height', '160%')
    .append('feDropShadow')
    .attr('dx', 0)
    .attr('dy', 2)
    .attr('stdDeviation', 2.2)
    .attr('flood-color', '#0f172a')
    .attr('flood-opacity', 0.12);

  return { dom, svg };
}

function saveSvg(dom, filename) {
  fs.writeFileSync(path.join(outDir, filename), dom.window.document.body.innerHTML, 'utf8');
}

function title(svg, text, subtitle) {
  svg
    .append('text')
    .attr('x', 40)
    .attr('y', 42)
    .attr('font-size', 30)
    .attr('font-weight', 800)
    .attr('fill', '#0f172a')
    .text(text);

  if (subtitle) {
    svg
      .append('text')
      .attr('x', 40)
      .attr('y', 70)
      .attr('font-size', 15)
      .attr('font-weight', 500)
      .attr('fill', palette.muted)
      .text(subtitle);
  }
}

function addLines(group, x, y, lines, options = {}) {
  const {
    size = 14,
    weight = 600,
    fill = palette.text,
    lineHeight = 18
  } = options;
  const text = group
    .append('text')
    .attr('x', x)
    .attr('y', y)
    .attr('font-size', size)
    .attr('font-weight', weight)
    .attr('fill', fill);
  lines.forEach((line, i) => {
    text
      .append('tspan')
      .attr('x', x)
      .attr('dy', i === 0 ? 0 : lineHeight)
      .text(line);
  });
}

function addNode(svg, config) {
  const g = svg.append('g');
  g.append('rect')
    .attr('x', config.x)
    .attr('y', config.y)
    .attr('width', config.w)
    .attr('height', config.h)
    .attr('rx', config.rx || 12)
    .attr('fill', config.fill)
    .attr('stroke', config.stroke)
    .attr('stroke-width', config.strokeWidth || 2)
    .attr('filter', 'url(#softShadow)');
  addLines(
    g,
    config.x + 14,
    config.y + 24,
    config.lines,
    {
      size: config.fontSize || 14,
      weight: config.fontWeight || 600,
      fill: config.textColor || palette.text,
      lineHeight: config.lineHeight || 18
    }
  );
}

function arrow(svg, x1, y1, x2, y2, label = '') {
  svg
    .append('line')
    .attr('x1', x1)
    .attr('y1', y1)
    .attr('x2', x2)
    .attr('y2', y2)
    .attr('stroke', palette.link)
    .attr('stroke-width', 1.8)
    .attr('marker-end', 'url(#arrow)');
  if (label) {
    svg
      .append('text')
      .attr('x', (x1 + x2) / 2)
      .attr('y', (y1 + y2) / 2 - 6)
      .attr('text-anchor', 'middle')
      .attr('font-size', 12)
      .attr('font-weight', 600)
      .attr('fill', '#334155')
      .text(label);
  }
}

function loadCaseData(phrase = '打招呼') {
  function pick(file) {
    const lines = fs.readFileSync(path.join(roundsDir, file), 'utf8').trim().split(/\n+/);
    for (const line of lines) {
      const obj = JSON.parse(line);
      if (obj?.request?.phrase !== phrase) continue;
      const obs = obj?.response?.observability || {};
      const few = obs?.metadata?.fewShot || {};
      const promptText = String(obj?.response?.prompt || '');
      const fileBaseMatch = promptText.match(/文件名基础:\s*"([^"]+)"/);
      return {
        quality: obs?.quality?.score || 0,
        tokens: obs?.tokens?.total || 0,
        latency: obs?.performance?.totalTime || 0,
        fewShotEnabled: !!few.enabled,
        countUsed: few.countUsed || 0,
        fallbackReason: few.fallbackReason || 'none',
        basePromptTokens: few.basePromptTokens || 0,
        fewshotPromptTokens: few.fewshotPromptTokens || 0,
        totalPromptTokensEst: few.totalPromptTokensEst || 0,
        exampleIds: Array.isArray(few.exampleIds) ? few.exampleIds : [],
        countRequested: few.countRequested || 0,
        minScore: few.minScore || 0,
        tokenBudgetRatio: few.tokenBudgetRatio || 0,
        promptText,
        promptChars: promptText.length,
        promptLines: promptText ? promptText.split(/\r?\n/).length : 0,
        fileNameBase: fileBaseMatch ? fileBaseMatch[1] : ''
      };
    }
    return null;
  }

  return {
    phrase,
    baseline: pick('baseline.jsonl'),
    fewshot: pick('fewshot_r1.jsonl')
  };
}

function drawCaseDataFlow(caseData) {
  const width = 1680;
  const height = 980;
  const { dom, svg } = createSvg(width, height);

  title(
    svg,
    `案例数据流图: "${caseData.phrase}"`,
    'experiment=exp_benchmark_50_20260209_140431 | round: baseline vs fewshot_r1'
  );

  svg.append('rect')
    .attr('x', 36)
    .attr('y', 95)
    .attr('width', 1608)
    .attr('height', 390)
    .attr('rx', 16)
    .attr('fill', palette.panel)
    .attr('stroke', palette.panelStroke)
    .attr('stroke-dasharray', '6,6');
  svg.append('text')
    .attr('x', 54)
    .attr('y', 126)
    .attr('font-size', 18)
    .attr('font-weight', 800)
    .attr('fill', '#0f172a')
    .text('共享输入阶段');

  addNode(svg, {
    x: 70, y: 160, w: 280, h: 100,
    fill: '#eef2ff', stroke: '#4f46e5',
    lines: [
      '请求: POST /api/generate',
      `phrase = ${caseData.phrase}`,
      'provider = local'
    ]
  });
  addNode(svg, {
    x: 400, y: 160, w: 290, h: 100,
    fill: palette.baseline.fill, stroke: palette.baseline.stroke,
    lines: [
      'V1+V2 基础 Prompt',
      `basePromptTokens = ${caseData.baseline.basePromptTokens}`,
      'buildPrompt/buildMarkdownPrompt'
    ]
  });
  addNode(svg, {
    x: 740, y: 160, w: 320, h: 112,
    fill: palette.fewshot.fill, stroke: palette.fewshot.stroke,
    lines: [
      'V3 示例检索',
      `countUsed = ${caseData.fewshot.countUsed}`,
      `exampleIds = [${caseData.fewshot.exampleIds.join(',')}]`
    ]
  });
  addNode(svg, {
    x: 1110, y: 160, w: 320, h: 112,
    fill: palette.warn.fill, stroke: palette.warn.stroke,
    lines: [
      '预算门控',
      `fallback = ${caseData.fewshot.fallbackReason}`,
      `fewshotPromptTokens = ${caseData.fewshot.fewshotPromptTokens}`
    ]
  });

  arrow(svg, 350, 210, 400, 210, '输入短语');
  arrow(svg, 690, 210, 740, 210, '启用 few-shot');
  arrow(svg, 1060, 216, 1110, 216, '预算检查');

  svg.append('rect')
    .attr('x', 36)
    .attr('y', 510)
    .attr('width', 780)
    .attr('height', 410)
    .attr('rx', 16)
    .attr('fill', '#f0f9ff')
    .attr('stroke', '#38bdf8')
    .attr('stroke-dasharray', '5,5');
  svg.append('text')
    .attr('x', 54)
    .attr('y', 540)
    .attr('font-size', 18)
    .attr('font-weight', 800)
    .attr('fill', '#0f172a')
    .text('Baseline 路径（无 few-shot）');

  addNode(svg, {
    x: 70, y: 580, w: 320, h: 120,
    fill: palette.baseline.fill, stroke: palette.baseline.stroke,
    lines: [
      'Prompt 提交',
      `totalPromptTokensEst = ${caseData.baseline.totalPromptTokensEst}`,
      'fewShotEnabled = false'
    ]
  });
  addNode(svg, {
    x: 430, y: 580, w: 340, h: 168,
    fill: '#ffffff', stroke: palette.baseline.stroke,
    lines: [
      '模型输出指标',
      `quality = ${caseData.baseline.quality}`,
      `tokens = ${caseData.baseline.tokens}`,
      `latency = ${caseData.baseline.latency} ms`
    ],
    fontSize: 16,
    lineHeight: 26
  });
  arrow(svg, 390, 640, 430, 640, '直接生成');

  svg.append('rect')
    .attr('x', 842)
    .attr('y', 510)
    .attr('width', 802)
    .attr('height', 410)
    .attr('rx', 16)
    .attr('fill', '#f0fdf4')
    .attr('stroke', '#22c55e')
    .attr('stroke-dasharray', '5,5');
  svg.append('text')
    .attr('x', 860)
    .attr('y', 540)
    .attr('font-size', 18)
    .attr('font-weight', 800)
    .attr('fill', '#0f172a')
    .text('Few-shot 路径（动态注入后）');

  addNode(svg, {
    x: 870, y: 580, w: 340, h: 120,
    fill: palette.fewshot.fill, stroke: palette.fewshot.stroke,
    lines: [
      '增强 Prompt 提交',
      `totalPromptTokensEst = ${caseData.fewshot.totalPromptTokensEst}`,
      `fewShotEnabled = ${caseData.fewshot.fewShotEnabled}`
    ]
  });
  addNode(svg, {
    x: 1244, y: 580, w: 360, h: 168,
    fill: '#ffffff', stroke: palette.fewshot.stroke,
    lines: [
      '模型输出指标',
      `quality = ${caseData.fewshot.quality}`,
      `tokens = ${caseData.fewshot.tokens}`,
      `latency = ${caseData.fewshot.latency} ms`
    ],
    fontSize: 16,
    lineHeight: 26
  });
  arrow(svg, 1210, 640, 1244, 640, '注入示例后生成');

  const dQuality = caseData.fewshot.quality - caseData.baseline.quality;
  const dTokens = caseData.fewshot.tokens - caseData.baseline.tokens;
  const dLatency = caseData.fewshot.latency - caseData.baseline.latency;
  addNode(svg, {
    x: 1000, y: 774, w: 520, h: 118,
    fill: '#ecfeff', stroke: '#0891b2',
    lines: [
      `对照结论: quality +${dQuality} | tokens +${dTokens} | latency +${dLatency}ms`,
      '机制生效特征: 注入 1 条示例 + budget_reduction 触发',
      '说明质量提升来自 V3 注入路径，而非仅模板变更'
    ],
    fontSize: 15,
    lineHeight: 22
  });

  svg.append('text')
    .attr('x', 40)
    .attr('y', 958)
    .attr('font-size', 12)
    .attr('fill', palette.muted)
    .text('Source: baseline.jsonl + fewshot_r1.jsonl (phrase=打招呼)');

  saveSvg(dom, 'prompt_case_dataflow_dazhahu.svg');
}

function drawCaseSample(caseData) {
  const width = 1680;
  const height = 1000;
  const { dom, svg } = createSvg(width, height);

  title(
    svg,
    `案例数据样例图: "${caseData.phrase}" baseline vs fewshot_r1`,
    '关键观测字段与 few-shot 元数据样例'
  );

  addNode(svg, {
    x: 60, y: 110, w: 740, h: 284,
    fill: '#f8fafc', stroke: '#38bdf8',
    lines: [
      'Baseline 样例',
      `quality=${caseData.baseline.quality}, tokens=${caseData.baseline.tokens}, latency=${caseData.baseline.latency}ms`,
      `fewShotEnabled=${caseData.baseline.fewShotEnabled}, countUsed=${caseData.baseline.countUsed}, fallback=${caseData.baseline.fallbackReason}`,
      `basePromptTokens=${caseData.baseline.basePromptTokens}, fewshotPromptTokens=${caseData.baseline.fewshotPromptTokens}, totalPromptTokensEst=${caseData.baseline.totalPromptTokensEst}`
    ],
    fontSize: 18,
    lineHeight: 34
  });

  addNode(svg, {
    x: 880, y: 110, w: 740, h: 284,
    fill: '#f8fafc', stroke: '#22c55e',
    lines: [
      'Fewshot_r1 样例',
      `quality=${caseData.fewshot.quality}, tokens=${caseData.fewshot.tokens}, latency=${caseData.fewshot.latency}ms`,
      `fewShotEnabled=${caseData.fewshot.fewShotEnabled}, countUsed=${caseData.fewshot.countUsed}, fallback=${caseData.fewshot.fallbackReason}`,
      `basePromptTokens=${caseData.fewshot.basePromptTokens}, fewshotPromptTokens=${caseData.fewshot.fewshotPromptTokens}, totalPromptTokensEst=${caseData.fewshot.totalPromptTokensEst}`
    ],
    fontSize: 18,
    lineHeight: 34
  });

  const metrics = [
    { name: 'quality', baseline: caseData.baseline.quality, fewshot: caseData.fewshot.quality, max: 100, unit: '' },
    { name: 'tokens', baseline: caseData.baseline.tokens, fewshot: caseData.fewshot.tokens, max: Math.max(caseData.fewshot.tokens, caseData.baseline.tokens) * 1.15, unit: '' },
    { name: 'latency(ms)', baseline: caseData.baseline.latency, fewshot: caseData.fewshot.latency, max: Math.max(caseData.fewshot.latency, caseData.baseline.latency) * 1.2, unit: '' }
  ];

  const chartX = 90;
  const chartY = 450;
  const rowGap = 120;
  const barMax = 620;

  svg.append('text')
    .attr('x', chartX)
    .attr('y', chartY - 24)
    .attr('font-size', 22)
    .attr('font-weight', 800)
    .attr('fill', '#0f172a')
    .text('核心指标条形对照');

  metrics.forEach((m, i) => {
    const y = chartY + i * rowGap;
    const scale = d3.scaleLinear().domain([0, m.max]).range([0, barMax]);
    const bWidth = scale(m.baseline);
    const fWidth = scale(m.fewshot);

    svg.append('text')
      .attr('x', chartX)
      .attr('y', y + 14)
      .attr('font-size', 16)
      .attr('font-weight', 700)
      .attr('fill', '#334155')
      .text(m.name);

    svg.append('rect')
      .attr('x', chartX + 130)
      .attr('y', y)
      .attr('width', barMax)
      .attr('height', 26)
      .attr('rx', 8)
      .attr('fill', '#e2e8f0');
    svg.append('rect')
      .attr('x', chartX + 130)
      .attr('y', y)
      .attr('width', bWidth)
      .attr('height', 12)
      .attr('rx', 6)
      .attr('fill', '#0ea5e9');
    svg.append('rect')
      .attr('x', chartX + 130)
      .attr('y', y + 14)
      .attr('width', fWidth)
      .attr('height', 12)
      .attr('rx', 6)
      .attr('fill', '#22c55e');

    svg.append('text')
      .attr('x', chartX + 130 + bWidth + 10)
      .attr('y', y + 10)
      .attr('font-size', 13)
      .attr('fill', '#0369a1')
      .text(`baseline: ${m.baseline}${m.unit}`);
    svg.append('text')
      .attr('x', chartX + 130 + fWidth + 10)
      .attr('y', y + 26)
      .attr('font-size', 13)
      .attr('fill', '#15803d')
      .text(`fewshot: ${m.fewshot}${m.unit}`);
  });

  addNode(svg, {
    x: 900, y: 450, w: 720, h: 420,
    fill: palette.code.fill, stroke: palette.code.stroke, textColor: palette.code.text,
    lines: [
      'metadata.fewShot 样例 (fewshot_r1)',
      '{',
      '  "enabled": true,',
      '  "countUsed": 1,',
      '  "fallbackReason": "budget_reduction",',
      '  "basePromptTokens": 274,',
      '  "fewshotPromptTokens": 258,',
      '  "totalPromptTokensEst": 532,',
      '  "exampleIds": [27]',
      '}'
    ],
    fontSize: 18,
    lineHeight: 34
  });

  svg.append('text')
    .attr('x', 40)
    .attr('y', 970)
    .attr('font-size', 12)
    .attr('fill', palette.muted)
    .text('Source: exp_benchmark_50_20260209_140431 baseline.jsonl + fewshot_r1.jsonl');

  saveSvg(dom, 'prompt_case_sample_dazhahu.svg');
}

function drawPromptStageDiff(caseData) {
  const width = 1680;
  const height = 1060;
  const { dom, svg } = createSvg(width, height);

  title(
    svg,
    `Prompt 阶段差异图: "${caseData.phrase}" baseline vs fewshot_r1`,
    'V1 静态模板不变 | V2 参数变化 | V3 动态注入新增'
  );

  const anchor = '你是中英日三语学习卡片生成器。';
  const fewPrompt = caseData.fewshot.promptText || '';
  const idx = fewPrompt.indexOf(anchor);
  const v3Prefix = idx > 0 ? fewPrompt.slice(0, idx).trim() : '';
  const v3PrefixLines = v3Prefix ? v3Prefix.split(/\r?\n/).length : 0;
  const v3PrefixChars = v3Prefix.length;

  const maxPromptToken = Math.max(caseData.baseline.totalPromptTokensEst, caseData.fewshot.totalPromptTokensEst);
  const tokenScale = d3.scaleLinear().domain([0, maxPromptToken]).range([0, 620]);

  addNode(svg, {
    x: 48, y: 110, w: 780, h: 318,
    fill: '#f8fafc', stroke: '#cbd5e1',
    lines: ['Prompt 构成对比（Token 估算）'],
    fontSize: 22,
    lineHeight: 28
  });

  const rows = [
    {
      name: 'baseline',
      base: caseData.baseline.basePromptTokens,
      inject: caseData.baseline.fewshotPromptTokens,
      total: caseData.baseline.totalPromptTokensEst,
      y: 210,
      color1: '#0ea5e9',
      color2: '#0369a1'
    },
    {
      name: 'fewshot_r1',
      base: caseData.fewshot.basePromptTokens,
      inject: caseData.fewshot.fewshotPromptTokens,
      total: caseData.fewshot.totalPromptTokensEst,
      y: 290,
      color1: '#22c55e',
      color2: '#15803d'
    }
  ];

  rows.forEach((r) => {
    svg.append('text')
      .attr('x', 96)
      .attr('y', r.y + 8)
      .attr('font-size', 16)
      .attr('font-weight', 700)
      .attr('fill', '#1f2937')
      .text(r.name);

    svg.append('rect')
      .attr('x', 210)
      .attr('y', r.y - 14)
      .attr('width', 620)
      .attr('height', 30)
      .attr('rx', 8)
      .attr('fill', '#e2e8f0');

    const baseW = tokenScale(r.base);
    const injW = tokenScale(r.inject);
    svg.append('rect')
      .attr('x', 210)
      .attr('y', r.y - 14)
      .attr('width', baseW)
      .attr('height', 14)
      .attr('rx', 6)
      .attr('fill', r.color1);
    svg.append('rect')
      .attr('x', 210)
      .attr('y', r.y + 2)
      .attr('width', injW)
      .attr('height', 14)
      .attr('rx', 6)
      .attr('fill', r.color2);

    svg.append('text')
      .attr('x', 210 + baseW + 8)
      .attr('y', r.y - 2)
      .attr('font-size', 12)
      .attr('fill', '#1e3a8a')
      .text(`base: ${r.base}`);
    svg.append('text')
      .attr('x', 210 + injW + 8)
      .attr('y', r.y + 14)
      .attr('font-size', 12)
      .attr('fill', '#14532d')
      .text(`inject: ${r.inject}`);
    svg.append('text')
      .attr('x', 760)
      .attr('y', r.y + 7)
      .attr('font-size', 14)
      .attr('font-weight', 700)
      .attr('fill', '#0f172a')
      .text(`total=${r.total}`);
  });

  addNode(svg, {
    x: 860, y: 110, w: 772, h: 318,
    fill: '#f8fafc', stroke: '#cbd5e1',
    lines: ['Prompt 长度差异（字符 / 行）'],
    fontSize: 22,
    lineHeight: 28
  });

  const lenRows = [
    { name: 'chars', b: caseData.baseline.promptChars, f: caseData.fewshot.promptChars, max: Math.max(caseData.baseline.promptChars, caseData.fewshot.promptChars) * 1.15, y: 210 },
    { name: 'lines', b: caseData.baseline.promptLines, f: caseData.fewshot.promptLines, max: Math.max(caseData.baseline.promptLines, caseData.fewshot.promptLines) * 1.2, y: 290 }
  ];
  lenRows.forEach((r) => {
    const scale = d3.scaleLinear().domain([0, r.max]).range([0, 560]);
    svg.append('text')
      .attr('x', 900)
      .attr('y', r.y + 8)
      .attr('font-size', 16)
      .attr('font-weight', 700)
      .attr('fill', '#334155')
      .text(r.name);
    svg.append('rect')
      .attr('x', 1000)
      .attr('y', r.y - 14)
      .attr('width', 560)
      .attr('height', 30)
      .attr('rx', 8)
      .attr('fill', '#e2e8f0');
    svg.append('rect')
      .attr('x', 1000)
      .attr('y', r.y - 14)
      .attr('width', scale(r.b))
      .attr('height', 12)
      .attr('rx', 6)
      .attr('fill', '#0ea5e9');
    svg.append('rect')
      .attr('x', 1000)
      .attr('y', r.y + 2)
      .attr('width', scale(r.f))
      .attr('height', 12)
      .attr('rx', 6)
      .attr('fill', '#22c55e');
    svg.append('text')
      .attr('x', 1000 + scale(r.b) + 8)
      .attr('y', r.y - 2)
      .attr('font-size', 12)
      .attr('fill', '#0369a1')
      .text(`baseline: ${r.b}`);
    svg.append('text')
      .attr('x', 1000 + scale(r.f) + 8)
      .attr('y', r.y + 14)
      .attr('font-size', 12)
      .attr('fill', '#15803d')
      .text(`fewshot: ${r.f}`);
  });

  addNode(svg, {
    x: 48, y: 458, w: 510, h: 252,
    fill: palette.baseline.fill, stroke: palette.baseline.stroke,
    lines: [
      'V1 静态模板差异',
      '结构约束: 基本一致',
      '三语字段与严格要求不变',
      '本例差异仅体现在后续注入段'
    ],
    fontSize: 18,
    lineHeight: 34
  });

  addNode(svg, {
    x: 586, y: 458, w: 510, h: 252,
    fill: '#fef3c7', stroke: '#d97706',
    lines: [
      'V2 程序化参数差异',
      `文件名基础: ${caseData.baseline.fileNameBase} -> ${caseData.fewshot.fileNameBase}`,
      `countRequested: ${caseData.baseline.countRequested} -> ${caseData.fewshot.countRequested}`,
      `minScore: ${caseData.baseline.minScore} -> ${caseData.fewshot.minScore}`,
      `tokenBudgetRatio: ${caseData.baseline.tokenBudgetRatio} -> ${caseData.fewshot.tokenBudgetRatio}`
    ],
    fontSize: 16,
    lineHeight: 30
  });

  addNode(svg, {
    x: 1122, y: 458, w: 510, h: 252,
    fill: palette.fewshot.fill, stroke: palette.fewshot.stroke,
    lines: [
      'V3 动态注入差异',
      `注入前缀: ${v3PrefixLines} 行 / ${v3PrefixChars} 字符`,
      `countUsed=${caseData.fewshot.countUsed}, exampleIds=[${caseData.fewshot.exampleIds.join(',')}]`,
      `fallbackReason=${caseData.fewshot.fallbackReason}`,
      `fewshotPromptTokens=${caseData.fewshot.fewshotPromptTokens}`
    ],
    fontSize: 16,
    lineHeight: 30
  });

  addNode(svg, {
    x: 48, y: 740, w: 1584, h: 260,
    fill: '#111827', stroke: '#374151', textColor: '#f9fafb',
    lines: [
      'fewshot_r1 注入块样例（节选）',
      '请参考以下 1 个高质量示例，仅学习结构与细节层级，不要照抄具体文本。',
      '### 示例 1（质量评分: 87）',
      '输入: シナリオ',
      '输出示例: { "markdown_content": "...", "audio_tasks": [...] }',
      '---',
      '现在请基于下面任务生成结果：'
    ],
    fontSize: 18,
    lineHeight: 32
  });

  svg.append('text')
    .attr('x', 40)
    .attr('y', 1034)
    .attr('font-size', 12)
    .attr('fill', palette.muted)
    .text('Source: baseline/fewshot_r1 prompt text + observability.metadata.fewShot (phrase=打招呼)');

  saveSvg(dom, 'prompt_case_stage_diff_dazhahu.svg');
}

function main() {
  const caseData = loadCaseData('打招呼');
  if (!caseData.baseline || !caseData.fewshot) {
    throw new Error('Case data not found for phrase=打招呼');
  }

  drawCaseDataFlow(caseData);
  drawCaseSample(caseData);
  drawPromptStageDiff(caseData);

  console.log('[prompt-case-diagrams] generated:');
  console.log('- Docs/TestDocs/charts/prompt_case_dataflow_dazhahu.svg');
  console.log('- Docs/TestDocs/charts/prompt_case_sample_dazhahu.svg');
  console.log('- Docs/TestDocs/charts/prompt_case_stage_diff_dazhahu.svg');
}

main();
