import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const chartsDir = path.join(repoRoot, 'Docs', 'TestDocs', 'charts');
const outDir = path.join(chartsDir, 'ja');

fs.mkdirSync(outDir, { recursive: true });

const files = [
  'slide_01_goal_triangle.svg',
  'slide_02_kpi_framework.svg',
  'slide_03_system_observability.svg',
  'slide_04_code_as_prompt_timeline.svg',
  'slide_04a_observability_data_model.svg',
  'slide_04b_observability_timeline.svg',
  'slide_04c_code_as_prompt_architecture.svg',
  'slide_04d_code_as_prompt_gates.svg',
  'slide_04e_code_as_prompt_case_kpi.svg',
  'slide_04f_code_as_prompt_composition.svg',
  'slide_04g_code_as_prompt_stage_impact.svg',
  'slide_04h_code_as_prompt_prompt_diff_metrics.svg',
  'slide_05_injection_mechanism.svg',
  'slide_06_repro_pipeline.svg',
  'slide_07_benchmark_design.svg',
  'slide_08_core_results.svg',
  'round_quality_trend_exp_benchmark_50_20260209_140431.svg',
  'slide_09_category_insights.svg',
  'slide_10_limitations.svg',
  'slide_11_roadmap.svg',
  'slide_12_engineering_value.svg',
  'slide_13_decision_matrix.svg',
  'slide_14_statistical_evidence.svg',
  'slide_15_historical_comparison.svg',
  'slide_16_artifact_coverage.svg'
];

const textMap = new Map([
  ['质量-成本-稳定性目标三角', '品質・コスト・安定性の目標トライアングル'],
  ['质量', '品質'],
  ['成本可控', 'コスト管理'],
  ['稳定性', '安定性'],
  ['质量分', '品質スコア'],
  ['Token 增幅', 'Token増加率'],
  ['稳定性 CV', '安定性 CV'],
  ['评估框架：指标与统计显著性', '評価フレームワーク：KPIと統計的有意性'],
  ['主指标', '主要指標'],
  ['约束指标', '制約指標'],
  ['效率指标', '効率指標'],
  ['统计检验', '統計検定'],
  ['系统可观测覆盖：链路、数据、接口', 'システム可観測性カバレッジ：パイプライン・データ・API'],
  ['生成链路阶段', '生成パイプライン工程'],
  ['核心 API 端点', '主要APIエンドポイント'],
  ['数据库核心表', 'DB主要テーブル'],
  ['实验数据维度', '実験データ次元'],
  ['Code as Prompt：三代演进时间线', 'Code as Prompt：3世代の進化タイムライン'],
  ['V1 静态模板', 'V1 静的テンプレート'],
  ['固定 Prompt 文本', '固定Promptテキスト'],
  ['规则硬编码', 'ルールをハードコード'],
  ['V2 程序化生成', 'V2 プログラム生成'],
  ['promptEngine 组装', 'promptEngineで組み立て'],
  ['质量标准结构化', '品質基準の構造化'],
  ['V3 动态注入', 'V3 動的注入'],
  ['预算与回退控制', '予算とフォールバック制御'],
  ['工程结论：Prompt 优化 = 代码重构 + 版本化迭代 + 实验回归', 'エンジニアリング結論：Prompt最適化 = コード再設計 + バージョン反復 + 実験回帰'],
  ['系统观测性子页 A：数据模型与追溯关系', 'システム可観測性 サブページA：データモデルと追跡関係'],
  ['从生成记录追溯到 few-shot 与 teacher 证据链', '生成記録からfew-shotとteacherの証跡まで追跡'],
  ['- 核心持久化表: 11', '- 主要永続化テーブル: 11'],
  ['- 实验追踪主表: runs / rounds / samples / teacher', '- 実験追跡主表: runs / rounds / samples / teacher'],
  ['- INTEL 数据: prompt/rawOutput/quality/tokens/performance 全链路可回放', '- INTELデータ: prompt/rawOutput/quality/tokens/performance を全経路で再生可能'],
  ['系统观测性子页 B：采集时序与指标落点', 'システム可観測性 サブページB：収集タイムラインと指標配置'],
  ['生成链路 9 步中每一步的可观测字段', '生成パイプライン9工程における可観測フィールド'],
  ['- Mission Control 实时统计', '- Mission Control リアルタイム集計'],
  ['- History INTEL 卡片回放', '- History INTEL カード再生'],
  ['- 实验导出脚本可复现', '- 実験エクスポートスクリプトで再現可能'],
  ['Code as Prompt 子页 A：运行时组装架构', 'Code as Prompt サブページA：実行時組み立てアーキテクチャ'],
  ['模板 -> 程序化约束 -> few-shot 注入 -> 结构校验', 'テンプレート -> プログラム制約 -> few-shot注入 -> 構造検証'],
  ['INTEL 可展示工件', 'INTEL表示アーティファクト'],
  ['Code as Prompt 子页 B：实验门禁与发布判定', 'Code as Prompt サブページB：実験ゲートとリリース判定'],
  ['以统计显著性和成本效率作为 prompt 变更准入条件', '統計的有意性とコスト効率をprompt変更の判定条件にする'],
  ['Code as Prompt 案例 KPI（打招呼）', 'Code as Prompt ケースKPI（挨拶）'],
  ['结论: 质量 +9，代价是 Tokens/Latency 上升', '結論: 品質 +9、ただし Tokens/Latency は増加'],
  ['Prompt 构成对比（Token 维度）', 'Prompt構成比較（Token視点）'],
  ['注入占比: 48.5%', '注入比率: 48.5%'],
  ['阶段影响判断（单案例）', '段階影響評価（単一ケース）'],
  ['V1/V2 稳态 + V3 注入触发有效变化', 'V1/V2は安定、V3注入で有効な変化'],
  ['结构不变', '構造は不変'],
  ['V2 程序化参数', 'V2 プログラム化パラメータ'],
  ['参数微调', 'パラメータ微調整'],
  ['证据1: basePromptTokens 274 -> 274 (不变)', '証拠1: basePromptTokens 274 -> 274 (不変)'],
  ['证据2: 注入 tokens 0 -> 258，countUsed=1', '証拠2: 注入tokens 0 -> 258, countUsed=1'],
  ['证据3: 输出质量 64 -> 73，与 V3 同步出现', '証拠3: 出力品質 64 -> 73、V3と同時に出現'],
  ['Prompt 文本差异指标（单案例）', 'Promptテキスト差分指標（単一ケース）'],
  ['可用于变更门禁的轻量指标', '変更ゲートに使える軽量指標'],
  ['门禁建议: 若 Prompt Tokens 增幅 > 80%，必须同步满足 Quality 增幅 >= +3 (当前 +9)', 'ゲート提案: Prompt Tokens増加率 > 80% の場合、Quality増加 >= +3 を必須 (現状 +9)'],
  ['Few-shot 注入机制与预算回退', 'Few-shot注入メカニズムと予算フォールバック'],
  ['输入短语', '入力フレーズ'],
  ['样本检索', 'サンプル検索'],
  ['质量筛选', '品質フィルタ'],
  ['预算检查', '予算チェック'],
  ['注入执行', '注入実行'],
  ['- budget_reduction: 缩减示例数', '- budget_reduction: 例示数を削減'],
  ['- budget_truncate: 截断示例内容', '- budget_truncate: 例示内容を切り詰め'],
  ['- budget_exceeded_disable: 回退 baseline', '- budget_exceeded_disable: baselineへフォールバック'],
  ['实验复现管线：run -> export -> chart -> report', '実験再現パイプライン：run -> export -> chart -> report'],
  ['输出: JSONL', '出力: JSONL'],
  ['输出: CSV/JSON + stats', '出力: CSV/JSON + stats'],
  ['输出: SVG charts', '出力: SVG charts'],
  ['输出: Markdown report', '出力: Markdown report'],
  ['数据集: 8+ CSV/JSON', 'データセット: 8+ CSV/JSON'],
  ['图表: 6 SVG', '図表: 6 SVG'],
  ['报告: 1 KPI + 1 Full', 'レポート: 1 KPI + 1 Full'],
  ['50 样本 Benchmark 设计分布', '50サンプル Benchmark 設計分布'],
  ['日常词汇', '日常語彙'],
  ['技术术语', '技術用語'],
  ['歧义复杂', '曖昧・複雑'],
  ['15 条 (30%)', '15件 (30%)'],
  ['20 条 (40%)', '20件 (40%)'],
  ['核心结果：Baseline vs Fewshot_r1', 'コア結果：Baseline vs Fewshot_r1'],
  ['分类洞察：不同类别的增益与 ROI', 'カテゴリ洞察：カテゴリ別の改善とROI'],
  ['蓝: Delta Quality', '青: Delta Quality'],
  ['绿: Gain/1k Tokens', '緑: Gain/1k Tokens'],
  ['局限与失败分解', '限界と失敗要因の分解'],
  ['评分器规则化', 'スコアラーのルール偏重'],
  ['Teacher 样本不足', 'Teacherサンプル不足'],
  ['预算回退触发', '予算フォールバック発生'],
  ['单轮对比覆盖', '単一ラウンド比較の偏り'],
  ['失败样本: 数据管道(基线失败)->fewshot成功；信息茧房(基线成功)->fewshot失败', '失敗サンプル: データパイプライン(baseline失敗)->fewshot成功；情報カプセル化(baseline成功)->fewshot失敗'],
  ['30/60/90 天优化路线图', '30/60/90日 最適化ロードマップ'],
  ['30天', '30日'],
  ['60天', '60日'],
  ['90天', '90日'],
  ['- Teacher 池扩容', '- Teacherプール拡張'],
  ['- 预算参数调优', '- 予算パラメータ調整'],
  ['- 失败重试机制', '- 失敗時リトライ機構'],
  ['- 向量召回', '- ベクトル検索'],
  ['- 动态示例裁剪', '- 動的な例示トリミング'],
  ['- Prompt 结构分层', '- Prompt構造のレイヤ化'],
  ['- 多 Teacher 融合', '- 複数Teacher統合'],
  ['- LLM 评分器', '- LLMスコアラー'],
  ['- 统一 LLM 层', '- 統一LLMレイヤ'],
  ['工程价值：可观测 + 可追溯 + 可复制', 'エンジニアリング価値：可観測 + 追跡可能 + 再現可能'],
  ['数据沉淀', 'データ蓄積'],
  ['可追溯性', '追跡可能性'],
  ['自动化复现', '自動再現'],
  ['统计可信度', '統計的信頼性'],
  ['手工流程', '手作業フロー'],
  ['自动化流程', '自動化フロー'],
  ['决策矩阵：收益、成本与优先级', '意思決定マトリクス：効果・コスト・優先度'],
  ['Token 成本增幅 (%)', 'Tokenコスト増加率 (%)'],
  ['质量增益 (分)', '品質改善 (点)'],
  ['维持现状', '現状維持'],
  ['扩充 Teacher 池', 'Teacherプール拡張'],
  ['预算调优0.25', '予算調整 0.25'],
  ['引入 LLM 评分器', 'LLMスコアラー導入'],
  ['建议优先级: 预算调优 + Teacher池扩容', '推奨優先度: 予算調整 + Teacherプール拡張'],
  ['目标：保持显著性，降低 token 成本', '目標: 有意性を維持しつつTokenコストを低減'],
  ['统计显著性证据：CI / p-value / Effect Size', '統計的有意性の証拠：CI / p-value / Effect Size'],
  ['历史对照：21样本实验 vs 50样本实验', '履歴比較：21サンプル実験 vs 50サンプル実験'],
  ['21样本: 7.33', '21サンプル: 7.33'],
  ['50样本: 1.88', '50サンプル: 1.88'],
  ['21样本: 14.14', '21サンプル: 14.14'],
  ['50样本: 4.88', '50サンプル: 4.88'],
  ['Token增幅(%)', 'Token増加率(%)'],
  ['21样本: 52.94', '21サンプル: 52.94'],
  ['50样本: 37.42', '50サンプル: 37.42'],
  ['结论：旧实验幅度更高，但存在评分器偏差', '結論: 旧実験は改善幅が大きいが、スコアラー偏差あり'],
  ['新实验提升幅度更小但统计更可靠', '新実験は改善幅が小さいが統計的により信頼可能'],
  ['实验产物覆盖：数据/图表/报告', '実験成果物カバレッジ：データ/図表/レポート'],
  ['Local Quality Trend by Round (exp_benchmark_50_20260209_140431)', 'ローカル品質トレンド（ラウンド別）(exp_benchmark_50_20260209_140431)'],
  ['Round Number', 'ラウンド番号'],
  ['Average Quality Score', '平均Quality Score']
]);

function localizeSvg(filename) {
  const src = path.join(chartsDir, filename);
  const dst = path.join(outDir, filename.replace(/\.svg$/, '_ja.svg'));

  if (!fs.existsSync(src)) {
    console.warn(`[warn] source svg missing: ${filename}`);
    return;
  }

  const raw = fs.readFileSync(src, 'utf8');
  const dom = new JSDOM(raw, { contentType: 'image/svg+xml' });
  const doc = dom.window.document;
  const nodes = doc.querySelectorAll('text, tspan');

  nodes.forEach((node) => {
    const current = (node.textContent || '').trim();
    if (!current) return;
    const mapped = textMap.get(current);
    if (mapped) {
      node.textContent = mapped;
    }
  });

  fs.writeFileSync(dst, doc.documentElement.outerHTML, 'utf8');
  console.log(`[ok] ${path.relative(repoRoot, dst)}`);
}

files.forEach(localizeSvg);
console.log(`[done] localized ${files.length} charts -> ${path.relative(repoRoot, outDir)}`);
