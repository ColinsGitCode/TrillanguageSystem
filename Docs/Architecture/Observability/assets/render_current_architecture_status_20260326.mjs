import fs from 'fs';
import path from 'path';
import * as d3 from 'd3';
import { JSDOM } from 'jsdom';

const WIDTH = 3200;
const HEIGHT = 1800;
const BG = '#FFFFFF';
const TEXT = '#1F2937';
const SUB = '#64748B';
const BORDER = '#CBD5E1';

const outPath = path.resolve('Docs/Architecture/Observability/assets/current_architecture_status_20260326.svg');

const dom = new JSDOM('<!DOCTYPE html><body></body>');
const body = d3.select(dom.window.document.body);
const svg = body.append('svg')
  .attr('xmlns', 'http://www.w3.org/2000/svg')
  .attr('width', WIDTH)
  .attr('height', HEIGHT)
  .attr('viewBox', `0 0 ${WIDTH} ${HEIGHT}`)
  .style('background', BG);

const defs = svg.append('defs');
defs.append('filter')
  .attr('id', 'shadow')
  .attr('x', '-20%').attr('y', '-20%')
  .attr('width', '140%').attr('height', '140%')
  .html(`
    <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#0F172A" flood-opacity="0.10" />
  `);
defs.append('marker')
  .attr('id', 'arrow')
  .attr('viewBox', '0 -5 10 10')
  .attr('refX', 9)
  .attr('refY', 0)
  .attr('markerWidth', 8)
  .attr('markerHeight', 8)
  .attr('orient', 'auto')
  .append('path')
  .attr('d', 'M0,-5L10,0L0,5')
  .attr('fill', '#475569');

defs.append('linearGradient')
  .attr('id', 'heroGrad')
  .attr('x1', '0%').attr('x2', '100%')
  .attr('y1', '0%').attr('y2', '0%')
  .html(`
    <stop offset="0%" stop-color="#DBEAFE" />
    <stop offset="100%" stop-color="#E9D5FF" />
  `);

function addText(x, y, text, opts = {}) {
  const {
    size = 32,
    weight = 500,
    fill = TEXT,
    anchor = 'start',
    family = 'SimHei, "Microsoft YaHei", sans-serif',
    letterSpacing = 0,
  } = opts;
  return svg.append('text')
    .attr('x', x)
    .attr('y', y)
    .attr('fill', fill)
    .attr('font-size', size)
    .attr('font-weight', weight)
    .attr('font-family', family)
    .attr('text-anchor', anchor)
    .attr('letter-spacing', letterSpacing)
    .text(text);
}

function wrap(text, maxChars) {
  const src = String(text || '');
  const lines = [];
  let buf = '';
  for (const ch of src) {
    buf += ch;
    if (buf.length >= maxChars && /[，。、；：, .]/.test(ch)) {
      lines.push(buf.trim());
      buf = '';
    }
  }
  if (buf.trim()) lines.push(buf.trim());
  return lines.length ? lines : [''];
}

function drawCard(x, y, w, h, title, bullets, color, badge = '') {
  const g = svg.append('g').attr('transform', `translate(${x},${y})`);
  g.append('rect')
    .attr('width', w)
    .attr('height', h)
    .attr('rx', 24)
    .attr('fill', '#FFFFFF')
    .attr('stroke', color.stroke)
    .attr('stroke-width', 3)
    .attr('filter', 'url(#shadow)');
  g.append('rect')
    .attr('x', 0)
    .attr('y', 0)
    .attr('width', w)
    .attr('height', 84)
    .attr('rx', 24)
    .attr('fill', color.header);
  g.append('rect')
    .attr('x', 0)
    .attr('y', 60)
    .attr('width', w)
    .attr('height', 24)
    .attr('fill', color.header);
  g.append('text')
    .attr('x', 30)
    .attr('y', 52)
    .attr('fill', color.title)
    .attr('font-size', 34)
    .attr('font-weight', 700)
    .attr('font-family', 'SimHei, "Microsoft YaHei", sans-serif')
    .text(title);

  if (badge) {
    const bw = Math.max(150, badge.length * 18 + 40);
    g.append('rect')
      .attr('x', w - bw - 28)
      .attr('y', 20)
      .attr('width', bw)
      .attr('height', 42)
      .attr('rx', 21)
      .attr('fill', '#FFFFFF')
      .attr('stroke', color.stroke)
      .attr('stroke-width', 2);
    g.append('text')
      .attr('x', w - bw / 2 - 28)
      .attr('y', 48)
      .attr('fill', color.title)
      .attr('font-size', 22)
      .attr('font-weight', 700)
      .attr('text-anchor', 'middle')
      .attr('font-family', 'SimHei, "Microsoft YaHei", sans-serif')
      .text(badge);
  }

  let cy = 126;
  bullets.forEach((item) => {
    const lines = wrap(item, 24);
    g.append('circle').attr('cx', 34).attr('cy', cy - 8).attr('r', 6).attr('fill', color.stroke);
    lines.forEach((line, idx) => {
      g.append('text')
        .attr('x', 54)
        .attr('y', cy + idx * 32)
        .attr('fill', TEXT)
        .attr('font-size', 24)
        .attr('font-weight', idx === 0 ? 600 : 500)
        .attr('font-family', 'SimHei, "Microsoft YaHei", sans-serif')
        .text(line);
    });
    cy += lines.length * 32 + 28;
  });
}

function drawBox(x, y, w, h, title, bodyLines, opts = {}) {
  const g = svg.append('g').attr('transform', `translate(${x},${y})`);
  g.append('rect')
    .attr('width', w)
    .attr('height', h)
    .attr('rx', 20)
    .attr('fill', opts.fill || '#FFFFFF')
    .attr('stroke', opts.stroke || BORDER)
    .attr('stroke-width', opts.strokeWidth || 2)
    .attr('filter', 'url(#shadow)');
  g.append('text')
    .attr('x', 24)
    .attr('y', 38)
    .attr('fill', opts.titleFill || TEXT)
    .attr('font-size', 24)
    .attr('font-weight', 700)
    .attr('font-family', 'SimHei, "Microsoft YaHei", sans-serif')
    .text(title);
  let yCursor = 76;
  bodyLines.forEach((line) => {
    const wrapped = wrap(line, 24);
    wrapped.forEach((seg, idx) => {
      g.append('text')
        .attr('x', 26 + (idx === 0 ? 0 : 18))
        .attr('y', yCursor)
        .attr('fill', opts.bodyFill || TEXT)
        .attr('font-size', 20)
        .attr('font-weight', 500)
        .attr('font-family', 'SimHei, "Microsoft YaHei", sans-serif')
        .text(idx === 0 ? `• ${seg}` : seg);
      yCursor += 28;
    });
    yCursor += 10;
  });
}

function drawArrow(x1, y1, x2, y2, label = '') {
  svg.append('line')
    .attr('x1', x1).attr('y1', y1)
    .attr('x2', x2).attr('y2', y2)
    .attr('stroke', '#475569')
    .attr('stroke-width', 3.2)
    .attr('marker-end', 'url(#arrow)');
  if (label) {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    svg.append('rect')
      .attr('x', mx - 84)
      .attr('y', my - 24)
      .attr('width', 168)
      .attr('height', 34)
      .attr('rx', 17)
      .attr('fill', '#FFFFFF')
      .attr('stroke', '#CBD5E1');
    addText(mx, my - 1, label, { size: 18, weight: 700, anchor: 'middle', fill: '#334155' });
  }
}

svg.append('rect')
  .attr('x', 40)
  .attr('y', 34)
  .attr('width', WIDTH - 80)
  .attr('height', 160)
  .attr('rx', 28)
  .attr('fill', 'url(#heroGrad)')
  .attr('stroke', '#BFDBFE')
  .attr('stroke-width', 2);

addText(88, 100, 'Three_LANS 当前架构状态', { size: 64, weight: 800, fill: '#0F172A' });
addText(92, 150, '项目内 Gemini Proxy + 服务端共享队列；核心主链已收口，剩余是认证与宿主机隔离问题。', { size: 26, weight: 500, fill: SUB });

addText(120, 262, '一、当前架构', { size: 38, weight: 800, fill: '#0F172A' });
addText(1950, 262, '二、未完成项与风险', { size: 38, weight: 800, fill: '#0F172A' });

const colors = {
  browser: { header: '#DBEAFE', stroke: '#2563EB', title: '#1D4ED8' },
  viewer: { header: '#F3E8FF', stroke: '#7C3AED', title: '#6D28D9' },
  proxy: { header: '#FCE7F3', stroke: '#DB2777', title: '#BE185D' },
  host: { header: '#E8F5E9', stroke: '#16A34A', title: '#15803D' },
  data: { header: '#FFF7ED', stroke: '#EA580C', title: '#C2410C' },
};

drawCard(100, 320, 520, 270, '浏览器层', [
  '主页面 / Mission Control / Knowledge 页面',
  '所有浏览器统一读取服务端共享队列',
  '只负责入队、展示、审计与详情查看'
], colors.browser, 'UI');

drawCard(760, 320, 560, 330, 'viewer 业务服务', [
  '负责 /api/generate、/api/training、/api/knowledge',
  '内置单 worker 串行执行 generation_jobs',
  '统一落库 cards、TRAIN、knowledge、queue events'
], colors.viewer, 'Node');

drawCard(1460, 320, 520, 290, '项目内 Gemini Proxy', [
  '项目内专属 LLM HTTP 入口',
  '负责健康检查、超时控制、响应清洗',
  '避免依赖外部共享 18888 服务'
], colors.proxy, 'Proxy');

drawCard(2120, 320, 520, 320, '宿主机 Gemini Executor', [
  '仍在本机执行 Gemini CLI',
  '作为工程自带 host-side executor',
  '连接本地 Gemini CLI 与项目专属运行目录'
], colors.host, 'Host');

drawCard(760, 790, 560, 320, '数据与审计层', [
  'SQLite：generations / card_training_assets',
  'generation_jobs / generation_job_events',
  'Knowledge tables + TRAIN assets + highlights'
], colors.data, 'DB');

drawCard(1460, 790, 520, 300, '辅助服务层', [
  'OCR 容器：图像识别与清洗前置',
  'TTS EN / JA：例句音频生成',
  '都由 viewer 统一调度'
], colors.browser, 'Sidecars');

drawArrow(620, 455, 760, 455, '入队 / 读取');
drawArrow(1320, 455, 1460, 455, 'LLM 调用');
drawArrow(1980, 455, 2120, 455, '转发');
drawArrow(1040, 650, 1040, 790, '持久化');
drawArrow(1600, 650, 1600, 790, '协作');

const rightX = 1940;
drawBox(rightX, 320, 1120, 250, '未完成项 01 · Gemini Auth 收口', [
  '当前调用链已切到项目内 proxy，但认证链还没有完全并到同一路径。',
  '目标是让 auth status / start / submit / cancel 全部经由项目内 proxy 与 host executor。'
], { fill: '#FFF7ED', stroke: '#FB923C', titleFill: '#C2410C' });

drawBox(rightX, 610, 1120, 250, '未完成项 02 · 宿主机运行环境隔离', [
  'Gemini CLI 仍受宿主机环境影响，这是当前最大外部变量。',
  '需要继续隔离专属目录、白名单 env，并压缩 MCP 污染与非预期 fallback。'
], { fill: '#FEF2F2', stroke: '#F87171', titleFill: '#B91C1C' });

drawBox(rightX, 900, 1120, 250, '风险点 · 配额 / 模型可用性 / CLI 行为', [
  '共享队列和项目内 proxy 已稳定，但质量与时延仍受 Gemini 配额和模型状态影响。',
  '现在的策略是：项目内清洗、校验、重试；不要静默降级。'
], { fill: '#EEF2FF', stroke: '#818CF8', titleFill: '#4338CA' });

drawBox(rightX, 1190, 1120, 320, '下一阶段优先级', [
  'P1：Gemini auth 全量收口到项目内 proxy。',
  'P2：继续隔离 host executor 的 Gemini CLI 运行环境。',
  'P3：增强共享队列控制能力（running cancel / priority / backoff）。'
], { fill: '#ECFDF5', stroke: '#34D399', titleFill: '#047857' });

svg.append('line')
  .attr('x1', 1760).attr('y1', 280)
  .attr('x2', 1760).attr('y2', 1660)
  .attr('stroke', '#CBD5E1')
  .attr('stroke-width', 2)
  .attr('stroke-dasharray', '10 10');

addText(110, 1618, '当前判断：主链已稳定；剩余工作属于“架构收尾”，不是“主链路不可用”。', { size: 28, weight: 700, fill: '#0F172A' });
addText(110, 1662, '数据来源：当前仓库实现 + SystemDevelopStatusDocs 状态文档（2026-03-26）', { size: 22, weight: 500, fill: SUB });

fs.writeFileSync(outPath, body.html());
console.log(`written: ${outPath}`);
