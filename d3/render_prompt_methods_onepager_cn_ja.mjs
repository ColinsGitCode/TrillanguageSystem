import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as d3 from 'd3';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outputDir = path.join(repoRoot, 'Docs', 'TestDocs', 'charts');
fs.mkdirSync(outputDir, { recursive: true });

function renderOnePager({ filename, title, subtitle, footer, cards, fontFamily = 'sans-serif' }) {
  const dom = new JSDOM('<!doctype html><body></body>');
  const svg = d3
    .select(dom.window.document.body)
    .append('svg')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('width', 1600)
    .attr('height', 900)
    .style('background', '#f8fafc')
    .style('font-family', fontFamily);

  svg
    .append('rect')
    .attr('x', 18)
    .attr('y', 18)
    .attr('width', 1564)
    .attr('height', 864)
    .attr('rx', 20)
    .attr('fill', '#ffffff')
    .attr('stroke', '#e2e8f0');

  svg
    .append('text')
    .attr('x', 56)
    .attr('y', 78)
    .attr('font-size', 46)
    .attr('font-weight', 800)
    .attr('fill', '#0f172a')
    .text(title);

  svg
    .append('text')
    .attr('x', 56)
    .attr('y', 114)
    .attr('font-size', 22)
    .attr('fill', '#475569')
    .text(subtitle);

  cards.forEach((c) => {
    svg
      .append('rect')
      .attr('x', c.x)
      .attr('y', c.y)
      .attr('width', c.w)
      .attr('height', c.h)
      .attr('rx', 16)
      .attr('fill', c.fill)
      .attr('stroke', c.stroke)
      .attr('stroke-width', 2.6);

    svg
      .append('circle')
      .attr('cx', c.x + 48)
      .attr('cy', c.y + 52)
      .attr('r', 24)
      .attr('fill', '#0f172a');

    svg
      .append('text')
      .attr('x', c.x + 48)
      .attr('y', c.y + 60)
      .attr('text-anchor', 'middle')
      .attr('font-size', 25)
      .attr('font-weight', 800)
      .attr('fill', '#ffffff')
      .text(c.badge);

    svg
      .append('text')
      .attr('x', c.x + 84)
      .attr('y', c.y + 60)
      .attr('font-size', 34)
      .attr('font-weight', 800)
      .attr('fill', '#0f172a')
      .text(c.title);

    c.lines.forEach((line, i) => {
      svg
        .append('text')
        .attr('x', c.x + 40)
        .attr('y', c.y + 124 + i * 54)
        .attr('font-size', 24)
        .attr('fill', '#1e293b')
        .text(`- ${line}`);
    });
  });

  svg
    .append('text')
    .attr('x', 56)
    .attr('y', 860)
    .attr('font-size', 16)
    .attr('fill', '#64748b')
    .text(footer);

  const outputFile = path.join(outputDir, filename);
  fs.writeFileSync(outputFile, dom.window.document.body.innerHTML, 'utf8');
  console.log(`Generated: ${outputFile}`);
}

const baseCards = [
  { x: 68, y: 170, w: 710, h: 300, fill: '#e0f2fe', stroke: '#0284c7', badge: '1' },
  { x: 822, y: 170, w: 710, h: 300, fill: '#ede9fe', stroke: '#7c3aed', badge: '2' },
  { x: 68, y: 510, w: 710, h: 300, fill: '#dcfce7', stroke: '#16a34a', badge: '3' },
  { x: 822, y: 510, w: 710, h: 300, fill: '#ffedd5', stroke: '#ea580c', badge: '4' }
];

renderOnePager({
  filename: 'slide_prompt_methods_1_2_3_6_cn.svg',
  title: 'Code as Prompt：精度提升四项机制',
  subtitle: '选择项：1 / 2 / 3 / 4（简洁版）',
  footer: 'One-page summary for this project',
  fontFamily: "'PingFang SC','Microsoft YaHei','Noto Sans SC',sans-serif",
  cards: [
    {
      ...baseCards[0],
      title: 'Schema优先约束',
      lines: ['先定义输出结构与必填字段', '校验失败自动修复重试', '提升格式稳定与解析成功率']
    },
    {
      ...baseCards[1],
      title: '规则包注入',
      lines: ['业务规则模块化、版本化', '按场景装配（文本/OCR/对比）', '减少规则漂移与回归']
    },
    {
      ...baseCards[2],
      title: '两阶段生成',
      lines: ['草稿生成 -> 校验 -> 定点修复', '覆盖准确性/完整性/格式', '降低语义错误率']
    },
    {
      ...baseCards[3],
      title: '任务路由Prompt',
      lines: ['按任务类型切换Prompt模板', '噪声OCR/术语/口语分治', '提高首轮命中率']
    }
  ]
});

renderOnePager({
  filename: 'slide_prompt_methods_1_2_3_6_ja.svg',
  title: 'Code as Prompt：精度向上の4施策',
  subtitle: '対象：1 / 2 / 3 / 4（簡潔版）',
  footer: 'One-page summary for this project',
  fontFamily: "'Yu Gothic','Hiragino Kaku Gothic ProN','Meiryo',sans-serif",
  cards: [
    {
      ...baseCards[0],
      title: 'Schema先行制約',
      lines: ['出力構造と必須項目を先に固定', '不整合は自動修復で再試行', '形式安定性と解析成功率を改善']
    },
    {
      ...baseCards[1],
      title: 'Rule Pack注入',
      lines: ['業務ルールをモジュール化・版管理', 'テキスト/OCR/比較で切替適用', 'ルール逸脱と回帰を抑制']
    },
    {
      ...baseCards[2],
      title: '2段階生成',
      lines: ['草案生成 -> 検証 -> ピンポイント修正', '正確性/完全性/形式を検査', '意味エラー発生率を低減']
    },
    {
      ...baseCards[3],
      title: 'タスク別Promptルーティング',
      lines: ['入力タイプごとにPromptを切替', 'ノイズOCR/専門用語/口語を分治', '初回品質ヒット率を向上']
    }
  ]
});
