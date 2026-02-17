import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as d3 from 'd3';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outputDir = path.join(repoRoot, 'Docs', 'TestDocs', 'charts');
const outputFile = path.join(outputDir, 'slide_prompt_methods_1_2_3_6.svg');

fs.mkdirSync(outputDir, { recursive: true });

const dom = new JSDOM('<!doctype html><body></body>');
const svg = d3
  .select(dom.window.document.body)
  .append('svg')
  .attr('xmlns', 'http://www.w3.org/2000/svg')
  .attr('width', 1600)
  .attr('height', 900)
  .style('background', '#f8fafc');

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
  .text('Code as Prompt: Precision Uplift Toolkit');

svg
  .append('text')
  .attr('x', 56)
  .attr('y', 114)
  .attr('font-size', 22)
  .attr('fill', '#475569')
  .text('Selected mechanisms: #1 #2 #3 #4');

const cards = [
  {
    x: 68,
    y: 170,
    w: 710,
    h: 300,
    fill: '#e0f2fe',
    stroke: '#0284c7',
    badge: '1',
    title: 'Schema-first Output Constraints',
    lines: [
      'Define strict JSON/Markdown contracts before generation.',
      'Validate structure/fields/regex; auto-repair on failure.',
      'Direct gain: format stability and parse success rate.'
    ]
  },
  {
    x: 822,
    y: 170,
    w: 710,
    h: 300,
    fill: '#ede9fe',
    stroke: '#7c3aed',
    badge: '2',
    title: 'Rule Pack Injection',
    lines: [
      'Package business rules into versioned prompt modules.',
      'Load by scenario (text / OCR / compare mode).',
      'Direct gain: rule consistency and lower policy regressions.'
    ]
  },
  {
    x: 68,
    y: 510,
    w: 710,
    h: 300,
    fill: '#dcfce7',
    stroke: '#16a34a',
    badge: '3',
    title: 'Draft -> Verify -> Fix',
    lines: [
      'Two-pass generation: first draft, then targeted verification.',
      'Verifier checks quality dimensions and hard constraints.',
      'Direct gain: fewer semantic errors with controlled retries.'
    ]
  },
  {
    x: 822,
    y: 510,
    w: 710,
    h: 300,
    fill: '#ffedd5',
    stroke: '#ea580c',
    badge: '4',
    title: 'Task-routed Prompt Assembly',
    lines: [
      'Route to prompt templates by task type and risk profile.',
      'Examples: OCR noisy input, technical terms, colloquial phrases.',
      'Direct gain: better task-model fit and higher first-pass quality.'
    ]
  }
];

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
  .text('Slide-ready one-page summary for prompt precision mechanisms in this project');

fs.writeFileSync(outputFile, dom.window.document.body.innerHTML, 'utf8');
console.log(`Generated: ${outputFile}`);
