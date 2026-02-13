import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as d3 from 'd3';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outDir = path.join(repoRoot, 'Docs', 'TestDocs', 'charts');
const dataDir = path.join(repoRoot, 'Docs', 'TestDocs', 'data');

fs.mkdirSync(outDir, { recursive: true });

function createSvg(width = 1280, height = 720) {
  const dom = new JSDOM('<!doctype html><body></body>');
  const svg = d3
    .select(dom.window.document.body)
    .append('svg')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('width', width)
    .attr('height', height)
    .style('background', '#ffffff');
  return { dom, svg, width, height };
}

function saveSvg(dom, filename) {
  fs.writeFileSync(path.join(outDir, filename), dom.window.document.body.innerHTML, 'utf8');
}

function addTitle(svg, text, subtitle = '') {
  svg
    .append('text')
    .attr('x', 40)
    .attr('y', 42)
    .attr('font-size', 28)
    .attr('font-weight', 700)
    .attr('fill', '#0f172a')
    .text(text);
  if (subtitle) {
    svg
      .append('text')
      .attr('x', 40)
      .attr('y', 72)
      .attr('font-size', 15)
      .attr('fill', '#475569')
      .text(subtitle);
  }
}

function addFooter(svg, text) {
  svg
    .append('text')
    .attr('x', 40)
    .attr('y', 700)
    .attr('font-size', 12)
    .attr('fill', '#64748b')
    .text(text);
}

function loadCsv(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return d3.csvParse(raw, (d) => {
    const parsed = {};
    for (const [k, v] of Object.entries(d)) {
      const n = Number(v);
      parsed[k] = Number.isFinite(n) ? n : v;
    }
    return parsed;
  });
}

const benchmarkRows = loadCsv(path.join(dataDir, 'round_metrics_exp_benchmark_50_20260209_140431.csv'));
const local20Rows = loadCsv(path.join(dataDir, 'round_metrics_exp_round_local20plus_20260206_073637.csv'));
const benchmarkKpi = JSON.parse(
  fs.readFileSync(path.join(dataDir, 'round_kpi_summary_exp_benchmark_50_20260209_140431.json'), 'utf8')
);

const benchmarkBaseline = benchmarkRows.find((r) => String(r.roundName) === 'baseline') || {};
const benchmarkFewshot = benchmarkRows.find((r) => String(r.roundName) === 'fewshot_r1') || {};
const localBaseline = local20Rows.find((r) => String(r.roundName) === 'baseline') || {};
const localFewshot = local20Rows.find((r) => String(r.roundName) === 'fewshot_r1') || {};

const categoryData = [
  { category: '日常词汇', baseline: 73.47, fewshot: 77.2, delta: 3.73, roi: 9.06 },
  { category: '技术术语', baseline: 77.95, fewshot: 78.85, delta: 0.9, roi: 2.33 },
  { category: '歧义复杂', baseline: 77.8, fewshot: 79.21, delta: 1.41, roi: 3.75 }
];

function renderSlide00PromptHierarchy() {
  const { dom, svg } = createSvg();
  addTitle(svg, '概念界定：Prompt Engineering / Code as Prompt / Few-shot', '层级关系：方法论 -> 工程范式 -> 运行时策略');

  const layers = [
    {
      x: 120,
      y: 130,
      w: 1040,
      h: 138,
      title: 'Prompt Engineering（提示词工程）',
      desc: '定义任务目标、约束与评测口径，形成可迭代优化闭环',
      color: '#e0f2fe',
      stroke: '#0284c7'
    },
    {
      x: 220,
      y: 315,
      w: 840,
      h: 138,
      title: 'Code as Prompt（代码即提示词）',
      desc: '将提示词模块化、版本化、可观测化，并接入实验门禁',
      color: '#ede9fe',
      stroke: '#7c3aed'
    },
    {
      x: 320,
      y: 500,
      w: 640,
      h: 114,
      title: 'Few-shot（少样本机制）',
      desc: '运行时按预算注入高质量样例，提升输出一致性与准确性',
      color: '#dcfce7',
      stroke: '#16a34a'
    }
  ];

  layers.forEach((layer) => {
    svg
      .append('rect')
      .attr('x', layer.x)
      .attr('y', layer.y)
      .attr('width', layer.w)
      .attr('height', layer.h)
      .attr('rx', 18)
      .attr('fill', layer.color)
      .attr('stroke', layer.stroke)
      .attr('stroke-width', 2.2);
    svg
      .append('text')
      .attr('x', layer.x + 24)
      .attr('y', layer.y + 48)
      .attr('font-size', 30)
      .attr('font-weight', 700)
      .attr('fill', '#0f172a')
      .text(layer.title);
    svg
      .append('text')
      .attr('x', layer.x + 24)
      .attr('y', layer.y + 88)
      .attr('font-size', 22)
      .attr('fill', '#334155')
      .text(layer.desc);
  });

  const arrow = (x1, y1, x2, y2) => {
    svg
      .append('line')
      .attr('x1', x1)
      .attr('y1', y1)
      .attr('x2', x2)
      .attr('y2', y2)
      .attr('stroke', '#64748b')
      .attr('stroke-width', 2.5)
      .attr('marker-end', 'url(#arrowhead)');
  };

  const defs = svg.append('defs');
  defs
    .append('marker')
    .attr('id', 'arrowhead')
    .attr('viewBox', '0 0 10 10')
    .attr('refX', 8)
    .attr('refY', 5)
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
    .attr('orient', 'auto-start-reverse')
    .append('path')
    .attr('d', 'M 0 0 L 10 5 L 0 10 z')
    .attr('fill', '#64748b');

  arrow(640, 270, 640, 305);
  arrow(640, 455, 640, 490);

  svg
    .append('rect')
    .attr('x', 120)
    .attr('y', 638)
    .attr('width', 1040)
    .attr('height', 52)
    .attr('rx', 12)
    .attr('fill', '#f8fafc')
    .attr('stroke', '#cbd5e1');
  svg
    .append('text')
    .attr('x', 140)
    .attr('y', 672)
    .attr('font-size', 22)
    .attr('font-weight', 600)
    .attr('fill', '#1e3a8a')
    .text('项目映射：V1 静态模板（基础） -> V2 程序化组装（工程化） -> V3 few-shot 动态注入（策略化）');

  addFooter(svg, 'Source: promptEngine.js + goldenExamplesService.js + observability design');
  saveSvg(dom, 'slide_00_prompt_hierarchy.svg');
}

function renderSlide01GoalTriangle() {
  const { dom, svg } = createSvg();
  addTitle(svg, '质量-成本-稳定性目标三角', 'exp_benchmark_50_20260209_140431');

  const cx = 470;
  const cy = 380;
  const r = 240;
  const points = [
    { name: '质量', angle: -Math.PI / 2, score: benchmarkFewshot.avgQualityScore / 100 },
    { name: '成本可控', angle: (Math.PI * 5) / 6, score: 1 - Math.min(benchmarkFewshot.tokenIncreasePct / 100, 1) },
    { name: '稳定性', angle: Math.PI / 6, score: 1 - Math.min((benchmarkFewshot.qualityCvPct || 0) / 10, 1) }
  ];

  const toXY = (angle, radius) => [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
  const outer = points.map((p) => toXY(p.angle, r));
  const polyOuter = outer.map((p) => p.join(',')).join(' ');
  svg.append('polygon').attr('points', polyOuter).attr('fill', '#f8fafc').attr('stroke', '#94a3b8').attr('stroke-width', 2);

  const inner = points.map((p) => toXY(p.angle, r * p.score));
  const polyInner = inner.map((p) => p.join(',')).join(' ');
  svg.append('polygon').attr('points', polyInner).attr('fill', '#3b82f633').attr('stroke', '#2563eb').attr('stroke-width', 3);

  points.forEach((p, idx) => {
    const [x, y] = toXY(p.angle, r + 40);
    svg.append('text').attr('x', x).attr('y', y).attr('text-anchor', 'middle').attr('font-size', 20).attr('font-weight', 700).attr('fill', '#0f172a').text(p.name);
    svg
      .append('text')
      .attr('x', inner[idx][0])
      .attr('y', inner[idx][1] - 8)
      .attr('text-anchor', 'middle')
      .attr('font-size', 13)
      .attr('fill', '#1e3a8a')
      .text(`${Math.round(p.score * 100)}%`);
  });

  const table = [
    ['质量分', `${benchmarkBaseline.avgQualityScore?.toFixed(2)} -> ${benchmarkFewshot.avgQualityScore?.toFixed(2)}`],
    ['Token 增幅', `+${benchmarkFewshot.tokenIncreasePct?.toFixed(1)}%`],
    ['稳定性 CV', `${benchmarkBaseline.qualityCvPct?.toFixed(2)}% -> ${benchmarkFewshot.qualityCvPct?.toFixed(2)}%`]
  ];
  svg.append('rect').attr('x', 780).attr('y', 160).attr('width', 440).attr('height', 280).attr('rx', 16).attr('fill', '#f8fafc').attr('stroke', '#cbd5e1');
  table.forEach((row, i) => {
    svg.append('text').attr('x', 810).attr('y', 220 + i * 72).attr('font-size', 18).attr('font-weight', 600).attr('fill', '#0f172a').text(row[0]);
    svg.append('text').attr('x', 810).attr('y', 248 + i * 72).attr('font-size', 22).attr('font-weight', 700).attr('fill', '#1d4ed8').text(row[1]);
  });

  addFooter(svg, 'Data: round_metrics_exp_benchmark_50_20260209_140431.csv');
  saveSvg(dom, 'slide_01_goal_triangle.svg');
}

function renderSlide02KpiFramework() {
  const { dom, svg } = createSvg();
  addTitle(svg, '评估框架：指标与统计显著性');

  const cards = [
    { x: 70, y: 120, w: 360, h: 230, title: '主指标', items: ['Quality Score', 'Success Rate'], color: '#dbeafe', stroke: '#2563eb' },
    { x: 460, y: 120, w: 360, h: 230, title: '约束指标', items: ['Avg Tokens', 'Avg Latency'], color: '#ffedd5', stroke: '#ea580c' },
    { x: 850, y: 120, w: 360, h: 230, title: '效率指标', items: ['Gain / 1k Extra Tokens', 'Quality CV%'], color: '#dcfce7', stroke: '#16a34a' },
    { x: 265, y: 390, w: 750, h: 230, title: '统计检验', items: ['paired t-test p = 0.0005', 'Wilcoxon p = 0.0010', '95% CI = [0.84, 2.83]', "Cohen's d = 0.537 (medium)"], color: '#f3e8ff', stroke: '#9333ea' }
  ];

  cards.forEach((c) => {
    svg.append('rect').attr('x', c.x).attr('y', c.y).attr('width', c.w).attr('height', c.h).attr('rx', 14).attr('fill', c.color).attr('stroke', c.stroke).attr('stroke-width', 2.2);
    svg.append('text').attr('x', c.x + 20).attr('y', c.y + 36).attr('font-size', 24).attr('font-weight', 700).attr('fill', '#0f172a').text(c.title);
    c.items.forEach((item, i) => {
      svg.append('text').attr('x', c.x + 24).attr('y', c.y + 76 + i * 40).attr('font-size', 20).attr('fill', '#1f2937').text(`- ${item}`);
    });
  });
  addFooter(svg, 'Data: round_kpi_summary_exp_benchmark_50_20260209_140431.json');
  saveSvg(dom, 'slide_02_kpi_framework.svg');
}

function renderSlide03SystemObservability() {
  const { dom, svg } = createSvg();
  addTitle(svg, '系统可观测覆盖：链路、数据、接口');

  const blocks = [
    { name: '生成链路阶段', value: 10, max: 12, color: '#2563eb' },
    { name: '核心 API 端点', value: 19, max: 20, color: '#16a34a' },
    { name: '数据库核心表', value: 11, max: 12, color: '#ea580c' },
    { name: '实验数据维度', value: 6, max: 6, color: '#9333ea' }
  ];

  const x0 = 260;
  const y0 = 170;
  const barW = 760;
  const barH = 56;
  const gap = 90;

  blocks.forEach((b, i) => {
    const y = y0 + i * gap;
    svg.append('text').attr('x', 32).attr('y', y + 38).attr('font-size', 23).attr('fill', '#0f172a').text(b.name);
    svg.append('rect').attr('x', x0).attr('y', y).attr('width', barW).attr('height', barH).attr('rx', 12).attr('fill', '#e2e8f0');
    svg
      .append('rect')
      .attr('x', x0)
      .attr('y', y)
      .attr('width', (barW * b.value) / b.max)
      .attr('height', barH)
      .attr('rx', 12)
      .attr('fill', b.color);
    svg
      .append('text')
      .attr('x', x0 + barW + 24)
      .attr('y', y + 38)
      .attr('font-size', 22)
      .attr('font-weight', 700)
      .attr('fill', '#0f172a')
      .text(`${b.value}/${b.max}`);
  });

  addFooter(svg, 'Source: Docs/SystemDevelopStatusDocs/API.md + BACKEND.md');
  saveSvg(dom, 'slide_03_system_observability.svg');
}

function renderSlide04CodeAsPromptTimeline() {
  const { dom, svg } = createSvg();
  addTitle(svg, 'Code as Prompt：三代演进时间线');

  const items = [
    { x: 120, title: 'V1 静态模板', desc: '固定 Prompt 文本\n规则硬编码', color: '#dbeafe', stroke: '#2563eb' },
    { x: 460, title: 'V2 程序化生成', desc: 'promptEngine 组装\n质量标准结构化', color: '#ffedd5', stroke: '#ea580c' },
    { x: 800, title: 'V3 动态注入', desc: 'golden examples\n预算与回退控制', color: '#dcfce7', stroke: '#16a34a' }
  ];

  svg.append('line').attr('x1', 130).attr('y1', 360).attr('x2', 1120).attr('y2', 360).attr('stroke', '#94a3b8').attr('stroke-width', 4);
  items.forEach((it) => {
    svg.append('circle').attr('cx', it.x + 150).attr('cy', 360).attr('r', 14).attr('fill', it.stroke);
    svg.append('rect').attr('x', it.x).attr('y', 190).attr('width', 300).attr('height', 140).attr('rx', 14).attr('fill', it.color).attr('stroke', it.stroke).attr('stroke-width', 2.2);
    svg.append('text').attr('x', it.x + 20).attr('y', 232).attr('font-size', 28).attr('font-weight', 700).attr('fill', '#0f172a').text(it.title);
    it.desc.split('\n').forEach((line, idx) => {
      svg.append('text').attr('x', it.x + 20).attr('y', 270 + idx * 30).attr('font-size', 20).attr('fill', '#334155').text(line);
    });
  });

  svg.append('text').attr('x', 120).attr('y', 470).attr('font-size', 24).attr('font-weight', 700).attr('fill', '#1e3a8a').text('工程结论：Prompt 优化 = 代码重构 + 版本化迭代 + 实验回归');
  addFooter(svg, 'Source: promptEngine.js / goldenExamplesService.js / observabilityService.js');
  saveSvg(dom, 'slide_04_code_as_prompt_timeline.svg');
}

function renderSlide04aObservabilityDataModel() {
  const { dom, svg } = createSvg();
  addTitle(svg, '系统观测性子页 A：数据模型与追溯关系', '从生成记录追溯到 few-shot 与 teacher 证据链');

  const nodes = [
    { id: 'generations', x: 80, y: 150, w: 220, h: 86, color: '#dbeafe', stroke: '#2563eb', text: 'generations' },
    { id: 'observability_metrics', x: 340, y: 150, w: 260, h: 86, color: '#ede9fe', stroke: '#7c3aed', text: 'observability_metrics' },
    { id: 'audio_files', x: 640, y: 150, w: 200, h: 86, color: '#dcfce7', stroke: '#16a34a', text: 'audio_files' },
    { id: 'few_shot_runs', x: 80, y: 300, w: 220, h: 86, color: '#ffedd5', stroke: '#ea580c', text: 'few_shot_runs' },
    { id: 'few_shot_examples', x: 340, y: 300, w: 260, h: 86, color: '#fef3c7', stroke: '#ca8a04', text: 'few_shot_examples' },
    { id: 'experiment_rounds', x: 640, y: 300, w: 220, h: 86, color: '#e0f2fe', stroke: '#0284c7', text: 'experiment_rounds' },
    { id: 'experiment_samples', x: 80, y: 450, w: 240, h: 86, color: '#fee2e2', stroke: '#dc2626', text: 'experiment_samples' },
    { id: 'teacher_references', x: 360, y: 450, w: 240, h: 86, color: '#dcfce7', stroke: '#15803d', text: 'teacher_references' }
  ];

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = [
    ['generations', 'observability_metrics'],
    ['generations', 'audio_files'],
    ['few_shot_runs', 'few_shot_examples'],
    ['few_shot_runs', 'experiment_rounds'],
    ['experiment_rounds', 'experiment_samples'],
    ['experiment_samples', 'teacher_references'],
    ['observability_metrics', 'experiment_samples']
  ];

  links.forEach(([from, to]) => {
    const a = byId.get(from);
    const b = byId.get(to);
    if (!a || !b) return;
    const x1 = a.x + a.w;
    const y1 = a.y + a.h / 2;
    const x2 = b.x;
    const y2 = b.y + b.h / 2;
    svg.append('line').attr('x1', x1).attr('y1', y1).attr('x2', x2).attr('y2', y2).attr('stroke', '#64748b').attr('stroke-width', 2);
  });

  nodes.forEach((n) => {
    svg.append('rect').attr('x', n.x).attr('y', n.y).attr('width', n.w).attr('height', n.h).attr('rx', 12).attr('fill', n.color).attr('stroke', n.stroke).attr('stroke-width', 2);
    svg.append('text').attr('x', n.x + 14).attr('y', n.y + 52).attr('font-size', 22).attr('font-weight', 700).attr('fill', '#0f172a').text(n.text);
  });

  const facts = [
    '核心持久化表: 11',
    '实验追踪: 轮次/样本/教师参照',
    '生成输入输出与质量成本可回放'
  ];
  svg.append('rect').attr('x', 880).attr('y', 180).attr('width', 360).attr('height', 360).attr('rx', 14).attr('fill', '#f8fafc').attr('stroke', '#cbd5e1');
  facts.forEach((f, i) => {
    svg.append('text').attr('x', 904).attr('y', 244 + i * 88).attr('font-size', 18).attr('fill', '#334155').text(`- ${f}`);
  });

  addFooter(svg, 'Source: Docs/SystemDevelopStatusDocs/BACKEND.md + API.md');
  saveSvg(dom, 'slide_04a_observability_data_model.svg');
}

function renderSlide04bObservabilityTimeline() {
  const { dom, svg } = createSvg();
  addTitle(svg, '系统观测性子页 B：采集时序与指标落点', '生成链路 9 步中每一步的可观测字段');

  const stages = [
    'request',
    'promptBuild',
    'llmCall',
    'parse',
    'postProcess',
    'render',
    'saveFiles',
    'tts',
    'dbPersist'
  ];
  const startX = 70;
  const gapX = 128;
  const y = 250;
  stages.forEach((s, i) => {
    const x = startX + i * gapX;
    svg.append('circle').attr('cx', x).attr('cy', y).attr('r', 26).attr('fill', '#dbeafe').attr('stroke', '#2563eb').attr('stroke-width', 2);
    svg.append('text').attr('x', x).attr('y', y + 6).attr('text-anchor', 'middle').attr('font-size', 12).attr('font-weight', 700).attr('fill', '#1e3a8a').text(i + 1);
    svg.append('text').attr('x', x).attr('y', y + 52).attr('text-anchor', 'middle').attr('font-size', 12).attr('fill', '#334155').text(s);
    if (i < stages.length - 1) {
      svg.append('line').attr('x1', x + 26).attr('y1', y).attr('x2', x + gapX - 26).attr('y2', y).attr('stroke', '#94a3b8').attr('stroke-width', 2);
    }
  });

  const metrics = [
    { name: 'tokens', value: 3, max: 3, color: '#2563eb' },
    { name: 'quality', value: 5, max: 5, color: '#16a34a' },
    { name: 'performance', value: 6, max: 6, color: '#7c3aed' },
    { name: 'prompt/output', value: 4, max: 4, color: '#ea580c' },
    { name: 'few-shot metadata', value: 6, max: 6, color: '#dc2626' }
  ];
  const barX = 140;
  const barY = 380;
  const barW = 760;
  const barH = 40;
  const barGap = 54;

  metrics.forEach((m, i) => {
    const yy = barY + i * barGap;
    svg.append('text').attr('x', 40).attr('y', yy + 26).attr('font-size', 18).attr('fill', '#0f172a').text(m.name);
    svg.append('rect').attr('x', barX).attr('y', yy).attr('width', barW).attr('height', barH).attr('rx', 8).attr('fill', '#e2e8f0');
    svg.append('rect').attr('x', barX).attr('y', yy).attr('width', (barW * m.value) / m.max).attr('height', barH).attr('rx', 8).attr('fill', m.color);
    svg.append('text').attr('x', barX + barW + 18).attr('y', yy + 26).attr('font-size', 18).attr('font-weight', 700).attr('fill', '#1f2937').text(`${m.value}/${m.max}`);
  });

  svg.append('rect').attr('x', 934).attr('y', 378).attr('width', 306).attr('height', 240).attr('rx', 12).attr('fill', '#f8fafc').attr('stroke', '#cbd5e1');
  ['实时监控', '历史回放', '结果可复现'].forEach((line, idx) => {
    svg.append('text').attr('x', 948).attr('y', 436 + idx * 62).attr('font-size', 17).attr('fill', '#334155').text(`- ${line}`);
  });

  addFooter(svg, 'Source: generation pipeline + /api/history/:id payload');
  saveSvg(dom, 'slide_04b_observability_timeline.svg');
}

function renderSlide04cCodeAsPromptArchitecture() {
  const { dom, svg } = createSvg();
  addTitle(svg, 'Code as Prompt 子页 A：运行时组装架构', '模板 -> 程序化约束 -> few-shot 注入 -> 结构校验');

  const layers = [
    { title: 'L1 Prompt Template', desc: 'codex_prompt/*.md', x: 80, y: 140, color: '#dbeafe', stroke: '#2563eb' },
    { title: 'L2 Prompt Engine', desc: 'buildPrompt / buildMarkdownPrompt', x: 80, y: 250, color: '#ffedd5', stroke: '#ea580c' },
    { title: 'L3 Few-shot Injector', desc: 'goldenExamplesService + budget fallback', x: 80, y: 360, color: '#dcfce7', stroke: '#16a34a' },
    { title: 'L4 Parser & Quality', desc: 'PromptParser + observabilityService', x: 80, y: 470, color: '#ede9fe', stroke: '#7c3aed' }
  ];

  layers.forEach((l, idx) => {
    svg.append('rect').attr('x', l.x).attr('y', l.y).attr('width', 510).attr('height', 86).attr('rx', 12).attr('fill', l.color).attr('stroke', l.stroke).attr('stroke-width', 2);
    svg.append('text').attr('x', l.x + 18).attr('y', l.y + 36).attr('font-size', 24).attr('font-weight', 700).attr('fill', '#0f172a').text(l.title);
    svg.append('text').attr('x', l.x + 18).attr('y', l.y + 64).attr('font-size', 18).attr('fill', '#334155').text(l.desc);
    if (idx < layers.length - 1) {
      svg.append('line').attr('x1', 335).attr('y1', l.y + 86).attr('x2', 335).attr('y2', layers[idx + 1].y).attr('stroke', '#64748b').attr('stroke-width', 2.2);
    }
  });

  const artifacts = [
    { name: 'Prompt Full Text', color: '#2563eb' },
    { name: 'Prompt Parsed JSON', color: '#ea580c' },
    { name: 'Raw LLM Output', color: '#16a34a' },
    { name: 'Output Structured', color: '#7c3aed' },
    { name: 'Few-shot Metadata', color: '#dc2626' }
  ];

  svg.append('rect').attr('x', 660).attr('y', 170).attr('width', 560).attr('height', 430).attr('rx', 14).attr('fill', '#f8fafc').attr('stroke', '#cbd5e1');
  svg.append('text').attr('x', 686).attr('y', 216).attr('font-size', 24).attr('font-weight', 700).attr('fill', '#0f172a').text('INTEL 可展示工件');
  artifacts.forEach((a, i) => {
    const yy = 260 + i * 66;
    svg.append('circle').attr('cx', 690).attr('cy', yy - 8).attr('r', 8).attr('fill', a.color);
    svg.append('text').attr('x', 710).attr('y', yy).attr('font-size', 20).attr('fill', '#334155').text(a.name);
  });

  addFooter(svg, 'Source: services/promptEngine.js + services/goldenExamplesService.js + services/observabilityService.js');
  saveSvg(dom, 'slide_04c_code_as_prompt_architecture.svg');
}

function renderSlide04dCodeAsPromptGates() {
  const { dom, svg } = createSvg();
  addTitle(svg, 'Code as Prompt 子页 B：实验门禁与发布判定', '以统计显著性和成本效率作为 prompt 变更准入条件');

  const gates = [
    { name: 'Success Rate >= 95%', baseline: benchmarkFewshot.successRatePct || 98, threshold: 95, unit: '%' },
    { name: 'Delta Quality > 0', baseline: benchmarkFewshot.deltaQuality || 1.88, threshold: 0, unit: '' },
    { name: 'p-value < 0.05', baseline: benchmarkKpi.statisticalSignificance?.pValue || 0.0005, threshold: 0.05, unit: '', reverse: true },
    { name: "Cohen's d >= 0.3", baseline: benchmarkKpi.statisticalSignificance?.cohensD?.d || 0.537, threshold: 0.3, unit: '' },
    { name: 'Gain / 1k Tokens >= 3', baseline: benchmarkFewshot.gainPer1kExtraTokens || 4.88, threshold: 3, unit: '' },
    { name: 'Token Increase <= 35%', baseline: benchmarkFewshot.tokenIncreasePct || 37.4, threshold: 35, unit: '%', reverse: true }
  ];

  const left = 70;
  const rowH = 82;
  gates.forEach((g, i) => {
    const y = 170 + i * rowH;
    const pass = g.reverse ? g.baseline <= g.threshold : g.baseline >= g.threshold;
    const bg = pass ? '#dcfce7' : '#fee2e2';
    const stroke = pass ? '#16a34a' : '#dc2626';
    svg.append('rect').attr('x', left).attr('y', y).attr('width', 1140).attr('height', 62).attr('rx', 10).attr('fill', bg).attr('stroke', stroke);
    svg.append('text').attr('x', left + 18).attr('y', y + 39).attr('font-size', 22).attr('font-weight', 700).attr('fill', '#0f172a').text(g.name);
    svg.append('text').attr('x', 860).attr('y', y + 39).attr('font-size', 20).attr('fill', '#1f2937').text(`observed=${g.baseline.toFixed(4)}${g.unit}`);
    svg.append('text').attr('x', 1110).attr('y', y + 39).attr('font-size', 20).attr('font-weight', 700).attr('fill', pass ? '#166534' : '#991b1b').text(pass ? 'PASS' : 'FAIL');
  });

  svg.append('rect').attr('x', 70).attr('y', 680).attr('width', 1140).attr('height', 28).attr('fill', '#e2e8f0');
  const passCount = gates.filter((g) => (g.reverse ? g.baseline <= g.threshold : g.baseline >= g.threshold)).length;
  const passRatio = passCount / gates.length;
  svg.append('rect').attr('x', 70).attr('y', 680).attr('width', 1140 * passRatio).attr('height', 28).attr('fill', '#2563eb');
  svg.append('text').attr('x', 80).attr('y', 668).attr('font-size', 16).attr('fill', '#334155').text(`Release Gate Coverage: ${passCount}/${gates.length}`);

  addFooter(svg, 'Data: round_metrics_exp_benchmark_50_20260209_140431.csv + round_kpi_summary_exp_benchmark_50_20260209_140431.json');
  saveSvg(dom, 'slide_04d_code_as_prompt_gates.svg');
}

function renderSlide05InjectionMechanism() {
  const { dom, svg } = createSvg();
  addTitle(svg, 'Few-shot 注入机制与预算回退');

  const steps = [
    { name: '输入短语', x: 90, w: 170, color: '#dbeafe', stroke: '#2563eb' },
    { name: '样本检索', x: 300, w: 170, color: '#ede9fe', stroke: '#7c3aed' },
    { name: '质量筛选', x: 510, w: 170, color: '#fef3c7', stroke: '#d97706' },
    { name: '预算检查', x: 720, w: 170, color: '#fee2e2', stroke: '#dc2626' },
    { name: '注入执行', x: 930, w: 170, color: '#dcfce7', stroke: '#16a34a' }
  ];

  steps.forEach((s, idx) => {
    svg.append('rect').attr('x', s.x).attr('y', 260).attr('width', s.w).attr('height', 90).attr('rx', 12).attr('fill', s.color).attr('stroke', s.stroke).attr('stroke-width', 2);
    svg.append('text').attr('x', s.x + s.w / 2).attr('y', 314).attr('text-anchor', 'middle').attr('font-size', 24).attr('font-weight', 700).attr('fill', '#0f172a').text(s.name);
    if (idx < steps.length - 1) {
      svg.append('line').attr('x1', s.x + s.w + 8).attr('y1', 305).attr('x2', steps[idx + 1].x - 8).attr('y2', 305).attr('stroke', '#64748b').attr('stroke-width', 2.2);
    }
  });

  const notes = [
    'budget_reduction: 缩减示例数',
    'budget_truncate: 截断示例内容',
    'budget_exceeded_disable: 回退 baseline'
  ];
  svg.append('rect').attr('x', 260).attr('y', 430).attr('width', 760).attr('height', 180).attr('rx', 16).attr('fill', '#f8fafc').attr('stroke', '#cbd5e1');
  notes.forEach((n, i) => {
    svg.append('text').attr('x', 300).attr('y', 490 + i * 44).attr('font-size', 23).attr('fill', '#1f2937').text(`- ${n}`);
  });
  addFooter(svg, 'Source: server.js few-shot budget & fallback chain');
  saveSvg(dom, 'slide_05_injection_mechanism.svg');
}

function renderSlide06ReproPipeline() {
  const { dom, svg } = createSvg();
  addTitle(svg, '实验复现管线：run -> export -> chart -> report');

  const steps = [
    { title: 'run_fewshot_rounds.js', x: 80, color: '#dbeafe', out: 'JSONL' },
    { title: 'export_round_trend_dataset.js', x: 370, color: '#ffedd5', out: 'CSV/JSON + stats' },
    { title: 'render_round_trend_charts.mjs', x: 690, color: '#ede9fe', out: 'SVG charts' },
    { title: 'generate_round_kpi_report.js', x: 980, color: '#dcfce7', out: 'Markdown report' }
  ];

  steps.forEach((s, idx) => {
    svg.append('rect').attr('x', s.x).attr('y', 250).attr('width', 220).attr('height', 120).attr('rx', 14).attr('fill', s.color).attr('stroke', '#334155');
    svg.append('text').attr('x', s.x + 14).attr('y', 292).attr('font-size', 18).attr('font-weight', 700).attr('fill', '#0f172a').text(s.title);
    svg.append('text').attr('x', s.x + 14).attr('y', 332).attr('font-size', 17).attr('fill', '#475569').text(`输出: ${s.out}`);
    if (idx < steps.length - 1) {
      svg.append('line').attr('x1', s.x + 220).attr('y1', 310).attr('x2', steps[idx + 1].x - 10).attr('y2', 310).attr('stroke', '#64748b').attr('stroke-width', 3);
    }
  });

  const artifacts = [
    ['数据集', '8+ CSV/JSON'],
    ['图表', '6 SVG'],
    ['报告', '1 KPI + 1 Full']
  ];
  svg.append('rect').attr('x', 300).attr('y', 430).attr('width', 680).attr('height', 200).attr('rx', 16).attr('fill', '#f8fafc').attr('stroke', '#cbd5e1');
  artifacts.forEach((a, i) => {
    svg.append('text').attr('x', 350).attr('y', 500 + i * 44).attr('font-size', 24).attr('fill', '#1f2937').text(`${a[0]}: ${a[1]}`);
  });
  addFooter(svg, 'Source: scripts/run_fewshot_rounds.js and related exporters');
  saveSvg(dom, 'slide_06_repro_pipeline.svg');
}

function renderSlide07BenchmarkDesign() {
  const { dom, svg } = createSvg();
  addTitle(svg, '50 样本 Benchmark 设计分布');

  const data = [
    { name: '日常词汇', value: 15, color: '#3b82f6' },
    { name: '技术术语', value: 20, color: '#10b981' },
    { name: '歧义复杂', value: 15, color: '#f59e0b' }
  ];

  const pie = d3.pie().value((d) => d.value).sort(null);
  const arc = d3.arc().innerRadius(120).outerRadius(220);
  const g = svg.append('g').attr('transform', 'translate(380,370)');

  g.selectAll('path')
    .data(pie(data))
    .enter()
    .append('path')
    .attr('d', arc)
    .attr('fill', (d) => d.data.color)
    .attr('stroke', '#ffffff')
    .attr('stroke-width', 3);

  g.selectAll('text')
    .data(pie(data))
    .enter()
    .append('text')
    .attr('transform', (d) => `translate(${arc.centroid(d)})`)
    .attr('text-anchor', 'middle')
    .attr('font-size', 22)
    .attr('font-weight', 700)
    .attr('fill', '#ffffff')
    .text((d) => d.data.value);

  svg.append('text').attr('x', 350).attr('y', 380).attr('font-size', 30).attr('font-weight', 700).attr('fill', '#0f172a').text('N=50');

  data.forEach((d, i) => {
    const y = 260 + i * 110;
    svg.append('rect').attr('x', 720).attr('y', y - 28).attr('width', 26).attr('height', 26).attr('fill', d.color);
    svg.append('text').attr('x', 760).attr('y', y - 8).attr('font-size', 28).attr('font-weight', 700).attr('fill', '#0f172a').text(d.name);
    svg.append('text').attr('x', 760).attr('y', y + 28).attr('font-size', 22).attr('fill', '#334155').text(`${d.value} 条 (${((d.value / 50) * 100).toFixed(0)}%)`);
  });

  addFooter(svg, 'Data: benchmark_phrases_50.txt');
  saveSvg(dom, 'slide_07_benchmark_design.svg');
}

function renderSlide08CoreResults() {
  const { dom, svg } = createSvg();
  addTitle(svg, '核心结果：Baseline vs Fewshot_r1');

  const metrics = [
    { name: 'Quality', baseline: benchmarkBaseline.avgQualityScore, fewshot: benchmarkFewshot.avgQualityScore },
    { name: 'Tokens', baseline: benchmarkBaseline.avgTokensTotal, fewshot: benchmarkFewshot.avgTokensTotal },
    { name: 'Latency(ms)', baseline: benchmarkBaseline.avgLatencyMs, fewshot: benchmarkFewshot.avgLatencyMs }
  ];
  const y = d3
    .scaleBand()
    .domain(metrics.map((m) => m.name))
    .range([150, 520])
    .padding(0.26);
  const max = d3.max(metrics.flatMap((m) => [m.baseline, m.fewshot])) || 1;
  const x = d3.scaleLinear().domain([0, max * 1.15]).range([260, 1180]);

  svg.append('g').attr('transform', 'translate(0,550)').call(d3.axisBottom(x).ticks(8));
  metrics.forEach((m) => {
    svg.append('text').attr('x', 60).attr('y', y(m.name) + 34).attr('font-size', 24).attr('font-weight', 700).attr('fill', '#0f172a').text(m.name);
    svg.append('rect').attr('x', x(0)).attr('y', y(m.name)).attr('width', x(m.baseline) - x(0)).attr('height', y.bandwidth() / 2 - 4).attr('fill', '#93c5fd');
    svg.append('rect').attr('x', x(0)).attr('y', y(m.name) + y.bandwidth() / 2 + 4).attr('width', x(m.fewshot) - x(0)).attr('height', y.bandwidth() / 2 - 4).attr('fill', '#2563eb');
    svg.append('text').attr('x', x(m.baseline) + 8).attr('y', y(m.name) + 20).attr('font-size', 14).attr('fill', '#1e3a8a').text(`B: ${Math.round(m.baseline)}`);
    svg.append('text').attr('x', x(m.fewshot) + 8).attr('y', y(m.name) + y.bandwidth() - 8).attr('font-size', 14).attr('fill', '#1e40af').text(`F: ${Math.round(m.fewshot)}`);
  });

  svg.append('rect').attr('x', 920).attr('y', 120).attr('width', 260).attr('height', 120).attr('rx', 12).attr('fill', '#f0fdf4').attr('stroke', '#16a34a');
  svg.append('text').attr('x', 940).attr('y', 166).attr('font-size', 20).attr('font-weight', 700).attr('fill', '#166534').text(`Delta Quality: +${benchmarkFewshot.deltaQuality.toFixed(2)}`);
  svg.append('text').attr('x', 940).attr('y', 198).attr('font-size', 20).attr('fill', '#166534').text(`p-value: ${(benchmarkKpi.statisticalSignificance?.pValue || 0).toFixed(4)}`);

  addFooter(svg, 'Data: round_metrics_exp_benchmark_50_20260209_140431.csv');
  saveSvg(dom, 'slide_08_core_results.svg');
}

function renderSlide09CategoryInsights() {
  const { dom, svg } = createSvg();
  addTitle(svg, '分类洞察：不同类别的增益与 ROI');

  const x = d3.scaleBand().domain(categoryData.map((d) => d.category)).range([170, 1120]).padding(0.28);
  const y = d3.scaleLinear().domain([0, 10]).range([560, 150]);
  svg.append('g').attr('transform', 'translate(0,560)').call(d3.axisBottom(x));
  svg.append('g').attr('transform', 'translate(170,0)').call(d3.axisLeft(y).ticks(8));

  categoryData.forEach((d) => {
    svg.append('rect').attr('x', x(d.category)).attr('y', y(d.delta)).attr('width', x.bandwidth() * 0.46).attr('height', y(0) - y(d.delta)).attr('fill', '#2563eb');
    svg
      .append('rect')
      .attr('x', x(d.category) + x.bandwidth() * 0.54)
      .attr('y', y(d.roi))
      .attr('width', x.bandwidth() * 0.46)
      .attr('height', y(0) - y(d.roi))
      .attr('fill', '#16a34a');
    svg.append('text').attr('x', x(d.category) + x.bandwidth() * 0.23).attr('y', y(d.delta) - 8).attr('text-anchor', 'middle').attr('font-size', 14).attr('fill', '#1e3a8a').text(d.delta.toFixed(2));
    svg.append('text').attr('x', x(d.category) + x.bandwidth() * 0.77).attr('y', y(d.roi) - 8).attr('text-anchor', 'middle').attr('font-size', 14).attr('fill', '#166534').text(d.roi.toFixed(2));
  });

  svg.append('text').attr('x', 1040).attr('y', 120).attr('font-size', 14).attr('fill', '#1e3a8a').text('蓝: Delta Quality');
  svg.append('text').attr('x', 1040).attr('y', 144).attr('font-size', 14).attr('fill', '#166534').text('绿: Gain/1k Tokens');
  addFooter(svg, 'Data: benchmark_experiment_report.md (category table)');
  saveSvg(dom, 'slide_09_category_insights.svg');
}

function renderSlide10Limitations() {
  const { dom, svg } = createSvg();
  addTitle(svg, '局限与失败分解');

  const issues = [
    { name: '评分器规则化', score: 80 },
    { name: 'Teacher 样本不足', score: 74 },
    { name: '预算回退触发', score: 67 },
    { name: '单轮对比覆盖', score: 58 }
  ];
  const x = d3.scaleLinear().domain([0, 100]).range([320, 1140]);
  const y = d3.scaleBand().domain(issues.map((d) => d.name)).range([170, 500]).padding(0.3);
  issues.forEach((d) => {
    const yy = y(d.name);
    svg.append('text').attr('x', 40).attr('y', yy + 34).attr('font-size', 22).attr('fill', '#0f172a').text(d.name);
    svg.append('rect').attr('x', 320).attr('y', yy).attr('width', 760).attr('height', y.bandwidth()).attr('rx', 10).attr('fill', '#e2e8f0');
    svg.append('rect').attr('x', 320).attr('y', yy).attr('width', x(d.score) - 320).attr('height', y.bandwidth()).attr('rx', 10).attr('fill', '#dc2626');
    svg.append('text').attr('x', x(d.score) + 8).attr('y', yy + 34).attr('font-size', 18).attr('font-weight', 700).attr('fill', '#7f1d1d').text(`${d.score}`);
  });
  svg.append('text').attr('x', 40).attr('y', 560).attr('font-size', 20).attr('fill', '#334155').text('失败样本: 数据管道(基线失败)->fewshot成功；信息茧房(基线成功)->fewshot失败');
  addFooter(svg, 'Data: benchmark_experiment_report.md failure analysis');
  saveSvg(dom, 'slide_10_limitations.svg');
}

function renderSlide11Roadmap() {
  const { dom, svg } = createSvg();
  addTitle(svg, '30/60/90 天优化路线图');
  const phases = [
    { name: '30天', start: 0, span: 1, tasks: ['Teacher 池扩容', '预算参数调优', '失败重试机制'], color: '#dbeafe', stroke: '#2563eb' },
    { name: '60天', start: 1, span: 1, tasks: ['向量召回', '动态示例裁剪', 'Prompt 结构分层'], color: '#ffedd5', stroke: '#ea580c' },
    { name: '90天', start: 2, span: 1, tasks: ['多 Teacher 融合', 'LLM 评分器', '统一 LLM 层'], color: '#dcfce7', stroke: '#16a34a' }
  ];

  phases.forEach((p, i) => {
    const x = 120 + p.start * 360;
    const y = 170;
    svg.append('rect').attr('x', x).attr('y', y).attr('width', 330).attr('height', 430).attr('rx', 14).attr('fill', p.color).attr('stroke', p.stroke).attr('stroke-width', 2.2);
    svg.append('text').attr('x', x + 20).attr('y', y + 44).attr('font-size', 30).attr('font-weight', 700).attr('fill', '#0f172a').text(p.name);
    p.tasks.forEach((t, idx) => {
      svg.append('text').attr('x', x + 24).attr('y', y + 108 + idx * 56).attr('font-size', 22).attr('fill', '#1f2937').text(`- ${t}`);
    });
    if (i < phases.length - 1) {
      svg.append('line').attr('x1', x + 338).attr('y1', 385).attr('x2', x + 360 - 8).attr('y2', 385).attr('stroke', '#64748b').attr('stroke-width', 3);
    }
  });
  addFooter(svg, 'Source: Few-Shot机制设计方案.md + LLM_Provider_Unified_Layer_Design.md');
  saveSvg(dom, 'slide_11_roadmap.svg');
}

function renderSlide12EngineeringValue() {
  const { dom, svg } = createSvg();
  addTitle(svg, '工程价值：可观测 + 可追溯 + 可复制');

  const labels = ['数据沉淀', '可追溯性', '自动化复现', '统计可信度'];
  const manual = [40, 45, 30, 20];
  const automated = [90, 92, 88, 85];
  const x = d3.scaleLinear().domain([0, 100]).range([330, 1140]);
  const y = d3.scaleBand().domain(labels).range([170, 560]).padding(0.2);

  labels.forEach((name, idx) => {
    const yy = y(name);
    svg.append('text').attr('x', 40).attr('y', yy + 32).attr('font-size', 22).attr('fill', '#0f172a').text(name);
    svg.append('rect').attr('x', 330).attr('y', yy).attr('width', x(manual[idx]) - 330).attr('height', y.bandwidth() / 2 - 3).attr('fill', '#93c5fd');
    svg.append('rect').attr('x', 330).attr('y', yy + y.bandwidth() / 2 + 3).attr('width', x(automated[idx]) - 330).attr('height', y.bandwidth() / 2 - 3).attr('fill', '#16a34a');
  });

  svg.append('rect').attr('x', 900).attr('y', 120).attr('width', 18).attr('height', 18).attr('fill', '#93c5fd');
  svg.append('text').attr('x', 926).attr('y', 134).attr('font-size', 14).attr('fill', '#334155').text('手工流程');
  svg.append('rect').attr('x', 1010).attr('y', 120).attr('width', 18).attr('height', 18).attr('fill', '#16a34a');
  svg.append('text').attr('x', 1038).attr('y', 134).attr('font-size', 14).attr('fill', '#334155').text('自动化流程');
  addFooter(svg, 'Derived from script pipeline coverage and report outputs');
  saveSvg(dom, 'slide_12_engineering_value.svg');
}

function renderSlide13DecisionMatrix() {
  const { dom, svg } = createSvg();
  addTitle(svg, '决策矩阵：收益、成本与优先级');

  const scenarios = [
    { name: '维持现状', gain: 1.88, cost: 37.4, risk: 35, color: '#94a3b8' },
    { name: '扩充 Teacher 池', gain: 3.2, cost: 42, risk: 48, color: '#2563eb' },
    { name: '预算调优0.25', gain: 2.6, cost: 28, risk: 40, color: '#16a34a' },
    { name: '引入 LLM 评分器', gain: 2.1, cost: 33, risk: 60, color: '#ea580c' }
  ];

  const x = d3.scaleLinear().domain([0, 50]).range([160, 1120]);
  const y = d3.scaleLinear().domain([0, 4]).range([600, 160]);
  const r = d3.scaleSqrt().domain([0, 100]).range([10, 42]);

  svg.append('g').attr('transform', 'translate(0,600)').call(d3.axisBottom(x).ticks(10));
  svg.append('g').attr('transform', 'translate(160,0)').call(d3.axisLeft(y).ticks(8));
  svg.append('text').attr('x', 590).attr('y', 650).attr('font-size', 16).attr('fill', '#334155').text('Token 成本增幅 (%)');
  svg.append('text').attr('transform', 'rotate(-90)').attr('x', -420).attr('y', 34).attr('font-size', 16).attr('fill', '#334155').text('质量增益 (分)');

  scenarios.forEach((s) => {
    svg.append('circle').attr('cx', x(s.cost)).attr('cy', y(s.gain)).attr('r', r(s.risk)).attr('fill', `${s.color}99`).attr('stroke', s.color).attr('stroke-width', 2);
    svg.append('text').attr('x', x(s.cost) + r(s.risk) + 8).attr('y', y(s.gain) + 4).attr('font-size', 14).attr('fill', '#0f172a').text(s.name);
  });

  svg.append('rect').attr('x', 700).attr('y', 70).attr('width', 500).attr('height', 112).attr('rx', 10).attr('fill', '#f0fdf4').attr('stroke', '#22c55e');
  svg.append('text').attr('x', 724).attr('y', 112).attr('font-size', 19).attr('font-weight', 700).attr('fill', '#166534').text('建议优先级: 预算调优 + Teacher池扩容');
  svg.append('text').attr('x', 724).attr('y', 142).attr('font-size', 15).attr('fill', '#166534').text('目标：保持显著性，降低 token 成本');
  addFooter(svg, 'Data: benchmark summary + roadmap assumptions');
  saveSvg(dom, 'slide_13_decision_matrix.svg');
}

function renderSlide14StatisticalEvidence() {
  const { dom, svg } = createSvg();
  addTitle(svg, '统计显著性证据：CI / p-value / Effect Size');

  const ci = benchmarkKpi.statisticalSignificance?.confidenceInterval95 || { lower: 0.84, upper: 2.83, mean: 1.83 };
  const pValue = benchmarkKpi.statisticalSignificance?.pValue || 0.0005;
  const wValue = benchmarkKpi.statisticalSignificance?.wilcoxonPValue || 0.001;
  const dVal = benchmarkKpi.statisticalSignificance?.cohensD?.d || 0.537;

  const x = d3.scaleLinear().domain([0, 3.5]).range([220, 1040]);
  svg.append('line').attr('x1', x(0)).attr('x2', x(3.5)).attr('y1', 320).attr('y2', 320).attr('stroke', '#94a3b8').attr('stroke-width', 2);
  svg.append('line').attr('x1', x(ci.lower)).attr('x2', x(ci.upper)).attr('y1', 320).attr('y2', 320).attr('stroke', '#2563eb').attr('stroke-width', 10).attr('stroke-linecap', 'round');
  svg.append('circle').attr('cx', x(ci.mean)).attr('cy', 320).attr('r', 12).attr('fill', '#1d4ed8');
  svg.append('text').attr('x', 220).attr('y', 280).attr('font-size', 22).attr('fill', '#0f172a').text('95% CI for Mean Delta Quality');
  svg.append('text').attr('x', x(ci.lower) - 20).attr('y', 358).attr('font-size', 16).attr('fill', '#334155').text(ci.lower.toFixed(2));
  svg.append('text').attr('x', x(ci.mean) - 18).attr('y', 358).attr('font-size', 16).attr('fill', '#334155').text(ci.mean.toFixed(2));
  svg.append('text').attr('x', x(ci.upper) - 18).attr('y', 358).attr('font-size', 16).attr('fill', '#334155').text(ci.upper.toFixed(2));

  const cards = [
    { title: 'Paired t-test', value: `p = ${pValue.toFixed(4)}`, color: '#dbeafe', stroke: '#2563eb' },
    { title: 'Wilcoxon', value: `p = ${wValue.toFixed(4)}`, color: '#ede9fe', stroke: '#7c3aed' },
    { title: "Cohen's d", value: `${dVal.toFixed(3)} (medium)`, color: '#dcfce7', stroke: '#16a34a' }
  ];
  cards.forEach((c, i) => {
    const x0 = 190 + i * 320;
    svg.append('rect').attr('x', x0).attr('y', 430).attr('width', 280).attr('height', 170).attr('rx', 12).attr('fill', c.color).attr('stroke', c.stroke);
    svg.append('text').attr('x', x0 + 18).attr('y', 485).attr('font-size', 24).attr('font-weight', 700).attr('fill', '#0f172a').text(c.title);
    svg.append('text').attr('x', x0 + 18).attr('y', 535).attr('font-size', 26).attr('font-weight', 700).attr('fill', '#1f2937').text(c.value);
  });

  addFooter(svg, 'Data: round_kpi_summary_exp_benchmark_50_20260209_140431.json');
  saveSvg(dom, 'slide_14_statistical_evidence.svg');
}

function renderSlide15HistoricalComparison() {
  const { dom, svg } = createSvg();
  addTitle(svg, '历史对照：21样本实验 vs 50样本实验');

  const compare = [
    { name: 'Delta Quality', old: localFewshot.deltaQuality || 7.33, now: benchmarkFewshot.deltaQuality || 1.88, color: '#2563eb' },
    { name: 'Gain/1k Tokens', old: localFewshot.gainPer1kExtraTokens || 14.14, now: benchmarkFewshot.gainPer1kExtraTokens || 4.88, color: '#16a34a' },
    { name: 'Token增幅(%)', old: localFewshot.tokenIncreasePct || 52.94, now: benchmarkFewshot.tokenIncreasePct || 37.42, color: '#ea580c' }
  ];

  const y = d3.scaleBand().domain(compare.map((d) => d.name)).range([180, 560]).padding(0.25);
  const max = d3.max(compare.flatMap((d) => [d.old, d.now])) || 1;
  const x = d3.scaleLinear().domain([0, max * 1.15]).range([270, 1150]);
  svg.append('g').attr('transform', 'translate(0,590)').call(d3.axisBottom(x).ticks(8));

  compare.forEach((d) => {
    const yy = y(d.name);
    svg.append('text').attr('x', 50).attr('y', yy + 36).attr('font-size', 22).attr('fill', '#0f172a').text(d.name);
    svg.append('rect').attr('x', 270).attr('y', yy).attr('width', x(d.old) - 270).attr('height', y.bandwidth() / 2 - 4).attr('fill', '#93c5fd');
    svg.append('rect').attr('x', 270).attr('y', yy + y.bandwidth() / 2 + 4).attr('width', x(d.now) - 270).attr('height', y.bandwidth() / 2 - 4).attr('fill', d.color);
    svg.append('text').attr('x', x(d.old) + 8).attr('y', yy + 18).attr('font-size', 14).attr('fill', '#1e3a8a').text(`21样本: ${d.old.toFixed(2)}`);
    svg.append('text').attr('x', x(d.now) + 8).attr('y', yy + y.bandwidth() - 8).attr('font-size', 14).attr('fill', '#7c2d12').text(`50样本: ${d.now.toFixed(2)}`);
  });

  svg.append('rect').attr('x', 780).attr('y', 120).attr('width', 400).attr('height', 120).attr('rx', 10).attr('fill', '#f8fafc').attr('stroke', '#cbd5e1');
  svg.append('text').attr('x', 800).attr('y', 162).attr('font-size', 18).attr('fill', '#334155').text('结论：旧实验幅度更高，但存在评分器偏差');
  svg.append('text').attr('x', 800).attr('y', 194).attr('font-size', 18).attr('fill', '#334155').text('新实验提升幅度更小但统计更可靠');

  addFooter(svg, 'Data: round_metrics_exp_round_local20plus_20260206_073637.csv + benchmark metrics');
  saveSvg(dom, 'slide_15_historical_comparison.svg');
}

function renderSlide16ArtifactCoverage() {
  const { dom, svg } = createSvg();
  addTitle(svg, '实验产物覆盖：数据/图表/报告');

  const chartFiles = fs.readdirSync(path.join(repoRoot, 'Docs', 'TestDocs', 'charts')).filter((f) => f.endsWith('.svg')).length;
  const dataFiles = fs.readdirSync(path.join(repoRoot, 'Docs', 'TestDocs', 'data')).filter((f) => /\.(csv|json|txt)$/i.test(f)).length;
  const reportFiles = fs.readdirSync(path.join(repoRoot, 'Docs', 'TestDocs')).filter((f) => f.endsWith('.md')).length;

  const bars = [
    { name: 'Chart SVG', value: chartFiles, color: '#2563eb' },
    { name: 'Data Files', value: dataFiles, color: '#16a34a' },
    { name: 'Reports', value: reportFiles, color: '#ea580c' }
  ];
  const x = d3.scaleBand().domain(bars.map((b) => b.name)).range([250, 1050]).padding(0.35);
  const y = d3.scaleLinear().domain([0, d3.max(bars, (b) => b.value) * 1.2]).range([580, 160]);
  svg.append('g').attr('transform', 'translate(0,580)').call(d3.axisBottom(x));
  svg.append('g').attr('transform', 'translate(250,0)').call(d3.axisLeft(y).ticks(8));
  bars.forEach((b) => {
    svg.append('rect').attr('x', x(b.name)).attr('y', y(b.value)).attr('width', x.bandwidth()).attr('height', y(0) - y(b.value)).attr('fill', b.color);
    svg.append('text').attr('x', x(b.name) + x.bandwidth() / 2).attr('y', y(b.value) - 12).attr('text-anchor', 'middle').attr('font-size', 20).attr('font-weight', 700).attr('fill', '#0f172a').text(String(b.value));
  });
  addFooter(svg, 'Data: filesystem counts under Docs/TestDocs');
  saveSvg(dom, 'slide_16_artifact_coverage.svg');
}

function main() {
  renderSlide00PromptHierarchy();
  renderSlide01GoalTriangle();
  renderSlide02KpiFramework();
  renderSlide03SystemObservability();
  renderSlide04CodeAsPromptTimeline();
  renderSlide04aObservabilityDataModel();
  renderSlide04bObservabilityTimeline();
  renderSlide04cCodeAsPromptArchitecture();
  renderSlide04dCodeAsPromptGates();
  renderSlide05InjectionMechanism();
  renderSlide06ReproPipeline();
  renderSlide07BenchmarkDesign();
  renderSlide08CoreResults();
  renderSlide09CategoryInsights();
  renderSlide10Limitations();
  renderSlide11Roadmap();
  renderSlide12EngineeringValue();
  renderSlide13DecisionMatrix();
  renderSlide14StatisticalEvidence();
  renderSlide15HistoricalComparison();
  renderSlide16ArtifactCoverage();
  console.log(`[slides-charts] generated in ${outDir}`);
}

main();
