import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as d3 from 'd3';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outDir = path.join(repoRoot, 'Docs', 'TestDocs', 'charts', 'agent_observability');
const dataDir = path.join(repoRoot, 'Docs', 'TestDocs', 'data');

fs.mkdirSync(outDir, { recursive: true });

const theme = {
  bg: '#ffffff',
  text: '#0f172a',
  muted: '#475569',
  grid: '#cbd5e1',
  blue: '#2563eb',
  blueSoft: '#dbeafe',
  green: '#16a34a',
  greenSoft: '#dcfce7',
  orange: '#ea580c',
  orangeSoft: '#ffedd5',
  purple: '#9333ea',
  purpleSoft: '#f3e8ff',
  graySoft: '#f8fafc',
  red: '#dc2626',
  redSoft: '#fee2e2'
};

function createSvg(width = 1280, height = 720) {
  const dom = new JSDOM('<!doctype html><body></body>');
  const svg = d3
    .select(dom.window.document.body)
    .append('svg')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('width', width)
    .attr('height', height)
    .style('background', theme.bg);
  return { dom, svg };
}

function saveSvg(dom, name) {
  fs.writeFileSync(path.join(outDir, name), dom.window.document.body.innerHTML, 'utf8');
}

function title(svg, text, subtitle = '') {
  svg.append('text').attr('x', 40).attr('y', 46).attr('font-size', 30).attr('font-weight', 700).attr('fill', theme.text).text(text);
  if (subtitle) {
    svg.append('text').attr('x', 40).attr('y', 74).attr('font-size', 15).attr('fill', theme.muted).text(subtitle);
  }
}

function footer(svg, text) {
  svg.append('text').attr('x', 40).attr('y', 700).attr('font-size', 12).attr('fill', '#64748b').text(text);
}

function card(svg, { x, y, w, h, fill = theme.graySoft, stroke = theme.grid, titleText = '', lines = [] }) {
  svg.append('rect').attr('x', x).attr('y', y).attr('width', w).attr('height', h).attr('rx', 14).attr('fill', fill).attr('stroke', stroke).attr('stroke-width', 2);
  if (titleText) {
    svg.append('text').attr('x', x + 18).attr('y', y + 34).attr('font-size', 22).attr('font-weight', 700).attr('fill', theme.text).text(titleText);
  }
  lines.forEach((line, idx) => {
    svg.append('text').attr('x', x + 18).attr('y', y + 66 + idx * 28).attr('font-size', 18).attr('fill', '#1e293b').text(line);
  });
}

function loadCsv(name) {
  const raw = fs.readFileSync(path.join(dataDir, name), 'utf8');
  return d3.csvParse(raw, (d) => {
    const out = {};
    for (const [k, v] of Object.entries(d)) {
      const n = Number(v);
      out[k] = Number.isFinite(n) ? n : v;
    }
    return out;
  });
}

const kpiSummary = JSON.parse(fs.readFileSync(path.join(dataDir, 'round_kpi_summary_exp_benchmark_50_20260209_140431.json'), 'utf8'));
const roundMetrics = loadCsv('round_metrics_exp_benchmark_50_20260209_140431.csv');
const baseline = roundMetrics.find((r) => String(r.roundName) === 'baseline') || {};
const fewshot = roundMetrics.find((r) => String(r.roundName) === 'fewshot_r1') || {};

const serverCode = fs.readFileSync(path.join(repoRoot, 'server.js'), 'utf8');
const routeMatches = [...serverCode.matchAll(/app\.(get|post|put|patch|delete)\(\s*['"](\/api\/[^'"]+)/g)];
const routeCategories = new Map();
routeMatches.forEach((m) => {
  const root = (m[2].split('/')[2] || '').trim();
  routeCategories.set(root, (routeCategories.get(root) || 0) + 1);
});

const schemaText = fs.readFileSync(path.join(repoRoot, 'database', 'schema.sql'), 'utf8');
const tableMatches = [...schemaText.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-zA-Z0-9_]+)/g)];
const tableNames = tableMatches.map((m) => m[1]);

function render01Value() {
  const { dom, svg } = createSvg();
  title(svg, 'AI Agent 服务可观测性：目标与价值', '从“能运行”升级到“可解释、可定位、可优化”');

  const cx = 420;
  const cy = 365;
  const r = 230;
  const points = [
    [cx, cy - r],
    [cx - 220, cy + 170],
    [cx + 220, cy + 170]
  ];
  svg.append('polygon').attr('points', points.map((p) => p.join(',')).join(' ')).attr('fill', '#f8fafc').attr('stroke', '#94a3b8').attr('stroke-width', 2.5);
  svg.append('text').attr('x', cx).attr('y', cy - 250).attr('text-anchor', 'middle').attr('font-size', 24).attr('font-weight', 700).attr('fill', theme.blue).text('可解释');
  svg.append('text').attr('x', cx - 260).attr('y', cy + 200).attr('font-size', 24).attr('font-weight', 700).attr('fill', theme.green).text('可定位');
  svg.append('text').attr('x', cx + 170).attr('y', cy + 200).attr('font-size', 24).attr('font-weight', 700).attr('fill', theme.orange).text('可优化');

  card(svg, {
    x: 730,
    y: 130,
    w: 500,
    h: 500,
    fill: theme.blueSoft,
    stroke: theme.blue,
    titleText: '可观测性在 Agent 场景中的核心收益',
    lines: [
      '1) 任务链路全程可追踪（Prompt -> Tool -> Output）',
      '2) 故障可快速归因（模型/工具/数据/配置）',
      '3) 质量优化有客观反馈（实验与统计显著性）',
      '4) 发布风险前置（门禁+回归验证）',
      `5) 当前工程已具备 ${routeMatches.length} 条 API 观测入口`
    ]
  });

  footer(svg, 'Source: server.js routes + observability design principles');
  saveSvg(dom, 'slide_01_agent_observability_value.svg');
}

function render02Theory() {
  const { dom, svg } = createSvg();
  title(svg, '理论框架：Agent 可观测性四层模型', '经典三支柱 + Agent 语义层 + 业务目标层');

  const layers = [
    { y: 540, h: 120, c: theme.graySoft, s: theme.grid, t: 'L4 业务目标层（SLO/SLA、成功率、用户价值）' },
    { y: 410, h: 120, c: theme.greenSoft, s: theme.green, t: 'L3 Agent 语义层（步骤事件、工具调用、反思决策）' },
    { y: 280, h: 120, c: theme.blueSoft, s: theme.blue, t: 'L2 遥测层（Metrics / Logs / Traces）' },
    { y: 150, h: 120, c: theme.purpleSoft, s: theme.purple, t: 'L1 采集层（SDK、Middleware、DB hooks、File hooks）' }
  ];
  layers.forEach((l) => {
    svg.append('rect').attr('x', 120).attr('y', l.y).attr('width', 1040).attr('height', l.h).attr('rx', 12).attr('fill', l.c).attr('stroke', l.s).attr('stroke-width', 2.5);
    svg.append('text').attr('x', 150).attr('y', l.y + 72).attr('font-size', 24).attr('font-weight', 700).attr('fill', theme.text).text(l.t);
  });

  footer(svg, 'Theory: OpenTelemetry paradigm adapted for Agent runtime');
  saveSvg(dom, 'slide_02_agent_observability_theory_layers.svg');
}

function render03Lifecycle() {
  const { dom, svg } = createSvg();
  title(svg, 'Agent 运行生命周期与可观测信号', '以一次生成请求为例：9 阶段采集');

  const steps = ['Request', 'PromptBuild', 'LLMCall', 'Parse', 'PostProcess', 'Render', 'Save', 'TTS', 'DBPersist'];
  const x0 = 80;
  const gap = 130;
  steps.forEach((s, i) => {
    const x = x0 + i * gap;
    svg.append('circle').attr('cx', x).attr('cy', 220).attr('r', 28).attr('fill', '#dbeafe').attr('stroke', theme.blue).attr('stroke-width', 2);
    svg.append('text').attr('x', x).attr('y', 227).attr('text-anchor', 'middle').attr('font-size', 14).attr('font-weight', 700).attr('fill', '#1e40af').text(i + 1);
    svg.append('text').attr('x', x).attr('y', 270).attr('text-anchor', 'middle').attr('font-size', 13).attr('fill', theme.text).text(s);
    if (i < steps.length - 1) {
      svg.append('line').attr('x1', x + 30).attr('y1', 220).attr('x2', x + gap - 30).attr('y2', 220).attr('stroke', '#94a3b8').attr('stroke-width', 2);
    }
  });

  const tracks = [
    { name: 'Logs', color: '#2563eb', y: 360, w: 980, value: 'request_id, provider, errors' },
    { name: 'Metrics', color: '#16a34a', y: 415, w: 980, value: 'quality, tokens, latency, cost' },
    { name: 'Traces', color: '#9333ea', y: 470, w: 980, value: 'phase timing + tool spans' },
    { name: 'Events', color: '#ea580c', y: 525, w: 980, value: 'few-shot fallback / model switch' }
  ];
  tracks.forEach((t) => {
    svg.append('text').attr('x', 80).attr('y', t.y + 24).attr('font-size', 20).attr('font-weight', 700).attr('fill', theme.text).text(t.name);
    svg.append('rect').attr('x', 220).attr('y', t.y).attr('width', t.w).attr('height', 34).attr('rx', 8).attr('fill', '#e2e8f0');
    svg.append('rect').attr('x', 220).attr('y', t.y).attr('width', t.w).attr('height', 34).attr('rx', 8).attr('fill', t.color);
    svg.append('text').attr('x', 235).attr('y', t.y + 23).attr('font-size', 15).attr('fill', 'white').text(t.value);
  });

  footer(svg, 'Source: server.js pipeline + observability_metrics schema');
  saveSvg(dom, 'slide_03_agent_runtime_lifecycle.svg');
}

function render04ScopeMatrix() {
  const { dom, svg } = createSvg();
  title(svg, '可观测对象矩阵：看什么、在哪里看', '业务层/模型层/系统层/安全层的信号覆盖');

  const rows = ['业务质量', '模型行为', '系统性能', '安全合规'];
  const cols = ['日志', '指标', '追踪', '事件'];
  const matrix = [
    [3, 3, 2, 2],
    [2, 3, 3, 3],
    [2, 3, 3, 2],
    [2, 2, 1, 3]
  ];
  const x0 = 300;
  const y0 = 180;
  const cw = 180;
  const ch = 105;
  const color = d3.scaleLinear().domain([1, 3]).range(['#e2e8f0', '#2563eb']);

  cols.forEach((c, j) => {
    svg.append('text').attr('x', x0 + j * cw + cw / 2).attr('y', y0 - 18).attr('text-anchor', 'middle').attr('font-size', 20).attr('font-weight', 700).attr('fill', theme.text).text(c);
  });
  rows.forEach((r, i) => {
    svg.append('text').attr('x', 190).attr('y', y0 + i * ch + 62).attr('font-size', 21).attr('font-weight', 700).attr('fill', theme.text).text(r);
    cols.forEach((_c, j) => {
      const v = matrix[i][j];
      svg.append('rect').attr('x', x0 + j * cw).attr('y', y0 + i * ch).attr('width', cw - 12).attr('height', ch - 12).attr('rx', 12).attr('fill', color(v)).attr('stroke', '#cbd5e1');
      svg.append('text').attr('x', x0 + j * cw + (cw - 12) / 2).attr('y', y0 + i * ch + 60).attr('text-anchor', 'middle').attr('font-size', 24).attr('font-weight', 700).attr('fill', v >= 2 ? '#ffffff' : '#0f172a').text(v);
    });
  });
  card(svg, { x: 1060, y: 200, w: 180, h: 220, fill: theme.graySoft, stroke: theme.grid, titleText: '等级说明', lines: ['1=薄弱', '2=可用', '3=完善'] });

  footer(svg, 'Matrix definition for AI agent observability capability');
  saveSvg(dom, 'slide_04_scope_signal_matrix.svg');
}

function render05ProjectMapping() {
  const { dom, svg } = createSvg();
  title(svg, '本工程映射：观测链路与落点', 'Trilingual Records 的实际落地面');

  const sections = [
    { name: 'API 路由', value: routeMatches.length, target: 22, c: theme.blue },
    { name: 'DB 核心表', value: tableNames.length, target: 12, c: theme.green },
    { name: '生成阶段', value: 9, target: 9, c: theme.purple },
    { name: '实验导出', value: 6, target: 6, c: theme.orange }
  ];

  sections.forEach((s, i) => {
    const y = 190 + i * 110;
    svg.append('text').attr('x', 80).attr('y', y + 34).attr('font-size', 24).attr('font-weight', 700).attr('fill', theme.text).text(s.name);
    svg.append('rect').attr('x', 280).attr('y', y).attr('width', 760).attr('height', 44).attr('rx', 10).attr('fill', '#e2e8f0');
    svg.append('rect').attr('x', 280).attr('y', y).attr('width', (760 * s.value) / s.target).attr('height', 44).attr('rx', 10).attr('fill', s.c);
    svg.append('text').attr('x', 1060).attr('y', y + 32).attr('font-size', 24).attr('font-weight', 700).attr('fill', theme.text).text(`${s.value}/${s.target}`);
  });

  card(svg, {
    x: 80,
    y: 630 - 130,
    w: 1160,
    h: 120,
    fill: '#eff6ff',
    stroke: theme.blue,
    titleText: '现状结论',
    lines: ['核心链路已可观测，下一步重点是统一 Trace-ID 并建设告警规则与 SLO 看板']
  });

  footer(svg, 'Source: server.js + database/schema.sql + Docs/SystemDevelopStatusDocs');
  saveSvg(dom, 'slide_05_project_observability_mapping.svg');
}

function render06DataModel() {
  const { dom, svg } = createSvg();
  title(svg, '数据模型落地：从生成记录到实验追踪', '核心表关系支撑回放、分析、优化闭环');

  const nodes = [
    { id: 'generations', x: 80, y: 180, w: 210, h: 80, c: theme.blueSoft, s: theme.blue },
    { id: 'observability_metrics', x: 330, y: 180, w: 270, h: 80, c: theme.purpleSoft, s: theme.purple },
    { id: 'audio_files', x: 640, y: 180, w: 210, h: 80, c: theme.greenSoft, s: theme.green },
    { id: 'generation_errors', x: 890, y: 180, w: 280, h: 80, c: theme.redSoft, s: theme.red },
    { id: 'few_shot_runs', x: 80, y: 340, w: 220, h: 80, c: theme.orangeSoft, s: theme.orange },
    { id: 'few_shot_examples', x: 340, y: 340, w: 240, h: 80, c: '#fef3c7', s: '#ca8a04' },
    { id: 'experiment_rounds', x: 620, y: 340, w: 240, h: 80, c: '#e0f2fe', s: '#0284c7' },
    { id: 'experiment_samples', x: 900, y: 340, w: 250, h: 80, c: '#fee2e2', s: '#dc2626' },
    { id: 'teacher_references', x: 390, y: 500, w: 280, h: 80, c: '#dcfce7', s: '#15803d' }
  ];
  const map = new Map(nodes.map((n) => [n.id, n]));
  const links = [
    ['generations', 'observability_metrics'],
    ['generations', 'audio_files'],
    ['generations', 'generation_errors'],
    ['generations', 'few_shot_runs'],
    ['few_shot_runs', 'few_shot_examples'],
    ['few_shot_runs', 'experiment_rounds'],
    ['experiment_rounds', 'experiment_samples'],
    ['experiment_samples', 'teacher_references']
  ];
  links.forEach(([a, b]) => {
    const na = map.get(a);
    const nb = map.get(b);
    svg.append('line').attr('x1', na.x + na.w).attr('y1', na.y + na.h / 2).attr('x2', nb.x).attr('y2', nb.y + nb.h / 2).attr('stroke', '#64748b').attr('stroke-width', 1.8);
  });
  nodes.forEach((n) => {
    svg.append('rect').attr('x', n.x).attr('y', n.y).attr('width', n.w).attr('height', n.h).attr('rx', 10).attr('fill', n.c).attr('stroke', n.s).attr('stroke-width', 2);
    svg.append('text').attr('x', n.x + 14).attr('y', n.y + 48).attr('font-size', 22).attr('font-weight', 700).attr('fill', theme.text).text(n.id);
  });

  footer(svg, `Source: database/schema.sql (${tableNames.length} tables)`);
  saveSvg(dom, 'slide_06_data_model_traceability.svg');
}

function render07ApiSurface() {
  const { dom, svg } = createSvg();
  title(svg, '服务面观测：API 入口分布', '按路由根分类统计（server.js）');

  const data = [...routeCategories.entries()]
    .map(([k, v]) => ({ name: k || 'unknown', value: v }))
    .sort((a, b) => b.value - a.value);

  const x = d3.scaleLinear().domain([0, d3.max(data, (d) => d.value) || 1]).range([0, 760]);
  data.forEach((d, i) => {
    const y = 150 + i * 48;
    svg.append('text').attr('x', 80).attr('y', y + 26).attr('font-size', 18).attr('fill', theme.text).text(d.name);
    svg.append('rect').attr('x', 260).attr('y', y).attr('width', 760).attr('height', 30).attr('rx', 8).attr('fill', '#e2e8f0');
    svg.append('rect').attr('x', 260).attr('y', y).attr('width', x(d.value)).attr('height', 30).attr('rx', 8).attr('fill', theme.blue);
    svg.append('text').attr('x', 1040).attr('y', y + 22).attr('font-size', 18).attr('font-weight', 700).attr('fill', theme.text).text(String(d.value));
  });

  card(svg, {
    x: 780,
    y: 480,
    w: 420,
    h: 170,
    fill: theme.greenSoft,
    stroke: theme.green,
    titleText: '建议补强',
    lines: ['- 为 /generate 与 /ocr 增加 trace_id 回传', '- 统一错误码到 generation_errors 维度', '- 增加 per-route P95/P99 观测']
  });

  footer(svg, `Source: server.js (${routeMatches.length} API routes)`);
  saveSvg(dom, 'slide_07_api_surface_distribution.svg');
}

function render08ExperimentEvidence() {
  const { dom, svg } = createSvg();
  title(svg, '实验观测证据：质量、成本、时延对照', 'exp_benchmark_50_20260209_140431');

  const metrics = [
    { name: '质量分', base: baseline.avgQualityScore || 0, fs: fewshot.avgQualityScore || 0, max: 90, unit: '' },
    { name: 'Tokens', base: baseline.avgTokensTotal || 0, fs: fewshot.avgTokensTotal || 0, max: 1700, unit: '' },
    { name: '延迟(ms)', base: baseline.avgLatencyMs || 0, fs: fewshot.avgLatencyMs || 0, max: 55000, unit: '' },
    { name: '成功率(%)', base: baseline.successRate || 0, fs: fewshot.successRate || 0, max: 100, unit: '%' }
  ];

  metrics.forEach((m, i) => {
    const y = 170 + i * 120;
    const scale = d3.scaleLinear().domain([0, m.max]).range([0, 380]);
    svg.append('text').attr('x', 70).attr('y', y + 24).attr('font-size', 22).attr('font-weight', 700).attr('fill', theme.text).text(m.name);
    svg.append('rect').attr('x', 270).attr('y', y).attr('width', 390).attr('height', 36).attr('rx', 8).attr('fill', '#dbeafe');
    svg.append('rect').attr('x', 270).attr('y', y).attr('width', scale(m.base)).attr('height', 36).attr('rx', 8).attr('fill', theme.blue);
    svg.append('text').attr('x', 670).attr('y', y + 24).attr('font-size', 18).attr('fill', theme.text).text(`Baseline ${m.base.toFixed(2)}${m.unit}`);

    svg.append('rect').attr('x', 760).attr('y', y).attr('width', 390).attr('height', 36).attr('rx', 8).attr('fill', '#dcfce7');
    svg.append('rect').attr('x', 760).attr('y', y).attr('width', scale(m.fs)).attr('height', 36).attr('rx', 8).attr('fill', theme.green);
    svg.append('text').attr('x', 1160).attr('y', y + 24).attr('font-size', 18).attr('text-anchor', 'end').attr('fill', theme.text).text(`Few-shot ${m.fs.toFixed(2)}${m.unit}`);
  });

  footer(svg, 'Source: round_metrics_exp_benchmark_50_20260209_140431.csv');
  saveSvg(dom, 'slide_08_experiment_observability_evidence.svg');
}

function render09Stat() {
  const { dom, svg } = createSvg();
  title(svg, '统计显著性：观测结果是否可信', '将“看起来变好”升级为“统计上成立”');

  const p = kpiSummary.statisticalSignificance?.pValue || 1;
  const w = kpiSummary.statisticalSignificance?.wilcoxonPValue || 1;
  const d = kpiSummary.statisticalSignificance?.cohensD?.d || 0;
  const ci = kpiSummary.statisticalSignificance?.confidenceInterval95 || { lower: 0, upper: 0, mean: 0 };

  card(svg, {
    x: 70,
    y: 140,
    w: 360,
    h: 240,
    fill: theme.blueSoft,
    stroke: theme.blue,
    titleText: '显著性检验',
    lines: [`t-test p = ${p.toFixed(4)}`, `Wilcoxon p = ${w.toFixed(4)}`, `样本量 = ${kpiSummary.statisticalSignificance?.pairedSampleSize || 0}`]
  });
  card(svg, {
    x: 460,
    y: 140,
    w: 360,
    h: 240,
    fill: theme.greenSoft,
    stroke: theme.green,
    titleText: '效应量',
    lines: [`Cohen's d = ${d.toFixed(3)}`, `解释 = ${kpiSummary.statisticalSignificance?.cohensD?.interpretation || '-'}`, '用于判断“提升幅度”大小']
  });
  card(svg, {
    x: 850,
    y: 140,
    w: 360,
    h: 240,
    fill: theme.purpleSoft,
    stroke: theme.purple,
    titleText: '置信区间',
    lines: [`95% CI: [${ci.lower}, ${ci.upper}]`, `均值差: ${ci.mean}`, '区间不跨 0 -> 方向稳定']
  });

  const axisX0 = 150;
  const axisX1 = 1130;
  const axisY = 530;
  const scale = d3.scaleLinear().domain([-1, 4]).range([axisX0, axisX1]);
  svg.append('line').attr('x1', axisX0).attr('y1', axisY).attr('x2', axisX1).attr('y2', axisY).attr('stroke', '#334155').attr('stroke-width', 2);
  d3.range(-1, 4.1, 1).forEach((t) => {
    const x = scale(t);
    svg.append('line').attr('x1', x).attr('y1', axisY - 8).attr('x2', x).attr('y2', axisY + 8).attr('stroke', '#334155');
    svg.append('text').attr('x', x).attr('y', axisY + 28).attr('text-anchor', 'middle').attr('font-size', 14).attr('fill', theme.muted).text(String(t));
  });
  svg.append('line').attr('x1', scale(ci.lower)).attr('y1', axisY - 50).attr('x2', scale(ci.upper)).attr('y2', axisY - 50).attr('stroke', theme.green).attr('stroke-width', 10).attr('stroke-linecap', 'round');
  svg.append('circle').attr('cx', scale(ci.mean)).attr('cy', axisY - 50).attr('r', 9).attr('fill', theme.green);
  svg.append('text').attr('x', scale(ci.mean)).attr('y', axisY - 70).attr('text-anchor', 'middle').attr('font-size', 14).attr('fill', theme.green).text('mean');

  footer(svg, 'Source: round_kpi_summary_exp_benchmark_50_20260209_140431.json');
  saveSvg(dom, 'slide_09_statistical_trustworthiness.svg');
}

function render10Gaps() {
  const { dom, svg } = createSvg();
  title(svg, '当前差距：从“可观测”到“可运营”', '以目标门槛定义下一步优化空间');

  const rows = [
    { k: '质量提升(Δ)', cur: fewshot.deltaQuality || 0, target: 2.5, better: 'high', fmt: (v) => v.toFixed(2) },
    { k: 'Token增幅(%)', cur: fewshot.tokenIncreasePct || 0, target: 25, better: 'low', fmt: (v) => `${v.toFixed(1)}%` },
    { k: '延迟增幅(%)', cur: fewshot.latencyIncreasePct || 0, target: 10, better: 'low', fmt: (v) => `${v.toFixed(1)}%` },
    { k: '质量CV(%)', cur: fewshot.qualityCvPct || 0, target: 4.0, better: 'low', fmt: (v) => `${v.toFixed(2)}%` },
    { k: 'Gain/1kTokens', cur: fewshot.gainPer1kExtraTokens || 0, target: 8.0, better: 'high', fmt: (v) => v.toFixed(2) }
  ];

  rows.forEach((r, i) => {
    const y = 160 + i * 96;
    const ok = r.better === 'high' ? r.cur >= r.target : r.cur <= r.target;
    svg.append('text').attr('x', 70).attr('y', y + 30).attr('font-size', 22).attr('font-weight', 700).attr('fill', theme.text).text(r.k);
    svg.append('rect').attr('x', 300).attr('y', y).attr('width', 330).attr('height', 40).attr('rx', 8).attr('fill', theme.graySoft).attr('stroke', '#cbd5e1');
    svg.append('text').attr('x', 318).attr('y', y + 28).attr('font-size', 18).attr('fill', theme.text).text(`当前: ${r.fmt(r.cur)}`);
    svg.append('rect').attr('x', 660).attr('y', y).attr('width', 280).attr('height', 40).attr('rx', 8).attr('fill', theme.blueSoft).attr('stroke', theme.blue);
    svg.append('text').attr('x', 678).attr('y', y + 28).attr('font-size', 18).attr('fill', theme.text).text(`目标: ${r.fmt(r.target)}`);
    svg.append('rect').attr('x', 970).attr('y', y).attr('width', 220).attr('height', 40).attr('rx', 8).attr('fill', ok ? theme.greenSoft : theme.redSoft).attr('stroke', ok ? theme.green : theme.red);
    svg.append('text').attr('x', 1080).attr('y', y + 28).attr('text-anchor', 'middle').attr('font-size', 18).attr('font-weight', 700).attr('fill', ok ? theme.green : theme.red).text(ok ? '达标' : '待优化');
  });

  footer(svg, 'Source: benchmark round deltas + operational target proposal');
  saveSvg(dom, 'slide_10_gap_to_operational_slo.svg');
}

function render11Roadmap() {
  const { dom, svg } = createSvg();
  title(svg, '优化路线：可观测性增强 Backlog', '按影响力 x 实施复杂度分层推进');

  const items = [
    { name: '统一 Trace-ID 透传', impact: 5, effort: 2, c: theme.blue },
    { name: '异常告警规则库', impact: 4, effort: 2, c: theme.green },
    { name: 'Token预算自适应', impact: 5, effort: 4, c: theme.orange },
    { name: 'Prompt diff 可视化', impact: 3, effort: 2, c: theme.purple },
    { name: 'SLO 看板与周报', impact: 4, effort: 3, c: '#0ea5e9' },
    { name: 'Agent Span 明细', impact: 3, effort: 4, c: '#ef4444' }
  ];

  const x = d3.scaleLinear().domain([1, 5]).range([150, 1080]);
  const y = d3.scaleLinear().domain([1, 5]).range([600, 160]);
  svg.append('line').attr('x1', 150).attr('y1', 600).attr('x2', 1080).attr('y2', 600).attr('stroke', '#334155');
  svg.append('line').attr('x1', 150).attr('y1', 600).attr('x2', 150).attr('y2', 160).attr('stroke', '#334155');
  svg.append('text').attr('x', 620).attr('y', 640).attr('text-anchor', 'middle').attr('font-size', 20).attr('fill', theme.text).text('实施复杂度（低 -> 高）');
  svg.append('text').attr('transform', 'translate(90,380) rotate(-90)').attr('text-anchor', 'middle').attr('font-size', 20).attr('fill', theme.text).text('业务影响（低 -> 高）');

  items.forEach((it) => {
    const cx = x(it.effort);
    const cy = y(it.impact);
    svg.append('circle').attr('cx', cx).attr('cy', cy).attr('r', 24).attr('fill', it.c).attr('opacity', 0.85);
    svg.append('text').attr('x', cx + 34).attr('y', cy + 6).attr('font-size', 16).attr('fill', theme.text).text(it.name);
  });

  footer(svg, 'Backlog prioritization for observability improvements');
  saveSvg(dom, 'slide_11_observability_backlog_matrix.svg');
}

function render12Execution() {
  const { dom, svg } = createSvg();
  title(svg, '落地实施计划：30/60/90 天', '理论到工程的执行节奏');

  const phases = [
    { x: 120, title: 'Phase 1 (0-30天)', tasks: ['统一 trace_id/request_id', '补齐 route 级错误统计', '定义 SLO 草案'], color: theme.blueSoft, stroke: theme.blue },
    { x: 450, title: 'Phase 2 (31-60天)', tasks: ['上线告警规则', 'Prompt diff + few-shot注入看板', '异常回放 SOP'], color: theme.greenSoft, stroke: theme.green },
    { x: 780, title: 'Phase 3 (61-90天)', tasks: ['自动化周报', '优化门禁策略', '容量与成本联动预测'], color: theme.orangeSoft, stroke: theme.orange }
  ];

  phases.forEach((p, idx) => {
    card(svg, {
      x: p.x,
      y: 190,
      w: 300,
      h: 360,
      fill: p.color,
      stroke: p.stroke,
      titleText: p.title,
      lines: p.tasks.map((t) => `- ${t}`)
    });
    if (idx < phases.length - 1) {
      svg.append('line').attr('x1', p.x + 300).attr('y1', 370).attr('x2', phases[idx + 1].x).attr('y2', 370).attr('stroke', '#94a3b8').attr('stroke-width', 2);
    }
  });

  card(svg, {
    x: 120,
    y: 585,
    w: 960,
    h: 85,
    fill: theme.purpleSoft,
    stroke: theme.purple,
    titleText: '交付物',
    lines: ['可观测性规范文档 + 仪表盘 + 告警策略 + 回放/复盘机制']
  });

  footer(svg, 'Execution plan for AI agent observability rollout');
  saveSvg(dom, 'slide_12_execution_plan_30_60_90.svg');
}

function main() {
  render01Value();
  render02Theory();
  render03Lifecycle();
  render04ScopeMatrix();
  render05ProjectMapping();
  render06DataModel();
  render07ApiSurface();
  render08ExperimentEvidence();
  render09Stat();
  render10Gaps();
  render11Roadmap();
  render12Execution();
  console.log(`[agent-observability-slides] generated: ${outDir}`);
}

main();
