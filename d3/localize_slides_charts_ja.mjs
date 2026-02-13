import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';
import * as d3 from 'd3';

const OUTPUT_DIR = 'Docs/assets/slides_charts/ja';
const DATA_DIR = 'Docs/TestDocs/data';
const BENCHMARK_ID = 'exp_benchmark_50_20260209_140431';

const summaryPath = path.join(DATA_DIR, `round_kpi_summary_${BENCHMARK_ID}.json`);
const trendPath = path.join(DATA_DIR, `round_trend_${BENCHMARK_ID}.json`);
const summaryData = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const trendData = JSON.parse(fs.readFileSync(trendPath, 'utf8'));

const baselineRound = (trendData.roundMetrics || []).find((r) => r.roundNumber === 0) || {};
const fewshotRound = (trendData.roundMetrics || []).find((r) => r.roundNumber !== 0 && r.fewshotEnabled) || (trendData.roundMetrics || [])[1] || {};
const statSig = summaryData.statisticalSignificance || {};

const CANVAS = { width: 1280, height: 720 };
const FONT = {
  family: "'Noto Sans JP','Hiragino Sans','Yu Gothic',sans-serif",
  mono: "'JetBrains Mono','SFMono-Regular',monospace"
};

const PALETTE = {
  bg: '#F7F9FC',
  text: '#1F2937',
  muted: '#5B6475',
  line: '#CBD5E1',
  blue: { fill: '#E7F0FF', stroke: '#2563EB', title: '#1D4ED8' },
  green: { fill: '#E9F8EF', stroke: '#16A34A', title: '#15803D' },
  orange: { fill: '#FFF4E8', stroke: '#EA580C', title: '#C2410C' },
  purple: { fill: '#F3E8FF', stroke: '#9333EA', title: '#7E22CE' },
  red: { fill: '#FEECEC', stroke: '#DC2626', title: '#B91C1C' },
  gray: { fill: '#EEF2F7', stroke: '#64748B', title: '#475569' }
};

function num(v, digits = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '-';
  return n.toFixed(digits);
}

function pct(v, digits = 1) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '-';
  return `${n.toFixed(digits)}%`;
}

function createCanvas(title, subtitle = '') {
  const dom = new JSDOM('<!doctype html><body></body>');
  const body = dom.window.document.body;
  const svg = d3
    .select(body)
    .append('svg')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('width', CANVAS.width)
    .attr('height', CANVAS.height)
    .style('background', PALETTE.bg);

  svg
    .append('rect')
    .attr('x', 16)
    .attr('y', 16)
    .attr('width', CANVAS.width - 32)
    .attr('height', CANVAS.height - 32)
    .attr('rx', 18)
    .attr('fill', '#FFFFFF')
    .attr('stroke', '#E2E8F0');

  svg
    .append('text')
    .attr('x', 44)
    .attr('y', 62)
    .attr('font-family', FONT.family)
    .attr('font-size', 40)
    .attr('font-weight', 800)
    .attr('fill', PALETTE.text)
    .text(title);

  if (subtitle) {
    svg
      .append('text')
      .attr('x', 44)
      .attr('y', 92)
      .attr('font-family', FONT.family)
      .attr('font-size', 18)
      .attr('fill', PALETTE.muted)
      .text(subtitle);
  }

  return { body, svg };
}

function saveSvg(body, filename) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, filename), body.innerHTML, 'utf8');
  console.log(`Saved: ${filename}`);
}

function ensureArrow(svg, id = 'arrow') {
  let defs = svg.select('defs');
  if (defs.empty()) defs = svg.append('defs');
  if (defs.select(`#${id}`).empty()) {
    defs
      .append('marker')
      .attr('id', id)
      .attr('viewBox', '0 0 10 10')
      .attr('refX', 9)
      .attr('refY', 5)
      .attr('markerWidth', 7)
      .attr('markerHeight', 7)
      .attr('orient', 'auto-start-reverse')
      .append('path')
      .attr('d', 'M0,0 L10,5 L0,10 z')
      .attr('fill', '#64748B');
  }
}

function arrow(svg, x1, y1, x2, y2, label = '') {
  ensureArrow(svg);
  svg
    .append('line')
    .attr('x1', x1)
    .attr('y1', y1)
    .attr('x2', x2)
    .attr('y2', y2)
    .attr('stroke', '#64748B')
    .attr('stroke-width', 2)
    .attr('marker-end', 'url(#arrow)');

  if (label) {
    svg
      .append('text')
      .attr('x', (x1 + x2) / 2)
      .attr('y', (y1 + y2) / 2 - 8)
      .attr('text-anchor', 'middle')
      .attr('font-family', FONT.family)
      .attr('font-size', 14)
      .attr('fill', '#475569')
      .text(label);
  }
}

function card(svg, { x, y, w, h, theme = 'gray', title = '', lines = [] }) {
  const c = PALETTE[theme] || PALETTE.gray;
  svg
    .append('rect')
    .attr('x', x)
    .attr('y', y)
    .attr('width', w)
    .attr('height', h)
    .attr('rx', 14)
    .attr('fill', c.fill)
    .attr('stroke', c.stroke)
    .attr('stroke-width', 2);

  if (title) {
    svg
      .append('text')
      .attr('x', x + 18)
      .attr('y', y + 32)
      .attr('font-family', FONT.family)
      .attr('font-size', 20)
      .attr('font-weight', 800)
      .attr('fill', c.title)
      .text(title);
  }

  lines.forEach((line, idx) => {
    svg
      .append('text')
      .attr('x', x + 18)
      .attr('y', y + 60 + idx * 24)
      .attr('font-family', FONT.family)
      .attr('font-size', 16)
      .attr('fill', PALETTE.text)
      .text(line);
  });
}

function footer(svg, text) {
  svg
    .append('text')
    .attr('x', 44)
    .attr('y', CANVAS.height - 30)
    .attr('font-family', FONT.family)
    .attr('font-size', 12)
    .attr('fill', '#64748B')
    .text(`出典: ${String(text || '').replace(/^Source:\s*/i, '')}`);
}

function renderSlide00() {
  const { svg, body } = createCanvas('アプリ機能サマリー', '生成・学習・観測を1画面で運用');

  card(svg, {
    x: 70,
    y: 180,
    w: 260,
    h: 150,
    theme: 'blue',
    title: '入力',
    lines: ['テキスト', '画像OCR']
  });

  card(svg, {
    x: 390,
    y: 180,
    w: 260,
    h: 150,
    theme: 'green',
    title: '生成',
    lines: ['日英中カード', '例句TTS']
  });

  card(svg, {
    x: 710,
    y: 180,
    w: 260,
    h: 150,
    theme: 'purple',
    title: '管理',
    lines: ['日付フォルダ', '履歴/削除']
  });

  card(svg, {
    x: 1030,
    y: 180,
    w: 180,
    h: 150,
    theme: 'orange',
    title: '分析',
    lines: ['INTEL', '統計ダッシュボード']
  });

  arrow(svg, 330, 255, 390, 255);
  arrow(svg, 650, 255, 710, 255);
  arrow(svg, 970, 255, 1030, 255);

  card(svg, {
    x: 180,
    y: 400,
    w: 930,
    h: 170,
    theme: 'gray',
    title: '実運用の価値',
    lines: ['生成 -> 学習 -> 追跡を同じ導線で完結', 'few-shot実験の記録と再現をそのまま報告へ接続']
  });

  footer(svg, 'app workflow overview');
  saveSvg(body, 'slide_00_app_overview_ja.svg');
}

function renderSlide00aConceptHierarchy() {
  const { svg, body } = createCanvas('概念関係：Prompt Engineering / Code as Prompt / few-shot', '順序ではなく「集合の所属関係」で整理');

  // Scheme B: strict subset (nested sets).
  svg
    .append('rect')
    .attr('x', 70)
    .attr('y', 130)
    .attr('width', 1140)
    .attr('height', 520)
    .attr('rx', 22)
    .attr('fill', '#EFF6FF')
    .attr('stroke', '#2563EB')
    .attr('stroke-width', 2.5);

  svg
    .append('text')
    .attr('x', 102)
    .attr('y', 176)
    .attr('font-family', FONT.family)
    .attr('font-size', 28)
    .attr('font-weight', 800)
    .attr('fill', '#1D4ED8')
    .text('Prompt Engineering（方法論の集合）');

  svg
    .append('text')
    .attr('x', 102)
    .attr('y', 206)
    .attr('font-family', FONT.family)
    .attr('font-size', 16)
    .attr('fill', '#334155')
    .text('目的定義 / 制約設計 / 評価指標 / 反復改善を含む全体領域');

  svg
    .append('rect')
    .attr('x', 180)
    .attr('y', 250)
    .attr('width', 920)
    .attr('height', 330)
    .attr('rx', 20)
    .attr('fill', '#F3E8FF')
    .attr('stroke', '#7C3AED')
    .attr('stroke-width', 2.5)
    .attr('opacity', 0.92);

  svg
    .append('text')
    .attr('x', 215)
    .attr('y', 292)
    .attr('font-family', FONT.family)
    .attr('font-size', 24)
    .attr('font-weight', 800)
    .attr('fill', '#6D28D9')
    .text('Code as Prompt（Prompt Engineering の部分集合）');
  svg
    .append('text')
    .attr('x', 215)
    .attr('y', 320)
    .attr('font-family', FONT.family)
    .attr('font-size', 15)
    .attr('fill', '#334155')
    .text('Promptを部品化・実装化・計測可能にする運用集合');

  svg
    .append('rect')
    .attr('x', 330)
    .attr('y', 365)
    .attr('width', 620)
    .attr('height', 170)
    .attr('rx', 18)
    .attr('fill', '#DCFCE7')
    .attr('stroke', '#16A34A')
    .attr('stroke-width', 2.5)
    .attr('opacity', 0.92);

  svg
    .append('text')
    .attr('x', 360)
    .attr('y', 406)
    .attr('font-family', FONT.family)
    .attr('font-size', 24)
    .attr('font-weight', 800)
    .attr('fill', '#15803D')
    .text('few-shot（Code as Prompt の部分集合）');
  svg
    .append('text')
    .attr('x', 360)
    .attr('y', 434)
    .attr('font-family', FONT.family)
    .attr('font-size', 15)
    .attr('fill', '#334155')
    .text('高品質例示を使う品質向上戦術の集合');

  svg
    .append('rect')
    .attr('x', 520)
    .attr('y', 468)
    .attr('width', 240)
    .attr('height', 52)
    .attr('rx', 10)
    .attr('fill', '#FEF9C3')
    .attr('stroke', '#CA8A04')
    .attr('stroke-width', 2.2);

  svg
    .append('text')
    .attr('x', 640)
    .attr('y', 500)
    .attr('text-anchor', 'middle')
    .attr('font-family', FONT.family)
    .attr('font-size', 16)
    .attr('font-weight', 800)
    .attr('fill', '#A16207')
    .text('本デモで適用したメカニズム');

  footer(svg, 'set-based relationship among three prompt concepts');
  saveSvg(body, 'slide_00a_concept_hierarchy_ja.svg');
}

function renderSlide00bPromptEngineeringIntro() {
  const { svg, body } = createCanvas('概念解説① Prompt Engineering', '何を最適化するかを定義する設計層');

  card(svg, {
    x: 80,
    y: 150,
    w: 340,
    h: 190,
    theme: 'blue',
    title: '役割',
    lines: ['・目的と評価軸を定義', '・出力フォーマットを規定', '・失敗パターンを制約化']
  });

  card(svg, {
    x: 470,
    y: 150,
    w: 340,
    h: 190,
    theme: 'green',
    title: '主要成果物',
    lines: ['・system指示', '・品質ルーブリック', '・評価手順 / 判定条件']
  });

  card(svg, {
    x: 860,
    y: 150,
    w: 340,
    h: 190,
    theme: 'orange',
    title: '本プロジェクト適用',
    lines: ['・三言語カード仕様', '・日本語ふりがな規則', '・INTEL指標定義']
  });

  card(svg, {
    x: 130,
    y: 410,
    w: 1020,
    h: 220,
    theme: 'gray',
    title: '判断基準（この層で確定）',
    lines: ['品質のみでは採用しない：品質 + コスト + 安定性 + 統計有意性を同時評価', '→ 以降の Code as Prompt / few-shot はこの基準を満たすための実装手段']
  });

  arrow(svg, 420, 245, 470, 245);
  arrow(svg, 810, 245, 860, 245);
  arrow(svg, 640, 342, 640, 410);

  footer(svg, 'prompt engineering role in evaluation and constraints');
  saveSvg(body, 'slide_00b_prompt_engineering_intro_ja.svg');
}

function renderSlide00cCodeAsPromptIntro() {
  const { svg, body } = createCanvas('概念解説② Code as Prompt', 'Promptを「編集可能な資産」に変える実装層');

  card(svg, {
    x: 70,
    y: 170,
    w: 250,
    h: 160,
    theme: 'gray',
    title: '入力',
    lines: ['フレーズ', '言語条件', 'モデル設定']
  });

  card(svg, {
    x: 370,
    y: 170,
    w: 250,
    h: 160,
    theme: 'blue',
    title: 'テンプレ層',
    lines: ['共通規約', '出力制約', '表記ルール']
  });

  card(svg, {
    x: 670,
    y: 170,
    w: 250,
    h: 160,
    theme: 'purple',
    title: '組立/注入層',
    lines: ['条件分岐', 'few-shot注入', '予算制御']
  });

  card(svg, {
    x: 970,
    y: 170,
    w: 250,
    h: 160,
    theme: 'green',
    title: '出力',
    lines: ['Markdownカード', '音声タスク', '観測メトリクス']
  });

  arrow(svg, 320, 250, 370, 250);
  arrow(svg, 620, 250, 670, 250);
  arrow(svg, 920, 250, 970, 250);

  card(svg, {
    x: 90,
    y: 390,
    w: 1100,
    h: 240,
    theme: 'orange',
    title: 'Code as Promptの価値',
    lines: ['・変更をコード差分で管理できる（再現性）', '・ラウンド比較で改善を定量評価できる（検証性）', '・ゲート条件で安全に本番反映できる（運用性）']
  });

  footer(svg, 'code-as-prompt engineering properties');
  saveSvg(body, 'slide_00c_code_as_prompt_intro_ja.svg');
}

function renderSlide00dFewShotIntro() {
  const { svg, body } = createCanvas('概念解説③ few-shot', '高品質例示を予算内で注入する実行戦術');

  const stages = [
    { x: 70, t: '候補取得', d: ['Teacherサンプル検索'], c: 'blue' },
    { x: 340, t: '品質選別', d: ['スコア下限 / 類似度'], c: 'green' },
    { x: 610, t: '予算判定', d: ['context比率 18-25%'], c: 'purple' },
    { x: 880, t: '注入/縮退', d: ['注入 or 短縮 or 無効化'], c: 'orange' }
  ];

  stages.forEach((s, i) => {
    card(svg, { x: s.x, y: 190, w: 230, h: 140, theme: s.c, title: s.t, lines: s.d });
    if (i < stages.length - 1) arrow(svg, s.x + 230, 260, stages[i + 1].x, 260);
  });

  card(svg, {
    x: 90,
    y: 390,
    w: 510,
    h: 220,
    theme: 'gray',
    title: '期待効果',
    lines: ['・翻訳の自然さ向上', '・例句品質の一貫性向上', '・ローカルLLMの弱点補完']
  });

  card(svg, {
    x: 680,
    y: 390,
    w: 510,
    h: 220,
    theme: 'red',
    title: '運用リスクと制御',
    lines: ['・token増加 → 予算制御/ゲートで抑制', '・過適合 → Teacher多様性と定期更新', '・効果減衰 → ラウンド評価で再調整']
  });

  footer(svg, 'few-shot runtime strategy and controls');
  saveSvg(body, 'slide_00d_fewshot_intro_ja.svg');
}

function renderSlide01() {
  const { svg, body } = createCanvas('課題三角形：品質・コスト・安定性', 'Few-shot導入の評価軸');

  const pA = [640, 190];
  const pB = [300, 560];
  const pC = [980, 560];

  svg
    .append('path')
    .attr('d', `M${pA[0]},${pA[1]} L${pB[0]},${pB[1]} L${pC[0]},${pC[1]} Z`)
    .attr('fill', '#F8FAFC')
    .attr('stroke', '#94A3B8')
    .attr('stroke-width', 2)
    .attr('stroke-dasharray', '8,6');

  card(svg, { x: 560, y: 138, w: 160, h: 94, theme: 'blue', title: '品質', lines: ['Quality Score'] });
  card(svg, { x: 218, y: 510, w: 170, h: 94, theme: 'orange', title: 'コスト', lines: ['Avg Tokens'] });
  card(svg, { x: 892, y: 510, w: 180, h: 94, theme: 'green', title: '安定性', lines: ['CV / Success Rate'] });
  card(svg, {
    x: 500,
    y: 360,
    w: 280,
    h: 120,
    theme: 'purple',
    title: '最適化目標',
    lines: ['ローカルLLM品質を改善しつつ', 'token増加を管理可能範囲に維持']
  });

  footer(svg, 'Source: Benchmark方針と評価設計');
  saveSvg(body, 'slide_01_goal_triangle_ja.svg');
}

function renderSlide02() {
  const { svg, body } = createCanvas('評価フレーム：成功基準の定義', '品質だけでなく効率・統計で判定');

  const cols = [
    {
      theme: 'blue',
      title: '主要指標',
      lines: ['・平均品質スコア', '・成功率', '・改善ラウンド比率']
    },
    {
      theme: 'orange',
      title: '制約指標',
      lines: ['・平均トークン数', '・平均遅延', '・トークン増加率']
    },
    {
      theme: 'green',
      title: '効率指標',
      lines: ['・Gain / 1k tokens', '・しきい値 > 5.0', `・実測: ${num(summaryData.bestEfficiencyRound?.gainPer1kExtraTokens, 2)}`]
    },
    {
      theme: 'purple',
      title: '統計指標',
      lines: [`・p値: ${num(statSig.pValue, 4)}`, `・95% CI: [${num(statSig.confidenceInterval95?.lower, 2)}, ${num(statSig.confidenceInterval95?.upper, 2)}]`, `・Cohen's d: ${num(statSig.cohensD?.d, 3)}`]
    }
  ];

  cols.forEach((col, idx) => {
    card(svg, { x: 46 + idx * 302, y: 150, w: 286, h: 220, theme: col.theme, title: col.title, lines: col.lines });
  });

  card(svg, {
    x: 46,
    y: 420,
    w: 1188,
    h: 150,
    theme: statSig.significant ? 'green' : 'red',
    title: statSig.significant ? '判定: 統計的に有意' : '判定: 有意差なし',
    lines: [statSig.summary || '統計サマリーなし']
  });

  footer(svg, 'Source: round_kpi_summary_exp_benchmark_50_20260209_140431.json');
  saveSvg(body, 'slide_02_kpi_framework_ja.svg');
}

function renderSlide03() {
  const { svg, body } = createCanvas('システム構成：生成から可観測まで', '実験再現を支える記録導線');

  card(svg, { x: 70, y: 180, w: 250, h: 120, theme: 'blue', title: 'フロントエンド', lines: ['カード生成UI', '比較ビュー / 履歴'] });
  card(svg, { x: 370, y: 180, w: 250, h: 120, theme: 'green', title: 'バックエンド', lines: ['生成オーケストレーション', 'モデル切替・比較実行'] });
  card(svg, { x: 670, y: 180, w: 250, h: 120, theme: 'purple', title: 'Promptエンジン', lines: ['テンプレート組立', 'few-shot注入'] });
  card(svg, { x: 970, y: 180, w: 240, h: 120, theme: 'orange', title: 'モデル層', lines: ['Gemini Teacher', 'Local Student'] });

  card(svg, { x: 240, y: 390, w: 360, h: 170, theme: 'gray', title: '保存レイヤー', lines: ['ファイル: md/html/audio', 'DB: runs / samples / metrics'] });
  card(svg, { x: 660, y: 390, w: 420, h: 170, theme: 'blue', title: '可観測レイヤー', lines: ['tokens / latency / quality', 'prompt・output・差分を追跡'] });

  arrow(svg, 320, 240, 370, 240);
  arrow(svg, 620, 240, 670, 240);
  arrow(svg, 920, 240, 970, 240);
  arrow(svg, 560, 300, 420, 390, '保存');
  arrow(svg, 800, 300, 870, 390, '指標化');

  footer(svg, 'Source: backend/frontend 実装 + observability schema');
  saveSvg(body, 'slide_03_system_observability_ja.svg');
}

function renderSlide04() {
  const { svg, body } = createCanvas('Code as Prompt：V1→V2→V3', '静的文面から実行時注入へ');

  svg
    .append('line')
    .attr('x1', 110)
    .attr('y1', 360)
    .attr('x2', 1160)
    .attr('y2', 360)
    .attr('stroke', '#94A3B8')
    .attr('stroke-width', 8)
    .attr('stroke-linecap', 'round');

  const nodes = [
    { x: 220, theme: 'gray', title: 'V1 静的テンプレート', lines: ['固定指示のみ', '再利用は容易 / 精度限界'] },
    { x: 640, theme: 'blue', title: 'V2 プログラム組立', lines: ['条件分岐・部品化', '出力構造の安定化'] },
    { x: 1060, theme: 'green', title: 'V3 実行時few-shot', lines: ['類似例を動的注入', '品質改善と予算制御'] }
  ];

  nodes.forEach((n, idx) => {
    svg
      .append('circle')
      .attr('cx', n.x)
      .attr('cy', 360)
      .attr('r', 18)
      .attr('fill', PALETTE[n.theme].stroke);
    card(svg, { x: n.x - 165, y: 420, w: 330, h: 145, theme: n.theme, title: n.title, lines: n.lines });
    if (idx < nodes.length - 1) {
      arrow(svg, n.x + 18, 360, nodes[idx + 1].x - 18, 360);
    }
  });

  card(svg, {
    x: 440,
    y: 170,
    w: 400,
    h: 120,
    theme: 'purple',
    title: '単一ケース例（挨拶）',
    lines: ['品質: 64 → 73 (+14.1%)', 'Tokens: 870 → 1291 (+48.4%)', 'Latency: 27.6s → 34.4s (+24.8%)']
  });

  footer(svg, 'Source: prompt evolution + case sample');
  saveSvg(body, 'slide_04_code_as_prompt_timeline_ja.svg');
}

function renderSlide04a() {
  const { svg, body } = createCanvas('観測サブページA：データモデルと追跡関係', '生成記録からfew-shot参照まで単一路で追跡');

  const nodes = [
    { x: 80, y: 160, t: '生成記録', l: ['phrases / files'], c: 'blue' },
    { x: 360, y: 160, t: '指標記録', l: ['tokens / quality'], c: 'purple' },
    { x: 640, y: 160, t: '音声記録', l: ['audio tasks'], c: 'green' },
    { x: 80, y: 340, t: 'few-shot実験', l: ['runs / rounds'], c: 'orange' },
    { x: 360, y: 340, t: 'Teacher参照', l: ['examples'], c: 'gray' },
    { x: 640, y: 340, t: 'サンプル明細', l: ['samples'], c: 'blue' }
  ];

  nodes.forEach((n) => card(svg, { x: n.x, y: n.y, w: 220, h: 120, theme: n.c, title: n.t, lines: n.l }));

  arrow(svg, 300, 220, 360, 220);
  arrow(svg, 580, 220, 640, 220);
  arrow(svg, 190, 280, 190, 340);
  arrow(svg, 470, 280, 470, 340);
  arrow(svg, 300, 400, 360, 400);
  arrow(svg, 580, 400, 640, 400);

  card(svg, {
    x: 910,
    y: 160,
    w: 320,
    h: 300,
    theme: 'green',
    title: '追跡ポイント',
    lines: ['・request_id / generation_id で結線', '・PromptとOutputを同時保存', '・品質差分をラウンド比較可能', '・Teacher参照の効果を再集計可能']
  });

  footer(svg, 'Source: DB schema + experiment tracking flow');
  saveSvg(body, 'slide_04a_observability_data_model_ja.svg');
}

function renderSlide04b() {
  const { svg, body } = createCanvas('観測サブページB：収集タイムラインと指標配置', '9工程ごとの計測位置を固定化');

  const steps = ['受信', 'Prompt構築', 'LLM呼出', '解析', '後処理', '描画', '保存', '音声生成', 'DB記録'];
  const startX = 60;
  const gap = 128;

  steps.forEach((s, idx) => {
    const x = startX + idx * gap;
    svg.append('circle').attr('cx', x).attr('cy', 220).attr('r', 27).attr('fill', '#DBEAFE').attr('stroke', '#2563EB').attr('stroke-width', 2);
    svg.append('text').attr('x', x).attr('y', 226).attr('text-anchor', 'middle').attr('font-family', FONT.mono).attr('font-size', 14).attr('fill', '#1E3A8A').text(idx + 1);
    svg.append('text').attr('x', x).attr('y', 272).attr('text-anchor', 'middle').attr('font-family', FONT.family).attr('font-size', 14).attr('fill', PALETTE.text).text(s);
    if (idx < steps.length - 1) {
      arrow(svg, x + 28, 220, x + gap - 28, 220);
    }
  });

  const bars = [
    { label: 'トークン', covered: '3/3', ratio: 1.0, c: '#2563EB' },
    { label: '品質', covered: '5/5', ratio: 1.0, c: '#16A34A' },
    { label: '性能', covered: '6/6', ratio: 1.0, c: '#7C3AED' },
    { label: '指示/出力', covered: '4/4', ratio: 1.0, c: '#EA580C' },
    { label: 'few-shot', covered: '6/6', ratio: 1.0, c: '#DC2626' }
  ];

  // Dedicated columns to avoid overlap when scaled in PPT.
  const labelColRight = 180;
  const barX = 210;
  const barWidth = 560;
  const valueColX = 790;
  const valueColW = 90;
  const valueX = valueColX + valueColW - 14;

  svg.append('rect').attr('x', 36).attr('y', 352).attr('width', 150).attr('height', 280).attr('rx', 10).attr('fill', '#F8FAFC').attr('stroke', '#CBD5E1');
  svg.append('rect').attr('x', valueColX).attr('y', 352).attr('width', valueColW).attr('height', 280).attr('rx', 10).attr('fill', '#F8FAFC').attr('stroke', '#CBD5E1');

  bars.forEach((b, idx) => {
    const y = 360 + idx * 56;
    svg
      .append('text')
      .attr('x', labelColRight)
      .attr('y', y + 24)
      .attr('text-anchor', 'end')
      .attr('font-family', FONT.family)
      .attr('font-size', 22)
      .attr('fill', '#334155')
      .text(b.label);
    svg.append('rect').attr('x', barX).attr('y', y).attr('width', barWidth).attr('height', 36).attr('rx', 8).attr('fill', '#E2E8F0');
    svg.append('rect').attr('x', barX).attr('y', y).attr('width', barWidth * b.ratio).attr('height', 36).attr('rx', 8).attr('fill', b.c);
    svg
      .append('text')
      .attr('x', valueX)
      .attr('y', y + 24)
      .attr('text-anchor', 'end')
      .attr('font-family', FONT.mono)
      .attr('font-size', 20)
      .attr('font-weight', 700)
      .attr('fill', '#0F172A')
      .text(b.covered);
  });

  card(svg, {
    x: 940,
    y: 356,
    w: 280,
    h: 280,
    theme: 'gray',
    title: '運用価値',
    lines: ['・リアルタイムの品質監視', '・履歴カードで再生確認', '・実験レポートで再現検証']
  });

  footer(svg, 'Source: observability instrumentation map');
  saveSvg(body, 'slide_04b_observability_timeline_ja.svg');
}

function renderSlide04c() {
  const { svg, body } = createCanvas('観測サブページC：Code as Promptの4層構造', '差し替え可能なPromptエンジン設計');

  const layers = [
    { t: '検証層', l: ['schemaチェック', '安全フィルタ'], c: 'red', y: 150 },
    { t: '注入層', l: ['few-shot候補選定', '予算内注入'], c: 'purple', y: 250 },
    { t: '組立層', l: ['テンプレ部品合成', '条件分岐'], c: 'blue', y: 350 },
    { t: 'テンプレ層', l: ['言語別ひな型', '出力制約'], c: 'gray', y: 450 }
  ];

  layers.forEach((layer, idx) => {
    card(svg, { x: 270, y: layer.y, w: 740, h: 90, theme: layer.c, title: layer.t, lines: layer.l });
    if (idx < layers.length - 1) arrow(svg, 640, layer.y + 90, 640, layers[idx + 1].y);
  });

  card(svg, {
    x: 70,
    y: 220,
    w: 170,
    h: 230,
    theme: 'green',
    title: '入力',
    lines: ['phrase', '言語条件', 'モデル設定']
  });
  arrow(svg, 240, 335, 270, 335);

  card(svg, {
    x: 1040,
    y: 220,
    w: 170,
    h: 230,
    theme: 'orange',
    title: '出力',
    lines: ['markdown', 'audio tasks', 'observability']
  });
  arrow(svg, 1010, 335, 1040, 335);

  footer(svg, 'Source: promptEngine + validation flow');
  saveSvg(body, 'slide_04c_code_as_prompt_architecture_ja.svg');
}

function renderSlide04d() {
  const { svg, body } = createCanvas('観測サブページD：リリースゲート判定', '主観ではなく指標でPromptを出荷');

  card(svg, {
    x: 440,
    y: 150,
    w: 400,
    h: 110,
    theme: 'gray',
    title: '候補Prompt',
    lines: ['実験ラウンド結果を入力']
  });

  card(svg, {
    x: 390,
    y: 310,
    w: 500,
    h: 160,
    theme: 'blue',
    title: 'ゲート条件',
    lines: ['① deltaQuality > 0', '② p-value < 0.05', '③ Gain > 5.0  (例外: 高コスト時は +3品質を要求)']
  });

  card(svg, {
    x: 180,
    y: 540,
    w: 380,
    h: 110,
    theme: 'green',
    title: 'PASS',
    lines: ['本番候補として採用', '次ラウンドで継続監視']
  });
  card(svg, {
    x: 720,
    y: 540,
    w: 380,
    h: 110,
    theme: 'red',
    title: 'FAIL',
    lines: ['差分分析へ戻す', '候補例や予算設定を再調整']
  });

  arrow(svg, 640, 260, 640, 310);
  arrow(svg, 560, 470, 370, 540, '条件を満たす');
  arrow(svg, 720, 470, 910, 540, '条件未達');

  footer(svg, 'Source: release policy / experiment gate criteria');
  saveSvg(body, 'slide_04d_code_as_prompt_gates_ja.svg');
}

function renderSlide05() {
  const { svg, body } = createCanvas('few-shot注入メカニズム', '検索・選別・予算制御・フォールバック');

  const stages = [
    { x: 60, title: '入力フレーズ', lines: ['例: rollout'], theme: 'gray' },
    { x: 330, title: '類似検索', lines: ['Teacher候補を取得'], theme: 'blue' },
    { x: 600, title: '品質選別', lines: ['下限スコア / 類似度'], theme: 'green' },
    { x: 870, title: '予算判定', lines: ['token比率 0.18-0.25'], theme: 'purple' }
  ];
  stages.forEach((s, idx) => {
    card(svg, { x: s.x, y: 190, w: 220, h: 130, theme: s.theme, title: s.title, lines: s.lines });
    if (idx < stages.length - 1) arrow(svg, s.x + 220, 255, stages[idx + 1].x, 255);
  });

  card(svg, {
    x: 180,
    y: 400,
    w: 920,
    h: 210,
    theme: 'orange',
    title: 'フォールバック経路',
    lines: ['1) 例示数を削減  →  2) 例示本文を短縮  →  3) 注入停止してbaselineへ回帰', 'budget_exceeded_disable を観測指標として保存']
  });
  arrow(svg, 980, 320, 640, 400, '超過時');

  footer(svg, 'Source: goldenExamplesService + token budget logic');
  saveSvg(body, 'slide_05_injection_mechanism_ja.svg');
}

function renderSlide06() {
  const { svg, body } = createCanvas('ワンクリック再現パイプライン', 'Run -> Aggregate -> Visualize -> Report');

  const steps = [
    { t: '実験実行', d: 'ラウンド生成', c: 'gray' },
    { t: '集計', d: 'KPI抽出', c: 'blue' },
    { t: '可視化', d: 'SVG生成', c: 'green' },
    { t: '報告', d: 'レポート出力', c: 'purple' }
  ];

  steps.forEach((s, idx) => {
    const x = 80 + idx * 300;
    card(svg, { x, y: 260, w: 230, h: 170, theme: s.c, title: `Step ${idx + 1}: ${s.t}`, lines: [s.d] });
    if (idx < steps.length - 1) arrow(svg, x + 230, 345, x + 300, 345);
  });

  card(svg, {
    x: 160,
    y: 500,
    w: 960,
    h: 120,
    theme: 'orange',
    title: '再現性の定義',
    lines: ['同じ入力セット・同じ設定で、同じ統計サマリーと同じ結論が再取得できること']
  });

  footer(svg, 'Source: experiment scripts + reporting pipeline');
  saveSvg(body, 'slide_06_repro_pipeline_ja.svg');
}

function renderSlide07() {
  const { svg, body } = createCanvas('50サンプルベンチマーク設計', `実験ID: ${BENCHMARK_ID}`);

  const data = [
    { name: '日常語彙', count: 15, color: 'blue' },
    { name: '技術用語', count: 20, color: 'green' },
    { name: '曖昧/複雑', count: 15, color: 'purple' }
  ];

  const total = data.reduce((sum, d) => sum + d.count, 0);
  let start = -Math.PI / 2;
  const cx = 380;
  const cy = 370;
  const r = 180;

  data.forEach((d) => {
    const angle = (d.count / total) * Math.PI * 2;
    const arc = d3.arc().innerRadius(70).outerRadius(r).startAngle(start).endAngle(start + angle);
    svg
      .append('path')
      .attr('d', arc())
      .attr('transform', `translate(${cx},${cy})`)
      .attr('fill', PALETTE[d.color].fill)
      .attr('stroke', PALETTE[d.color].stroke)
      .attr('stroke-width', 2);

    const mid = start + angle / 2;
    const tx = cx + Math.cos(mid) * 225;
    const ty = cy + Math.sin(mid) * 225;
    svg
      .append('text')
      .attr('x', tx)
      .attr('y', ty)
      .attr('text-anchor', 'middle')
      .attr('font-family', FONT.family)
      .attr('font-size', 18)
      .attr('font-weight', 700)
      .attr('fill', PALETTE[d.color].title)
      .text(`${d.name} ${d.count}件`);

    start += angle;
  });

  svg
    .append('text')
    .attr('x', cx)
    .attr('y', cy - 8)
    .attr('text-anchor', 'middle')
    .attr('font-family', FONT.mono)
    .attr('font-size', 34)
    .attr('font-weight', 800)
    .attr('fill', '#0F172A')
    .text('50');
  svg
    .append('text')
    .attr('x', cx)
    .attr('y', cy + 26)
    .attr('text-anchor', 'middle')
    .attr('font-family', FONT.family)
    .attr('font-size', 16)
    .attr('fill', PALETTE.muted)
    .text('総サンプル数');

  card(svg, {
    x: 760,
    y: 220,
    w: 430,
    h: 240,
    theme: 'gray',
    title: '設計ポイント',
    lines: ['・カテゴリ偏りを抑えた配分', '・口語/技術/複雑表現を網羅', '・few-shot効果の偏りを検証可能']
  });

  footer(svg, 'Source: benchmark_phrases_50.txt');
  saveSvg(body, 'slide_07_benchmark_design_ja.svg');
}

function renderSlide08() {
  const { svg, body } = createCanvas('コア結果：50サンプル比較', 'few-shotの改善量とコスト増を同時提示');

  const qualityBefore = Number(baselineRound.avgQualityScore || 0);
  const qualityAfter = Number(fewshotRound.avgQualityScore || 0);
  const tokensBefore = Number(baselineRound.avgTokensTotal || 0);
  const tokensAfter = Number(fewshotRound.avgTokensTotal || 0);

  const qScale = d3.scaleLinear().domain([0, 90]).range([0, 260]);
  const tScale = d3.scaleLinear().domain([0, Math.max(tokensAfter, tokensBefore, 1500)]).range([0, 260]);

  card(svg, { x: 60, y: 150, w: 560, h: 230, theme: 'blue', title: '品質スコア', lines: [`Baseline: ${num(qualityBefore, 2)}`, `Few-shot: ${num(qualityAfter, 2)}`, `差分: +${num(qualityAfter - qualityBefore, 2)}`] });
  svg.append('rect').attr('x', 300).attr('y', 230).attr('width', qScale(qualityBefore)).attr('height', 24).attr('fill', '#93C5FD');
  svg.append('rect').attr('x', 300).attr('y', 270).attr('width', qScale(qualityAfter)).attr('height', 24).attr('fill', '#2563EB');

  card(svg, { x: 660, y: 150, w: 560, h: 230, theme: 'orange', title: 'トークン量', lines: [`Baseline: ${num(tokensBefore, 0)}`, `Few-shot: ${num(tokensAfter, 0)}`, `増加率: ${pct(((tokensAfter - tokensBefore) / tokensBefore) * 100, 1)}`] });
  svg.append('rect').attr('x', 900).attr('y', 230).attr('width', tScale(tokensBefore)).attr('height', 24).attr('fill', '#FDBA74');
  svg.append('rect').attr('x', 900).attr('y', 270).attr('width', tScale(tokensAfter)).attr('height', 24).attr('fill', '#EA580C');

  card(svg, {
    x: 60,
    y: 430,
    w: 1160,
    h: 210,
    theme: 'green',
    title: 'ケース例: rollout',
    lines: ['Before: 辞書的で硬い説明、文脈が薄い', 'After: DevOps文脈を含む口語的な説明へ改善', '体感価値: 「辞書」→「文脈理解アシスタント」']
  });

  footer(svg, `Source: round metrics + p-value ${num(statSig.pValue, 4)}`);
  saveSvg(body, 'slide_08_core_results_with_case_ja.svg');
}

function renderSlide09() {
  const { svg, body } = createCanvas('カテゴリ洞察：効果の偏り', 'Gain per 1k tokens のカテゴリ差');

  const data = [
    { cat: '日常語彙', gain: 9.06, theme: 'blue' },
    { cat: '曖昧/複雑', gain: 3.75, theme: 'green' },
    { cat: '技術用語', gain: 2.33, theme: 'gray' }
  ];

  const x = d3.scaleBand().domain(data.map((d) => d.cat)).range([120, 840]).padding(0.35);
  const y = d3.scaleLinear().domain([0, 10]).range([560, 180]);

  svg.append('line').attr('x1', 120).attr('y1', 560).attr('x2', 860).attr('y2', 560).attr('stroke', '#334155').attr('stroke-width', 2);
  svg.append('line').attr('x1', 120).attr('y1', y(5)).attr('x2', 860).attr('y2', y(5)).attr('stroke', '#DC2626').attr('stroke-width', 2).attr('stroke-dasharray', '6,6');
  svg.append('text').attr('x', 870).attr('y', y(5) + 5).attr('font-family', FONT.mono).attr('font-size', 14).attr('fill', '#DC2626').text('しきい値 5.0');

  data.forEach((d) => {
    const bw = x.bandwidth();
    svg
      .append('rect')
      .attr('x', x(d.cat))
      .attr('y', y(d.gain))
      .attr('width', bw)
      .attr('height', 560 - y(d.gain))
      .attr('rx', 8)
      .attr('fill', PALETTE[d.theme].stroke);
    svg
      .append('text')
      .attr('x', x(d.cat) + bw / 2)
      .attr('y', y(d.gain) - 10)
      .attr('text-anchor', 'middle')
      .attr('font-family', FONT.mono)
      .attr('font-size', 20)
      .attr('font-weight', 700)
      .attr('fill', '#0F172A')
      .text(num(d.gain, 2));
    svg
      .append('text')
      .attr('x', x(d.cat) + bw / 2)
      .attr('y', 590)
      .attr('text-anchor', 'middle')
      .attr('font-family', FONT.family)
      .attr('font-size', 18)
      .attr('fill', '#334155')
      .text(d.cat);
  });

  card(svg, {
    x: 910,
    y: 220,
    w: 300,
    h: 300,
    theme: 'orange',
    title: '解釈',
    lines: ['・日常語彙は高効率', '・技術用語は効果限定', '・適用対象の選別が必要']
  });

  footer(svg, 'Source: benchmark report category summary');
  saveSvg(body, 'slide_09_category_insights_ja.svg');
}

function renderSlide10() {
  const { svg, body } = createCanvas('自己批判：品質増分の分解', '見かけの差分と実質改善を分離');

  const rows = [
    { label: 'Raw Delta', value: 7.33, theme: 'gray' },
    { label: 'Length Bias', value: -5.45, theme: 'red' },
    { label: 'True Quality', value: 1.88, theme: 'green' }
  ];

  rows.forEach((row, idx) => {
    card(svg, {
      x: 280,
      y: 170 + idx * 170,
      w: 720,
      h: 120,
      theme: row.theme,
      title: `${idx + 1}. ${row.label}`,
      lines: [`寄与値: ${row.value > 0 ? '+' : ''}${num(row.value, 2)}`]
    });
    if (idx < rows.length - 1) {
      arrow(svg, 640, 290 + idx * 170, 640, 340 + idx * 170);
    }
  });

  card(svg, {
    x: 60,
    y: 240,
    w: 180,
    h: 210,
    theme: 'blue',
    title: '結論',
    lines: ['見かけ値ではなく', '補正後の値を', '主要判断に使う']
  });

  footer(svg, 'Source: benchmark bias analysis');
  saveSvg(body, 'slide_10_limitations_onion_ja.svg');
}

function renderSlide11() {
  const { svg, body } = createCanvas('最適化ロードマップ：効果とリスク', '30/60/90日で段階導入');

  const items = [
    { term: '30日', plan: 'Teacherプール拡張', effect: '品質 +2〜3', risk: '類似検索 +200ms', c: 'blue', y: 170 },
    { term: '60日', plan: '予算配分緩和', effect: 'fallback減少', risk: '月間コスト +15%', c: 'green', y: 320 },
    { term: '90日', plan: 'LLM評価導入', effect: '評価精度向上', risk: '評価時間 x2', c: 'purple', y: 470 }
  ];

  items.forEach((item) => {
    card(svg, { x: 60, y: item.y, w: 130, h: 100, theme: 'gray', title: item.term, lines: [] });
    card(svg, { x: 230, y: item.y, w: 340, h: 100, theme: item.c, title: '方針', lines: [item.plan] });
    card(svg, { x: 610, y: item.y, w: 250, h: 100, theme: 'green', title: '期待効果', lines: [item.effect] });
    card(svg, { x: 900, y: item.y, w: 320, h: 100, theme: 'red', title: '潜在リスク', lines: [item.risk] });
    arrow(svg, 190, item.y + 50, 230, item.y + 50);
    arrow(svg, 570, item.y + 50, 610, item.y + 50);
    arrow(svg, 860, item.y + 50, 900, item.y + 50);
  });

  footer(svg, 'Source: optimization roadmap design');
  saveSvg(body, 'slide_11_roadmap_risk_ja.svg');
}

function renderSlide12() {
  const { svg, body } = createCanvas('エンジニアリング価値', 'Observability + Traceability + Reproducibility');

  const pillars = [
    { t: 'Observability', d: '全生成の構造化記録', c: 'blue', x: 90 },
    { t: 'Traceability', d: '実験IDで完全追跡', c: 'green', x: 450 },
    { t: 'Reproducibility', d: '自動実行で再現', c: 'purple', x: 810 }
  ];

  pillars.forEach((p, idx) => {
    card(svg, { x: p.x, y: 210, w: 300, h: 230, theme: p.c, title: p.t, lines: [p.d] });
    if (idx < pillars.length - 1) arrow(svg, p.x + 300, 325, pillars[idx + 1].x, 325);
  });

  card(svg, {
    x: 150,
    y: 500,
    w: 980,
    h: 130,
    theme: 'orange',
    title: '開発効果',
    lines: ['品質改善施策を、計測可能・比較可能・再実行可能な単位で運用できる']
  });

  footer(svg, 'Source: production observability implementation');
  saveSvg(body, 'slide_12_engineering_value_ja.svg');
}

function renderSlide13() {
  const { svg, body } = createCanvas('投資優先マトリクス', '縦軸: 品質効果 / 横軸: 実装難易度');

  const left = 130;
  const top = 150;
  const width = 850;
  const height = 470;

  svg.append('rect').attr('x', left).attr('y', top).attr('width', width).attr('height', height).attr('fill', '#FFFFFF').attr('stroke', '#CBD5E1');
  svg.append('line').attr('x1', left + width / 2).attr('y1', top).attr('x2', left + width / 2).attr('y2', top + height).attr('stroke', '#CBD5E1').attr('stroke-dasharray', '7,6');
  svg.append('line').attr('x1', left).attr('y1', top + height / 2).attr('x2', left + width).attr('y2', top + height / 2).attr('stroke', '#CBD5E1').attr('stroke-dasharray', '7,6');

  svg.append('text').attr('x', left + width / 2).attr('y', top + height + 48).attr('text-anchor', 'middle').attr('font-family', FONT.family).attr('font-size', 20).attr('fill', '#334155').text('実装難易度 →');
  svg.append('text').attr('transform', `translate(${left - 74}, ${top + height / 2}) rotate(-90)`).attr('text-anchor', 'middle').attr('font-family', FONT.family).attr('font-size', 20).attr('fill', '#334155').text('品質効果 →');

  const points = [
    { x: 280, y: 270, label: '予算配分緩和', c: 'green' },
    { x: 650, y: 230, label: 'Teacherプール拡張', c: 'blue' },
    { x: 760, y: 330, label: 'LLM評価導入', c: 'purple' },
    { x: 260, y: 510, label: 'ルール微修正', c: 'gray' },
    { x: 760, y: 520, label: '無差別few-shot', c: 'red' }
  ];

  points.forEach((p) => {
    svg.append('circle').attr('cx', p.x).attr('cy', p.y).attr('r', 16).attr('fill', PALETTE[p.c].fill).attr('stroke', PALETTE[p.c].stroke).attr('stroke-width', 2);
    svg.append('text').attr('x', p.x + 24).attr('y', p.y + 5).attr('font-family', FONT.family).attr('font-size', 16).attr('fill', '#0F172A').text(p.label);
  });

  card(svg, {
    x: 1010,
    y: 210,
    w: 220,
    h: 260,
    theme: 'green',
    title: '推奨順位',
    lines: ['1) 予算配分緩和', '2) Teacherプール拡張', '3) LLM評価導入']
  });

  footer(svg, 'Source: roadmap assumptions + benchmark outcomes');
  saveSvg(body, 'slide_13_investment_matrix_ja.svg');
}

function main() {
  console.log('Generating localized JP slide charts...');
  renderSlide00aConceptHierarchy();
  renderSlide00bPromptEngineeringIntro();
  renderSlide00cCodeAsPromptIntro();
  renderSlide00dFewShotIntro();
  renderSlide00();
  renderSlide01();
  renderSlide02();
  renderSlide03();
  renderSlide04();
  renderSlide04a();
  renderSlide04b();
  renderSlide04c();
  renderSlide04d();
  renderSlide05();
  renderSlide06();
  renderSlide07();
  renderSlide08();
  renderSlide09();
  renderSlide10();
  renderSlide11();
  renderSlide12();
  renderSlide13();
  console.log('Done.');
}

main();
