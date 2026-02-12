import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as d3 from 'd3';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outDir = path.join(repoRoot, 'Docs', 'TestDocs', 'charts');
fs.mkdirSync(outDir, { recursive: true });

const palette = {
  text: '#1f2937',
  muted: '#64748b',
  link: '#475569',
  layerBg: '#f8fafc',
  layerBorder: '#cbd5e1',
  v1: { fill: '#e0f2fe', stroke: '#0284c7' },
  v2: { fill: '#fef3c7', stroke: '#d97706' },
  v3: { fill: '#dcfce7', stroke: '#16a34a' },
  data: { fill: '#ede9fe', stroke: '#7c3aed' },
  warn: { fill: '#fee2e2', stroke: '#dc2626' }
};

function createSvg(width, height) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const svg = d3
    .select(dom.window.document.body)
    .append('svg')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('width', width)
    .attr('height', height)
    .style('background-color', '#ffffff');

  const defs = svg.append('defs');
  defs
    .append('marker')
    .attr('id', 'arrow')
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 8)
    .attr('refY', 0)
    .attr('markerWidth', 7)
    .attr('markerHeight', 7)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0,-5L10,0L0,5')
    .attr('fill', palette.link);

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
    .attr('stdDeviation', 2.2)
    .attr('flood-color', '#0f172a')
    .attr('flood-opacity', 0.12);

  return { dom, svg };
}

function saveSvg(dom, filename) {
  fs.writeFileSync(path.join(outDir, filename), dom.window.document.body.innerHTML, 'utf8');
}

function addTitle(svg, title, subtitle) {
  svg
    .append('text')
    .attr('x', 42)
    .attr('y', 44)
    .attr('font-size', 30)
    .attr('font-weight', 800)
    .attr('fill', '#0f172a')
    .text(title);

  if (subtitle) {
    svg
      .append('text')
      .attr('x', 42)
      .attr('y', 72)
      .attr('font-size', 15)
      .attr('font-weight', 500)
      .attr('fill', palette.muted)
      .text(subtitle);
  }
}

function addWrappedText(group, x, y, lines, options = {}) {
  const {
    size = 14,
    weight = 500,
    fill = palette.text,
    lineHeight = 18
  } = options;

  const text = group
    .append('text')
    .attr('x', x)
    .attr('y', y)
    .attr('font-size', size)
    .attr('font-weight', weight)
    .attr('fill', fill);

  lines.forEach((line, index) => {
    text
      .append('tspan')
      .attr('x', x)
      .attr('dy', index === 0 ? 0 : lineHeight)
      .text(line);
  });
}

function addNode(svg, node) {
  const group = svg.append('g');
  group
    .append('rect')
    .attr('x', node.x)
    .attr('y', node.y)
    .attr('width', node.w)
    .attr('height', node.h)
    .attr('rx', node.rx || 12)
    .attr('fill', node.fill)
    .attr('stroke', node.stroke)
    .attr('stroke-width', node.strokeWidth || 2)
    .attr('filter', 'url(#softShadow)');

  addWrappedText(
    group,
    node.x + 14,
    node.y + 24,
    node.lines,
    { size: node.fontSize || 14, weight: node.fontWeight || 600, fill: node.textColor || palette.text, lineHeight: node.lineHeight || 18 }
  );
}

function addArrow(svg, from, to, label = '') {
  svg
    .append('line')
    .attr('x1', from.x)
    .attr('y1', from.y)
    .attr('x2', to.x)
    .attr('y2', to.y)
    .attr('stroke', palette.link)
    .attr('stroke-width', 1.8)
    .attr('marker-end', 'url(#arrow)');

  if (label) {
    svg
      .append('text')
      .attr('x', (from.x + to.x) / 2)
      .attr('y', (from.y + to.y) / 2 - 6)
      .attr('text-anchor', 'middle')
      .attr('font-size', 12)
      .attr('font-weight', 600)
      .attr('fill', '#334155')
      .text(label);
  }
}

function drawArchitectureDiagram() {
  const width = 1600;
  const height = 980;
  const { dom, svg } = createSvg(width, height);

  addTitle(
    svg,
    'Code-as-Prompt 机制架构图（V1 / V2 / V3）',
    'Static Template -> Programmatic Assembly -> Runtime Few-shot Injection'
  );

  const layers = [
    { x: 30, y: 100, w: 500, h: 620, title: 'V1 静态模板层', color: palette.v1 },
    { x: 550, y: 100, w: 500, h: 620, title: 'V2 程序化生成层', color: palette.v2 },
    { x: 1070, y: 100, w: 500, h: 620, title: 'V3 动态注入层', color: palette.v3 }
  ];

  layers.forEach((layer) => {
    svg
      .append('rect')
      .attr('x', layer.x)
      .attr('y', layer.y)
      .attr('width', layer.w)
      .attr('height', layer.h)
      .attr('rx', 16)
      .attr('fill', palette.layerBg)
      .attr('stroke', palette.layerBorder)
      .attr('stroke-width', 1.8)
      .attr('stroke-dasharray', '6,6');

    svg
      .append('rect')
      .attr('x', layer.x + 14)
      .attr('y', layer.y + 12)
      .attr('width', layer.w - 28)
      .attr('height', 42)
      .attr('rx', 10)
      .attr('fill', layer.color.fill)
      .attr('stroke', layer.color.stroke)
      .attr('stroke-width', 2.2);

    svg
      .append('text')
      .attr('x', layer.x + 28)
      .attr('y', layer.y + 40)
      .attr('font-size', 20)
      .attr('font-weight', 800)
      .attr('fill', '#0f172a')
      .text(layer.title);
  });

  addNode(svg, {
    x: 58, y: 185, w: 445, h: 100,
    fill: palette.v1.fill, stroke: palette.v1.stroke,
    lines: ['prompts/phrase_3LANS_markdown.md', '固定结构与字段命名规则', '占位符替换: {{ phrase }}']
  });
  addNode(svg, {
    x: 58, y: 315, w: 445, h: 100,
    fill: palette.v1.fill, stroke: palette.v1.stroke,
    lines: ['services/promptEngine.js', 'buildPrompt() strictCompactPrompt', 'JSON 输出模板 (静态规则)']
  });

  addNode(svg, {
    x: 578, y: 185, w: 445, h: 100,
    fill: palette.v2.fill, stroke: palette.v2.stroke,
    lines: ['server.js generateWithProvider()', '按 provider/mode 选择 prompt', 'buildPrompt / buildMarkdownPrompt']
  });
  addNode(svg, {
    x: 578, y: 315, w: 445, h: 110,
    fill: palette.v2.fill, stroke: palette.v2.stroke,
    lines: ['fewshotOptions 参数化配置', 'count/minScore/contextWindow/tokenBudgetRatio', '请求级实验参数注入']
  });
  addNode(svg, {
    x: 578, y: 457, w: 445, h: 110,
    fill: palette.data.fill, stroke: palette.data.stroke,
    lines: ['observability PromptParser', 'prompt 结构化解析 + token 估算', '保存 prompt/rawOutput/metadata']
  });

  addNode(svg, {
    x: 1098, y: 185, w: 445, h: 120,
    fill: palette.v3.fill, stroke: palette.v3.stroke,
    lines: ['goldenExamplesService.getRelevantExamples()', 'Teacher 优先 -> 历史高质量回退', 'bigramSimilarity 重排候选']
  });
  addNode(svg, {
    x: 1098, y: 337, w: 445, h: 110,
    fill: palette.warn.fill, stroke: palette.warn.stroke,
    lines: ['预算门控 (server.js)', 'budget_reduction / budget_truncate', 'budget_exceeded_disable']
  });
  addNode(svg, {
    x: 1098, y: 479, w: 445, h: 100,
    fill: palette.v3.fill, stroke: palette.v3.stroke,
    lines: ['buildEnhancedPrompt()', 'Few-shot 示例拼接到 basePrompt', '最终提交给 LLM']
  });

  addNode(svg, {
    x: 140, y: 760, w: 1320, h: 160,
    rx: 16,
    fill: '#eef2ff', stroke: '#4f46e5', strokeWidth: 2.6,
    fontSize: 15,
    lines: [
      '观测与实验闭环: few_shot_runs / few_shot_examples / experiment_rounds / experiment_samples / teacher_references',
      '运行脚本: scripts/run_fewshot_rounds.js -> scripts/export_round_trend_dataset.js -> 报告图表',
      '目标: Prompt 优化从“文本改写”升级为“代码重构 + 可追踪实验迭代”'
    ]
  });

  addArrow(svg, { x: 503, y: 235 }, { x: 578, y: 235 }, '模板输入');
  addArrow(svg, { x: 1023, y: 240 }, { x: 1098, y: 240 }, '运行时增强');
  addArrow(svg, { x: 800, y: 567 }, { x: 800, y: 760 }, '观测数据沉淀');
  addArrow(svg, { x: 1318, y: 579 }, { x: 1318, y: 760 }, 'few-shot 元数据');

  svg
    .append('text')
    .attr('x', 42)
    .attr('y', 955)
    .attr('font-size', 12)
    .attr('fill', palette.muted)
    .text('Source: promptEngine.js, server.js, goldenExamplesService.js, observabilityService.js');

  saveSvg(dom, 'prompt_mechanism_architecture_v1v2v3.svg');
}

function drawRuntimeFlowDiagram() {
  const width = 1600;
  const height = 1020;
  const { dom, svg } = createSvg(width, height);

  addTitle(
    svg,
    'Code-as-Prompt 运行流程图（请求到实验回归）',
    '请求驱动 -> Prompt 组装 -> Few-shot 注入 -> 预算门控 -> 观测回写'
  );

  const steps = [
    { id: 1, x: 120, y: 140, lines: ['1. API 请求进入', 'POST /api/generate', '携带 fewshot_options'], style: palette.v1 },
    { id: 2, x: 470, y: 140, lines: ['2. 选择基础 Prompt', 'buildPrompt / buildMarkdownPrompt', '按 provider/mode 分流'], style: palette.v2 },
    { id: 3, x: 820, y: 140, lines: ['3. 判断 few-shot', 'provider=local && enabled', '读取策略参数'], style: palette.v2 },
    { id: 4, x: 1170, y: 140, lines: ['4. 示例检索', 'teacher_references 优先', '历史高质量 + bigram'], style: palette.v3 },
    { id: 5, x: 1170, y: 330, lines: ['5. 预算门控', 'reduction -> truncate', '超限则 disable'], style: palette.warn },
    { id: 6, x: 820, y: 330, lines: ['6. 生成增强 Prompt', 'buildEnhancedPrompt(base, examples)', '得到最终 prompt'], style: palette.v3 },
    { id: 7, x: 470, y: 330, lines: ['7. 调用模型', 'local / gemini gateway', '获取输出 + usage'], style: palette.v2 },
    { id: 8, x: 120, y: 330, lines: ['8. 后处理与渲染', 'validate + render HTML', '抽取 audio_tasks'], style: palette.v1 },
    { id: 9, x: 120, y: 560, lines: ['9. 文件与数据库落地', 'generations + observability', 'few_shot_runs/examples'], style: palette.data },
    { id: 10, x: 470, y: 560, lines: ['10. 实验样本追踪', 'experiment_samples', 'teacher_references'], style: palette.data },
    { id: 11, x: 820, y: 560, lines: ['11. 指标导出', 'export_round_trend_dataset', 'CSV/JSON/KPI'], style: palette.data },
    { id: 12, x: 1170, y: 560, lines: ['12. 报告图表回归', 'D3 SVG + 测试报告', '形成下一轮 prompt 优化'], style: palette.v3 }
  ];

  steps.forEach((step) => {
    addNode(svg, {
      x: step.x,
      y: step.y,
      w: 300,
      h: 128,
      fill: step.style.fill,
      stroke: step.style.stroke,
      lines: step.lines,
      fontSize: 14
    });
  });

  const arrowPairs = [
    [1, 2, 'request'],
    [2, 3, 'base prompt'],
    [3, 4, 'few-shot on'],
    [4, 5, 'candidate examples'],
    [5, 6, 'budget pass'],
    [6, 7, 'enhanced prompt'],
    [7, 8, 'model output'],
    [8, 9, 'parsed content'],
    [9, 10, 'metrics'],
    [10, 11, 'experiment trend'],
    [11, 12, 'report artifacts']
  ];

  const byId = new Map(steps.map((s) => [s.id, s]));
  arrowPairs.forEach(([fromId, toId, label]) => {
    const from = byId.get(fromId);
    const to = byId.get(toId);
    if (!from || !to) return;
    let p1 = { x: from.x + 300, y: from.y + 64 };
    let p2 = { x: to.x, y: to.y + 64 };
    if (to.y > from.y) {
      p1 = { x: from.x + 150, y: from.y + 128 };
      p2 = { x: to.x + 150, y: to.y };
    }
    if (to.y === from.y && to.x < from.x) {
      p1 = { x: from.x, y: from.y + 64 };
      p2 = { x: to.x + 300, y: to.y + 64 };
    }
    addArrow(svg, p1, p2, label);
  });

  addArrow(svg, { x: 1320, y: 688 }, { x: 1320, y: 820 }, 'feedback');
  addArrow(svg, { x: 1320, y: 820 }, { x: 180, y: 820 }, '');
  addArrow(svg, { x: 180, y: 820 }, { x: 180, y: 268 }, 'next round');

  svg
    .append('rect')
    .attr('x', 80)
    .attr('y', 860)
    .attr('width', 1440)
    .attr('height', 120)
    .attr('rx', 14)
    .attr('fill', '#f8fafc')
    .attr('stroke', '#94a3b8')
    .attr('stroke-width', 1.8);

  addWrappedText(svg, 110, 900, [
    '关键控制点: few-shot 仅在 local provider 启用；teacher 样本优先；预算超限会自动降级/禁用，保证请求可用性。',
    '关键输出: prompt/full/rawOutput/fewShotMeta 全量入库，可直接用于统计检验与版本回归。'
  ], { size: 15, weight: 600, fill: '#334155', lineHeight: 28 });

  svg
    .append('text')
    .attr('x', 42)
    .attr('y', 1000)
    .attr('font-size', 12)
    .attr('fill', palette.muted)
    .text('Source: server.js (generateWithProvider), goldenExamplesService.js, fewShotMetricsService.js, experimentTrackingService.js');

  saveSvg(dom, 'prompt_mechanism_runtime_flow.svg');
}

drawArchitectureDiagram();
drawRuntimeFlowDiagram();

console.log('[prompt-diagrams] generated:');
console.log('- Docs/TestDocs/charts/prompt_mechanism_architecture_v1v2v3.svg');
console.log('- Docs/TestDocs/charts/prompt_mechanism_runtime_flow.svg');
