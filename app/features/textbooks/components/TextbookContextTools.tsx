import { ContextTools } from '../../../components/workflow';
import type { TextbookReviewTask } from '../types';

function shortHash(value: string) {
  return value ? `${value.slice(0, 8)}…${value.slice(-6)}` : 'not set';
}

export function TextbookContextTools({ task }: { task: TextbookReviewTask | null }) {
  if (!task) return <ContextTools title="校对上下文"><p>选择表达后查看来源与确定性检查。</p></ContextTools>;
  const minConfidence = Math.min(...Object.values(task.confidence).filter(Number.isFinite));
  const sourceLabel = Object.keys(task.source.provenance).length ? 'Skill manifest' : '来源未登记';
  return (
    <ContextTools
      title="校对上下文"
      sections={[
        {
          label: '来源',
          value: <><strong>{sourceLabel}</strong><p>官方 EN/JA 原文保持独立；中文、ruby 和分析为派生内容。</p></>,
        },
        {
          label: '确定性检查',
          value: (
            <ul className="textbook-deterministic-checks">
              <li className={task.reasons.includes('missing-ruby') ? 'warning' : 'ok'}>汉字 ruby：{task.reasons.includes('missing-ruby') ? '待补充' : '通过'}</li>
              <li className={minConfidence < .85 ? 'warning' : 'ok'}>最低置信度：{Number.isFinite(minConfidence) ? `${Math.round(minConfidence * 100)}%` : '未知'}</li>
              <li className={task.reasons.length ? 'warning' : 'ok'}>审查原因：{task.reasons.join(', ') || '无'}</li>
            </ul>
          ),
        },
        {
          label: '内容身份',
          value: <><code>EN {shortHash(task.source.enUnitHash)}</code><code>JA {shortHash(task.source.jaUnitHash)}</code></>,
        },
        {
          label: 'Source span',
          value: <pre>{JSON.stringify(task.source.spans, null, 2)}</pre>,
        },
      ]}
    />
  );
}
