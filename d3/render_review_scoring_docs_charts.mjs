import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as d3 from 'd3';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outDir = path.join(repoRoot, 'Docs', 'TestDocs', 'charts', 'review_scoring');

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
  cyan: '#0891b2'
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

  const defs = svg.append('defs');
  defs
    .append('marker')
    .attr('id', 'arrow')
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 9)
    .attr('refY', 0)
    .attr('markerWidth', 7)
    .attr('markerHeight', 7)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0,-5L10,0L0,5')
    .attr('fill', '#64748b');

  return { dom, svg };
}

function save(dom, fileName) {
  fs.writeFileSync(path.join(outDir, fileName), dom.window.document.body.innerHTML, 'utf8');
}

function title(svg, main, sub = '') {
  svg
    .append('text')
    .attr('x', 48)
    .attr('y', 62)
    .attr('font-size', 42)
    .attr('font-weight', 700)
    .attr('fill', theme.text)
    .text(main);
  if (sub) {
    svg
      .append('text')
      .attr('x', 48)
      .attr('y', 96)
      .attr('font-size', 20)
      .attr('fill', theme.muted)
      .text(sub);
  }
}

function footer(svg, text) {
  svg
    .append('text')
    .attr('x', 48)
    .attr('y', 874)
    .attr('font-size', 13)
    .attr('fill', '#64748b')
    .text(text);
}

function panel(svg, x, y, w, h, label, fill = theme.panel, stroke = theme.stroke) {
  svg
    .append('rect')
    .attr('x', x)
    .attr('y', y)
    .attr('width', w)
    .attr('height', h)
    .attr('rx', 14)
    .attr('fill', fill)
    .attr('stroke', stroke)
    .attr('stroke-width', 2);
  if (label) {
    svg
      .append('text')
      .attr('x', x + 16)
      .attr('y', y + 32)
      .attr('font-size', 22)
      .attr('font-weight', 700)
      .attr('fill', theme.text)
      .text(label);
  }
}

function arrow(svg, x1, y1, x2, y2, label = '') {
  svg
    .append('line')
    .attr('x1', x1)
    .attr('y1', y1)
    .attr('x2', x2)
    .attr('y2', y2)
    .attr('stroke', '#64748b')
    .attr('stroke-width', 2.4)
    .attr('marker-end', 'url(#arrow)');
  if (label) {
    svg
      .append('text')
      .attr('x', (x1 + x2) / 2)
      .attr('y', (y1 + y2) / 2 - 8)
      .attr('text-anchor', 'middle')
      .attr('font-size', 18)
      .attr('fill', theme.muted)
      .text(label);
  }
}

function render01EndToEndFlow() {
  const { dom, svg } = createSvg();
  title(svg, '学习卡片评分与评论：端到端流程', '生成即入池，评审后再进入 few-shot 注入通道');

  const nodes = [
    { x: 70, y: 190, w: 250, h: 92, text: '1. 生成卡片\nPOST /api/generate', fill: '#dbeafe', stroke: theme.blue },
    { x: 370, y: 190, w: 270, h: 92, text: '2. 解析例句\nEN/JA + 中文释义', fill: '#dcfce7', stroke: theme.green },
    { x: 690, y: 190, w: 320, h: 92, text: '3. 入库去重\nexample_units + sources', fill: '#fff7ed', stroke: theme.orange },
    { x: 1060, y: 190, w: 250, h: 92, text: '4. UI 人工评分\n原句/翻译/TTS', fill: '#f3e8ff', stroke: theme.purple },
    { x: 1360, y: 190, w: 180, h: 92, text: '5. 保存评论\ndecision/comment', fill: '#fee2e2', stroke: theme.red }
  ];

  nodes.forEach((n, i) => {
    panel(svg, n.x, n.y, n.w, n.h, '', n.fill, n.stroke);
    const lines = n.text.split('\n');
    lines.forEach((line, idx) => {
      svg
        .append('text')
        .attr('x', n.x + n.w / 2)
        .attr('y', n.y + 36 + idx * 28)
        .attr('text-anchor', 'middle')
        .attr('font-size', 21)
        .attr('font-weight', idx === 0 ? 700 : 500)
        .attr('fill', theme.text)
        .text(line);
    });
    if (i < nodes.length - 1) {
      arrow(svg, n.x + n.w, n.y + 46, nodes[i + 1].x, nodes[i + 1].y + 46);
    }
  });

  panel(svg, 140, 360, 1320, 300, '统一处理并入池（Finalize）', '#ffffff', '#94a3b8');
  const steps = [
    'A. 批次进度检查：未评完禁止 finalize（默认）。',
    'B. 聚合评分：overall = 0.45*原句 + 0.45*翻译 + 0.1*TTS。',
    'C. 资格判定：pending / approved / rejected。',
    'D. few-shot 检索优先使用 approved 样本；可配置 reviewOnly。'
  ];
  steps.forEach((s, i) => {
    svg
      .append('text')
      .attr('x', 180)
      .attr('y', 430 + i * 58)
      .attr('font-size', 26)
      .attr('fill', '#1e293b')
      .text(s);
  });

  arrow(svg, 1260, 282, 1260, 360, '批次完成后');

  footer(svg, 'Source: server.js + exampleReviewService.js + goldenExamplesService.js');
  save(dom, 'review_01_end_to_end_flow.svg');
}

function render02ApiSequence() {
  const { dom, svg } = createSvg();
  title(svg, '评审 API 时序（UI -> Server -> DB）', '每个卡片可独立评分，批次统一 finalize');

  const lanes = [
    { x: 180, label: 'UI (Modal)' },
    { x: 640, label: 'Review APIs' },
    { x: 1120, label: 'SQLite' }
  ];

  lanes.forEach((l) => {
    svg
      .append('text')
      .attr('x', l.x)
      .attr('y', 156)
      .attr('text-anchor', 'middle')
      .attr('font-size', 26)
      .attr('font-weight', 700)
      .attr('fill', theme.text)
      .text(l.label);
    svg
      .append('line')
      .attr('x1', l.x)
      .attr('y1', 180)
      .attr('x2', l.x)
      .attr('y2', 760)
      .attr('stroke', '#cbd5e1')
      .attr('stroke-width', 2);
  });

  const calls = [
    { y: 220, from: 0, to: 1, text: 'GET /api/review/campaigns/active' },
    { y: 280, from: 1, to: 2, text: '查询 review_campaigns + progress' },
    { y: 340, from: 0, to: 1, text: 'GET /api/review/generations/:id/examples' },
    { y: 400, from: 1, to: 2, text: 'JOIN units/sources/reviews' },
    { y: 470, from: 0, to: 1, text: 'POST /api/review/examples/:id/reviews' },
    { y: 530, from: 1, to: 2, text: 'UPSERT example_reviews + 回写聚合分' },
    { y: 600, from: 0, to: 1, text: 'POST /api/review/campaigns/:id/finalize' },
    { y: 660, from: 1, to: 2, text: '计算 eligibility + 更新 campaign 状态' }
  ];

  calls.forEach((c) => {
    const x1 = lanes[c.from].x;
    const x2 = lanes[c.to].x;
    arrow(svg, x1 + 20, c.y, x2 - 20, c.y, c.text);
  });

  panel(svg, 108, 770, 1384, 90, '', '#e2e8f0', '#94a3b8');
  svg
    .append('text')
    .attr('x', 800)
    .attr('y', 826)
    .attr('text-anchor', 'middle')
    .attr('font-size', 24)
    .attr('font-weight', 700)
    .attr('fill', '#334155')
    .text('关键约束：未完成评审默认不可 finalize；finalize 后才更新注入资格');

  footer(svg, 'Source: public/js/modules/api.js + server.js');
  save(dom, 'review_02_api_sequence.svg');
}

function render03DataModel() {
  const { dom, svg } = createSvg();
  title(svg, '数据模型：评分、评论与注入资格', '核心是 example_units 主表 + campaign/review 明细表');

  const boxes = [
    {
      x: 80, y: 200, w: 360, h: 200, c: '#dbeafe', s: theme.blue,
      title: 'generations',
      lines: ['id, phrase, folder_name', 'markdown_content', 'llm_provider, llm_model']
    },
    {
      x: 500, y: 160, w: 480, h: 280, c: '#dcfce7', s: theme.green,
      title: 'example_units (核心)',
      lines: [
        'dedupe_hash, lang, sentence_text, translation_text',
        'review_score_sentence / translation / tts / overall',
        'review_votes, review_comment_latest, eligibility'
      ]
    },
    {
      x: 1040, y: 200, w: 460, h: 200, c: '#fff7ed', s: theme.orange,
      title: 'example_reviews',
      lines: ['example_id, campaign_id, reviewer', 'score_sentence, score_translation, score_tts', 'decision, comment']
    },
    {
      x: 240, y: 500, w: 420, h: 200, c: '#f3e8ff', s: theme.purple,
      title: 'review_campaigns',
      lines: ['name, status, snapshot_at', 'total/reviewed/approved/rejected', 'finalized_at']
    },
    {
      x: 740, y: 500, w: 430, h: 200, c: '#e0f2fe', s: theme.cyan,
      title: 'review_campaign_items',
      lines: ['campaign_id, example_id', 'status(pending/reviewed)', 'reviewed_at']
    }
  ];

  boxes.forEach((b) => {
    panel(svg, b.x, b.y, b.w, b.h, b.title, b.c, b.s);
    b.lines.forEach((line, i) => {
      svg
        .append('text')
        .attr('x', b.x + 18)
        .attr('y', b.y + 76 + i * 42)
        .attr('font-size', 21)
        .attr('fill', '#1e293b')
        .text(`- ${line}`);
    });
  });

  arrow(svg, 440, 300, 500, 300, '解析后入池');
  arrow(svg, 980, 300, 1040, 300, '评分明细');
  arrow(svg, 660, 600, 740, 600, '批次映射');
  arrow(svg, 980, 440, 960, 500, '聚合状态');
  arrow(svg, 300, 400, 300, 500, '快照建批次');
  arrow(svg, 1180, 500, 1240, 400, '回写资格');

  footer(svg, 'Source: database/schema.sql (example_units/example_reviews/review_campaigns)');
  save(dom, 'review_03_data_model.svg');
}

function render04ScoringEligibility() {
  const { dom, svg } = createSvg();
  title(svg, '评分与资格判定规则', '数值分 + 决策投票共同决定是否可注入');

  panel(svg, 90, 190, 620, 300, '评分输入', '#dbeafe', theme.blue);
  const scoreRows = [
    { name: '原句质量', w: 0.45, c: theme.blue },
    { name: '翻译准确性', w: 0.45, c: theme.green },
    { name: 'TTS 可用性', w: 0.10, c: theme.orange }
  ];
  scoreRows.forEach((r, i) => {
    const y = 260 + i * 80;
    svg.append('text').attr('x', 120).attr('y', y + 24).attr('font-size', 24).attr('fill', theme.text).text(`${r.name} (1~5)`);
    svg.append('rect').attr('x', 360).attr('y', y).attr('width', 300).attr('height', 34).attr('rx', 8).attr('fill', '#e2e8f0');
    svg.append('rect').attr('x', 360).attr('y', y).attr('width', 300 * r.w).attr('height', 34).attr('rx', 8).attr('fill', r.c);
    svg.append('text').attr('x', 675).attr('y', y + 24).attr('font-size', 20).attr('fill', theme.muted).text(`${Math.round(r.w * 100)}%`);
  });

  panel(svg, 760, 190, 750, 300, '聚合与门限', '#dcfce7', theme.green);
  const rules = [
    'overall = 0.45*sentence + 0.45*translation + 0.1*tts',
    'minVotes >= 1（默认）',
    'overall >= 4.2，且 sentence/translation >= 4.0',
    'rejectRate < 0.3（否则 rejected）'
  ];
  rules.forEach((r, i) => {
    svg.append('text').attr('x', 790).attr('y', 266 + i * 52).attr('font-size', 26).attr('fill', '#14532d').text(`- ${r}`);
  });

  panel(svg, 90, 560, 1420, 220, '资格结果', '#ffffff', '#94a3b8');
  const resultNodes = [
    { x: 220, t: 'pending', c: '#fef3c7', s: '#ca8a04', d: '票数不足或未 finalize' },
    { x: 720, t: 'approved', c: '#dcfce7', s: '#16a34a', d: '可进入 review-gated few-shot' },
    { x: 1220, t: 'rejected', c: '#fee2e2', s: '#dc2626', d: '不参与注入候选集' }
  ];
  resultNodes.forEach((n) => {
    panel(svg, n.x - 170, 616, 340, 120, '', n.c, n.s);
    svg.append('text').attr('x', n.x).attr('y', 658).attr('text-anchor', 'middle').attr('font-size', 32).attr('font-weight', 700).attr('fill', theme.text).text(n.t);
    svg.append('text').attr('x', n.x).attr('y', 692).attr('text-anchor', 'middle').attr('font-size', 20).attr('fill', theme.muted).text(n.d);
  });

  arrow(svg, 800, 490, 800, 560, 'finalize 后更新');
  footer(svg, 'Source: exampleReviewService.computeEligibility() + finalizeCampaign()');
  save(dom, 'review_04_scoring_eligibility.svg');
}

function render05InjectionGate() {
  const { dom, svg } = createSvg();
  title(svg, '后台使用方式：review-gated few-shot 注入', '先取人工通过样本，再按相似度/评分排序注入');

  const flow = [
    { x: 80, y: 210, w: 250, h: 92, t: 'build fewShotConfig', c: '#dbeafe', s: theme.blue },
    { x: 370, y: 210, w: 270, h: 92, t: 'reviewGated?', c: '#fff7ed', s: theme.orange },
    { x: 680, y: 210, w: 350, h: 92, t: 'getApprovedExamplesForFewShot', c: '#dcfce7', s: theme.green },
    { x: 1070, y: 210, w: 220, h: 92, t: '有样本', c: '#dcfce7', s: theme.green },
    { x: 1330, y: 210, w: 210, h: 92, t: '注入 Prompt', c: '#e0f2fe', s: theme.cyan }
  ];

  flow.forEach((n, i) => {
    panel(svg, n.x, n.y, n.w, n.h, '', n.c, n.s);
    svg
      .append('text')
      .attr('x', n.x + n.w / 2)
      .attr('y', n.y + 55)
      .attr('text-anchor', 'middle')
      .attr('font-size', 24)
      .attr('font-weight', 700)
      .attr('fill', theme.text)
      .text(n.t);
    if (i < flow.length - 1) {
      arrow(svg, n.x + n.w, n.y + 46, flow[i + 1].x, flow[i + 1].y + 46);
    }
  });

  const fallback = [
    { x: 450, y: 380, w: 300, h: 92, t: '无样本 & reviewOnly=true' },
    { x: 800, y: 380, w: 320, h: 92, t: '返回空数组 (不注入)' },
    { x: 450, y: 520, w: 300, h: 92, t: '无样本 & reviewOnly=false' },
    { x: 800, y: 520, w: 320, h: 92, t: '回退 teacher/历史样本' }
  ];

  fallback.forEach((n, idx) => {
    panel(svg, n.x, n.y, n.w, n.h, '', '#ffffff', '#94a3b8');
    svg.append('text').attr('x', n.x + n.w / 2).attr('y', n.y + 56).attr('text-anchor', 'middle').attr('font-size', 22).attr('fill', theme.text).text(n.t);
    if (idx % 2 === 0) {
      arrow(svg, n.x + n.w, n.y + 46, fallback[idx + 1].x, fallback[idx + 1].y + 46, idx === 0 ? 'Yes' : 'No');
    }
  });

  arrow(svg, 1120, 472, 1120, 640, '两条路径最终汇合');
  panel(svg, 980, 640, 460, 150, '注入候选排序', '#f1f5f9', '#94a3b8');
  ['similarity (bigram)', 'review_score_overall', 'review_votes'].forEach((t, i) => {
    svg.append('text').attr('x', 1010).attr('y', 700 + i * 30).attr('font-size', 22).attr('fill', '#334155').text(`- ${t}`);
  });

  footer(svg, 'Source: server.js(processFewShotPrompt) + goldenExamplesService.js');
  save(dom, 'review_05_injection_gate.svg');
}

function main() {
  render01EndToEndFlow();
  render02ApiSequence();
  render03DataModel();
  render04ScoringEligibility();
  render05InjectionGate();
  console.log(`[review-scoring] charts generated at: ${outDir}`);
}

main();
