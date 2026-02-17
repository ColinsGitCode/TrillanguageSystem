import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as d3 from 'd3';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outDir = path.join(repoRoot, 'Docs', 'assets', 'slides_charts', 'ja');
const outFile = path.join(outDir, 'slide_05_fewshot_budget_flow_ja.svg');

const W = 1280;
const H = 720;
const FONT = "'Yu Gothic','YuGothic','Hiragino Kaku Gothic ProN','Meiryo',sans-serif";
const STROKE = '#2F9BB2';
const FILL = '#F8FCFD';
const TEXT = '#1F2937';

fs.mkdirSync(outDir, { recursive: true });

const dom = new JSDOM('<!doctype html><html><body></body></html>');
const svg = d3
  .select(dom.window.document.body)
  .append('svg')
  .attr('xmlns', 'http://www.w3.org/2000/svg')
  .attr('width', W)
  .attr('height', H)
  .style('background', '#FFFFFF');

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
  .attr('fill', STROKE);

svg
  .append('text')
  .attr('x', 40)
  .attr('y', 56)
  .attr('font-family', FONT)
  .attr('font-size', 34)
  .attr('font-weight', 800)
  .attr('fill', TEXT)
  .text('few-shot注入と予算フォールバック');

svg
  .append('text')
  .attr('x', 40)
  .attr('y', 86)
  .attr('font-family', FONT)
  .attr('font-size', 16)
  .attr('fill', '#64748B')
  .text('目的：予算制御を維持しつつ生成品質を向上');

function drawRectNode({ x, y, w, h, label, sub = '' }) {
  svg
    .append('rect')
    .attr('x', x)
    .attr('y', y)
    .attr('width', w)
    .attr('height', h)
    .attr('rx', 12)
    .attr('fill', FILL)
    .attr('stroke', STROKE)
    .attr('stroke-width', 3);

  svg
    .append('text')
    .attr('x', x + w / 2)
    .attr('y', y + (sub ? 34 : 42))
    .attr('text-anchor', 'middle')
    .attr('font-family', FONT)
    .attr('font-size', 40 / 2)
    .attr('font-weight', 700)
    .attr('fill', TEXT)
    .text(label);

  if (sub) {
    svg
      .append('text')
      .attr('x', x + w / 2)
      .attr('y', y + 62)
      .attr('text-anchor', 'middle')
      .attr('font-family', FONT)
      .attr('font-size', 16)
      .attr('fill', '#334155')
      .text(sub);
  }
}

function drawArrow(x1, y1, x2, y2, label = '') {
  svg
    .append('line')
    .attr('x1', x1)
    .attr('y1', y1)
    .attr('x2', x2)
    .attr('y2', y2)
    .attr('stroke', STROKE)
    .attr('stroke-width', 2.6)
    .attr('marker-end', 'url(#arrow)');

  if (label) {
    svg
      .append('text')
      .attr('x', (x1 + x2) / 2)
      .attr('y', (y1 + y2) / 2 - 8)
      .attr('text-anchor', 'middle')
      .attr('font-family', FONT)
      .attr('font-size', 18)
      .attr('font-weight', 700)
      .attr('fill', TEXT)
      .text(label);
  }
}

function drawDiamond({ cx, cy, w, h, labelTop, labelBottom }) {
  const points = [
    [cx, cy - h / 2],
    [cx + w / 2, cy],
    [cx, cy + h / 2],
    [cx - w / 2, cy]
  ];

  svg
    .append('polygon')
    .attr('points', points.map((p) => p.join(',')).join(' '))
    .attr('fill', FILL)
    .attr('stroke', STROKE)
    .attr('stroke-width', 3);

  svg
    .append('text')
    .attr('x', cx)
    .attr('y', cy - 8)
    .attr('text-anchor', 'middle')
    .attr('font-family', FONT)
    .attr('font-size', 34 / 2)
    .attr('font-weight', 700)
    .attr('fill', TEXT)
    .text(labelTop);

  svg
    .append('text')
    .attr('x', cx)
    .attr('y', cy + 22)
    .attr('text-anchor', 'middle')
    .attr('font-family', FONT)
    .attr('font-size', 34 / 2)
    .attr('font-weight', 700)
    .attr('fill', TEXT)
    .text(labelBottom);
}

drawRectNode({ x: 40, y: 190, w: 200, h: 82, label: '入力語句' });
drawRectNode({ x: 290, y: 190, w: 230, h: 82, label: '例示検索', sub: 'teacher生成例示を優先' });
drawRectNode({ x: 560, y: 190, w: 220, h: 82, label: '品質選別', sub: 'score>=85・類似度上位' });
drawDiamond({ cx: 900, cy: 230, w: 200, h: 150, labelTop: '予算', labelBottom: '通過判定' });
drawRectNode({ x: 1060, y: 190, w: 180, h: 82, label: '注入実行' });

drawRectNode({ x: 770, y: 340, w: 260, h: 92, label: '例示数削減', sub: 'budget_reduction' });
drawRectNode({ x: 770, y: 470, w: 260, h: 92, label: '内容切り詰め', sub: 'budget_truncate' });
drawRectNode({ x: 710, y: 600, w: 380, h: 92, label: '注入停止＋基線回帰', sub: 'budget_exceeded_disable' });

drawArrow(240, 231, 290, 231);
drawArrow(520, 231, 560, 231);
drawArrow(780, 231, 800, 231);
drawArrow(1000, 231, 1060, 231, 'Yes');
drawArrow(900, 305, 900, 340, 'No');
drawArrow(900, 432, 900, 470);
drawArrow(900, 562, 900, 600);

// 左下：品质筛选标准（简要）
svg
  .append('rect')
  .attr('x', 40)
  .attr('y', 336)
  .attr('width', 620)
  .attr('height', 336)
  .attr('rx', 12)
  .attr('fill', '#FFFBEB')
  .attr('stroke', '#EAB308')
  .attr('stroke-width', 2);

svg
  .append('text')
  .attr('x', 64)
  .attr('y', 372)
  .attr('font-family', FONT)
  .attr('font-size', 22)
  .attr('font-weight', 800)
  .attr('fill', '#92400E')
  .text('品質選別基準（簡易）');

const rules = [
  '1) quality_score >= 85（minScore）',
  '2) テンプレ完全性：三語構造・例句・audio_tasks',
  '3) 品質次元：completeness / accuracy / example / formatting',
  '4) 同点時：入力との類似度（bigram）上位を優先'
];

rules.forEach((line, idx) => {
  svg
    .append('text')
    .attr('x', 68)
    .attr('y', 416 + idx * 56)
    .attr('font-family', FONT)
    .attr('font-size', 18)
    .attr('fill', '#334155')
    .text(line);
});

svg
  .append('text')
  .attr('x', 40)
  .attr('y', 704)
  .attr('font-family', FONT)
  .attr('font-size', 12)
  .attr('fill', '#64748B')
  .text('Source: generation pipeline few-shot budget guard flow');

fs.writeFileSync(outFile, dom.window.document.body.innerHTML, 'utf8');
console.log(`Generated: ${outFile}`);
