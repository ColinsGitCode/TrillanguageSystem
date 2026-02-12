# Trilingual Records: Few-shot 品質向上レポート構成 (Final)

**発表テーマ**: Code as Prompt — コード進化で駆動するローカルLLM品質向上実践  
**対象**: 技術レビュー / プロジェクト管理 / アーキテクト・アルゴリズムチーム  
**技術スタック**: Node.js + D3.js + Gemini 3 Pro (Teacher) + Qwen 2.5-7B (Student)  
**注記**: 本文では実験IDを厳密に分離し、異なる実験間で結論を混在させない



## Slide 1 表紙：課題と目標

- 目標（1文）：クラウド推論を主経路に依存せず、ローカルLLMの出力品質を測定可能な形で改善する。
- 主要内容：
  - 業務シナリオ：テキスト/OCR -> 三言語カード + TTS
  - 主要課題：品質・安定性・コストのトレードオフ
  - 今回の検証問い：**few-shotは統計的に有効か**

![Slide 1 Chart](TestDocs/charts/ja/slide_01_goal_triangle_ja.svg)

**スピーカーノート**：最初に課題を定義し、後続はデータと統計検定で検証する。冒頭で「統計的有意」を基準として提示する。  
**Data Source**: `Docs/TestDocs/data/round_metrics_exp_benchmark_50_20260209_140431.csv`



## Slide 2 成功基準：評価フレームワーク

- 目標（1文）：まず「最適化成功」を定義し、その後に結果を見る。
- 主要内容：
  - 主要指標：`Quality Score`、`Success Rate`
  - 制約指標：`Avg Tokens`、`Avg Latency`
  - 効率指標：`Gain per 1k Extra Tokens = DeltaQuality / (DeltaTokens/1000)`
  - 安定性指標：`Quality CV%`
  - **統計指標**：`p-value`、`95% CI`、`Cohen's d`

![Slide 2 Chart](TestDocs/charts/ja/slide_02_kpi_framework_ja.svg)

**スピーカーノート**：ポイントは3つ：点数だけで判断しない、コストを必ず併記する、結論は統計で裏付ける。  
**Data Source**: `Docs/TestDocs/data/round_kpi_summary_exp_benchmark_50_20260209_140431.json`



## Slide 3 システム構成：プロダクトから可観測へ

- 目標（1文）：システムがなぜ再現可能実験を支えられるかを示す。
- 主要内容：
  - フロントエンド：生成ページ + Mission Control
  - バックエンド：`server.js`編成、provider切替、比較モード
  - ストレージ：ファイルシステム + SQLite（実験テーブル含む）
  - 要点：全生成リクエストを`experiment_samples` + `observability_metrics`へ自動記録

![Slide 3 Chart](TestDocs/charts/ja/slide_03_system_observability_ja.svg)

**スピーカーノート**：「なぜ実験できるか」を構造化保存と追跡チェーンに帰着させる。  
**Data Source**: `Docs/SystemDevelopStatusDocs/BACKEND.md`, `Docs/SystemDevelopStatusDocs/API.md`



## Slide 4 Code as Prompt — コード即プロンプト

- 目標（1文）：Promptは「反復可能なコードシステム」であり、「一回きりの文章」ではない。
- 進化主線：V1 静的テンプレート -> V2 プログラム組み立て -> V3 実行時few-shot注入。
- 単一ケース指標（挨拶）：Quality `64 -> 73`（`+14.1%`）、Tokens `870 -> 1291`（`+48.4%`）、Latency `27.6s -> 34.4s`（`+24.8%`）。
- 報告の焦点：各Prompt変更は可観測・再生可能・ゲート判定可能。

![Slide 4 Chart](TestDocs/charts/ja/slide_04_code_as_prompt_timeline_ja.svg)

**スピーカーノート**：まず「Promptの工学化」を主張し、その後にデータとメカニズムへ入る。  
**Data Source**: `services/promptEngine.js`, `services/goldenExamplesService.js`, `Docs/TestDocs/data/rounds/exp_benchmark_50_20260209_140431/*.jsonl`



## Slide 4.1 システム可観測性サブページA：データモデルと追跡関係

- 目標（1文）：品質問題を「サンプル-プロンプト-出力-指標」の全チェーンで特定できる。
- データ領域：業務生成テーブル + few-shot実験テーブル + teacher参照テーブル。
- 再生フィールド：`promptFull`、`rawOutput`、`metadata.fewShot`、`quality/tokens/latency`。
- 報告観点：異常サンプルは1本のSQLで起点と影響範囲を追跡可能。

![Slide 4.1 Chart](TestDocs/charts/ja/slide_04a_observability_data_model_ja.svg)

**スピーカーノート**：「追跡可能性」が実験信頼性の前提である点を強調。  
**Data Source**: `Docs/SystemDevelopStatusDocs/BACKEND.md`, `Docs/SystemDevelopStatusDocs/API.md`



## Slide 4.2 システム可観測性サブページB：収集タイムラインと指標配置

- 目標（1文）：指標は正しい工程で収集する必要があり、そうでなければ品質変化を説明できない。
- 時系列ノード：`request -> promptBuild -> llmCall -> parse -> save -> persist`。
- 指標グループ：品質、Token、遅延、few-shot注入メタデータ。
- データ整合性：API返却値・DB・実験レポートの3点照合。

![Slide 4.2 Chart](TestDocs/charts/ja/slide_04b_observability_timeline_ja.svg)

**スピーカーノート**：このページは「いつ何を収集するか」に限定し、アルゴリズム詳細には踏み込まない。  
**Data Source**: `server.js`, `Docs/SystemDevelopStatusDocs/API.md`, `Docs/SystemDevelopStatusDocs/BACKEND.md`



## Slide 4.3 Code as Prompt サブページA：実行時組み立てアーキテクチャ

- 目標（1文）：Prompt工学を差し替え可能なコンポーネントへ分解し、「全面書き換え」を避ける。
- 4層構造：テンプレート層 / 組み立て層 / 注入層 / 検証層。
- 主要インターフェース：`buildPrompt()`、`getRelevantExamples()`、`buildEnhancedPrompt()`。
- 工学的メリット：局所調整を独立回帰でき、段階リリース可能。

![Slide 4.3 Chart](TestDocs/charts/ja/slide_04c_code_as_prompt_architecture_ja.svg)

**スピーカーノート**：「プロンプト技巧」ではなく「保守可能アーキテクチャ」を強調。  
**Data Source**: `services/promptEngine.js`, `services/goldenExamplesService.js`, `services/observabilityService.js`



## Slide 4.4 Code as Prompt サブページB：実験ゲートとリリース判定

- 目標（1文）：Promptリリースは「指標ゲート」で判定し、「主観判断」に依存しない。
- ゲート指標：`deltaQuality`、`pValue`、`tokenIncreasePct`、`gainPer1kTokens`。
- 判定ルール：品質向上 + 有意性 + コスト制約を同時に満たす。
- 結論：品質改善は成立するが、token膨張が主ボトルネック。

![Slide 4.4 Chart](TestDocs/charts/ja/slide_04d_code_as_prompt_gates_ja.svg)

**スピーカーノート**：「実験結論」を実行可能なリリース戦略へ変換する。  
**Data Source**: `Docs/TestDocs/data/round_metrics_exp_benchmark_50_20260209_140431.csv`, `Docs/TestDocs/data/round_kpi_summary_exp_benchmark_50_20260209_140431.json`



## Slide 4.5 Code as Prompt サブページC：単一ケースKPI比較（データ主図）

- 目標（1文）：1つの実例で「効果と代償」を迅速に示す。
- 品質：`64 -> 73`（`+9`、`+14.1%`）。
- コスト：Tokens `+421`（`+48.4%`）、Latency `+6835ms`（`+24.8%`）。
- 運用アクション：few-shotを維持しつつ、注入長と予算比率を継続圧縮。

![Slide 4.5 Chart](TestDocs/charts/ja/slide_04e_code_as_prompt_case_kpi_ja.svg)

**スピーカーノート**：ビジネス側に最も直感的なページ。  
**Data Source**: `Docs/TestDocs/data/rounds/exp_benchmark_50_20260209_140431/baseline.jsonl`, `Docs/TestDocs/data/rounds/exp_benchmark_50_20260209_140431/fewshot_r1.jsonl`



## Slide 4.6 Code as Prompt サブページD：Prompt Token構成（予算視点）

- 目標（1文）：「なぜtokenが増えるか」を説明する。
- ベースPrompt：`274`（2ラウンド不変）。
- 注入Token：`0 -> 258`；総Prompt：`274 -> 532`。
- 注入効率：本ケース `countRequested=2`、`countUsed=1`、注入比率 `48.5%`。

![Slide 4.6 Chart](TestDocs/charts/ja/slide_04f_code_as_prompt_composition_ja.svg)

**スピーカーノート**：予算パラメータ調整（`tokenBudgetRatio` / 例示長トリミング）へ直結。  
**Data Source**: `Docs/TestDocs/data/rounds/exp_benchmark_50_20260209_140431/fewshot_r1.jsonl`



## Slide 4.7 Code as Prompt サブページE：段階別寄与（V1/V2/V3）

- 目標（1文）：品質改善が主にどの段階由来かを明確化。
- V1：構造は安定し、追加の改善信号なし。
- V2：パラメータ微調整で小幅影響。
- V3：few-shot注入後に品質改善が同時発生（`64 -> 73`）。

![Slide 4.7 Chart](TestDocs/charts/ja/slide_04g_code_as_prompt_stage_impact_ja.svg)

**スピーカーノート**：「今回の改善はどこに効いたか」への回答に使う。  
**Data Source**: `Docs/TestDocs/data/rounds/exp_benchmark_50_20260209_140431/*.jsonl`



## Slide 4.8 Code as Prompt サブページF：Prompt差分ゲート（リリース前チェック）

- 目標（1文）：Prompt変更に軽量ゲートを追加し、コスト暴走を防ぐ。
- 差分指標：Chars `+94.0%`、Lines `+83.7%`、Prompt Tokens `+94.2%`。
- 品質連動：Prompt Tokens増加率 > `80%` の場合、品質増加 >= `+3` を要求。
- 本ケース状態：品質 `+9` で連動ゲートは満たすが、さらなるコスト低減が必要。

![Slide 4.8 Chart](TestDocs/charts/ja/slide_04h_code_as_prompt_prompt_diff_metrics_ja.svg)

**スピーカーノート**：このページは「実行可能なゲート閾値」を提示し、チーム審査基準を統一する。  
**Data Source**: `Docs/TestDocs/data/rounds/exp_benchmark_50_20260209_140431/*.jsonl`



## Slide 5 Few-shotメカニズム：Teacherサンプル注入

- 目標（1文）：few-shotは単なるON/OFFではなく、検索と選別戦略を持つことを示す。
- 主要内容：
  - サンプル取得優先順位：
    1. 同一実験 `teacher_references`（SQL検索、quality_score DESC）
    2. 過去の高品質サンプル（既定gemini、bigram類似度で再順位付け）
  - 選別条件：`minScore >= 80`、bigramキーワード類似度順
  - Token予算：`contextWindow * tokenBudgetRatio`
  - フォールバック連鎖：`budget_reduction -> budget_truncate -> budget_exceeded_disable`
  - **コード対応**：
    - `goldenExamplesService.js:bigramSimilarity()` -> Dice coefficient 実装
    - `server.js:handleFewShotInjection()` -> 予算計算とフォールバックロジック

![Slide 5 Chart](TestDocs/charts/ja/slide_05_injection_mechanism_ja.svg)

**スピーカーノート**：「なぜこの仕組みが品質を上げうるか」と、予算制御がtoken膨張をどう抑えるかを説明。  
**Data Source**: `server.js`, `services/goldenExamplesService.js`



## Slide 6 ワンクリック再現 — 実験実行性

- 目標（1文）：実験実行からレポート生成までをスクリプト化し、誰でも5分で再現可能。
- 主要内容：
  - 実験パイプライン4ステップ：
    ```text
    run_fewshot_rounds.js           -> 実験実行、JSONL出力
    export_round_trend_dataset.js   -> データ出力 + 統計検定
    render_round_trend_charts.mjs   -> D3で6種のSVG図表を描画
    generate_round_kpi_report.js    -> KPIレポートMarkdownを生成
    ```
  - ワンコマンド実行：
    ```bash
    node scripts/run_fewshot_rounds.js benchmark_phrases_50.txt $EXP_ID rounds.json
    node scripts/export_round_trend_dataset.js $EXP_ID
    node d3/render_round_trend_charts.mjs data/round_trend_$EXP_ID.json
    node scripts/generate_round_kpi_report.js $EXP_ID
    ```
  - 成果物：JSONデータセット + CSV + SVG図表 + Markdownレポート

![Slide 6 Chart](TestDocs/charts/ja/slide_06_repro_pipeline_ja.svg)

**スピーカーノート**：「再現可能性」が科学的方法の基礎。コードは実験記録であり、git logは実験ログ。  
**Data Source**: `scripts/run_fewshot_rounds.js`, `scripts/export_round_trend_dataset.js`, `scripts/generate_round_kpi_report.js`



## Slide 7 実験設計：50サンプル Benchmark

- 目標（1文）：カテゴリラベル付き50フレーズでfew-shot効果を体系検証。
- 主要内容：
  - **実験 ID**: `exp_benchmark_50_20260209_140431`
  - **サンプル設計**：
    - 日常語彙 (15件)：挨拶、応援、乾杯...
    - 技術用語 (20件)：API Gateway、Prompt Engineering、ベクトルDB...
    - 曖昧/複雑 (15件)：文脈依存表現、煽動表現、比喩表現...
  - **比較**：baseline (few-shotなし) vs fewshot_r1 (2例示)
  - **改善点**：スコアラー偏差修正 + 例示選定強化 + 統計検定導入

![Slide 7 Chart](TestDocs/charts/ja/slide_07_benchmark_design_ja.svg)

**スピーカーノート**：「今回の実験は以前の21サンプルより信頼できる」ことを明示し、カテゴリ設計の価値を説明。  
**Data Source**: `Docs/TestDocs/data/benchmark_phrases_50.txt`



## Slide 8 結果：50サンプル実験データ

- 目標（1文）：few-shot改善は統計的に有意だが、改善幅は正直に報告する。
- 主要データ：

| 指標 | Baseline | Fewshot_r1 | Delta |
|------|-------:|-------:|------:|
| 成功率 | 98% | 98% | 0 |
| 平均品質 | 75.00 | 76.88 | **+1.88** |
| 平均Tokens | 1029 | 1414 | +385 (+37%) |
| 品質 CV% | 5.22% | 4.16% | **-1.06pp** |
| Gain/1k Tokens | - | 4.88 | - |

- **統計検定**：
  - 対応あり t-test: **p = 0.0005**
  - Wilcoxon: **p = 0.0010**
  - 95% CI: **[0.84, 2.83]**
  - Cohen's d: **0.537 (medium)**

![Slide 8 Chart](TestDocs/charts/ja/slide_08_core_results_ja.svg)
![Benchmark Quality Trend](TestDocs/charts/ja/round_quality_trend_exp_benchmark_50_20260209_140431_ja.svg)

**スピーカーノート**：先に結論を示し、次に代償を説明する。旧実験 +7.33 のうちスコアラー偏差を切り分け、信頼性を担保する。  
**Data Source**: `Docs/TestDocs/data/round_metrics_exp_benchmark_50_20260209_140431.csv`



## Slide 9 カテゴリ洞察：誰が最も恩恵を受けるか？

- 目標（1文）：日常語彙の改善が最大で、技術用語の改善余地は限定的。
- 主要データ：

| カテゴリ | Baseline 品質 | Fewshot 品質 | Delta | Gain/1k Tokens |
|------|-------:|-------:|------:|------:|
| 日常語彙 | 73.47 | 77.20 | **+3.73** | **9.06** |
| 技術用語 | 77.95 | 78.85 | +0.90 | 2.33 |
| 曖昧/複雑 | 77.80 | 79.21 | +1.41 | 3.75 |

- **傾向**：baseline品質が低いほどfew-shotの改善幅が大きい
- **解釈**：
  - 日常語彙は短文のため、モデルが例示誘導を必要とする
  - 技術用語は情報密度が高く、baselineが比較的強い
  - 曖昧表現は「多義展開」例示の恩恵を受ける

![Slide 9 Chart](TestDocs/charts/ja/slide_09_category_insights_ja.svg)

**スピーカーノート**：「シーンごとに効果が異なる」という粒度の高い洞察を伝え、一律結論を避ける。  
**Data Source**: `Docs/TestDocs/benchmark_experiment_report.md`



## Slide 10 自己批判：既知課題と限界

- 目標（1文）：不足を認めることは欠陥を隠すより価値が高い。
- 主要内容：
  1. **スコアラーは依然ルール駆動**：意味精度と翻訳流暢性を十分評価できない
  2. **Teacherサンプルプール活用不足**：本実験ではGemini Teacher参照を事前注入していない
  3. **Token予算が逼迫**：contextWindow=2048, budget≈368 tokens で一部例示が切り詰められた
  4. **単一ラウンド比較**：baseline vs fewshot_r1 のみで、多ラウンド漸進を未検証
  5. **旧実験の偏差補正**：+7.33 のうち約 5.45 はスコアラー長さバイアス、実質寄与は +1.88
  - **コード面の修正**：
    - `observabilityService.js`: `markdown.length > 500` -> 三言語構造の完全性チェック
    - `goldenExamplesService.js`: `LENGTH()` 近傍 -> bigram 類似度再ランキング

![Slide 10 Chart](TestDocs/charts/ja/slide_10_limitations_ja.svg)

**スピーカーノート**：課題を先に開示して信頼を獲得する。各限界に実行可能な改善策を対応させる。  
**Data Source**: `Docs/TestDocs/benchmark_experiment_report.md`



## Slide 11 最適化ロードマップ：コード変更駆動

- 目標（1文）：各最適化方針を具体的なコード変更に紐付ける。
- 主要内容：

| 段階 | 最適化方針 | コード変更 | 期待効果 |
|------|------|------|------|
| 30日 | Teacherプール拡張 | `run_fewshot_rounds.js` に teacher-seed ラウンド追加 | quality +2~3 |
| 30日 | token予算緩和 | `tokenBudgetRatio: 0.18 -> 0.25` | フォールバック減少 |
| 60日 | bigramを意味検索へ置換 | `goldenExamplesService.js` -> ベクトル検索 | 例示関連度 +50% |
| 60日 | LLMスコアラー | `observabilityService.js` -> GPT/Gemini 評価 | 評価精度向上 |
| 90日 | 複数Teacher統合 | 新規 `teacherFusionService.js` | 多ソース整合性 |
| 90日 | Unified LLM Layer | `llmUnifiedService.js` (Vercel AI SDK) | 保守コスト低減 |

![Slide 11 Chart](TestDocs/charts/ja/slide_11_roadmap_ja.svg)

**スピーカーノート**：ロードマップをスローガンにしない。各項目をファイルレベル変更へ落とし込む。  
**Data Source**: `Docs/DesignDocs/CodeAsPrompt/Few-Shot机制设计方案.md`, `Docs/DesignDocs/LLM_Provider_Unified_Layer_Design.md`



## Slide 12 エンジニアリング価値：可観測 + 追跡可能 + 再現可能

- 目標（1文）：few-shotはモデル最適化だけでなく、開発効率最適化でもある。
- 主要内容：
  - **可観測**：各生成で token・遅延・品質スコアを SQLite に自動記録
  - **追跡可能**：実験パラメータ、サンプル、出力、指標を全経路で再確認可能
  - **再現可能**：スクリプト化パイプラインで新環境でも実験を再実行可能
  - **検証可能**：統計検定をエクスポートスクリプトへ統合し、p-value/CI を自動出力
  - **コード証拠**：
    - `databaseService.js` -> 11テーブルを自動作成
    - `statisticsService.js` -> 4種類の検定を外部依存なしで実行
    - `export_round_trend_dataset.js` -> 出力時に自動で対応検定

![Slide 12 Chart](TestDocs/charts/ja/slide_12_engineering_value_ja.svg)

**スピーカーノート**：「アルゴリズム収益」から「開発生産性収益」へ議論を引き上げる。コード自体がドキュメント。  
**Data Source**: `Docs/SystemDevelopStatusDocs/BACKEND.md`, `Docs/TestDocs/data/round_kpi_summary_exp_benchmark_50_20260209_140431.json`



## Slide 13 まとめと意思決定リクエスト

- 目標（1文）：継続投資の方向と受け入れ基準を確定する。
- 主要結論：
  - Few-shot改善は**統計的有意** (p=0.0005, d=0.537)
  - 実質改善は **+1.88点**（スコアラー偏差補正後）
  - 日常語彙の恩恵が最大 (+3.73)、技術用語は限定的 (+0.90)
  - 安定性は改善 (CV: 5.22% -> 4.16%)
  - Tokenコスト +37%、遅延 +6%
- 意思決定リクエスト：
  1. Teacherプール拡張を承認（想定 +2~3 品質改善）
  2. token予算を 0.25 に緩和（フォールバック切り詰めを減少）
  3. ルール評価をLLMスコアラーへ置換開始
  4. 30/60/90日 KPI閾値を確定

![Slide 13 Chart](TestDocs/charts/ja/slide_13_decision_matrix_ja.svg)

**スピーカーノート**：用数据说话，以决策请求收尾。每个请求都绑定可量化预期收益。  
**Data Source**: `Docs/TestDocs/完整测试报告_20260206.md`, `Docs/TestDocs/benchmark_experiment_report.md`



## Slide 14 付録：統計的有意性詳細ページ

- 目標（1文）：有意性は口頭主張ではなく、完全な証拠チェーンで示す。
- 主要内容：
  - Mean diff: +1.83
  - 95% CI: [0.84, 2.83]
  - paired t-test p=0.0005
  - Wilcoxon p=0.0010
  - Cohen's d=0.537（medium）

![Slide 14 Chart](TestDocs/charts/ja/slide_14_statistical_evidence_ja.svg)

**Data Source**: `Docs/TestDocs/data/round_kpi_summary_exp_benchmark_50_20260209_140431.json`



## Slide 15 付録：履歴実験比較（21 vs 50）

- 目標（1文）：旧実験の改善幅が大きく、新実験の信頼性が高い理由を説明する。
- 主要内容：
  - 21サンプル実験：改善幅は大きいが、スコアラー偏差の影響が高い
  - 50サンプル実験：改善幅は小さいが、統計的有意性がより完全
  - 方針：今後は「有意性 + 再現可能性」を受け入れ主基準にする

![Slide 15 Chart](TestDocs/charts/ja/slide_15_historical_comparison_ja.svg)

**Data Source**: `Docs/TestDocs/data/round_metrics_exp_round_local20plus_20260206_073637.csv`, `Docs/TestDocs/data/round_metrics_exp_benchmark_50_20260209_140431.csv`



## Slide 16 付録：実験成果物カバレッジ

- 目標（1文）：現在の実験体系の「資産化レベル」を定量化する。
- 主要内容：
  - データファイル規模
  - 図表成果物規模
  - レポート蓄積規模
  - 再確認・監査・再現が可能な技術資産庫を形成

![Slide 16 Chart](TestDocs/charts/ja/slide_16_artifact_coverage_ja.svg)

**Data Source**: `Docs/TestDocs/` 文件系统统计

---

*Data Baseline: `exp_benchmark_50_20260209_140431` | Pipeline: run -> export -> chart -> report | Statistical tests: paired t-test, Wilcoxon, 95% CI, Cohen's d*  
*D3 Chart Script: `d3/localize_slides_charts_ja.mjs` -> output `Docs/TestDocs/charts/ja/*_ja.svg`*
