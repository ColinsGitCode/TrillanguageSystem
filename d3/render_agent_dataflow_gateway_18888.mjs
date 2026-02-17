import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as d3 from 'd3';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outputDir = path.join(repoRoot, 'Docs', 'TestDocs', 'charts');
const outputFile = path.join(outputDir, 'slide_agent_dataflow_gateway_18888.svg');

fs.mkdirSync(outputDir, { recursive: true });

const width = 1600;
const height = 920;

const dom = new JSDOM('<!doctype html><body></body>');
const svg = d3
  .select(dom.window.document.body)
  .append('svg')
  .attr('xmlns', 'http://www.w3.org/2000/svg')
  .attr('width', width)
  .attr('height', height)
  .style('background', '#f8fafc')
  .style('font-family', "'PingFang SC','Microsoft YaHei','Noto Sans SC',sans-serif");

svg
  .append('rect')
  .attr('x', 20)
  .attr('y', 20)
  .attr('width', width - 40)
  .attr('height', height - 40)
  .attr('rx', 20)
  .attr('fill', '#ffffff')
  .attr('stroke', '#e2e8f0');

svg
  .append('text')
  .attr('x', 56)
  .attr('y', 72)
  .attr('font-size', 44)
  .attr('font-weight', 800)
  .attr('fill', '#0f172a')
  .text('学习卡片生成链路数据流程图（Gateway 18888）');

svg
  .append('text')
  .attr('x', 56)
  .attr('y', 106)
  .attr('font-size', 20)
  .attr('fill', '#475569')
  .text('主链路：UI -> Viewer -> Gateway(18888) -> Host Executor(3210) -> Gemini CLI -> 后处理/TTS/存储');

const defs = svg.append('defs');
defs
  .append('marker')
  .attr('id', 'arrow')
  .attr('viewBox', '0 -5 10 10')
  .attr('refX', 9)
  .attr('refY', 0)
  .attr('markerWidth', 8)
  .attr('markerHeight', 8)
  .attr('orient', 'auto')
  .append('path')
  .attr('d', 'M0,-5L10,0L0,5')
  .attr('fill', '#64748b');

defs
  .append('marker')
  .attr('id', 'arrow-red')
  .attr('viewBox', '0 -5 10 10')
  .attr('refX', 9)
  .attr('refY', 0)
  .attr('markerWidth', 8)
  .attr('markerHeight', 8)
  .attr('orient', 'auto')
  .append('path')
  .attr('d', 'M0,-5L10,0L0,5')
  .attr('fill', '#dc2626');

function nodeBox({ x, y, w, h, fill, stroke, title, lines }) {
  svg
    .append('rect')
    .attr('x', x)
    .attr('y', y)
    .attr('width', w)
    .attr('height', h)
    .attr('rx', 14)
    .attr('fill', fill)
    .attr('stroke', stroke)
    .attr('stroke-width', 2.4);

  svg
    .append('text')
    .attr('x', x + 18)
    .attr('y', y + 38)
    .attr('font-size', 26)
    .attr('font-weight', 800)
    .attr('fill', '#0f172a')
    .text(title);

  lines.forEach((line, idx) => {
    svg
      .append('text')
      .attr('x', x + 18)
      .attr('y', y + 74 + idx * 28)
      .attr('font-size', 18)
      .attr('fill', '#1e293b')
      .text(line);
  });
}

function link({ x1, y1, x2, y2, label = '', dashed = false, red = false }) {
  svg
    .append('line')
    .attr('x1', x1)
    .attr('y1', y1)
    .attr('x2', x2)
    .attr('y2', y2)
    .attr('stroke', red ? '#dc2626' : '#64748b')
    .attr('stroke-width', 2.2)
    .attr('stroke-dasharray', dashed ? '8,6' : null)
    .attr('marker-end', red ? 'url(#arrow-red)' : 'url(#arrow)');

  if (label) {
    svg
      .append('text')
      .attr('x', (x1 + x2) / 2)
      .attr('y', (y1 + y2) / 2 - 10)
      .attr('text-anchor', 'middle')
      .attr('font-size', 16)
      .attr('fill', red ? '#b91c1c' : '#475569')
      .text(label);
  }
}

nodeBox({
  x: 60, y: 180, w: 220, h: 120,
  fill: '#e0f2fe', stroke: '#0284c7',
  title: '前端 UI',
  lines: ['文本输入 / OCR 输入']
});

nodeBox({
  x: 330, y: 170, w: 270, h: 140,
  fill: '#dbeafe', stroke: '#2563eb',
  title: 'Viewer 服务 :3010',
  lines: ['server.js 编排', '/api/generate']
});

nodeBox({
  x: 650, y: 170, w: 280, h: 140,
  fill: '#ede9fe', stroke: '#7c3aed',
  title: 'Gemini Gateway :18888',
  lines: ['鉴权 / 队列 / 熔断', '/api/gemini']
});

nodeBox({
  x: 980, y: 170, w: 280, h: 140,
  fill: '#dcfce7', stroke: '#16a34a',
  title: 'Host Executor :3210',
  lines: ['gemini-host-proxy.js', '执行器']
});

nodeBox({
  x: 1310, y: 170, w: 230, h: 140,
  fill: '#ffedd5', stroke: '#ea580c',
  title: 'Gemini CLI',
  lines: ['gemini --model', '-p prompt']
});

nodeBox({
  x: 360, y: 420, w: 290, h: 150,
  fill: '#f1f5f9', stroke: '#64748b',
  title: '后处理/渲染',
  lines: ['contentPostProcessor', 'htmlRenderer + 注音/音频任务']
});

nodeBox({
  x: 700, y: 420, w: 260, h: 150,
  fill: '#fef3c7', stroke: '#ca8a04',
  title: 'TTS 服务',
  lines: ['EN: :8000', 'JA: :50021']
});

nodeBox({
  x: 1010, y: 420, w: 260, h: 150,
  fill: '#e0f2fe', stroke: '#0284c7',
  title: '文件存储',
  lines: ['/data/trilingual_records', 'md/html/wav/meta']
});

nodeBox({
  x: 1320, y: 420, w: 220, h: 150,
  fill: '#fee2e2', stroke: '#dc2626',
  title: 'SQLite',
  lines: ['generations', 'observability_metrics']
});

nodeBox({
  x: 60, y: 650, w: 310, h: 170,
  fill: '#fee2e2', stroke: '#dc2626',
  title: '异常分支',
  lines: ['Gateway 503 / breaker open', '或 Local LLM 不可达', '最终写入 generation_errors']
});

link({ x1: 280, y1: 240, x2: 330, y2: 240, label: 'POST /api/generate' });
link({ x1: 600, y1: 240, x2: 650, y2: 240, label: 'llm_provider=gemini' });
link({ x1: 930, y1: 240, x2: 980, y2: 240, label: '上游转发' });
link({ x1: 1260, y1: 240, x2: 1310, y2: 240, label: 'spawn CLI' });

link({ x1: 1420, y1: 310, x2: 510, y2: 420, label: 'markdown/rawOutput 回传' });
link({ x1: 650, y1: 495, x2: 700, y2: 495, label: '抽取 audio_tasks' });
link({ x1: 960, y1: 495, x2: 1010, y2: 495, label: '保存卡片文件' });
link({ x1: 1270, y1: 495, x2: 1320, y2: 495, label: '落库指标与记录' });

link({ x1: 790, y1: 310, x2: 210, y2: 650, label: '上游失败/熔断', dashed: true, red: true });
link({ x1: 370, y1: 735, x2: 330, y2: 250, label: '回退失败后报错', dashed: true, red: true });

svg
  .append('rect')
  .attr('x', 420)
  .attr('y', 650)
  .attr('width', 1120)
  .attr('height', 170)
  .attr('rx', 14)
  .attr('fill', '#f8fafc')
  .attr('stroke', '#cbd5e1')
  .attr('stroke-dasharray', '6,5');

svg
  .append('text')
  .attr('x', 446)
  .attr('y', 690)
  .attr('font-size', 24)
  .attr('font-weight', 700)
  .attr('fill', '#0f172a')
  .text('运维要点（当前工程）');

[
  '1) 18888 是入口端口；是否可用取决于 Gateway -> 3210 -> Gemini CLI 全链路。',
  '2) /health 在线不代表 /api/gemini 可用；需同时看 breaker_state 与上游连通性。',
  '3) 建议保留 GEMINI_PROXY_URL 可配置，故障时可快速切换到直连可达执行器。',
].forEach((line, idx) => {
  svg
    .append('text')
    .attr('x', 446)
    .attr('y', 730 + idx * 30)
    .attr('font-size', 18)
    .attr('fill', '#334155')
    .text(line);
});

svg
  .append('text')
  .attr('x', 56)
  .attr('y', 878)
  .attr('font-size', 14)
  .attr('fill', '#64748b')
  .text('Source: server.js / geminiProxyService.js / gemini-host-proxy.js / Gateway18888 runtime');

fs.writeFileSync(outputFile, dom.window.document.body.innerHTML, 'utf8');
console.log(`Generated: ${outputFile}`);
