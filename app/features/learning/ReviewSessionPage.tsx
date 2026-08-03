import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, PanelLeftClose, PanelLeftOpen, Play, SkipForward, Volume2, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ProductShell } from '../../components/ProductShell';
import { ConfirmDialog } from '../../components/overlays';
import { DataRefreshStatus, PageState } from '../../components/states';
import { ErrorSummary, SaveStatus, type WorkflowError } from '../../components/workflow';
import { ApiError } from '../../lib/api/client';
import { useExclusiveAudio } from '../../lib/audio/exclusive-audio';
import { DeferredCardModal } from '../card-modal/DeferredCardModal';
import { renderCardMarkdown } from '../card-modal/markdown';
import type { CardSelection } from '../factory/types';
import { learningApi } from './learning-api';
import { itemPresentation, RATING_OPTIONS, reasonLabel, relativeDue } from './learning-format';
import { splitReviewAnswerMarkdown } from './review-answer-layering.mjs';
import type { LearningSession, ReviewResponse, StudyItem } from './types';

type PendingReview = {
  eventKey: string;
  queueEntryId: number;
  studyItemId: number;
  rating: number;
  expectedScheduleVersion: number;
  responseMs: number;
};

function reviewWorkflowError(error: Error): WorkflowError {
  if (error instanceof ApiError && error.payload && typeof error.payload === 'object' && 'code' in error.payload) {
    const code = String((error.payload as { code?: string }).code || '');
    if (code === 'LEARNING_SCHEDULE_CONFLICT') return { code, message: '这项内容的调度状态已变化。返回今日学习后重新进入再评分。' };
    if (code === 'LEARNING_SOURCE_INELIGIBLE' || code === 'LEARNING_ITEM_ARCHIVED') return { code, message: '当前卡片已归档或不再符合学习条件。请跳过此项。' };
    if (code === 'LEARNING_STORAGE_BUSY') return { code, message: '学习记录存储正忙。当前评分尚未写入，可以使用同一请求重试。', retryable: true };
    return { code: code || 'LEARNING_REVIEW_FAILED', message: error.message || '评分未保存。当前项已保留。', retryable: true };
  }
  return { code: 'LEARNING_REVIEW_FAILED', message: error.message || '评分未保存。当前项已保留。', retryable: true };
}

function SessionSummary({ session, onBack }: { session: LearningSession; onBack: () => void }) {
  return (
    <section className="learning-session-summary" data-testid="learning-session-summary">
      <p className="eyebrow">本次学习摘要</p>
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
  const playback = useExclusiveAudio();
  const renderCardType = item.source.cardType === 'textbook_track' ? 'trilingual' : item.source.cardType;
  const answerLayers = useMemo(() => splitReviewAnswerMarkdown(item.answer.markdown), [item.answer.markdown]);
  const coreHtml = useMemo(
    () => renderCardMarkdown(answerLayers.coreMarkdown, renderCardType, item.source.folder),
    [answerLayers.coreMarkdown, item.source.folder, renderCardType]
  );
  const supplementaryHtml = useMemo(
    () => answerLayers.supplementaryMarkdown
      ? renderCardMarkdown(answerLayers.supplementaryMarkdown, renderCardType, item.source.folder)
      : '',
    [answerLayers.supplementaryMarkdown, item.source.folder, renderCardType]
  );

  const playSource = (source: string, button?: HTMLElement, playbackUrl?: string) => {
    playback.stop();
    containerRef.current?.querySelectorAll('.audio-btn.is-playing').forEach((node) => node.classList.remove('is-playing'));
    button?.classList.add('is-playing');
    void playback.playUrl(
      playbackUrl || `/api/folders/${encodeURIComponent(item.source.folder)}/files/${encodeURIComponent(source)}`,
      {
        onEnded: () => button?.classList.remove('is-playing'),
        onError: () => button?.classList.remove('is-playing'),
        onStop: () => button?.classList.remove('is-playing'),
      }
    ).catch(() => button?.classList.remove('is-playing'));
  };

  return (
    <div className="learning-answer" ref={containerRef}>
      <div className="learning-answer-markdown" onClick={(event) => {
        const button = (event.target as HTMLElement).closest<HTMLElement>('.audio-btn');
        const source = button?.dataset.src;
        if (source) playSource(source, button);
      }} dangerouslySetInnerHTML={{ __html: coreHtml }} />
      {supplementaryHtml && (
        <details className="learning-answer-supplementary">
          <summary>
            <span>补充说明与常见误用</span>
            <small>{answerLayers.supplementarySectionCount} 个补充部分</small>
          </summary>
          <div className="learning-answer-markdown" onClick={(event) => {
            const button = (event.target as HTMLElement).closest<HTMLElement>('.audio-btn');
            const source = button?.dataset.src;
            if (source) playSource(source, button);
          }} dangerouslySetInnerHTML={{ __html: supplementaryHtml }} />
        </details>
      )}
      {item.audioFiles.length > 0 && <div className="learning-audio-strip"><span><Volume2 aria-hidden="true" /> 发音核对</span>{item.audioFiles.map((audio) => <button key={audio.id} type="button" disabled={!['success', 'generated', 'fallback_generated'].includes(audio.status)} onClick={() => playSource(audio.filename_suffix, undefined, audio.playback_url)}><Play aria-hidden="true" /> {audio.language.toUpperCase()} 发音</button>)}</div>}
      {!item.audioFiles.length && <p className="learning-audio-unavailable">当前单元没有可用音频；文字复习和评分仍可继续。</p>}
    </div>
  );
}

export function ReviewSessionPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const promptStartedAt = useRef(Date.now());
  const [pendingReview, setPendingReview] = useState<PendingReview | null>(null);
  const [reviewError, setReviewError] = useState<WorkflowError | null>(null);
  const [lastExplanation, setLastExplanation] = useState<ReviewResponse['publicExplanation'] | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [fullCard, setFullCard] = useState<CardSelection | null>(null);
  const [focusMode, setFocusMode] = useState(true);

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
    setReviewError(null);
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
      setReviewError(null);
      setSession(data.session);
    },
    onError: (error) => setReviewError(reviewWorkflowError(error)),
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
    return (
      <ProductShell active="today" title="复习会话">
        <PageState
          variant="loading"
          eyebrow="复习会话"
          title="正在恢复学习会话"
          description="正在读取当前进度，尚未提交新的评分。"
          testId="learning-session-loading"
        />
      </ProductShell>
    );
  }

  if (sessionQuery.isError && !sessionQuery.data) {
    return (
      <ProductShell active="today" title="复习会话">
        <PageState
          variant="error"
          eyebrow="复习会话"
          title="学习会话暂时无法读取"
          description="会话与评分记录没有被修改。重新读取后可以从原进度继续。"
          actions={<button className="primary" type="button" onClick={() => void sessionQuery.refetch()}>重新读取</button>}
          testId="learning-session-load-error"
        />
      </ProductShell>
    );
  }

  if (!session) {
    return (
      <ProductShell active="today" title="复习会话">
        <PageState
          variant="empty"
          eyebrow="复习会话"
          title="当前没有进行中的会话"
          description="从今日学习页生成队列并开始学习。"
          actions={<button className="primary" type="button" onClick={() => navigate('/learn')}><ArrowLeft aria-hidden="true" /> 回到今日学习</button>}
          testId="learning-session-empty"
        />
      </ProductShell>
    );
  }

  if (session.status !== 'active' || !entry) {
    return <ProductShell active="today" title="复习会话"><SessionSummary session={session} onBack={() => navigate('/learn')} /></ProductShell>;
  }

  const presentation = itemPresentation(item);
  const dailyCompleted = session.queueProgress.actionCount;
  const dailyGoal = session.queueProgress.actionGoal;
  const sessionTotal = session.queueProgress.total;
  const sessionCompleted = Number(session.queueProgress.byStatus.completed || 0);
  const sessionSkipped = Number(session.queueProgress.byStatus.skipped || 0);
  const sessionPosition = Math.min(sessionTotal, sessionCompleted + sessionSkipped + 1);
  const sessionProgress = sessionTotal ? Math.min(100, ((sessionPosition - 1) / sessionTotal) * 100) : 0;
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
    <ProductShell active="today" title="复习会话" focusMode={focusMode}>
      <div className="learning-session" data-testid="learning-review-session">
        <DataRefreshStatus
          refreshing={sessionQuery.isFetching && !sessionQuery.isLoading}
          failed={sessionQuery.isError && Boolean(sessionQuery.data)}
          label="学习会话"
          onRetry={() => void sessionQuery.refetch()}
          compact
          testId="learning-session-refresh-status"
        />
        <header className="learning-session-top">
          <span className="learning-session-count" data-testid="learning-session-progress"><small>本次</small><strong>{sessionPosition} / {sessionTotal}</strong></span>
          <div className="learning-session-progress" aria-label={`本次进度 ${sessionPosition} / ${sessionTotal}`}><i style={{ width: `${sessionProgress}%` }} /></div>
          <span className="learning-daily-goal" data-testid="learning-daily-goal"><small>今日目标</small><strong>{dailyCompleted} / {dailyGoal}</strong></span>
          <span className={`learning-reason reason-${entry.reason}`}>{reasonLabel(entry)}</span>
          <span className={`learning-session-type tone-${presentation.tone}`}>{presentation.type} · {presentation.language}</span>
          <button
            className="learning-focus-toggle"
            type="button"
            data-testid="learning-focus-toggle"
            aria-pressed={focusMode}
            onClick={() => setFocusMode((current) => !current)}
          >
            {focusMode ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
            {focusMode ? '显示导航' : '专注模式'}
          </button>
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

          {revealed && item && <section className={`surface learning-answer-surface tone-${presentation.tone}`} data-testid="learning-answer"><header><span>答案面</span>{item.annotationReference && <small>含个人标红</small>}{item.source.cardType !== 'textbook_track' && <button type="button" onClick={() => openFullCard(item)}>查看完整卡片 <ExternalLink aria-hidden="true" /></button>}</header><LearningAnswer item={item} /></section>}
        </div>

        <footer className="learning-session-footer">
          <button className="learning-skip-button" type="button" disabled={skipMutation.isPending || reviewMutation.isPending} onClick={() => skipMutation.mutate()}><SkipForward aria-hidden="true" /> 跳过</button>
          <div className="learning-grades" aria-label="学习反馈">
            {RATING_OPTIONS.map((option) => {
              const selected = pendingReview?.rating === option.value;
              return <button key={option.value} className={`grade-${option.tone}${selected ? ' selected' : ''}`} type="button" disabled={!revealed || Boolean(pendingReview) || reviewMutation.isPending} onClick={() => submitRating(option.value)}><strong>{option.label}</strong><small>{option.value} · {selected && reviewMutation.isPending ? '保存中…' : selected && reviewError ? '待重试' : option.hint}</small></button>;
            })}
          </div>
          <div className="learning-session-status">
            <SaveStatus state={reviewMutation.isPending ? 'saving' : reviewError ? 'failed' : lastExplanation ? 'saved' : 'clean'} />
            <span className="learning-key-hint">快捷键 1–4</span>
          </div>
          {reviewError && pendingReview && (
            <div className="learning-review-error">
              <ErrorSummary
                errors={[reviewError]}
                onRetry={() => reviewMutation.mutate(pendingReview)}
                retryLabel="重试提交"
                onDismiss={() => {
                  setPendingReview(null);
                  setReviewError(null);
                }}
                dismissLabel="更改评分"
              />
            </div>
          )}
        </footer>
      </div>

      {confirmEnd && (
        <ConfirmDialog
          ariaLabel="结束本次会话"
          title="结束本次会话？"
          description={<p>已提交的 <strong>{session.reviewSummary.total}</strong> 项会保留；其余内容回到今日队列，不计失败。</p>}
          cancelLabel="继续学习"
          confirmLabel="结束并查看摘要"
          pendingLabel="正在结束会话…"
          tone="danger"
          busy={endMutation.isPending}
          onCancel={() => setConfirmEnd(false)}
          onConfirm={() => endMutation.mutate()}
        />
      )}
      {fullCard && <DeferredCardModal selection={fullCard} readOnly onClose={() => setFullCard(null)} />}
    </ProductShell>
  );
}

function CheckCircleIcon() {
  return <span className="learning-success-dot" aria-hidden="true" />;
}
