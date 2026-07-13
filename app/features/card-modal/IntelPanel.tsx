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
        <p className="eyebrow">QUALITY</p>
        <strong>{score}</strong>
        <span>{score >= 80 ? 'READY' : score >= 60 ? 'REVIEW' : 'CHECK'}</span>
      </section>
      <section className="intel-panel">
        <p className="eyebrow">GENERATION</p>
        <dl className="intel-facts">
          <div><dt>Provider</dt><dd>{provider}</dd></div>
          <div><dt>Model</dt><dd>{model}</dd></div>
          <div><dt>Latency</dt><dd>{Number(obs?.performance_total_ms || 0)} ms</dd></div>
          <div><dt>Tokens</dt><dd>{Number(obs?.tokens_total || 0)}</dd></div>
          <div><dt>Cost</dt><dd>${Number(obs?.cost_total || 0).toFixed(6)}</dd></div>
        </dl>
      </section>
      <section className="intel-panel intel-wide">
        <p className="eyebrow">QUALITY DIMENSIONS</p>
        <div className="intel-bars">
          {Object.entries(dimensions).length ? Object.entries(dimensions).map(([label, value]) => (
            <div className="intel-bar" key={label}>
              <span>{label}</span><strong>{value}</strong>
              <div><i style={{ width: `${Math.max(0, Math.min(100, Number(value)))}%` }} /></div>
            </div>
          )) : <p className="empty-copy">No dimension data</p>}
        </div>
      </section>
      <section className="intel-panel intel-wide">
        <p className="eyebrow">PROMPT</p>
        <pre>{textValue(obs?.prompt_full || obs?.prompt_parsed)}</pre>
      </section>
      <section className="intel-panel intel-wide">
        <p className="eyebrow">MODEL OUTPUT</p>
        <pre>{textValue(obs?.llm_output)}</pre>
      </section>
    </div>
  );
}
