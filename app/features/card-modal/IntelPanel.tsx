import type { GenerationRecord } from '../factory/types';

function parseObject(value: unknown): Record<string, number> {
  if (value && typeof value === 'object') return value as Record<string, number>;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as Record<string, number>; } catch { return {}; }
  }
  return {};
}

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
        <div className="intel-bars">
          {Object.entries(dimensions).length ? Object.entries(dimensions).map(([label, value]) => (
            <div className="intel-bar" key={label}>
              <span>{label}</span><strong>{value}</strong>
              <div><i style={{ width: `${Math.max(0, Math.min(100, Number(value)))}%` }} /></div>
            </div>
          )) : <p className="empty-copy">暂无分项质量数据</p>}
        </div>
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
