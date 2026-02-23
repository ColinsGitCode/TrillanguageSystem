import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as d3 from 'd3';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outDir = path.join(repoRoot, 'Docs', 'TestDocs', 'charts', 'ai_agent_observability_cn');

fs.mkdirSync(outDir, { recursive: true });

const W = 1600;
const H = 900;
const theme = {
  bg: '#f8fafc',
  panel: '#ffffff',
  stroke: '#cbd5e1',
  text: '#0f172a',
  muted: '#475569',
  blue: '#2563eb',
  green: '#16a34a',
  orange: '#ea580c',
  purple: '#7c3aed',
  red: '#dc2626',
  cyan: '#0891b2',
  slate: '#334155'
};

function createSvg() {
  const dom = new JSDOM('<!doctype html><body></body>');
  const svg = d3
    .select(dom.window.document.body)
    .append('svg')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('width', W)
    .attr('height', H)
    .style('background', theme.bg)
    .style('font-family', '"Microsoft YaHei","PingFang SC","SimHei",sans-serif');
  return { dom, svg };
}

function save(dom, fileName) {
  fs.writeFileSync(path.join(outDir, fileName), dom.window.document.body.innerHTML, 'utf8');
}

function title(svg, main, sub = '') {
  svg.append('text')
    .attr('x', 48)
    .attr('y', 62)
    .attr('font-size', 44)
    .attr('font-weight', 700)
    .attr('fill', theme.text)
    .text(main);
  if (sub) {
    svg.append('text')
      .attr('x', 48)
      .attr('y', 98)
      .attr('font-size', 20)
      .attr('fill', theme.muted)
      .text(sub);
  }
}

function footer(svg, text) {
  svg.append('text')
    .attr('x', 48)
    .attr('y', 872)
    .attr('font-size', 13)
    .attr('fill', '#64748b')
    .text(text);
}

function panel(svg, { x, y, w, h, fill = theme.panel, stroke = theme.stroke, titleText = '', titleColor = theme.text }) {
  svg.append('rect')
    .attr('x', x)
    .attr('y', y)
    .attr('width', w)
    .attr('height', h)
    .attr('rx', 16)
    .attr('fill', fill)
    .attr('stroke', stroke)
    .attr('stroke-width', 2);
  if (titleText) {
    svg.append('text')
      .attr('x', x + 20)
      .attr('y', y + 36)
      .attr('font-size', 26)
      .attr('font-weight', 700)
      .attr('fill', titleColor)
      .text(titleText);
  }
}

function readProjectStats() {
  const serverPath = path.join(repoRoot, 'server.js');
  const schemaPath = path.join(repoRoot, 'database', 'schema.sql');
  const serverText = fs.existsSync(serverPath) ? fs.readFileSync(serverPath, 'utf8') : '';
  const schemaText = fs.existsSync(schemaPath) ? fs.readFileSync(schemaPath, 'utf8') : '';

  const routeMatches = [...serverText.matchAll(/app\.(get|post|put|patch|delete)\(\s*['"](\/api\/[^'"]+)/g)];
  const routeCategories = new Map();
  routeMatches.forEach((m) => {
    const root = (m[2].split('/')[2] || 'other').trim();
    routeCategories.set(root, (routeCategories.get(root) || 0) + 1);
  });

  const tableMatches = [...schemaText.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-zA-Z0-9_]+)/g)];
  const tableNames = tableMatches.map((m) => m[1]);

  return {
    routeCount: routeMatches.length,
    routeCategories: [...routeCategories.entries()].map(([k, v]) => ({ name: k, value: v })),
    tableCount: tableNames.length
  };
}

const stats = readProjectStats();

function render00Cover() {
  const { dom, svg } = createSvg();
  title(svg, 'AI Agent 可观测性：从可运行到可治理', '行业落地综述 + 本工程实施复盘');

  const cx = 520;
  const cy = 480;
  const r = 230;
  const items = [
    { a: -90, t: '稳定性', c: theme.blue },
    { a: 18, t: '质量', c: theme.green },
    { a: 126, t: '成本', c: theme.orange },
    { a: 234, t: '安全', c: theme.purple }
  ];
  svg.append('circle').attr('cx', cx).attr('cy', cy).attr('r', r).attr('fill', '#eef2ff').attr('stroke', '#a5b4fc').attr('stroke-width', 2);
  svg.append('circle').attr('cx', cx).attr('cy', cy).attr('r', 120).attr('fill', '#ffffff').attr('stroke', '#c7d2fe').attr('stroke-width', 2);
  svg.append('text').attr('x', cx).attr('y', cy + 8).attr('text-anchor', 'middle').attr('font-size', 34).attr('font-weight', 700).attr('fill', theme.slate).text('Observability');

  items.forEach((it) => {
    const rad = (it.a * Math.PI) / 180;
    const x = cx + Math.cos(rad) * (r - 28);
    const y = cy + Math.sin(rad) * (r - 28);
    svg.append('circle').attr('cx', x).attr('cy', y).attr('r', 42).attr('fill', it.c).attr('opacity', 0.18).attr('stroke', it.c);
    svg.append('text').attr('x', x).attr('y', y + 8).attr('text-anchor', 'middle').attr('font-size', 20).attr('font-weight', 700).attr('fill', it.c).text(it.t);
  });

  panel(svg, { x: 900, y: 220, w: 640, h: 430, fill: '#f1f5f9', stroke: '#94a3b8', titleText: '本次汇报回答三个问题', titleColor: '#0f172a' });
  [
    '1) 业界 AI Agent 可观测性已经形成哪些共识？',
    '2) 本工程已经完成了哪些可观测能力建设？',
    '3) 下一阶段如何把可观测性变成稳定收益？'
  ].forEach((line, i) => {
    svg.append('text')
      .attr('x', 930)
      .attr('y', 302 + i * 92)
      .attr('font-size', 28)
      .attr('fill', '#1e293b')
      .text(line);
  });

  footer(svg, 'Focus: Trace + Metrics + Evaluation + SLO');
  save(dom, 'slide_00_cover_ai_agent_observability.svg');
}

function render01IndustryPain() {
  const { dom, svg } = createSvg();
  title(svg, '业界背景：为什么 AI Agent 必须做可观测性', 'Agent 相比传统服务引入了更高的不确定性');

  const data = [
    { name: '非确定性输出', score: 92, color: theme.red },
    { name: '链路复杂度', score: 86, color: theme.purple },
    { name: 'Token 成本波动', score: 79, color: theme.orange },
    { name: '跨工具依赖', score: 74, color: theme.cyan },
    { name: '安全/合规风险', score: 82, color: theme.blue }
  ];
  const x = d3.scaleLinear().domain([0, 100]).range([0, 920]);
  data.forEach((d, i) => {
    const y = 180 + i * 110;
    svg.append('text').attr('x', 70).attr('y', y + 36).attr('font-size', 30).attr('font-weight', 700).attr('fill', theme.text).text(d.name);
    svg.append('rect').attr('x', 360).attr('y', y).attr('width', 920).attr('height', 46).attr('rx', 10).attr('fill', '#e2e8f0');
    svg.append('rect').attr('x', 360).attr('y', y).attr('width', x(d.score)).attr('height', 46).attr('rx', 10).attr('fill', d.color);
    svg.append('text').attr('x', 1305).attr('y', y + 33).attr('font-size', 24).attr('font-weight', 700).attr('fill', d.color).text(`${d.score}`);
  });

  footer(svg, 'Industry pattern: quality/latency/cost/safety must be jointly observable');
  save(dom, 'slide_01_industry_pain_driver.svg');
}

function render02IndustryStack() {
  const { dom, svg } = createSvg();
  title(svg, '业界落地综述：AI Agent 可观测性四层架构', '实践趋同：采集层 -> 遥测层 -> 评估层 -> 运营层');

  const layers = [
    { y: 630, h: 130, c: '#e2e8f0', s: '#94a3b8', t: 'L4 运营治理层：SLO / 告警 / 发布门禁 / 复盘', tc: '#0f172a' },
    { y: 490, h: 120, c: '#dcfce7', s: '#16a34a', t: 'L3 评估层：离线评测、在线抽检、人评校准、红队', tc: '#14532d' },
    { y: 350, h: 120, c: '#dbeafe', s: '#2563eb', t: 'L2 遥测层：Traces / Metrics / Logs / Events', tc: '#1e3a8a' },
    { y: 210, h: 120, c: '#f3e8ff', s: '#7c3aed', t: 'L1 采集层：SDK、Middleware、DB Hook、Tool Hook', tc: '#4c1d95' }
  ];
  layers.forEach((l) => {
    svg.append('rect').attr('x', 120).attr('y', l.y).attr('width', 1360).attr('height', l.h).attr('rx', 14).attr('fill', l.c).attr('stroke', l.s).attr('stroke-width', 2.5);
    svg.append('text').attr('x', 160).attr('y', l.y + 76).attr('font-size', 34).attr('font-weight', 700).attr('fill', l.tc).text(l.t);
  });

  footer(svg, 'Observed across OpenTelemetry ecosystem + Agent observability platforms');
  save(dom, 'slide_02_industry_observability_stack.svg');
}

function render03Standards() {
  const { dom, svg } = createSvg();
  title(svg, '标准化路径：OTel + GenAI SemConv + OpenInference', '目标：跨框架、跨模型、跨供应商统一语义');

  panel(svg, { x: 100, y: 210, w: 420, h: 460, fill: '#dbeafe', stroke: theme.blue, titleText: 'OpenTelemetry', titleColor: '#1e3a8a' });
  ['Trace DAG / Span', 'Context Propagation', 'Metrics + Logs', '跨语言生态'].forEach((t, i) => {
    svg.append('text').attr('x', 130).attr('y', 286 + i * 72).attr('font-size', 29).attr('fill', '#1e3a8a').text(`- ${t}`);
  });

  panel(svg, { x: 590, y: 210, w: 420, h: 460, fill: '#dcfce7', stroke: theme.green, titleText: 'GenAI SemConv', titleColor: '#14532d' });
  ['gen_ai.provider.name', 'gen_ai.request.model', 'token / usage / error', 'conversation / output attrs'].forEach((t, i) => {
    svg.append('text').attr('x', 620).attr('y', 286 + i * 72).attr('font-size', 26).attr('fill', '#14532d').text(`- ${t}`);
  });

  panel(svg, { x: 1080, y: 210, w: 420, h: 460, fill: '#fff7ed', stroke: theme.orange, titleText: 'OpenInference', titleColor: '#9a3412' });
  ['LLM/Tool/Chain span 语义', 'query -> retrieve -> synthesize', '评测与追踪协同', 'Agent 过程可回放'].forEach((t, i) => {
    svg.append('text').attr('x', 1110).attr('y', 286 + i * 72).attr('font-size', 26).attr('fill', '#9a3412').text(`- ${t}`);
  });

  svg.append('line').attr('x1', 520).attr('y1', 440).attr('x2', 590).attr('y2', 440).attr('stroke', '#64748b').attr('stroke-width', 3);
  svg.append('line').attr('x1', 1010).attr('y1', 440).attr('x2', 1080).attr('y2', 440).attr('stroke', '#64748b').attr('stroke-width', 3);

  footer(svg, 'Standards reduce vendor lock-in and improve incident triage efficiency');
  save(dom, 'slide_03_standards_alignment.svg');
}

function render04PlatformMatrix() {
  const { dom, svg } = createSvg();
  title(svg, '业界平台能力对照（抽象维度）', '本页展示能力类型，不做产品优劣排名');

  const rows = ['Tracing', 'Live Monitor', 'Evaluation', 'Prompt Versioning', 'OpenTelemetry', 'Self-host Option'];
  const cols = ['LangSmith', 'Phoenix', 'W&B Weave', 'Azure Foundry'];
  const matrix = [
    [3, 3, 3, 3],
    [3, 2, 2, 3],
    [3, 3, 3, 3],
    [2, 2, 3, 2],
    [3, 3, 2, 3],
    [2, 3, 1, 1]
  ];
  const color = d3.scaleLinear().domain([1, 3]).range(['#e2e8f0', '#2563eb']);
  const x0 = 350;
  const y0 = 190;
  const cw = 280;
  const ch = 90;

  cols.forEach((c, j) => {
    svg.append('text').attr('x', x0 + j * cw + 120).attr('y', y0 - 22).attr('text-anchor', 'middle').attr('font-size', 26).attr('font-weight', 700).attr('fill', theme.text).text(c);
  });

  rows.forEach((r, i) => {
    svg.append('text').attr('x', 74).attr('y', y0 + i * ch + 54).attr('font-size', 28).attr('font-weight', 700).attr('fill', theme.text).text(r);
    cols.forEach((_c, j) => {
      const v = matrix[i][j];
      svg.append('rect')
        .attr('x', x0 + j * cw)
        .attr('y', y0 + i * ch)
        .attr('width', cw - 18)
        .attr('height', ch - 16)
        .attr('rx', 12)
        .attr('fill', color(v))
        .attr('stroke', '#cbd5e1');
      svg.append('text')
        .attr('x', x0 + j * cw + (cw - 18) / 2)
        .attr('y', y0 + i * ch + 52)
        .attr('text-anchor', 'middle')
        .attr('font-size', 28)
        .attr('font-weight', 700)
        .attr('fill', v >= 2 ? '#ffffff' : '#0f172a')
        .text(v);
    });
  });

  footer(svg, 'Scoring legend: 1=basic, 2=available, 3=strong');
  save(dom, 'slide_04_platform_capability_matrix.svg');
}

function render05SloFramework() {
  const { dom, svg } = createSvg();
  title(svg, 'Agent SLI/SLO 设计框架（SRE 视角）', '从单一准确率转向“质量-性能-成本-安全”四维治理');

  const cards = [
    { x: 80, y: 190, w: 360, h: 260, t: '质量 SLI', c: '#dbeafe', s: theme.blue, lines: ['Task Success Rate', 'Groundedness / Faithfulness', 'Human-rated Quality'] },
    { x: 470, y: 190, w: 360, h: 260, t: '性能 SLI', c: '#dcfce7', s: theme.green, lines: ['P95 End-to-End Latency', 'Tool Call Error Rate', 'Queue Wait Time'] },
    { x: 860, y: 190, w: 360, h: 260, t: '成本 SLI', c: '#fff7ed', s: theme.orange, lines: ['Token per Success', 'Cost per Request', 'Cache Hit Ratio'] },
    { x: 1250, y: 190, w: 280, h: 260, t: '安全 SLI', c: '#f3e8ff', s: theme.purple, lines: ['Policy Violations', 'Unsafe Output Rate', 'Red-team Findings'] }
  ];
  cards.forEach((c) => {
    panel(svg, { x: c.x, y: c.y, w: c.w, h: c.h, fill: c.c, stroke: c.s, titleText: c.t });
    c.lines.forEach((line, i) => {
      svg.append('text').attr('x', c.x + 20).attr('y', c.y + 96 + i * 46).attr('font-size', 24).attr('fill', '#1e293b').text(`- ${line}`);
    });
  });

  panel(svg, { x: 120, y: 500, w: 1360, h: 270, fill: '#ffffff', stroke: '#94a3b8', titleText: 'SLO 门禁示例（可执行）' });
  const rules = [
    '规则1：P95 Latency <= 30s 且 Error Rate <= 2%',
    '规则2：Quality Score 不低于基线 -2 分，且人评通过率 >= 85%',
    '规则3：Token 增幅超过 25% 时，必须满足 gain_per_1k_tokens >= 阈值',
    '规则4：安全违规率超过阈值立即阻断发布'
  ];
  rules.forEach((r, i) => {
    svg.append('text').attr('x', 160).attr('y', 570 + i * 50).attr('font-size', 26).attr('fill', theme.slate).text(r);
  });

  footer(svg, 'Reference model: SRE SLI/SLO method adapted for AI agents');
  save(dom, 'slide_05_agent_slo_framework.svg');
}

function render06ProjectArchitecture() {
  const { dom, svg } = createSvg();
  title(svg, '本工程映射：AI Agent 可观测架构（现状）', 'Trilingual Records + Gateway + Host Executor');

  const nodes = [
    { x: 80, y: 230, w: 250, h: 110, t: 'Web UI', c: '#dbeafe', s: theme.blue },
    { x: 390, y: 230, w: 340, h: 110, t: 'Node Server :3010', c: '#dcfce7', s: theme.green },
    { x: 800, y: 230, w: 330, h: 110, t: 'Gateway :18888', c: '#fff7ed', s: theme.orange },
    { x: 1200, y: 230, w: 320, h: 110, t: 'Executor :3210', c: '#f3e8ff', s: theme.purple },
    { x: 390, y: 420, w: 260, h: 110, t: 'SQLite + Files', c: '#e2e8f0', s: '#64748b' },
    { x: 720, y: 420, w: 220, h: 110, t: 'TTS EN/JA', c: '#e0f2fe', s: '#0891b2' },
    { x: 1000, y: 420, w: 220, h: 110, t: 'OCR Service', c: '#fef3c7', s: '#ca8a04' }
  ];
  nodes.forEach((n) => {
    panel(svg, { x: n.x, y: n.y, w: n.w, h: n.h, fill: n.c, stroke: n.s });
    svg.append('text').attr('x', n.x + n.w / 2).attr('y', n.y + 66).attr('text-anchor', 'middle').attr('font-size', 30).attr('font-weight', 700).attr('fill', theme.text).text(n.t);
  });

  const links = [
    [330, 285, 390, 285, '请求'],
    [730, 285, 800, 285, '模型调用'],
    [1130, 285, 1200, 285, '转发'],
    [560, 340, 520, 420, '落库'],
    [730, 340, 800, 420, '音频'],
    [860, 340, 1110, 420, 'OCR']
  ];
  links.forEach(([x1, y1, x2, y2, label]) => {
    svg.append('line').attr('x1', x1).attr('y1', y1).attr('x2', x2).attr('y2', y2).attr('stroke', '#64748b').attr('stroke-width', 2.4);
    svg.append('text').attr('x', (x1 + x2) / 2).attr('y', (y1 + y2) / 2 - 8).attr('text-anchor', 'middle').attr('font-size', 18).attr('fill', theme.muted).text(label);
  });

  footer(svg, `Current codebase snapshot: ${stats.routeCount} API routes, ${stats.tableCount} DB tables`);
  save(dom, 'slide_06_project_architecture_mapping.svg');
}

function render07DataModel() {
  const { dom, svg } = createSvg();
  title(svg, '本工程数据模型：可追溯链路', '生成记录 -> 可观测指标 -> few-shot实验 -> 人工评审');

  const nodes = [
    { id: 'generations', x: 120, y: 220, w: 250, h: 90, c: '#dbeafe', s: theme.blue },
    { id: 'observability_metrics', x: 420, y: 220, w: 340, h: 90, c: '#f3e8ff', s: theme.purple },
    { id: 'few_shot_runs', x: 820, y: 220, w: 250, h: 90, c: '#fff7ed', s: theme.orange },
    { id: 'experiment_samples', x: 1120, y: 220, w: 320, h: 90, c: '#dcfce7', s: theme.green },
    { id: 'example_units', x: 300, y: 430, w: 260, h: 90, c: '#fee2e2', s: theme.red },
    { id: 'example_reviews', x: 620, y: 430, w: 280, h: 90, c: '#e0f2fe', s: theme.cyan },
    { id: 'review_campaigns', x: 960, y: 430, w: 310, h: 90, c: '#fef3c7', s: '#ca8a04' }
  ];

  const map = new Map(nodes.map((n) => [n.id, n]));
  const links = [
    ['generations', 'observability_metrics'],
    ['generations', 'few_shot_runs'],
    ['few_shot_runs', 'experiment_samples'],
    ['generations', 'example_units'],
    ['example_units', 'example_reviews'],
    ['review_campaigns', 'example_reviews']
  ];

  links.forEach(([a, b]) => {
    const na = map.get(a);
    const nb = map.get(b);
    svg.append('line')
      .attr('x1', na.x + na.w)
      .attr('y1', na.y + na.h / 2)
      .attr('x2', nb.x)
      .attr('y2', nb.y + nb.h / 2)
      .attr('stroke', '#64748b')
      .attr('stroke-width', 2);
  });

  nodes.forEach((n) => {
    panel(svg, { x: n.x, y: n.y, w: n.w, h: n.h, fill: n.c, stroke: n.s });
    svg.append('text').attr('x', n.x + 16).attr('y', n.y + 56).attr('font-size', 28).attr('font-weight', 700).attr('fill', theme.text).text(n.id);
  });

  panel(svg, { x: 120, y: 610, w: 1320, h: 180, fill: '#ffffff', stroke: '#94a3b8', titleText: '可回答的问题（由数据模型支持）' });
  [
    '这次质量下降是 Prompt 变更、模型变更还是示例注入变化导致？',
    '某条例句为何被注入？它的人工评分、来源卡片、历史表现是什么？',
    '一次故障对哪些请求、哪些实验轮次产生了影响？'
  ].forEach((line, i) => {
    svg.append('text').attr('x', 160).attr('y', 680 + i * 42).attr('font-size', 24).attr('fill', theme.slate).text(`- ${line}`);
  });

  footer(svg, 'Source: database/schema.sql + services/exampleReviewService.js');
  save(dom, 'slide_07_project_data_model_traceability.svg');
}

function render08CapabilityCoverage() {
  const { dom, svg } = createSvg();
  title(svg, '当前完成度：可观测能力覆盖评分', '按“采集、追踪、评估、治理”四个维度');

  const data = [
    { name: '链路采集', done: 8, total: 10, c: theme.blue },
    { name: '质量评估', done: 7, total: 9, c: theme.green },
    { name: '实验可复现', done: 6, total: 8, c: theme.purple },
    { name: '运营治理', done: 4, total: 9, c: theme.orange },
    { name: '故障自愈', done: 3, total: 8, c: theme.red }
  ];

  data.forEach((d, i) => {
    const y = 200 + i * 118;
    const pct = d.done / d.total;
    svg.append('text').attr('x', 70).attr('y', y + 36).attr('font-size', 30).attr('font-weight', 700).attr('fill', theme.text).text(d.name);
    svg.append('rect').attr('x', 320).attr('y', y).attr('width', 980).attr('height', 48).attr('rx', 12).attr('fill', '#e2e8f0');
    svg.append('rect').attr('x', 320).attr('y', y).attr('width', 980 * pct).attr('height', 48).attr('rx', 12).attr('fill', d.c);
    svg.append('text').attr('x', 1330).attr('y', y + 35).attr('font-size', 26).attr('font-weight', 700).attr('fill', d.c).text(`${d.done}/${d.total}`);
  });

  footer(svg, 'Assessment baseline for roadmap prioritization');
  save(dom, 'slide_08_capability_coverage_score.svg');
}

function render09IncidentCase() {
  const { dom, svg } = createSvg();
  title(svg, '故障复盘样例：GEMINI fetch fail', '问题链：3210不可用 + IPv6 解析漂移 + 网关队列阻塞');

  const steps = [
    { x: 90, y: 210, w: 260, h: 100, t: '症状\n/api/generate\nfetch fail', c: '#fee2e2', s: theme.red },
    { x: 400, y: 210, w: 260, h: 100, t: '诊断\n18888 validate 正常\napi/gemini 503', c: '#fef3c7', s: '#ca8a04' },
    { x: 710, y: 210, w: 260, h: 100, t: '根因\n3210 未常驻\nIPv6优先失败', c: '#fff7ed', s: theme.orange },
    { x: 1020, y: 210, w: 260, h: 100, t: '修复\nlaunchd守护\nIPv4 fallback', c: '#dcfce7', s: theme.green },
    { x: 1330, y: 210, w: 220, h: 100, t: '结果\n链路恢复', c: '#dbeafe', s: theme.blue }
  ];

  steps.forEach((s, i) => {
    panel(svg, { x: s.x, y: s.y, w: s.w, h: s.h, fill: s.c, stroke: s.s });
    const lines = s.t.split('\n');
    lines.forEach((line, idx) => {
      svg.append('text').attr('x', s.x + s.w / 2).attr('y', s.y + 36 + idx * 24).attr('text-anchor', 'middle').attr('font-size', 24).attr('font-weight', idx === 0 ? 700 : 500).attr('fill', theme.text).text(line);
    });
    if (i < steps.length - 1) {
      svg.append('line').attr('x1', s.x + s.w).attr('y1', s.y + 50).attr('x2', steps[i + 1].x).attr('y2', steps[i + 1].y + 50).attr('stroke', '#64748b').attr('stroke-width', 2.4);
    }
  });

  panel(svg, { x: 120, y: 400, w: 1360, h: 350, fill: '#ffffff', stroke: '#94a3b8', titleText: '复盘结论（可迁移）' });
  [
    '1) 对 Agent 系统，"健康检查可用" 不等于 "链路可用"，必须覆盖真实调用路径。',
    '2) 可观测性需要同时覆盖控制面（队列/熔断）和数据面（请求/响应/超时）。',
    '3) 上游执行器必须守护化（launchd/systemd），否则会周期性回归同类故障。',
    '4) 对 host gateway 域名解析需设置 IPv4 优先或降级策略，避免环境漂移。'
  ].forEach((line, i) => {
    svg.append('text').attr('x', 160).attr('y', 472 + i * 64).attr('font-size', 26).attr('fill', theme.slate).text(line);
  });

  footer(svg, 'Case-driven observability improvement loop');
  save(dom, 'slide_09_incident_case_fetch_fail.svg');
}

function render10Optimization() {
  const { dom, svg } = createSvg();
  title(svg, '可优化项总览：从“可见”到“可控”', '优先把观测数据变成自动化动作');

  const rows = [
    { name: '统一 Trace-ID', impact: 5, effort: 2, c: theme.blue },
    { name: 'SLO + 告警规则', impact: 5, effort: 3, c: theme.green },
    { name: 'Prompt 版本门禁', impact: 4, effort: 3, c: theme.orange },
    { name: '自动回归评测', impact: 4, effort: 4, c: theme.purple },
    { name: '故障自愈编排', impact: 5, effort: 4, c: theme.red }
  ];

  const x = d3.scaleLinear().domain([1, 5]).range([260, 1450]);
  const y = d3.scaleLinear().domain([1, 5]).range([720, 180]);
  svg.append('line').attr('x1', 260).attr('y1', 720).attr('x2', 1450).attr('y2', 720).attr('stroke', '#334155');
  svg.append('line').attr('x1', 260).attr('y1', 720).attr('x2', 260).attr('y2', 180).attr('stroke', '#334155');
  svg.append('text').attr('x', 880).attr('y', 770).attr('font-size', 28).attr('text-anchor', 'middle').attr('fill', theme.text).text('实施复杂度（低 -> 高）');
  svg.append('text').attr('transform', 'translate(150,460) rotate(-90)').attr('font-size', 28).attr('text-anchor', 'middle').attr('fill', theme.text).text('业务影响（低 -> 高）');

  rows.forEach((r) => {
    const cx = x(r.effort);
    const cy = y(r.impact);
    svg.append('circle').attr('cx', cx).attr('cy', cy).attr('r', 36).attr('fill', r.c).attr('opacity', 0.85);
    svg.append('text').attr('x', cx + 50).attr('y', cy + 10).attr('font-size', 24).attr('fill', theme.text).text(r.name);
  });

  footer(svg, 'Prioritize high-impact / low-effort tasks first');
  save(dom, 'slide_10_optimization_priority_matrix.svg');
}

function render11Roadmap() {
  const { dom, svg } = createSvg();
  title(svg, '实施路线图：2周 / 4周 / 8周', '将可观测能力转化为稳定的工程收益');

  const phases = [
    { x: 90, t: '2周（稳态）', c: '#dbeafe', s: theme.blue, lines: ['统一 trace_id', 'SLO API + 告警', '阶段耗时标准化', '错误快照自动入库'] },
    { x: 560, t: '4周（归因）', c: '#dcfce7', s: theme.green, lines: ['Prompt/参数版本化', '质量漂移监控', '成本效率看板', '队列治理指标'] },
    { x: 1030, t: '8周（闭环）', c: '#fff7ed', s: theme.orange, lines: ['实验包一键导出', '自动回归门禁', '自愈策略编排', '评审可信度建模'] }
  ];

  phases.forEach((p, i) => {
    panel(svg, { x: p.x, y: 220, w: 430, h: 520, fill: p.c, stroke: p.s, titleText: p.t });
    p.lines.forEach((line, idx) => {
      svg.append('text').attr('x', p.x + 24).attr('y', 300 + idx * 90).attr('font-size', 28).attr('fill', '#1e293b').text(`- ${line}`);
    });
    if (i < phases.length - 1) {
      svg.append('line').attr('x1', p.x + 430).attr('y1', 480).attr('x2', phases[i + 1].x).attr('y2', 480).attr('stroke', '#64748b').attr('stroke-width', 2.4);
    }
  });

  footer(svg, 'Execution cadence aligned with AI_Observability_Roadmap.md');
  save(dom, 'slide_11_delivery_roadmap_2_4_8_weeks.svg');
}

function render12Target() {
  const { dom, svg } = createSvg();
  title(svg, '目标态：Agent 可观测性运营闭环', '可观测 -> 可解释 -> 可决策 -> 可优化');

  const ringData = [
    { label: '可观测', color: theme.blue, r1: 260, r2: 320 },
    { label: '可解释', color: theme.green, r1: 190, r2: 250 },
    { label: '可决策', color: theme.orange, r1: 120, r2: 180 },
    { label: '可优化', color: theme.purple, r1: 50, r2: 110 }
  ];

  const g = svg.append('g').attr('transform', `translate(520,470)`);
  ringData.forEach((d) => {
    const arc = d3.arc().innerRadius(d.r1).outerRadius(d.r2).startAngle(-Math.PI * 0.9).endAngle(Math.PI * 0.9);
    g.append('path').attr('d', arc()).attr('fill', d.color).attr('opacity', 0.16).attr('stroke', d.color).attr('stroke-width', 2);
    g.append('text').attr('x', 0).attr('y', -d.r1 + 18).attr('text-anchor', 'middle').attr('font-size', 24).attr('font-weight', 700).attr('fill', d.color).text(d.label);
  });
  g.append('circle').attr('r', 36).attr('fill', '#0f172a');
  g.append('text').attr('x', 0).attr('y', 8).attr('text-anchor', 'middle').attr('font-size', 22).attr('fill', '#ffffff').text('AI');

  panel(svg, { x: 930, y: 210, w: 600, h: 530, fill: '#ffffff', stroke: '#94a3b8', titleText: '建议年度北极星指标' });
  const kpis = [
    'P95 端到端延迟：< 30s',
    '请求成功率：> 98%',
    '质量评分下限：>= 80',
    '严重故障 MTTR：< 15min',
    '单位质量成本：季度环比下降',
    '发布回滚率：持续下降'
  ];
  kpis.forEach((k, i) => {
    svg.append('text').attr('x', 965).attr('y', 298 + i * 74).attr('font-size', 30).attr('fill', theme.slate).text(`- ${k}`);
  });

  footer(svg, 'Outcome: observability as an engineering control system');
  save(dom, 'slide_12_target_state_operating_model.svg');
}

function main() {
  render00Cover();
  render01IndustryPain();
  render02IndustryStack();
  render03Standards();
  render04PlatformMatrix();
  render05SloFramework();
  render06ProjectArchitecture();
  render07DataModel();
  render08CapabilityCoverage();
  render09IncidentCase();
  render10Optimization();
  render11Roadmap();
  render12Target();
  console.log(`[ai-agent-observability-cn] charts generated at: ${outDir}`);
}

main();
