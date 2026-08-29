import type { GenerationRecord } from '../factory/types';

function parseObject(value: unknown): Record<string, number> {
  if (value && typeof value === 'object') return value as Record<string, number>;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as Record<string, number>; } catch { return {}; }
  }
  return {};
}

// Mirrors the maxima in services/observability/observabilityService.js. The
// stored dimensions are raw points, not percentages: completeness 40/40 is a
// perfect score, so drawing it as a 40% bar reads as a failure. contentLength
// is a character count the backend explicitly excludes from the total, so it
// is a fact, not a bar.
const SCORE_DIMENSIONS: Array<{ key: string; label: string; max: number }> = [
  { key: 'completeness', label: '完整性', max: 40 },
  { key: 'accuracy', label: '准确性', max: 30 },
  { key: 'exampleQuality', label: '例句质量', max: 20 },
  { key: 'formatting', label: '格式规范', max: 10 },
];

const EXTRA_DIMENSION_LABELS: Record<string, string> = {
  contentLength: '正文长度',
};

function textValue(value: unknown) {
  if (!value) return 'N/A';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

export function IntelPanel({ record }: { record: GenerationRecord | null }) {
  const obs = record?.observability;
  const score = Number(obs?.quality_score || 0);
  const dimensions = parseObject(obs?.quality_dimensions);
  const metadata = obs?.metadata || {};
  const provider = String(metadata.provider || record?.llm_provider || 'deepseek').toUpperCase();
  const model = String(metadata.model || record?.llm_model || 'unknown');
  const scored = SCORE_DIMENSIONS
    .filter((dimension) => dimension.key in dimensions)
    .map((dimension) => ({ ...dimension, value: Number(dimensions[dimension.key]) || 0 }));
  // Anything the backend adds later is surfaced as a plain fact rather than a
  // bar, because its scale is unknown here and a guessed bar would mislead.
  const extras = Object.entries(dimensions)
    .filter(([key]) => !SCORE_DIMENSIONS.some((dimension) => dimension.key === key))
    .map(([key, value]) => ({ key, label: EXTRA_DIMENSION_LABELS[key] || key, value: Number(value) || 0 }));

  return (
    <div className="intel-grid" data-testid="react-card-intel">
      <section className="intel-score-panel">
        <p className="eyebrow">内容质量</p>
        <strong>{score}</strong>
        <span>{score >= 80 ? '可使用' : score >= 60 ? '建议检查' : '需要检查'}</span>
      </section>
      <section className="intel-panel">
        <p className="eyebrow">生成信息</p>
        <dl className="intel-facts">
          <div><dt>生成服务</dt><dd>{provider}</dd></div>
          <div><dt>模型</dt><dd>{model}</dd></div>
          <div><dt>耗时</dt><dd>{Number(obs?.performance_total_ms || 0)} ms</dd></div>
          <div><dt>Token 用量</dt><dd>{Number(obs?.tokens_total || 0)}</dd></div>
          <div><dt>估算成本</dt><dd>${Number(obs?.cost_total || 0).toFixed(6)}</dd></div>
        </dl>
      </section>
      <section className="intel-panel intel-wide">
        <p className="eyebrow">质量维度</p>
        {scored.length ? (
          <div className="intel-bars">
            {scored.map(({ key, label, max, value }) => (
              <div className="intel-bar" key={key}>
                <span>{label}</span><strong>{value}<small> / {max}</small></strong>
                <div><i style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} /></div>
              </div>
            ))}
          </div>
        ) : <p className="empty-copy">暂无分项质量数据</p>}
        {extras.length ? (
          <dl className="intel-facts intel-dimension-extras">
            {extras.map(({ key, label, value }) => (
              <div key={key}><dt>{label}</dt><dd>{value}</dd></div>
            ))}
          </dl>
        ) : null}
      </section>
      <section className="intel-panel intel-wide">
        <p className="eyebrow">生成要求</p>
        <pre>{textValue(obs?.prompt_full || obs?.prompt_parsed)}</pre>
      </section>
      <section className="intel-panel intel-wide">
        <p className="eyebrow">模型原始输出</p>
        <pre>{textValue(obs?.llm_output)}</pre>
      </section>
    </div>
  );
}
