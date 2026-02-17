import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as d3 from 'd3';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outDir = path.join(repoRoot, 'Docs', 'assets', 'slides_charts', 'ja');
const outFile = path.join(outDir, 'slide_04e_code_as_prompt_system_landing_ja.svg');

const W = 1280;
const H = 720;
const FONT = "'Yu Gothic','YuGothic','Hiragino Kaku Gothic ProN','Meiryo',sans-serif";

fs.mkdirSync(outDir, { recursive: true });

const dom = new JSDOM('<!doctype html><html><body></body></html>');
const svg = d3
  .select(dom.window.document.body)
  .append('svg')
  .attr('xmlns', 'http://www.w3.org/2000/svg')
  .attr('width', W)
  .attr('height', H)
  .style('background', '#F3F6FB');

const defs = svg.append('defs');
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
  .attr('stdDeviation', 2)
  .attr('flood-color', '#0F172A')
  .attr('flood-opacity', 0.12);

defs
  .append('marker')
  .attr('id', 'arrowDown')
  .attr('viewBox', '0 0 10 10')
  .attr('refX', 5)
  .attr('refY', 5)
  .attr('markerWidth', 7)
  .attr('markerHeight', 7)
  .attr('orient', 'auto')
  .append('path')
  .attr('d', 'M0,0 L10,5 L0,10 z')
  .attr('fill', '#64748B');

svg
  .append('rect')
  .attr('x', 14)
  .attr('y', 14)
  .attr('width', W - 28)
  .attr('height', H - 28)
  .attr('rx', 18)
  .attr('fill', '#FFFFFF')
  .attr('stroke', '#D9E2EC');

svg
  .append('text')
  .attr('x', 44)
  .attr('y', 60)
  .attr('font-family', FONT)
  .attr('font-size', 40)
  .attr('font-weight', 800)
  .attr('fill', '#1F2937')
  .text('Code as Prompt 実装マップ（本システム）');

svg
  .append('text')
  .attr('x', 44)
  .attr('y', 90)
  .attr('font-family', FONT)
  .attr('font-size', 18)
  .attr('fill', '#5B6475')
  .text('7つの仕組みを「設計 → 制御 → 運用」で接続');

function addSection({ x, y, w, h, title, color, fill }) {
  svg
    .append('rect')
    .attr('x', x)
    .attr('y', y)
    .attr('width', w)
    .attr('height', h)
    .attr('rx', 14)
    .attr('fill', fill)
    .attr('stroke', color)
    .attr('stroke-width', 1.8);

  svg
    .append('text')
    .attr('x', x + 16)
    .attr('y', y + 30)
    .attr('font-family', FONT)
    .attr('font-size', 20)
    .attr('font-weight', 800)
    .attr('fill', color)
    .text(title);
}

function addNode({
  x,
  y,
  w,
  h,
  n,
  title,
  detail,
  fill,
  stroke,
  numberFill,
  titleWeight = 800,
  detailWeight = 500,
  detailColor = '#334155'
}) {
  svg
    .append('rect')
    .attr('x', x)
    .attr('y', y)
    .attr('width', w)
    .attr('height', h)
    .attr('rx', 12)
    .attr('fill', fill)
    .attr('stroke', stroke)
    .attr('stroke-width', 1.8)
    .attr('filter', 'url(#softShadow)');

  svg
    .append('circle')
    .attr('cx', x + 24)
    .attr('cy', y + 24)
    .attr('r', 14)
    .attr('fill', numberFill)
    .attr('stroke', stroke)
    .attr('stroke-width', 1.4);

  svg
    .append('text')
    .attr('x', x + 24)
    .attr('y', y + 29)
    .attr('text-anchor', 'middle')
    .attr('font-family', FONT)
    .attr('font-size', 16)
    .attr('font-weight', 800)
    .attr('fill', '#FFFFFF')
    .text(String(n));

  svg
    .append('text')
    .attr('x', x + 48)
    .attr('y', y + 29)
    .attr('font-family', FONT)
    .attr('font-size', 18)
    .attr('font-weight', titleWeight)
    .attr('fill', '#1F2937')
    .text(title);

  svg
    .append('text')
    .attr('x', x + 20)
    .attr('y', y + 58)
    .attr('font-family', FONT)
    .attr('font-size', 15)
    .attr('font-weight', detailWeight)
    .attr('fill', detailColor)
    .text(detail);
}

addSection({
  x: 44,
  y: 122,
  w: 1192,
  h: 156,
  title: '設計層',
  color: '#2563EB',
  fill: '#EEF4FF'
});

addSection({
  x: 44,
  y: 300,
  w: 1192,
  h: 132,
  title: '制御層',
  color: '#EA580C',
  fill: '#FFF4EC'
});

addSection({
  x: 44,
  y: 454,
  w: 1192,
  h: 180,
  title: '運用層',
  color: '#16A34A',
  fill: '#ECFDF3'
});

addNode({
  x: 64,
  y: 166,
  w: 360,
  h: 92,
  n: 1,
  title: 'テンプレ資産化',
  detail: '出力仕様を部品化',
  fill: '#FFFFFF',
  stroke: '#3B82F6',
  numberFill: '#2563EB'
});

addNode({
  x: 448,
  y: 166,
  w: 360,
  h: 92,
  n: 2,
  title: '実行時組立',
  detail: 'mode別に Prompt 構成',
  fill: '#FFFFFF',
  stroke: '#3B82F6',
  numberFill: '#2563EB'
});

addNode({
  x: 832,
  y: 166,
  w: 384,
  h: 92,
  n: 3,
  title: 'few-shot 注入（核心）',
  detail: 'DEMOで品質向上の主手段',
  fill: '#FCE7F3',
  stroke: '#EC4899',
  numberFill: '#DB2777',
  titleWeight: 900,
  detailWeight: 800,
  detailColor: '#9D174D'
});

addNode({
  x: 122,
  y: 334,
  w: 500,
  h: 78,
  n: 4,
  title: '予算ガード',
  detail: '超過時は段階回退',
  fill: '#FFFFFF',
  stroke: '#FB923C',
  numberFill: '#EA580C'
});

addNode({
  x: 646,
  y: 334,
  w: 500,
  h: 78,
  n: 5,
  title: '後処理ルール',
  detail: '音声用テキストを整形',
  fill: '#FFFFFF',
  stroke: '#FB923C',
  numberFill: '#EA580C'
});

addNode({
  x: 122,
  y: 490,
  w: 500,
  h: 118,
  n: 6,
  title: '観測・評価',
  detail: 'Prompt / Output / 品質を可視化',
  fill: '#FFFFFF',
  stroke: '#22C55E',
  numberFill: '#16A34A'
});

addNode({
  x: 646,
  y: 490,
  w: 500,
  h: 118,
  n: 7,
  title: '実験ループ',
  detail: 'round単位で改善を再現',
  fill: '#FFFFFF',
  stroke: '#22C55E',
  numberFill: '#16A34A'
});

svg
  .append('line')
  .attr('x1', 640)
  .attr('y1', 278)
  .attr('x2', 640)
  .attr('y2', 300)
  .attr('stroke', '#64748B')
  .attr('stroke-width', 1.8)
  .attr('marker-end', 'url(#arrowDown)');

svg
  .append('line')
  .attr('x1', 640)
  .attr('y1', 432)
  .attr('x2', 640)
  .attr('y2', 454)
  .attr('stroke', '#64748B')
  .attr('stroke-width', 1.8)
  .attr('marker-end', 'url(#arrowDown)');

svg
  .append('text')
  .attr('x', 44)
  .attr('y', 690)
  .attr('font-family', FONT)
  .attr('font-size', 12)
  .attr('fill', '#64748B')
  .text('Source: promptEngine / server pipeline / goldenExamples / observability / experiment tables');

fs.writeFileSync(outFile, dom.window.document.body.innerHTML, 'utf8');
console.log(`Generated: ${outFile}`);
