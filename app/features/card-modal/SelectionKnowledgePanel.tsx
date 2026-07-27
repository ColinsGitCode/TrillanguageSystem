import { CircleAlert, Search, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type {
  KnowledgeKind,
  LookupResult,
} from '../knowledge/types';
import type { CardLookupLanguage } from './selection-actions';

export type KnowledgeLookupDraft = {
  phrase: string;
  language: CardLookupLanguage | null;
  kind: KnowledgeKind;
};

type Props = {
  draft: KnowledgeLookupDraft;
  result: LookupResult | null;
  error: string;
  pending: boolean;
  onChange: (next: KnowledgeLookupDraft) => void;
  onSubmit: () => void;
  onClose: () => void;
};

const languageLabels: Record<CardLookupLanguage, string> = {
  en: 'English',
  ja: '日本語',
};

const kindLabels: Record<KnowledgeKind, string> = {
  lexeme: '单词',
  phrase: '短语',
  grammar_pattern: '语法',
};

export function SelectionKnowledgePanel({
  draft,
  result,
  error,
  pending,
  onChange,
  onSubmit,
  onClose,
}: Props) {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <aside
      ref={panelRef}
      className="card-knowledge-inspector"
      data-testid="card-knowledge-inspector"
      role="region"
      aria-labelledby="card-knowledge-title"
      tabIndex={-1}
    >
      <header>
        <Search aria-hidden="true" />
        <div>
          <span>KNOWLEDGE LOOKUP</span>
          <strong id="card-knowledge-title">查询选区</strong>
        </div>
        <button type="button" className="icon-button" aria-label="关闭知识点查询" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </header>

      <blockquote title={draft.phrase}>{draft.phrase}</blockquote>

      <fieldset>
        <legend>查询语言</legend>
        <div className="card-knowledge-segments">
          {(['en', 'ja'] as CardLookupLanguage[]).map((language) => (
            <button
              key={language}
              type="button"
              aria-pressed={draft.language === language}
              onClick={() => onChange({
                ...draft,
                language,
                kind: draft.kind === 'grammar_pattern' && language === 'en' ? 'phrase' : draft.kind,
              })}
            >
              {languageLabels[language]}
            </button>
          ))}
        </div>
        {!draft.language && (
          <p className="card-knowledge-hint">
            汉字选区无法可靠判断是中文还是日文，请先确认目标语言。
          </p>
        )}
      </fieldset>

      <fieldset>
        <legend>知识类型</legend>
        <div className="card-knowledge-segments">
          {(['lexeme', 'phrase', 'grammar_pattern'] as KnowledgeKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={draft.kind === kind}
              disabled={kind === 'grammar_pattern' && draft.language === 'en'}
              onClick={() => onChange({ ...draft, kind })}
            >
              {kindLabels[kind]}
            </button>
          ))}
        </div>
      </fieldset>

      <button
        type="button"
        className="card-knowledge-submit"
        disabled={!draft.language || pending}
        onClick={onSubmit}
      >
        <Search aria-hidden="true" />
        {pending ? '查询中…' : '确认查询'}
      </button>

      {error && (
        <p className="card-knowledge-error" role="alert">
          <CircleAlert aria-hidden="true" /> {error}
        </p>
      )}

      {result?.point && (
        <section className="card-knowledge-result" aria-label="知识点查询结果">
          <span>已解析 · {languageLabels[result.point.language as CardLookupLanguage] || result.point.language}</span>
          <strong>{result.point.canonicalForm}</strong>
          {result.point.canonicalReading && <p>{result.point.canonicalReading}</p>}
          <small>这次主动查询已记录为学习信号，不会直接修改 FSRS 调度。</small>
        </section>
      )}

      {result?.resolutionCase && (
        <section className="card-knowledge-result unresolved" aria-label="待确认知识点">
          <span>需要人工确认</span>
          <strong>{result.resolutionCase.normalizedInput}</strong>
          <p>系统没有猜测归属，已保留为待确认项。</p>
          <a href="/knowledge">前往知识点工作台</a>
        </section>
      )}
    </aside>
  );
}
