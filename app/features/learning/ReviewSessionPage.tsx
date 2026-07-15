import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, Play, SkipForward, Volume2, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ProductShell } from '../../components/ProductShell';
import { ApiError } from '../../lib/api/client';
import { CardModal } from '../card-modal/CardModal';
import { renderCardMarkdown } from '../card-modal/markdown';
import type { CardSelection } from '../factory/types';
import { learningApi } from './learning-api';
import { itemPresentation, RATING_OPTIONS, reasonLabel, relativeDue } from './learning-format';
import type { LearningSession, ReviewResponse, StudyItem } from './types';

type PendingReview = {
  eventKey: string;
  queueEntryId: number;
  studyItemId: number;
  rating: number;
  expectedScheduleVersion: number;
  responseMs: number;
};

function reviewErrorMessage(error: Error) {
  if (error instanceof ApiError && error.payload && typeof error.payload === 'object' && 'code' in error.payload) {
    const code = String((error.payload as { code?: string }).code || '');
    if (code === 'LEARNING_SCHEDULE_CONFLICT') return '这项内容的调度状态已变化。返回今日学习后重新进入再评分。';
    if (code === 'LEARNING_SOURCE_INELIGIBLE' || code === 'LEARNING_ITEM_ARCHIVED') return '当前卡片已归档或不再符合学习条件。请跳过此项。';
    if (code === 'LEARNING_STORAGE_BUSY') return '学习记录存储正忙。当前评分尚未写入，可以使用同一请求重试。';
  }
  return error.message || '评分未保存。当前项已保留。';
}

function SessionSummary({ session, onBack }: { session: LearningSession; onBack: () => void }) {
  return (
    <section className="learning-session-summary" data-testid="learning-session-summary">
      <p className="eyebrow">SESSION SUMMARY</p>
      <h1>{session.status === 'completed' ? '本次队列已完成' : '本次会话已结束'}</h1>
      <p>已提交 {session.reviewSummary.total} 个评分。未完成项目已回到今日队列，不计为失败。</p>
      <div className="learning-rating-summary">
        {RATING_OPTIONS.map((option) => <div key={option.value} className={`tone-${option.tone}`}><span>{option.label}</span><strong>{session.reviewSummary.byRating[String(option.value) as '1' | '2' | '3' | '4'] || 0}</strong></div>)}
      </div>
      <button className="learning-primary-button" type="button" onClick={onBack}><ArrowLeft aria-hidden="true" /> 回到今日学习</button>
    </section>
  );
}

function LearningAnswer({ item }: { item: StudyItem }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const renderCardType = item.source.cardType === 'textbook_track' ? 'trilingual' : item.source.cardType;
  const renderedHtml = useMemo(() => renderCardMarkdown(item.answer.markdown, renderCardType, item.source.folder), [item.answer.markdown, item.source.folder, renderCardType]);

  useEffect(() => () => audioRef.current?.pause(), []);

  const playSource = (source: string, button?: HTMLElement) => {
    audioRef.current?.pause();
    containerRef.current?.querySelectorAll('.audio-btn.is-playing').forEach((node) => node.classList.remove('is-playing'));
    const audio = new Audio(`/api/folders/${encodeURIComponent(item.source.folder)}/files/${encodeURIComponent(source)}`);
    audioRef.current = audio;
    button?.classList.add('is-playing');
    audio.addEventListener('ended', () => button?.classList.remove('is-playing'), { once: true });
    audio.play().catch(() => button?.classList.remove('is-playing'));
  };

  return (
    <div className="learning-answer" ref={containerRef}>
      <div className="learning-answer-markdown" onClick={(event) => {
        const button = (event.target as HTMLElement).closest<HTMLElement>('.audio-btn');
        const source = button?.dataset.src;
        if (source) playSource(source, button);
      }} dangerouslySetInnerHTML={{ __html: renderedHtml }} />
      {item.audioFiles.length > 0 && <div className="learning-audio-strip"><span><Volume2 aria-hidden="true" /> 发音核对</span>{item.audioFiles.map((audio) => <button key={audio.id} type="button" disabled={audio.status !== 'success'} onClick={() => playSource(audio.filename_suffix)}><Play aria-hidden="true" /> {audio.language.toUpperCase()} {audio.filename_suffix}</button>)}</div>}
      {!item.audioFiles.length && <p className="learning-audio-unavailable">当前单元没有可用音频；文字复习和评分仍可继续。</p>}
    </div>
  );
}

export function ReviewSessionPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const promptStartedAt = useRef(Date.now());
  const [pendingReview, setPendingReview] = useState<PendingReview | null>(null);
  const [reviewError, setReviewError] = useState('');
  const [lastExplanation, setLastExplanation] = useState<ReviewResponse['publicExplanation'] | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [fullCard, setFullCard] = useState<CardSelection | null>(null);

  const sessionQuery = useQuery({ queryKey: ['learning', 'session', 'active'], queryFn: learningApi.activeSession });
  const session = sessionQuery.data?.session || null;
  const entry = session?.currentEntry || null;
  const itemQuery = useQuery({
    queryKey: ['learning', 'item', entry?.studyItemId],
    queryFn: () => learningApi.item(entry!.studyItemId),
    enabled: Boolean(entry?.studyItemId),
    retry: false,
  });
  const item = itemQuery.data?.item || null;
  const revealed = Boolean(session && entry && session.revealedEntryId === entry.id);

  useEffect(() => {
    promptStartedAt.current = Date.now();
    setPendingReview(null);
    setReviewError('');
  }, [entry?.id]);

  const setSession = (next: LearningSession) => {
    queryClient.setQueryData(['learning', 'session', 'active'], { success: true, session: next });
    void queryClient.invalidateQueries({ queryKey: ['learning', 'queue', 'today'] });
  };

  const revealMutation = useMutation({
    mutationFn: () => learningApi.reveal(session!.id, entry!.id),
    onSuccess: (data) => setSession(data.session),
  });
  const skipMutation = useMutation({
    mutationFn: () => learningApi.skip(session!.id, entry!.id),
    onSuccess: (data) => setSession(data.session),
  });
  const reviewMutation = useMutation({
    mutationFn: (payload: PendingReview) => learningApi.review(session!.id, payload),
    onSuccess: (data) => {
      setLastExplanation(data.publicExplanation);
      setPendingReview(null);
      setReviewError('');
      setSession(data.session);
    },
    onError: (error) => setReviewError(reviewErrorMessage(error)),
  });
  const endMutation = useMutation({
    mutationFn: () => learningApi.endSession(session!.id),
    onSuccess: (data) => {
      setConfirmEnd(false);
      setSession(data.session);
    },
  });

  const submitRating = (rating: number) => {
    if (!session || !entry || !item || !revealed || reviewMutation.isPending || pendingReview) return;
    const payload: PendingReview = {
      eventKey: crypto.randomUUID(),
      queueEntryId: entry.id,
      studyItemId: item.id,
      rating,
      expectedScheduleVersion: item.expectedScheduleVersion,
      responseMs: Math.min(86_400_000, Math.max(0, Date.now() - promptStartedAt.current)),
    };
    setPendingReview(payload);
    reviewMutation.mutate(payload);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || confirmEnd) return;
      if (event.code === 'Space' && !revealed && entry && !revealMutation.isPending) {
        event.preventDefault();
        revealMutation.mutate();
      }
      const rating = Number(event.key);
      if (revealed && rating >= 1 && rating <= 4 && !pendingReview && !reviewMutation.isPending) {
        event.preventDefault();
        submitRating(rating);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  if (sessionQuery.isLoading) {
    return <ProductShell active="today" title="复习会话"><div className="learning-loading">正在恢复学习会话…</div></ProductShell>;
  }

  if (!session) {
    return <ProductShell active="today" title="复习会话"><section className="surface learning-empty"><p className="eyebrow">NO ACTIVE SESSION</p><h1>当前没有进行中的会话</h1><p>从今日学习页生成队列并开始学习。</p><button className="learning-primary-button" type="button" onClick={() => navigate('/learn')}><ArrowLeft aria-hidden="true" /> 回到今日学习</button></section></ProductShell>;
  }

  if (session.status !== 'active' || !entry) {
    return <ProductShell active="today" title="复习会话"><SessionSummary session={session} onBack={() => navigate('/learn')} /></ProductShell>;
  }

  const presentation = itemPresentation(item);
  const completed = session.queueProgress.actionCount;
  const goal = session.queueProgress.actionGoal;
  const progress = goal ? Math.min(100, (completed / goal) * 100) : 0;
  const openFullCard = (studyItem: StudyItem) => {
    if (studyItem.source.cardType === 'textbook_track') return;
    setFullCard({
      folder: studyItem.source.folder,
      baseName: studyItem.source.baseFilename,
      title: studyItem.source.title,
      cardType: studyItem.source.cardType,
    });
  };

  return (
    <ProductShell active="today" title="复习会话">
      <div className="learning-session" data-testid="learning-review-session">
        <header className="learning-session-top">
          <span className="learning-session-count">{Math.min(completed + 1, goal)} / {goal}</span>
          <div className="learning-session-progress"><i style={{ width: `${progress}%` }} /></div>
          <span className={`learning-reason reason-${entry.reason}`}>{reasonLabel(entry)}</span>
          <span className={`learning-session-type tone-${presentation.tone}`}>{presentation.type} · {presentation.language}</span>
          <button type="button" onClick={() => setConfirmEnd(true)}><X aria-hidden="true" /> 结束</button>
        </header>

        {lastExplanation && <div className="learning-schedule-explanation" role="status"><CheckCircleIcon /><span>上一项已保存：{RATING_OPTIONS.find((option) => option.value === Number(({ again: 1, hard: 2, good: 3, easy: 4 } as Record<string, number>)[lastExplanation.rating]))?.label || lastExplanation.rating}，{relativeDue(lastExplanation.nextDueAtUtc)}。</span></div>}

        <div className="learning-session-body">
          <section className={`surface learning-prompt tone-${presentation.tone}`}>
            <span>提示面</span>
            {itemQuery.isLoading && <div className="learning-loading compact">正在读取学习单元…</div>}
            {itemQuery.isError && <div className="learning-content-error"><strong>当前内容无法读取</strong><p>卡片可能已更新或归档。跳过此项不会产生评分记录。</p></div>}
            {item && <><p className={presentation.language.includes('JA') && item.unitKind === 'grammar_ja' ? 'japanese-text' : ''}>{item.prompt.text}</p><small>{presentation.instruction}</small></>}
          </section>

          {!revealed && item && <button className="learning-reveal-button" type="button" data-testid="learning-reveal" disabled={revealMutation.isPending} onClick={() => revealMutation.mutate()}>{revealMutation.isPending ? '正在揭示…' : '揭示答案'}<kbd>Space</kbd></button>}

          {revealed && item && <section className={`surface learning-answer-surface tone-${presentation.tone}`} data-testid="learning-answer"><header><span>答案面</span>{item.highlightReference && <small>含个人标红</small>}{item.source.cardType !== 'textbook_track' && <button type="button" onClick={() => openFullCard(item)}>查看完整卡片 <ExternalLink aria-hidden="true" /></button>}</header><LearningAnswer item={item} /></section>}
        </div>

        <footer className="learning-session-footer">
          <button className="learning-skip-button" type="button" disabled={skipMutation.isPending || reviewMutation.isPending} onClick={() => skipMutation.mutate()}><SkipForward aria-hidden="true" /> 跳过</button>
          <div className="learning-grades" aria-label="学习反馈">
            {RATING_OPTIONS.map((option) => {
              const selected = pendingReview?.rating === option.value;
              return <button key={option.value} className={`grade-${option.tone}${selected ? ' selected' : ''}`} type="button" disabled={!revealed || Boolean(pendingReview) || reviewMutation.isPending} onClick={() => submitRating(option.value)}><strong>{option.label}</strong><small>{option.value} · {selected && reviewMutation.isPending ? '保存中…' : selected && reviewError ? '待重试' : option.hint}</small></button>;
            })}
          </div>
          <span className="learning-key-hint">快捷键 1–4</span>
          {reviewError && pendingReview && <div className="learning-review-error" role="alert"><span>{reviewError}</span><button type="button" disabled={reviewMutation.isPending} onClick={() => reviewMutation.mutate(pendingReview)}>重试提交</button><button type="button" onClick={() => { setPendingReview(null); setReviewError(''); }}>更改评分</button></div>}
        </footer>
      </div>

      {confirmEnd && <div className="learning-dialog-backdrop"><section className="surface learning-dialog" role="alertdialog" aria-modal="true" aria-label="结束本次会话"><h2>结束本次会话？</h2><p>已提交的 <strong>{session.reviewSummary.total}</strong> 项会保留；其余内容回到今日队列，不计失败。</p><div><button type="button" onClick={() => setConfirmEnd(false)}>继续学习</button><button className="learning-primary-button" type="button" disabled={endMutation.isPending} onClick={() => endMutation.mutate()}>{endMutation.isPending ? '结束中…' : '结束并查看摘要'}</button></div></section></div>}
      {fullCard && <CardModal selection={fullCard} readOnly onClose={() => setFullCard(null)} />}
    </ProductShell>
  );
}

function CheckCircleIcon() {
  return <span className="learning-success-dot" aria-hidden="true" />;
}
