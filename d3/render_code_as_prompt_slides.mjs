import fs from 'fs';
import * as d3 from 'd3';
import { JSDOM } from 'jsdom';

const WIDTH = 1200;
const HEIGHT = 675;

const palette = {
  bg: '#F7F9FC',
  ink: '#111827',
  muted: '#6B7280',
  line: '#94A3B8',
  panel: '#FFFFFF',
  softBlue: '#E0E7FF',
  softOrange: '#FFEDD5',
  softGreen: '#DCFCE7',
  softPurple: '#EDE9FE',
  softGray: '#F3F4F6',
  blue: '#2563EB',
  orange: '#F97316',
  green: '#10B981',
  purple: '#7C3AED',
  red: '#EF4444',
};

function createSvg() {
  const dom = new JSDOM(`<!DOCTYPE html><body></body>`);
  const svg = d3
    .select(dom.window.document.body)
    .append('svg')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('width', WIDTH)
    .attr('height', HEIGHT)
    .style('background', palette.bg);

  const defs = svg.append('defs');
  defs
    .append('marker')
    .attr('id', 'arrow')
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 9)
    .attr('refY', 0)
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0,-5L10,0L0,5')
    .attr('fill', palette.line);

  return { svg, dom };
}

function addTitle(svg, text) {
  svg
    .append('text')
    .attr('x', 60)
    .attr('y', 60)
    .attr('font-size', 24)
    .attr('font-weight', 700)
    .attr('fill', palette.ink)
    .attr('font-family', 'Arial, sans-serif')
    .text(text);
}

function addBox(svg, { x, y, w, h, fill, stroke, title, subtitle, align = 'center' }) {
  svg
    .append('rect')
    .attr('x', x)
    .attr('y', y)
    .attr('width', w)
    .attr('height', h)
    .attr('rx', 12)
    .attr('fill', fill || palette.panel)
    .attr('stroke', stroke || palette.line)
    .attr('stroke-width', 2);

  const text = svg
    .append('text')
    .attr('x', align === 'left' ? x + 18 : x + w / 2)
    .attr('y', y + h / 2)
    .attr('text-anchor', align === 'left' ? 'start' : 'middle')
    .attr('font-family', 'Arial, sans-serif')
    .attr('fill', palette.ink);

  if (subtitle) {
    text
      .append('tspan')
      .attr('x', align === 'left' ? x + 18 : x + w / 2)
      .attr('dy', '-6')
      .attr('font-size', 16)
      .attr('font-weight', 700)
      .text(title || '');

    text
      .append('tspan')
      .attr('x', align === 'left' ? x + 18 : x + w / 2)
      .attr('dy', '22')
      .attr('font-size', 12)
      .attr('fill', palette.muted)
      .text(subtitle);
  } else {
    text
      .append('tspan')
      .attr('x', align === 'left' ? x + 18 : x + w / 2)
      .attr('dy', '4')
      .attr('font-size', 16)
      .attr('font-weight', 700)
      .text(title || '');
  }
}

function addArrow(svg, x1, y1, x2, y2, label) {
  svg
    .append('line')
    .attr('x1', x1)
    .attr('y1', y1)
    .attr('x2', x2)
    .attr('y2', y2)
    .attr('stroke', palette.line)
    .attr('stroke-width', 2)
    .attr('marker-end', 'url(#arrow)');

  if (label) {
    svg
      .append('text')
      .attr('x', (x1 + x2) / 2)
      .attr('y', (y1 + y2) / 2 - 8)
      .attr('text-anchor', 'middle')
      .attr('font-size', 12)
      .attr('fill', palette.muted)
      .attr('font-family', 'Arial, sans-serif')
      .text(label);
  }
}

function save(svg, filename) {
  fs.writeFileSync(filename, svg.node().outerHTML, 'utf-8');
}

// Slide 1: Cover motif
function slide1() {
  const { svg } = createSvg();
  const nodes = [
    { x: 180, y: 200 },
    { x: 320, y: 140 },
    { x: 480, y: 210 },
    { x: 680, y: 160 },
    { x: 820, y: 240 },
    { x: 980, y: 180 },
  ];
  svg.append('rect').attr('x', 50).attr('y', 90).attr('width', 1100).attr('height', 520).attr('rx', 20).attr('fill', palette.panel).attr('stroke', palette.softGray).attr('stroke-width', 2);

  nodes.forEach((n, i) => {
    if (i > 0) {
      addArrow(svg, nodes[i - 1].x, nodes[i - 1].y, n.x, n.y);
    }
  });

  nodes.forEach((n) => {
    svg.append('circle').attr('cx', n.x).attr('cy', n.y).attr('r', 10).attr('fill', palette.blue);
  });

  svg
    .append('text')
    .attr('x', WIDTH / 2)
    .attr('y', HEIGHT / 2)
    .attr('text-anchor', 'middle')
    .attr('font-size', 34)
    .attr('font-weight', 700)
    .attr('fill', palette.ink)
    .attr('font-family', 'Arial, sans-serif')
    .text('Code as Prompt');

  svg
    .append('text')
    .attr('x', WIDTH / 2)
    .attr('y', HEIGHT / 2 + 40)
    .attr('text-anchor', 'middle')
    .attr('font-size', 16)
    .attr('fill', palette.muted)
    .attr('font-family', 'Arial, sans-serif')
    .text('Trilingual Learning System');

  save(svg, 'svgs/slide_01_cover.svg');
}

// Slide 2: Agenda timeline
function slide2() {
  const { svg } = createSvg();
  const steps = ['背景', '理念', '实践', '对照', '演进', '总结'];
  const startX = 120;
  const endX = 1080;
  const y = HEIGHT / 2;
  svg.append('line').attr('x1', startX).attr('y1', y).attr('x2', endX).attr('y2', y).attr('stroke', palette.line).attr('stroke-width', 3);
  steps.forEach((label, i) => {
    const x = startX + (i * (endX - startX) / (steps.length - 1));
    svg.append('circle').attr('cx', x).attr('cy', y).attr('r', 14).attr('fill', palette.softBlue).attr('stroke', palette.blue).attr('stroke-width', 2);
    svg.append('text').attr('x', x).attr('y', y - 28).attr('text-anchor', 'middle').attr('font-size', 13).attr('fill', palette.ink).attr('font-family', 'Arial, sans-serif').text(label);
  });
  save(svg, 'svgs/slide_02_agenda.svg');
}

// Slide 3: Pain points matrix
function slide3() {
  const { svg } = createSvg();
  const gridX = 150;
  const gridY = 140;
  const cellW = 420;
  const cellH = 180;
  const items = [
    { x: gridX, y: gridY, title: '效率低', color: palette.softOrange },
    { x: gridX + cellW + 60, y: gridY, title: '质量不稳', color: palette.softPurple },
    { x: gridX, y: gridY + cellH + 60, title: '结构化不足', color: palette.softGreen },
    { x: gridX + cellW + 60, y: gridY + cellH + 60, title: '难维护', color: palette.softBlue },
  ];
  items.forEach((item) => {
    addBox(svg, { x: item.x, y: item.y, w: cellW, h: cellH, fill: item.color, stroke: palette.line, title: item.title });
  });
  save(svg, 'svgs/slide_03_pain_points.svg');
}

// Slide 4: Prompt vs Code
function slide4() {
  const { svg } = createSvg();
  addBox(svg, { x: 120, y: 160, w: 360, h: 220, fill: palette.softGray, stroke: palette.line, title: '传统 Prompt', subtitle: '字符串拼接' });
  addBox(svg, { x: 720, y: 140, w: 360, h: 260, fill: palette.softBlue, stroke: palette.blue, title: 'Code as Prompt', subtitle: '模块化 + 合同' });
  addArrow(svg, 480, 270, 720, 270, '结构化升级');
  addBox(svg, { x: 720, y: 430, w: 360, h: 120, fill: palette.softGreen, stroke: palette.green, title: 'JSON Output', subtitle: '可编程/可验证' });
  save(svg, 'svgs/slide_04_definition.svg');
}

// Slide 5: 5-layer stack
function slide5() {
  const { svg } = createSvg();
  const layers = [
    { label: 'System Role', color: palette.softBlue },
    { label: 'CoT Guidance', color: palette.softPurple },
    { label: 'Few-shot Examples', color: palette.softOrange },
    { label: 'Detailed Requirements', color: palette.softGreen },
    { label: 'Data Contract', color: palette.softGray },
  ];
  const x = 360;
  const y = 120;
  const w = 480;
  const h = 70;
  layers.forEach((layer, i) => {
    addBox(svg, { x, y: y + i * (h + 16), w, h, fill: layer.color, stroke: palette.line, title: layer.label });
  });
  save(svg, 'svgs/slide_05_prompt_layers.svg');
}

// Slide 6: Contract flow
function slide6() {
  const { svg } = createSvg();
  const boxes = [
    { label: 'Prompt', x: 80 },
    { label: 'LLM', x: 300 },
    { label: 'JSON', x: 520 },
    { label: 'Validator', x: 740 },
    { label: 'Storage', x: 960 },
  ];
  boxes.forEach((b, i) => {
    addBox(svg, { x: b.x, y: 260, w: 160, h: 90, fill: palette.panel, stroke: palette.line, title: b.label });
    if (i < boxes.length - 1) {
      addArrow(svg, b.x + 160, 305, boxes[i + 1].x, 305);
    }
  });
  // error branch
  svg.append('line').attr('x1', 820).attr('y1', 350).attr('x2', 820).attr('y2', 440).attr('stroke', palette.red).attr('stroke-width', 2).attr('stroke-dasharray', '4 4');
  svg.append('circle').attr('cx', 820).attr('cy', 470).attr('r', 18).attr('fill', palette.red);
  svg.append('text').attr('x', 820).attr('y', 475).attr('text-anchor', 'middle').attr('font-size', 16).attr('fill', '#fff').attr('font-family', 'Arial, sans-serif').text('X');
  save(svg, 'svgs/slide_06_contract_flow.svg');
}

// Slide 7: Rules good/bad
function slide7() {
  const { svg } = createSvg();
  addBox(svg, { x: 80, y: 140, w: 420, h: 380, fill: palette.panel, stroke: palette.line, title: '规则清单', subtitle: '长度/语域/注音' });
  addBox(svg, { x: 600, y: 160, w: 220, h: 160, fill: palette.softGreen, stroke: palette.green, title: '合规 ✅', subtitle: '汉字无注音' });
  addBox(svg, { x: 860, y: 160, w: 220, h: 160, fill: palette.softOrange, stroke: palette.orange, title: '不合规 ❌', subtitle: '汉字(かな)' });
  save(svg, 'svgs/slide_07_quality_rules.svg');
}

// Slide 8: Render + TTS
function slide8() {
  const { svg } = createSvg();
  addBox(svg, { x: 80, y: 260, w: 160, h: 90, fill: palette.softGray, stroke: palette.line, title: 'Markdown' });
  addBox(svg, { x: 300, y: 260, w: 160, h: 90, fill: palette.softBlue, stroke: palette.blue, title: 'Parser' });
  addBox(svg, { x: 520, y: 260, w: 160, h: 90, fill: palette.softPurple, stroke: palette.purple, title: 'audio_tasks' });
  addArrow(svg, 240, 305, 300, 305);
  addArrow(svg, 460, 305, 520, 305);
  addBox(svg, { x: 760, y: 180, w: 180, h: 80, fill: palette.softOrange, stroke: palette.orange, title: 'EN TTS' });
  addBox(svg, { x: 760, y: 340, w: 180, h: 80, fill: palette.softGreen, stroke: palette.green, title: 'JA TTS' });
  addArrow(svg, 680, 305, 760, 220);
  addArrow(svg, 680, 305, 760, 380);
  addBox(svg, { x: 980, y: 260, w: 160, h: 90, fill: palette.panel, stroke: palette.line, title: 'Files' });
  addArrow(svg, 940, 220, 980, 305);
  addArrow(svg, 940, 380, 980, 305);
  save(svg, 'svgs/slide_08_render_tts.svg');
}

// Slide 9: Observability panel
function slide9() {
  const { svg } = createSvg();
  svg.append('rect').attr('x', 120).attr('y', 120).attr('width', 960).attr('height', 420).attr('rx', 18).attr('fill', palette.panel).attr('stroke', palette.line).attr('stroke-width', 2);
  addBox(svg, { x: 160, y: 170, w: 420, h: 300, fill: palette.softGray, stroke: palette.line, title: 'Prompt' });
  addBox(svg, { x: 620, y: 170, w: 420, h: 300, fill: palette.softBlue, stroke: palette.blue, title: 'LLM Output' });
  save(svg, 'svgs/slide_09_observability.svg');
}

// Slide 10: Coverage vs gaps
function slide10() {
  const { svg } = createSvg();
  const rows = [
    { label: '模块化', ok: true },
    { label: '输出校验', ok: true },
    { label: '安全约束', ok: true },
    { label: '评测回归', ok: false },
    { label: '版本化', ok: false },
  ];
  rows.forEach((row, i) => {
    const y = 160 + i * 90;
    addBox(svg, { x: 180, y, w: 540, h: 70, fill: palette.panel, stroke: palette.line, title: row.label, align: 'left' });
    svg.append('circle').attr('cx', 760).attr('cy', y + 35).attr('r', 16).attr('fill', row.ok ? palette.green : palette.orange);
    svg.append('text').attr('x', 760).attr('y', y + 40).attr('text-anchor', 'middle').attr('font-size', 14).attr('fill', '#fff').attr('font-family', 'Arial, sans-serif').text(row.ok ? '✓' : '!');
  });
  save(svg, 'svgs/slide_10_coverage.svg');
}

// Slide 11: Golden practices roadmap
function slide11() {
  const { svg } = createSvg();
  const steps = ['Versioning', 'Regression', 'Retry', 'Token Budget', 'A/B'];
  const startX = 140;
  const y = 320;
  svg.append('line').attr('x1', startX).attr('y1', y).attr('x2', 1060).attr('y2', y).attr('stroke', palette.line).attr('stroke-width', 3);
  steps.forEach((label, i) => {
    const x = startX + i * 230;
    svg.append('circle').attr('cx', x).attr('cy', y).attr('r', 16).attr('fill', palette.softBlue).attr('stroke', palette.blue).attr('stroke-width', 2);
    svg.append('text').attr('x', x).attr('y', y - 28).attr('text-anchor', 'middle').attr('font-size', 12).attr('fill', palette.ink).attr('font-family', 'Arial, sans-serif').text(label);
  });
  save(svg, 'svgs/slide_11_roadmap.svg');
}

// Slide 12: Evaluation pipeline
function slide12() {
  const { svg } = createSvg();
  const labels = ['评测集', '自动执行', '指标计算', '报告'];
  labels.forEach((label, i) => {
    addBox(svg, { x: 140 + i * 250, y: 260, w: 200, h: 90, fill: palette.softGray, stroke: palette.line, title: label });
    if (i < labels.length - 1) {
      addArrow(svg, 340 + i * 250, 305, 140 + (i + 1) * 250, 305);
    }
  });
  save(svg, 'svgs/slide_12_eval_pipeline.svg');
}

// Slide 13: Dynamic injection
function slide13() {
  const { svg } = createSvg();
  addBox(svg, { x: 120, y: 120, w: 220, h: 80, fill: palette.softGray, stroke: palette.line, title: '输入' });
  addBox(svg, { x: 120, y: 260, w: 220, h: 80, fill: palette.softBlue, stroke: palette.blue, title: '语言检测' });
  addArrow(svg, 230, 200, 230, 260);
  addBox(svg, { x: 420, y: 220, w: 240, h: 80, fill: palette.softOrange, stroke: palette.orange, title: '注入规则' });
  addArrow(svg, 340, 300, 420, 260);
  addBox(svg, { x: 760, y: 220, w: 220, h: 80, fill: palette.softGreen, stroke: palette.green, title: '输出' });
  addArrow(svg, 660, 260, 760, 260);
  save(svg, 'svgs/slide_13_dynamic_injection.svg');
}

// Slide 14: Schema loop
function slide14() {
  const { svg } = createSvg();
  addBox(svg, { x: 240, y: 220, w: 240, h: 90, fill: palette.softBlue, stroke: palette.blue, title: 'JSON Schema' });
  addBox(svg, { x: 720, y: 220, w: 240, h: 90, fill: palette.softPurple, stroke: palette.purple, title: 'Validator' });
  addArrow(svg, 480, 265, 720, 265);
  svg.append('path')
    .attr('d', 'M720,320 C680,420 520,420 480,320')
    .attr('fill', 'none')
    .attr('stroke', palette.line)
    .attr('stroke-width', 2)
    .attr('marker-end', 'url(#arrow)');
  svg.append('text').attr('x', 600).attr('y', 400).attr('text-anchor', 'middle').attr('font-size', 12).attr('fill', palette.muted).attr('font-family', 'Arial, sans-serif').text('Self-correction');
  save(svg, 'svgs/slide_14_schema_loop.svg');
}

// Slide 15: Knowledge graph
function slide15() {
  const { svg } = createSvg();
  const nodes = [
    { x: 300, y: 200 },
    { x: 420, y: 140 },
    { x: 520, y: 240 },
    { x: 660, y: 180 },
    { x: 760, y: 260 },
    { x: 540, y: 360 },
  ];
  const links = [
    [0,1],[1,2],[2,3],[3,4],[2,5],[0,2],[1,3],[3,5]
  ];
  links.forEach(([a,b]) => {
    svg.append('line').attr('x1', nodes[a].x).attr('y1', nodes[a].y).attr('x2', nodes[b].x).attr('y2', nodes[b].y).attr('stroke', palette.line).attr('stroke-width', 2);
  });
  nodes.forEach((n) => {
    svg.append('circle').attr('cx', n.x).attr('cy', n.y).attr('r', 14).attr('fill', palette.softBlue).attr('stroke', palette.blue).attr('stroke-width', 2);
  });
  save(svg, 'svgs/slide_15_knowledge_graph.svg');
}

// Slide 16: Cost bar chart
function slide16() {
  const { svg } = createSvg();
  const data = [
    { label: '文本生成', value: 0.00078, color: palette.blue },
    { label: 'OCR+生成', value: 0.00089, color: palette.orange },
  ];
  const max = d3.max(data, d => d.value);
  const chartX = 240;
  const chartY = 140;
  const chartW = 720;
  const chartH = 360;
  svg.append('rect').attr('x', chartX).attr('y', chartY).attr('width', chartW).attr('height', chartH).attr('fill', palette.panel).attr('stroke', palette.line).attr('stroke-width', 2).attr('rx', 12);
  data.forEach((d, i) => {
    const barW = 180;
    const gap = 160;
    const x = chartX + 120 + i * (barW + gap);
    const h = (d.value / max) * 220;
    const y = chartY + chartH - 60 - h;
    svg.append('rect').attr('x', x).attr('y', y).attr('width', barW).attr('height', h).attr('fill', d.color).attr('rx', 8);
    svg.append('text').attr('x', x + barW / 2).attr('y', chartY + chartH - 30).attr('text-anchor', 'middle').attr('font-size', 12).attr('fill', palette.ink).attr('font-family', 'Arial, sans-serif').text(d.label);
    svg.append('text').attr('x', x + barW / 2).attr('y', y - 10).attr('text-anchor', 'middle').attr('font-size', 12).attr('fill', palette.muted).attr('font-family', 'Arial, sans-serif').text(d.value.toFixed(6));
  });
  save(svg, 'svgs/slide_16_cost_bar.svg');
}

// Slide 17: Summary staircase
function slide17() {
  const { svg } = createSvg();
  const steps = [
    { label: '模块化', x: 180, y: 360 },
    { label: '强契约', x: 380, y: 300 },
    { label: '可观测', x: 580, y: 240 },
  ];
  steps.forEach((s, i) => {
    addBox(svg, { x: s.x, y: s.y, w: 180, h: 80, fill: palette.softBlue, stroke: palette.blue, title: s.label });
    if (i < steps.length - 1) {
      addArrow(svg, s.x + 180, s.y + 40, steps[i + 1].x, steps[i + 1].y + 40);
    }
  });
  addBox(svg, { x: 820, y: 180, w: 200, h: 90, fill: palette.softGreen, stroke: palette.green, title: '智能闭环' });
  addArrow(svg, 760, 280, 820, 225);
  save(svg, 'svgs/slide_17_summary_steps.svg');
}

// Slide 18: Q&A
function slide18() {
  const { svg } = createSvg();
  svg.append('rect').attr('x', 90).attr('y', 120).attr('width', 1020).attr('height', 430).attr('rx', 20).attr('fill', palette.panel).attr('stroke', palette.softGray).attr('stroke-width', 2);
  svg.append('text').attr('x', WIDTH / 2).attr('y', HEIGHT / 2).attr('text-anchor', 'middle').attr('font-size', 54).attr('font-weight', 700).attr('fill', palette.ink).attr('font-family', 'Arial, sans-serif').text('Q&A');
  save(svg, 'svgs/slide_18_qa.svg');
}

function main() {
  slide1();
  slide2();
  slide3();
  slide4();
  slide5();
  slide6();
  slide7();
  slide8();
  slide9();
  slide10();
  slide11();
  slide12();
  slide13();
  slide14();
  slide15();
  slide16();
  slide17();
  slide18();
}

main();
