import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, History } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { ProductShell } from '../../components/ProductShell';
import {
  practiceApi, usePracticeAccess,
  type PracticeAttempt, type PracticeLanguage, type PracticePrompt, type PracticeRating,
} from './practice-api';

const languages = { ja: '日语', en: '英语' } as const;
const ratings: Record<PracticeRating, string> = { independent: '能独立表达', keep_practicing: '还要练' };
const historyKey = ['sentence-practice', 'history'] as const;

export function SentencePracticePage() {
  const [params] = useSearchParams();
  const sourceCard = params.has('card') ? Number(params.get('card')) : undefined;
  const access = usePracticeAccess();
  const queryClient = useQueryClient();
  const [language, setLanguage] = useState<PracticeLanguage>('ja');
  const [prompt, setPrompt] = useState<PracticePrompt | null>(null);
  const [attempt, setAttempt] = useState<PracticeAttempt | null>(null);
  const [draft, setDraft] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [saveNotice, setSaveNotice] = useState('');
  const history = useQuery({
    queryKey: historyKey, queryFn: practiceApi.history, enabled: Boolean(access.data && showHistory),
  });

  const issue = useMutation({
    mutationFn: practiceApi.issue,
    onSuccess: ({ prompt: next }) => {
      setLanguage(next.language);
      setPrompt(next);
      setAttempt(null);
      setDraft('');
      setSaveNotice('');
      setShowHistory(false);
    },
  });
  const submit = useMutation({
    mutationFn: ({ id, answer }: { id: string; answer: string }) => practiceApi.submit(id, answer),
    onSuccess: ({ attempt: saved }) => {
      setAttempt(saved);
      void queryClient.invalidateQueries({ queryKey: historyKey });
    },
  });
  const assess = useMutation({
    mutationFn: ({ id, ...values }: { id: string; selfAssessment?: PracticeRating; disputed?: boolean }) => practiceApi.assess(id, values),
    onSuccess: ({ attempt: saved }) => {
      setAttempt(saved);
      setSaveNotice('已保存');
      void queryClient.invalidateQueries({ queryKey: historyKey });
    },
  });
  const busy = issue.isPending || submit.isPending || assess.isPending;
  const error = issue.error || submit.error || assess.error;

  function start(nextLanguage: PracticeLanguage = language, previous?: PracticeAttempt, fromCard = true) {
    submit.reset();
    assess.reset();
    setSaveNotice('');
    issue.mutate({
      language: previous?.language ?? nextLanguage,
      ...(previous ? { previousId: previous.id } : fromCard && sourceCard !== undefined ? { generationId: sourceCard } : {}),
    });
  }

  function chooseLanguage(nextLanguage: PracticeLanguage) {
    if (nextLanguage === language) return;
    if (prompt) start(nextLanguage);
    else {
      issue.reset();
      setLanguage(nextLanguage);
    }
  }

  return (
    <ProductShell active="factory" title="练一句" focusMode>
      <section className="sentence-practice" aria-labelledby="sentence-practice-title">
        <header className="sentence-practice-nav">
          <Link to="/"><ArrowLeft aria-hidden="true" /> 返回首页</Link>
          {access.data && (
            <button className="practice-quiet" type="button" aria-expanded={showHistory} aria-controls="practice-history"
              onClick={() => setShowHistory(value => !value)}>
              <History aria-hidden="true" /> 练习记录
            </button>
          )}
        </header>
        <div className="sentence-practice-title">
          <h1 id="sentence-practice-title">练一句</h1>
          {access.data && (
            <div className="practice-language" role="group" aria-label="目标语言">
              {(Object.keys(languages) as PracticeLanguage[]).map(key => (
                <button key={key} type="button" aria-pressed={language === key}
                  disabled={busy || Boolean(prompt && !attempt && draft.trim())} onClick={() => chooseLanguage(key)}>
                  {languages[key]}
                </button>
              ))}
            </div>
          )}
        </div>

        {access.isPending && <p role="status">正在读取个人工作区…</p>}
        {access.isError && <p role="alert">暂时无法读取工作区。 <button type="button" onClick={() => void access.refetch()}>重试</button></p>}
        {access.data === false && <p>练一句仅在个人工作区可用。</p>}

        {access.data && !prompt && (
          <div className="practice-start">
            <span>{sourceCard ? '来自三语卡' : '今天练一句'} · {languages[language]}</span>
            <button type="button" className="practice-primary" disabled={busy} onClick={() => start()}>
              {issue.isPending ? '正在准备场景…' : '开始练习'} <ArrowRight aria-hidden="true" />
            </button>
          </div>
        )}

        {access.data && prompt && (
          <>
            <div className="practice-cue">
              <p>{prompt.scene}</p>
              <h2>{prompt.cue}</h2>
            </div>
            {!attempt ? (
              <form onSubmit={event => {
                event.preventDefault();
                if (draft.trim() && !busy) submit.mutate({ id: prompt.id, answer: draft });
              }}>
                <label className="practice-answer">你的作答
                  <textarea lang={prompt.language} rows={3} maxLength={500} value={draft}
                    autoComplete="off" spellCheck={false} disabled={busy} onChange={event => setDraft(event.target.value)} />
                </label>
                <div className="practice-actions">
                  <button type="submit" className="practice-primary" disabled={!draft.trim() || busy}>
                    {submit.isPending ? '正在获取反馈…' : '提交作答'}
                  </button>
                </div>
              </form>
            ) : (
              <section aria-label="练习反馈" className="practice-feedback">
                <p className="practice-label">你的作答</p>
                <p lang={attempt.language} className="practice-text">{attempt.answer}</p>
                <div aria-live="polite">
                  <h2 className="practice-label">AI 反馈</h2>
                  {attempt.feedback ? (
                    <>
                      <p>{attempt.feedback}</p>
                      {attempt.suggestion && <p lang={attempt.language} className="practice-suggestion">{attempt.suggestion}</p>}
                    </>
                  ) : (
                    <p>作答已保存，暂时没有反馈。 <button type="button" className="practice-quiet" disabled={busy}
                      onClick={() => submit.mutate({ id: attempt.id, answer: attempt.answer })}>
                      {submit.isPending ? '正在获取…' : '重试反馈'}
                    </button></p>
                  )}
                </div>
                <div className="practice-self" role="group" aria-label="自评">
                  {(Object.keys(ratings) as PracticeRating[]).map(rating => (
                    <button key={rating} type="button" aria-pressed={attempt.selfAssessment === rating} disabled={busy}
                      onClick={() => assess.mutate({ id: attempt.id, selfAssessment: rating })}>{ratings[rating]}</button>
                  ))}
                  <span role="status">{saveNotice}</span>
                </div>
                <div className="practice-actions">
                  {attempt.feedback && (
                    <button type="button" className="practice-quiet" aria-pressed={attempt.disputed} disabled={busy}
                      onClick={() => assess.mutate({ id: attempt.id, disputed: !attempt.disputed })}>
                      {attempt.disputed ? '已标记异议' : '我不同意'}
                    </button>
                  )}
                  <button type="button" className="practice-primary" disabled={busy} onClick={() => start(language, attempt)}>
                    {issue.isPending ? '正在换场景…' : '换个场景'} <ArrowRight aria-hidden="true" />
                  </button>
                </div>
              </section>
            )}
          </>
        )}

        {error && (
          <div className="practice-error" role="alert">
            {error.message}
            {!attempt && issue.isError && sourceCard !== undefined && (
              <button type="button" className="practice-quiet" disabled={busy} onClick={() => start(language, undefined, false)}>换一张卡</button>
            )}
          </div>
        )}

        {showHistory && (
          <section className="practice-history" id="practice-history" aria-labelledby="practice-history-title">
            <h2 id="practice-history-title">最近练习</h2>
            {history.isPending && <p role="status">正在读取练习记录…</p>}
            {history.isError && <p role="alert">练习记录无法读取。 <button type="button" onClick={() => void history.refetch()}>重试</button></p>}
            {history.data?.attempts.length === 0 && <p>还没有作答记录。</p>}
            <ul>
              {history.data?.attempts.map(item => (
                <li key={item.id}>
                  <div>
                    <p>{item.cue}</p>
                    <small>{languages[item.language]} · {new Date(item.answeredAt).toLocaleDateString('zh-CN')}
                      {item.selfAssessment ? ' · ' + ratings[item.selfAssessment] : ''}
                      {item.disputed ? ' · 有异议' : ''}</small>
                  </div>
                  <button type="button" className="practice-quiet" disabled={busy || Boolean(prompt && !attempt && draft.trim())}
                    onClick={() => start(item.language, item)}>换场景再练</button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </section>
    </ProductShell>
  );
}
