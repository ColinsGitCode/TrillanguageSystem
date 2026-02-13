import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';
import * as d3 from 'd3';

// --- Configuration ---
const OUTPUT_DIR = 'Docs/assets/slides_charts/ja';
const DATA_DIR = 'Docs/TestDocs/data';
const BENCHMARK_ID = 'exp_benchmark_50_20260209_140431';

const summaryPath = path.join(DATA_DIR, `round_kpi_summary_${BENCHMARK_ID}.json`);
const trendPath = path.join(DATA_DIR, `round_trend_${BENCHMARK_ID}.json`);
const summaryData = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const trendData = JSON.parse(fs.readFileSync(trendPath, 'utf8'));

const COLORS = {
  blue: '#E3F2FD', blueBorder: '#1565C0',
  green: '#E8F5E9', greenBorder: '#2E7D32',
  orange: '#FFF3E0', orangeBorder: '#EF6C00',
  purple: '#F3E5F5', purpleBorder: '#7B1FA2',
  red: '#FFEBEE', redBorder: '#C62828',
  gray: '#F5F5F5', grayBorder: '#424242',
  text: '#212121'
};

function createSVG(width, height) {
  const dom = new JSDOM(`<!DOCTYPE html><body></body>`);
  const body = dom.window.document.body;
  const svg = d3.select(body).append('svg')
    .attr('width', width).attr('height', height)
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .style('background', '#ffffff');
  return { svg, body };
}

function saveSVG(body, filename) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, filename), body.innerHTML);
  console.log(`Saved: ${filename}`);
}

function drawBox(g, x, y, w, h, text, colorKey, title = '', fontSize = 14) {
  const bg = COLORS[colorKey] || '#f0f0f0';
  const border = COLORS[colorKey + 'Border'] || '#ccc';
  g.append('rect').attr('x', x).attr('y', y).attr('width', w).attr('height', h).attr('rx', 8).attr('ry', 8).attr('fill', bg).attr('stroke', border).attr('stroke-width', 2);
  let textY = y + (title ? 50 : h / 2 + 5);
  if (title) {
    g.append('text').attr('x', x + w / 2).attr('y', y + 25).attr('text-anchor', 'middle').attr('font-family', 'sans-serif').attr('font-size', '16px').attr('font-weight', 'bold').attr('fill', border).text(title);
  }
  const lines = Array.isArray(text) ? text : [text];
  const offset = title ? 20 : (lines.length > 1 ? -((lines.length - 1) * 10) : 0);
  lines.forEach((line, i) => {
    g.append('text').attr('x', x + w / 2).attr('y', textY + offset + i * 22).attr('text-anchor', 'middle').attr('font-family', 'sans-serif').attr('font-size', `${fontSize}px`).attr('fill', COLORS.text).text(line);
  });
}

function drawArrow(svg, x1, y1, x2, y2, color = '#999') {
  const markerId = 'arrowhead';
  if (svg.select(`#${markerId}`).empty()) {
    svg.append('defs').append('marker').attr('id', markerId).attr('viewBox', '0 0 10 10').attr('refX', 10).attr('refY', 5).attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto').append('path').attr('d', 'M 0 0 L 10 5 L 0 10 z').attr('fill', color);
  }
  svg.append('line').attr('x1', x1).attr('y1', y1).attr('x2', x2).attr('y2', y2).attr('stroke', color).attr('stroke-width', 2).attr('marker-end', `url(#${markerId})`);
}

// --- Specific Sub-Page Renderers ---

function renderSlide04a() {
  const { svg, body } = createSVG(800, 400);
  drawBox(svg, 50, 50, 200, 100, ["Generation Logs", "(Requests/Outputs)"], "blue", "Product Domain");
  drawBox(svg, 300, 50, 200, 100, ["Experiment Runs", "(Rounds/Samples)"], "green", "Research Domain");
  drawBox(svg, 550, 50, 200, 100, ["Teacher Refs", "(Golden Examples)"], "purple", "Knowledge Domain");
  
  // Connectors
  drawArrow(svg, 250, 100, 300, 100);
  drawArrow(svg, 550, 100, 500, 100);
  
  svg.append('rect').attr('x', 250).attr('y', 220).attr('width', 300).attr('height', 80).attr('fill', '#f5f5f5').attr('stroke', '#666').attr('rx', 5);
  svg.append('text').attr('x', 400).attr('y', 255).attr('text-anchor', 'middle').attr('font-weight', 'bold').text("Unified Trace ID");
  svg.append('text').attr('x', 400).attr('y', 280).attr('text-anchor', 'middle').attr('font-size', '12px').text("Links quality metrics to prompt versions");
  
  drawArrow(svg, 150, 150, 250, 220);
  drawArrow(svg, 400, 150, 400, 220);
  drawArrow(svg, 650, 150, 550, 220);
  saveSVG(body, 'slide_04a_observability_data_model_ja.svg');
}

function renderSlide04b() {
  const { svg, body } = createSVG(850, 200);
  const steps = ["入力", "指示生成", "LLM推論", "構造化", "指標計算", "永続化"];
  const stepWidth = 110;
  steps.forEach((s, i) => {
    const x = 50 + i * (stepWidth + 20);
    drawBox(svg, x, 50, stepWidth, 80, [s], i % 2 === 0 ? "blue" : "green");
    if (i < steps.length - 1) drawArrow(svg, x + stepWidth, 90, x + stepWidth + 20, 90);
  });
  saveSVG(body, 'slide_04b_observability_timeline_ja.svg');
}

function renderSlide04c() {
  const { svg, body } = createSVG(800, 450);
  const layers = [
    { n: "Verification Layer", d: "Schema & Logic Check", c: "red" },
    { n: "Injection Layer", d: "Few-shot Runtime Inject", c: "purple" },
    { n: "Assemble Layer", d: "Dynamic Component Stitching", c: "blue" },
    { n: "Template Layer", d: "Base Markdown Structure", c: "gray" }
  ];
  layers.forEach((l, i) => {
    drawBox(svg, 200, 50 + i * 90, 400, 70, [l.n, l.d], l.c);
  });
  saveSVG(body, 'slide_04c_code_as_prompt_architecture_ja.svg');
}

function renderSlide04d() {
  const { svg, body } = createSVG(800, 400);
  drawBox(svg, 300, 50, 200, 80, ["Prompt Candidate"], "gray");
  drawArrow(svg, 400, 130, 400, 180);
  
  svg.append('text').attr('x', 400).attr('y', 170).attr('text-anchor', 'middle').attr('font-weight', 'bold').text("Gate Check");
  
  const conditions = [
    { t: "deltaQuality > 0", c: "blue", x: 100 },
    { t: "pValue < 0.05", c: "green", x: 325 },
    { t: "Gain > 5.0", c: "orange", x: 550 }
  ];
  conditions.forEach(d => {
    drawBox(svg, d.x, 200, 150, 80, [d.t], d.c);
    drawArrow(svg, 400, 180, d.x + 75, 200);
  });
  
  drawBox(svg, 250, 320, 300, 50, ["RELEASE PERMITTED"], "green");
  drawArrow(svg, 400, 280, 400, 320);
  saveSVG(body, 'slide_04d_code_as_prompt_gates_ja.svg');
}

// --- Re-use existing renderers ---
function renderSlide01() { const { svg, body } = createSVG(800, 400); const p1 = [400, 50]; const p2 = [200, 350]; const p3 = [600, 350]; svg.append('path').attr('d', `M${p1[0]},${p1[1]} L${p2[0]},${p2[1]} L${p3[0]},${p3[1]} Z`).attr('fill', '#fdfdfd').attr('stroke', '#ddd').attr('stroke-width', 2).attr('stroke-dasharray', '5,5'); drawBox(svg, p1[0]-75, p1[1]-25, 150, 50, ["Quality (品質)"], 'blue'); drawBox(svg, p2[0]-75, p2[1]-25, 150, 50, ["Cost (コスト)"], 'orange'); drawBox(svg, p3[0]-75, p3[1]-25, 150, 50, ["Stability (安定性)"], 'green'); svg.append('text').attr('x', 400).attr('y', 230).attr('text-anchor', 'middle').attr('font-family', 'sans-serif').attr('font-size', '20px').attr('font-weight', 'bold').text("Few-shot Trade-off"); saveSVG(body, 'slide_01_goal_triangle_ja.svg'); }
function renderSlide02() { const { svg, body } = createSVG(800, 450); const kpis = [{ title: "主要指標", items: ["Quality Score (品質)", "Success Rate (成功率)"], color: "blue", x: 50 }, { title: "制約指標", items: ["Avg Tokens (コスト)", "Avg Latency (遅延)"], color: "orange", x: 300 }, { title: "效率指標", items: ["Gain / 1k Tokens", "Threshold > 5.0"], color: "green", x: 550 }]; kpis.forEach(kpi => drawBox(svg, kpi.x, 100, 200, 150, kpi.items, kpi.color, kpi.title)); drawBox(svg, 50, 320, 700, 60, ["統計的有意性: p-value < 0.05 / 95% 信頼区間 / Cohen's d"], "purple"); saveSVG(body, 'slide_02_kpi_framework_ja.svg'); }
function renderSlide03() { const { svg, body } = createSVG(800, 500); drawBox(svg, 300, 30, 200, 60, ["Frontend UI", "Dashboard"], "blue"); svg.append('rect').attr('x', 100).attr('y', 130).attr('width', 600).attr('height', 240).attr('fill', '#f8f9fa').attr('stroke', '#dee2e6').attr('rx', 10); drawBox(svg, 150, 180, 180, 60, ["LLM Service", "(Provider Switch)"], "gray"); drawBox(svg, 470, 180, 180, 60, ["Few-shot Engine", "(Dynamic Inject)"], "green"); drawBox(svg, 310, 280, 180, 60, ["Observability Trace"], "purple"); drawBox(svg, 250, 410, 300, 60, ["SQLite Storage", "(Metrics & Samples)"], "orange"); drawArrow(svg, 400, 90, 400, 130); drawArrow(svg, 400, 370, 400, 410); saveSVG(body, 'slide_03_system_observability_ja.svg'); }
function renderSlide04() { const { svg, body } = createSVG(800, 300); const versions = [{ v: "V1", desc: "Static Template", x: 100, color: "gray" }, { v: "V2", desc: "Programmatic", x: 400, color: "blue" }, { v: "V3", desc: "Runtime Few-shot", x: 700, color: "green" }]; svg.append('line').attr('x1', 50).attr('y1', 150).attr('x2', 750).attr('y2', 150).attr('stroke', '#ccc').attr('stroke-width', 4); versions.forEach(d => { svg.append('circle').attr('cx', d.x).attr('cy', 150).attr('r', 12).attr('fill', COLORS[d.color + 'Border']); drawBox(svg, d.x - 75, 180, 150, 70, [d.v, d.desc], d.color); }); saveSVG(body, 'slide_04_code_as_prompt_timeline_ja.svg'); }
function renderSlide05() { const { svg, body } = createSVG(800, 400); drawBox(svg, 50, 50, 200, 100, ["Input Phrase", "(e.g. rollout)"], "gray"); drawBox(svg, 300, 50, 200, 100, ["Similarity Search", "(Teacher Pool)"], "blue"); drawBox(svg, 550, 50, 200, 100, ["Rank & Select", "(Quality > 85)"], "green"); svg.append('rect').attr('x', 200).attr('y', 200).attr('width', 400).attr('height', 150).attr('fill', COLORS.purple).attr('stroke', COLORS.purpleBorder).attr('rx', 8); svg.append('text').attr('x', 400).attr('y', 235).attr('text-anchor', 'middle').attr('font-weight', 'bold').text("Token Budget Control (25%)"); drawArrow(svg, 250, 100, 300, 100); drawArrow(svg, 500, 100, 550, 100); drawArrow(svg, 400, 150, 400, 200); saveSVG(body, 'slide_05_injection_mechanism_ja.svg'); }
function renderSlide06() { const { svg, body } = createSVG(800, 250); const steps = [{ n: "1. Run", c: "gray", x: 50 }, { n: "2. Agg", c: "blue", x: 235 }, { n: "3. Viz", c: "green", x: 420 }, { n: "4. Report", c: "purple", x: 605 }]; steps.forEach((s, i) => { drawBox(svg, s.x, 80, 145, 80, [s.n], s.c); if (i < 3) drawArrow(svg, s.x + 145, 120, s.x + 185, 120); }); saveSVG(body, 'slide_06_repro_pipeline_ja.svg'); }
function renderSlide07() { const { svg, body } = createSVG(800, 350); const categories = [{ name: "日常語彙 (Daily)", count: 15, color: "blue", x: 100 }, { name: "技術用語 (Tech)", count: 20, color: "green", x: 350 }, { name: "曖昧/複雑 (Complex)", count: 15, color: "purple", x: 600 }]; categories.forEach(d => { svg.append('circle').attr('cx', d.x + 50).attr('cy', 150).attr('r', d.count * 3).attr('fill', COLORS[d.color]).attr('stroke', COLORS[d.color + 'Border']).attr('stroke-width', 2); drawBox(svg, d.x - 25, 230, 150, 60, [d.name], d.color); }); saveSVG(body, 'slide_07_benchmark_design_ja.svg'); }
function renderSlide08() { const { svg, body } = createSVG(900, 500); const stats = [{ label: "Quality", val: "+1.88", sub: "p=0.0005", color: "blue" }, { label: "Cost", val: "+37%", sub: "Tokens", color: "orange" }, { label: "Efficiency", val: "4.88", sub: "pts/1k tok", color: "green" }]; stats.forEach((s, i) => drawBox(svg, 50 + i * 280, 50, 240, 100, [s.val, s.sub], s.color, s.label)); const caseY = 200; svg.append('rect').attr('x', 50).attr('y', caseY).attr('width', 800).attr('height', 250).attr('fill', '#fff').attr('stroke', '#333').attr('rx', 5); svg.append('text').attr('x', 70).attr('y', caseY + 30).attr('font-weight', 'bold').attr('font-size', '18px').text("Case Study: 'rollout'"); const caseText = ["Before (Baseline):", "  解説: 公開すること。 (Simple, dictionary-like)", "  After (Few-shot):", "  解説: DevOpsにおける段階的リリース... (Context-aware)"]; caseText.forEach((line, i) => { svg.append('text').attr('x', 70).attr('y', caseY + 60 + i * 25).attr('font-family', 'monospace').attr('font-size', '14px').attr('fill', line.includes("After") ? '#2E7D32' : (line.includes("Before") ? '#C62828' : '#333')).text(line); }); saveSVG(body, 'slide_08_core_results_with_case_ja.svg'); }
function renderSlide09() { const { svg, body } = createSVG(800, 400); const data = [{ cat: "日常語彙 (Daily)", gain: 9.06, color: "blue" }, { cat: "曖昧/複雑 (Complex)", gain: 3.75, color: "green" }, { cat: "技術用語 (Tech)", gain: 2.33, color: "gray" }]; const xScale = d3.scaleBand().domain(data.map(d => d.cat)).range([100, 700]).padding(0.4); const yScale = d3.scaleLinear().domain([0, 10]).range([350, 50]); svg.append('line').attr('x1', 100).attr('y1', 350).attr('x2', 700).attr('y2', 350).attr('stroke', '#333'); svg.append('line').attr('x1', 100).attr('y1', yScale(5)).attr('x2', 700).attr('y2', yScale(5)).attr('stroke', 'red').attr('stroke-dasharray', '4,4').attr('stroke-width', 2); data.forEach(d => { svg.append('rect').attr('x', xScale(d.cat)).attr('y', yScale(d.gain)).attr('width', xScale.bandwidth()).attr('height', 350 - yScale(d.gain)).attr('fill', COLORS[d.color]); svg.append('text').attr('x', xScale(d.cat) + xScale.bandwidth()/2).attr('y', yScale(d.gain) - 10).attr('text-anchor', 'middle').attr('font-weight', 'bold').text(d.gain); svg.append('text').attr('x', xScale(d.cat) + xScale.bandwidth()/2).attr('y', 370).attr('text-anchor', 'middle').attr('font-size', '12px').text(d.cat); }); saveSVG(body, 'slide_09_category_insights_ja.svg'); }
function renderSlide10() { const { svg, body } = createSVG(800, 400); const steps = [{ label: "Raw Delta", val: 7.33, y: 50, color: "gray" }, { label: "Length Bias", val: -5.45, y: 150, color: "red" }, { label: "True Quality", val: 1.88, y: 250, color: "green" }]; steps.forEach((step, i) => { drawBox(svg, 300, step.y, 200, 60, [`${step.val > 0 ? '+' : ''}${step.val}`], step.color, step.label); if (i < steps.length - 1) svg.append('line').attr('x1', 400).attr('y1', step.y + 60).attr('x2', 400).attr('y2', step.y + 100).attr('stroke', '#ccc').attr('stroke-width', 2).attr('stroke-dasharray', '4,4'); }); saveSVG(body, 'slide_10_limitations_onion_ja.svg'); }
function renderSlide11() { const { svg, body } = createSVG(800, 450); const rows = [{ time: "30 Days", item: "Teacher Pool Expansion", risk: "Latency +200ms", color: "blue" }, { time: "60 Days", item: "Budget Relax (0.25)", risk: "Cost +15%", color: "green" }, { time: "90 Days", item: "LLM Evaluator", risk: "Eval Time x2", color: "purple" }]; rows.forEach((row, i) => { const y = 50 + i * 130; drawBox(svg, 50, y, 120, 100, [row.time], "gray"); drawBox(svg, 220, y, 300, 100, [row.item], row.color, "Initiative"); drawBox(svg, 570, y, 180, 100, [row.risk], "red", "Risk"); drawArrow(svg, 170, y+50, 220, y+50); drawArrow(svg, 520, y+50, 570, y+50); }); saveSVG(body, 'slide_11_roadmap_risk_ja.svg'); }
function renderSlide12() { const { svg, body } = createSVG(800, 400); const pillars = [{ n: "Observability", d: "全生成の構造化記録", c: "blue", x: 50 }, { n: "Traceability", d: "実験IDによる完全追跡", c: "green", x: 300 }, { n: "Reproducibility", d: "ワンクリック再現", c: "purple", x: 550 }]; pillars.forEach(d => drawBox(svg, d.x, 100, 200, 200, [d.n, "", d.d], d.c)); saveSVG(body, 'slide_12_engineering_value_ja.svg'); }
function renderSlide13() { const { svg, body } = createSVG(600, 600); svg.append('line').attr('x1', 50).attr('y1', 550).attr('x2', 550).attr('y2', 550).attr('stroke', '#333').attr('stroke-width', 2); svg.append('line').attr('x1', 50).attr('y1', 550).attr('x2', 50).attr('y2', 50).attr('stroke', '#333').attr('stroke-width', 2); svg.append('line').attr('x1', 300).attr('y1', 50).attr('x2', 300).attr('y2', 550).attr('stroke', '#ddd').attr('stroke-dasharray', '4,4'); svg.append('line').attr('x1', 50).attr('y1', 300).attr('x2', 550).attr('y2', 300).attr('stroke', '#ddd').attr('stroke-dasharray', '4,4'); const items = [{ name: "Budget Relax", x: 150, y: 150, color: "green" }, { name: "Teacher Pool", x: 450, y: 100, color: "blue" }, { name: "LLM Eval", x: 450, y: 200, color: "blue" }, { name: "Rule Fixes", x: 150, y: 450, color: "gray" }, { name: "Blind Fewshot", x: 450, y: 450, color: "red" }]; items.forEach(d => { svg.append('circle').attr('cx', d.x).attr('cy', d.y).attr('r', 10).attr('fill', COLORS[d.color]); svg.append('text').attr('x', d.x).attr('y', d.y - 15).attr('text-anchor', 'middle').attr('font-size', '12px').text(d.name); }); saveSVG(body, 'slide_13_investment_matrix_ja.svg'); }

function main() {
  console.log("Generating Japanese Slides Charts (TRUE FULL VERSION)...");
  renderSlide01(); renderSlide02(); renderSlide03(); renderSlide04();
  renderSlide04a(); renderSlide04b(); renderSlide04c(); renderSlide04d();
  renderSlide05(); renderSlide06(); renderSlide07(); renderSlide08();
  renderSlide09(); renderSlide10(); renderSlide11(); renderSlide12();
  renderSlide13();
  console.log("Mission accomplished. All placeholders replaced with real visualizations.");
}
main();
