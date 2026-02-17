import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as d3 from 'd3';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outputDir = path.join(repoRoot, 'Docs', 'assets', 'slides_charts', 'ja');
const outputFile = path.join(outputDir, 'slide_kpi_framework_brief_ja.svg');

fs.mkdirSync(outputDir, { recursive: true });

const W = 1600;
const H = 900;
const dom = new JSDOM('<!doctype html><body></body>');

const svg = d3
  .select(dom.window.document.body)
  .append('svg')
  .attr('xmlns', 'http://www.w3.org/2000/svg')
  .attr('width', W)
  .attr('height', H)
  .style('background', '#f8fafc')
  .style('font-family', "'Yu Gothic','Hiragino Kaku Gothic ProN','Meiryo',sans-serif");

svg
  .append('rect')
  .attr('x', 18)
  .attr('y', 18)
  .attr('width', W - 36)
  .attr('height', H - 36)
  .attr('rx', 22)
  .attr('fill', '#ffffff')
  .attr('stroke', '#dbe3ee');

svg
  .append('text')
  .attr('x', 56)
  .attr('y', 78)
  .attr('font-size', 48)
  .attr('font-weight', 800)
  .attr('fill', '#0f172a')
  .text('実験評価フレーム（簡潔版）');

svg
  .append('text')
  .attr('x', 56)
  .attr('y', 118)
  .attr('font-size', 23)
  .attr('fill', '#475569')
  .text('Primary / Constraints / Efficiency / Statistics を同時に確認');

const cards = [
  {
    x: 70,
    y: 170,
    w: 720,
    h: 300,
    fill: '#dbeafe',
    stroke: '#2563eb',
    badge: '1',
    title: 'Primary（主要指標）',
    metrics: [
      { name: 'Quality Score', role: '出力品質の総合評価' },
      { name: 'Success Rate', role: '生成成功の安定性評価' }
    ]
  },
  {
    x: 810,
    y: 170,
    w: 720,
    h: 300,
    fill: '#ffedd5',
    stroke: '#ea580c',
    badge: '2',
    title: 'Constraints（制約指標）',
    metrics: [
      { name: 'Avg Tokens', role: '推論コストの管理指標' },
      { name: 'Latency', role: '待ち時間と応答性の管理' }
    ]
  },
  {
    x: 70,
    y: 490,
    w: 720,
    h: 300,
    fill: '#dcfce7',
    stroke: '#16a34a',
    badge: '3',
    title: 'Efficiency（効率指標）',
    metrics: [
      { name: 'Gain per 1k Tokens', role: '追加1k token当たりの品質改善効率' }
    ]
  },
  {
    x: 810,
    y: 490,
    w: 720,
    h: 300,
    fill: '#ede9fe',
    stroke: '#7c3aed',
    badge: '4',
    title: 'Statistics（統計指標）',
    metrics: [
      { name: 'p-value', role: '改善が偶然かどうかを判定' },
      { name: "Cohen's d", role: '改善幅の実務的な大きさを評価' }
    ]
  }
];

cards.forEach((card) => {
  svg
    .append('rect')
    .attr('x', card.x)
    .attr('y', card.y)
    .attr('width', card.w)
    .attr('height', card.h)
    .attr('rx', 18)
    .attr('fill', card.fill)
    .attr('stroke', card.stroke)
    .attr('stroke-width', 2.4);

  svg
    .append('circle')
    .attr('cx', card.x + 46)
    .attr('cy', card.y + 52)
    .attr('r', 23)
    .attr('fill', '#0f172a');

  svg
    .append('text')
    .attr('x', card.x + 46)
    .attr('y', card.y + 60)
    .attr('text-anchor', 'middle')
    .attr('font-size', 26)
    .attr('font-weight', 800)
    .attr('fill', '#ffffff')
    .text(card.badge);

  svg
    .append('text')
    .attr('x', card.x + 86)
    .attr('y', card.y + 60)
    .attr('font-size', 34)
    .attr('font-weight', 800)
    .attr('fill', '#0f172a')
    .text(card.title);

  const rows = card.metrics || [];
  const rowStartY = card.y + 96;
  const rowGap = rows.length > 1 ? 92 : 0;

  rows.forEach((row, idx) => {
    const rowY = rowStartY + idx * rowGap;

    svg
      .append('rect')
      .attr('x', card.x + 34)
      .attr('y', rowY)
      .attr('width', card.w - 68)
      .attr('height', 78)
      .attr('rx', 12)
      .attr('fill', '#ffffff')
      .attr('stroke', card.stroke)
      .attr('stroke-width', 1.2)
      .attr('opacity', 0.9);

    svg
      .append('text')
      .attr('x', card.x + 54)
      .attr('y', rowY + 34)
      .attr('font-size', 30)
      .attr('font-weight', 800)
      .attr('fill', '#0f172a')
      .text(row.name);

    svg
      .append('text')
      .attr('x', card.x + 54)
      .attr('y', rowY + 62)
      .attr('font-size', 22)
      .attr('font-weight', 500)
      .attr('fill', '#334155')
      .text(`役割: ${row.role}`);
  });
});

svg
  .append('text')
  .attr('x', 56)
  .attr('y', 860)
  .attr('font-size', 17)
  .attr('fill', '#64748b')
  .text('用途: Few-shot / Prompt改善の評価基準を1枚で共有（PPTX向け）');

fs.writeFileSync(outputFile, dom.window.document.body.innerHTML, 'utf8');
console.log(`Generated: ${outputFile}`);
