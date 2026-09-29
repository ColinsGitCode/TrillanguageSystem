import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays, ChevronDown, LayoutGrid, List, Plus, Search, X,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ProductShell } from '../../components/ProductShell';
import { DataRefreshStatus, PageState } from '../../components/states';
import {
  publishShellActivity,
  publishShellFeedback,
  readStoredActivities,
  type ShellActivityStatus,
} from '../../components/shell';
import { ApiError } from '../../lib/api/client';
import { DeferredCardModal } from '../card-modal/DeferredCardModal';
import { factoryApi } from './factory-api';
import { QueuePanel } from './QueuePanel';
import { QuickComposer, type ComposerSubmitResult } from './QuickComposer';
import type { CardSelection, CardType, DuplicateCardSummary, FolderFile, GenerationJob, SourceMode } from './types';

type CardSort = 'newest' | 'title' | 'type';
type CardDensity = 'comfortable' | 'compact';

function createInteractionKey(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}

const CARD_CONFIG: Record<CardType, { label: string }> = {
  trilingual: { label: '三语卡' },
  grammar_ja: { label: '语法卡' },
  scenario_phrase: { label: '场景卡' },
};

function useHydrated() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}

function cardTypeOf(file: FolderFile): CardType {
  const value = file.cardType || file.card_type || 'trilingual';
  return value in CARD_CONFIG ? value : 'trilingual';
}

function dateParts(folder: string) {
  const match = folder.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return { group: '其它', day: folder, title: folder };
  const day = Number(match[3]);
  const lastTwo = day % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] || 'th');
  return { group: `${match[1]}.${match[2]}`, day: `${day}${suffix}`, title: `${match[1]}.${match[2]}.${match[3]}` };
}

function queueCounts(jobs: GenerationJob[]) {
  return jobs.reduce((result, job) => {
    result[job.status] = (result[job.status] || 0) + 1;
    return result;
  }, {} as Record<string, number>);
}

function shellStatusForJob(status: GenerationJob['status']): ShellActivityStatus {
  if (status === 'success') return 'succeeded';
  return status;
}

function jobActivitySummary(job: GenerationJob) {
  if (job.status === 'queued') return `任务 #${job.id} 正在等待生成`;
  if (job.status === 'running') return `任务 #${job.id} 正在生成`;
  if (job.status === 'success') return `任务 #${job.id} 已生成学习卡`;
  if (job.status === 'failed') return `任务 #${job.id} 生成失败`;
  return `任务 #${job.id} 已取消`;
}

export function CardsFactory() {
  const hydrated = useHydrated();
  const queryClient = useQueryClient();
  const [cardType, setCardType] = useState<CardType>('trilingual');
  const [selectedFolder, setSelectedFolder] = useState('');
  const [selectedCard, setSelectedCard] = useState<CardSelection | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const composerTriggerRef = useRef<HTMLButtonElement>(null);
  const [submitting, setSubmitting] = useState(false);
  // Jobs handed over from the composer since the page loaded, newest first. The
  // registry keeps the job as the server first returned it, so the tray can
  // show it before the next queue poll includes it.
  const [sessionJobIds, setSessionJobIds] = useState<number[]>([]);
  const sessionRegistryRef = useRef<Map<number, GenerationJob>>(new Map());
  const [selectedQueueJobId, setSelectedQueueJobId] = useState<number | null>(null);
  const [libraryMode, setLibraryMode] = useState<'folders' | 'history'>('folders');
  const [expandedDateGroups, setExpandedDateGroups] = useState<Set<string>>(new Set());
  const [historyPage, setHistoryPage] = useState(1);
  const [cardSearch, setCardSearch] = useState('');
  const [cardSort, setCardSort] = useState<CardSort>('newest');
  const [cardDensity, setCardDensity] = useState<CardDensity>('comfortable');
  const [libraryPreferencesLoaded, setLibraryPreferencesLoaded] = useState(false);
  const [notice, setNotice] = useState('');
  const lastSuccessRef = useRef(0);
  const trackedJobIdsRef = useRef<Set<number>>(new Set());
  const publishedJobStatusRef = useRef<Map<number, GenerationJob['status']>>(new Map());
  const dateGroupsInitializedRef = useRef(false);

  const healthQuery = useQuery({
    queryKey: ['health'], queryFn: factoryApi.health, enabled: hydrated, refetchInterval: 15_000,
  });
  const foldersQuery = useQuery({
    queryKey: ['folders'], queryFn: factoryApi.folders, enabled: hydrated, refetchInterval: 60_000,
  });
  const todayCardsQuery = useQuery({
    queryKey: ['card-engagement', 'today'], queryFn: factoryApi.todayCards, enabled: hydrated,
  });
  const filesQuery = useQuery({
    queryKey: ['files', selectedFolder],
    queryFn: () => factoryApi.files(selectedFolder),
    enabled: hydrated && Boolean(selectedFolder),
  });
  const jobsQuery = useQuery({
    queryKey: ['queue', 'jobs'], queryFn: factoryApi.jobs, enabled: hydrated, refetchInterval: 1500,
  });
  const summaryQuery = useQuery({
    queryKey: ['queue', 'summary'], queryFn: factoryApi.queueSummary, enabled: hydrated, refetchInterval: 1500,
  });
  const historyQuery = useQuery({
    queryKey: ['history', cardSearch, historyPage],
    queryFn: () => factoryApi.history(cardSearch, historyPage),
    enabled: hydrated && libraryMode === 'history',
  });

  const physicalFolders = foldersQuery.data?.folders || [];
  const todayFolder = todayCardsQuery.data?.learningDay?.replaceAll('-', '') || '';
  const folders = useMemo(() => {
    const result = new Set(physicalFolders);
    if (todayFolder && (todayCardsQuery.data?.cards.length || sessionJobIds.length)) result.add(todayFolder);
    return [...result];
  }, [physicalFolders, todayCardsQuery.data?.cards.length, todayFolder, sessionJobIds.length]);
  const files = useMemo(() => {
    const physical = filesQuery.data?.files || [];
    if (!todayFolder || selectedFolder !== todayFolder) return physical;
    const merged = new Map(physical.map((file) => [`${selectedFolder}/${file.file}`, file]));
    for (const card of todayCardsQuery.data?.cards || []) {
      const key = `${card.folder}/${card.baseFilename}.html`;
      if (merged.has(key)) continue;
      merged.set(key, {
        file: `${card.baseFilename}.html`,
        title: card.phrase,
        cardType: card.cardType,
        generationId: card.id,
        sourceFolder: card.folder,
        sourceBaseFilename: card.baseFilename,
        resurfacedToday: true,
      });
    }
    return [...merged.values()];
  }, [filesQuery.data?.files, selectedFolder, todayCardsQuery.data?.cards, todayFolder]);
  const visibleFiles = useMemo(() => {
    const query = cardSearch.trim().toLocaleLowerCase();
    const collator = new Intl.Collator(['zh-CN', 'ja', 'en'], { sensitivity: 'base', numeric: true });
    const result = files
      .map((file, index) => ({ file, index, type: cardTypeOf(file) }))
      .filter(({ file, type }) => !query || [
        file.title,
        file.file,
        CARD_CONFIG[type].label,
      ].some((value) => String(value || '').toLocaleLowerCase().includes(query)));
    if (cardSort === 'title') {
      result.sort((left, right) => collator.compare(left.file.title || left.file.file, right.file.title || right.file.file));
    } else if (cardSort === 'type') {
      result.sort((left, right) => (
        collator.compare(CARD_CONFIG[left.type].label, CARD_CONFIG[right.type].label)
        || collator.compare(left.file.title || left.file.file, right.file.title || right.file.file)
      ));
    } else {
      result.sort((left, right) => left.index - right.index);
    }
    return result;
  }, [cardSearch, cardSort, files]);
  const jobs = jobsQuery.data?.jobs || [];
  const computedCounts = queueCounts(jobs);
  const summary = summaryQuery.data?.summary || computedCounts;
  const activeJob = jobs.find((job) => job.status === 'running') || jobs.find((job) => job.status === 'queued') || null;
  const queueUnavailable = (jobsQuery.isError && !jobsQuery.data) || (summaryQuery.isError && !summaryQuery.data);
  const queueRefreshFailed = (jobsQuery.isError && Boolean(jobsQuery.data))
    || (summaryQuery.isError && Boolean(summaryQuery.data));
  const queueInitialLoading = (jobsQuery.isLoading || summaryQuery.isLoading)
    && !jobsQuery.data
    && !summaryQuery.data;
  const queueRefreshing = (jobsQuery.isFetching || summaryQuery.isFetching)
    && Boolean(jobsQuery.data || summaryQuery.data)
    && !queueRefreshFailed;
  const queueStatusLabel = queueUnavailable
    ? '暂不可读'
    : queueRefreshFailed
      ? '刷新失败'
      : queueInitialLoading
        ? '读取中'
        : activeJob?.status === 'running'
          ? '生成中'
          : activeJob?.status === 'queued' ? '排队中' : '空闲';
  const queueStatusDescription = queueUnavailable
    ? '点击查看详情并重新读取'
    : queueRefreshFailed
      ? '正在显示上次成功读取的队列'
      : queueInitialLoading
        ? '正在读取任务状态'
        : activeJob?.phraseNormalized || '当前没有生成任务';

  useEffect(() => {
    if (!folders.length) return;
    if (!selectedFolder || !folders.includes(selectedFolder)) setSelectedFolder([...folders].sort().reverse()[0]);
  }, [folders, selectedFolder]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      const saved = JSON.parse(localStorage.getItem('three-lans:factory-library-preferences') || 'null');
      if (saved?.density === 'comfortable' || saved?.density === 'compact') setCardDensity(saved.density);
      if (saved?.sort === 'newest' || saved?.sort === 'title' || saved?.sort === 'type') setCardSort(saved.sort);
    } catch {
      // Invalid browser preferences fall back to the stable default order.
    } finally {
      setLibraryPreferencesLoaded(true);
    }
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      const saved = localStorage.getItem('three-lans:composer-card-type');
      if (saved && saved in CARD_CONFIG) setCardType(saved as CardType);
    } catch {
      // Storage can be unavailable; the composer then starts from 三语卡.
    }
  }, [hydrated]);

  const changeCardType = (type: CardType) => {
    setCardType(type);
    try {
      localStorage.setItem('three-lans:composer-card-type', type);
    } catch {
      // The choice still holds for this visit.
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      // A card or the queue dialog owns the keyboard while it is open.
      if (event.key.toLowerCase() !== 'k' || selectedCard || queueOpen) return;
      event.preventDefault();
      if (composerOpen) document.getElementById('qc-input')?.focus();
      else setComposerOpen(true);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedCard, queueOpen, composerOpen]);

  useEffect(() => {
    if (!libraryPreferencesLoaded) return;
    localStorage.setItem('three-lans:factory-library-preferences', JSON.stringify({
      density: cardDensity,
      sort: cardSort,
    }));
  }, [cardDensity, cardSort, libraryPreferencesLoaded]);

  useEffect(() => {
    const latestSuccess = Math.max(0, ...jobs.filter((job) => job.status === 'success').map((job) => job.id));
    if (latestSuccess > lastSuccessRef.current) {
      lastSuccessRef.current = latestSuccess;
      void queryClient.invalidateQueries({ queryKey: ['folders'] });
      void queryClient.invalidateQueries({ queryKey: ['files'] });
      void queryClient.invalidateQueries({ queryKey: ['history'] });
    }
  }, [jobs, queryClient]);

  useEffect(() => {
    if (!hydrated) return;
    for (const item of readStoredActivities()) {
      if (item.kind !== 'generation-job') continue;
      const id = Number(item.id);
      if (Number.isInteger(id)) trackedJobIdsRef.current.add(id);
    }

    const syncFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const requestedId = Number(params.get('job'));
      setQueueOpen(params.get('queue') === '1');
      setSelectedQueueJobId(Number.isInteger(requestedId) && requestedId > 0 ? requestedId : null);
    };
    syncFromUrl();
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, [hydrated]);

  useEffect(() => {
    for (const job of jobs) {
      const shouldTrack = trackedJobIdsRef.current.has(job.id)
        || job.status === 'queued'
        || job.status === 'running';
      if (!shouldTrack) continue;
      trackedJobIdsRef.current.add(job.id);
      const previousStatus = publishedJobStatusRef.current.get(job.id);
      if (previousStatus === job.status) continue;
      publishedJobStatusRef.current.set(job.id, job.status);
      publishShellActivity({
        id: String(job.id),
        kind: 'generation-job',
        status: shellStatusForJob(job.status),
        title: `${CARD_CONFIG[job.jobType]?.label || '学习卡'}生成`,
        summary: jobActivitySummary(job),
        href: `/?queue=1&job=${job.id}`,
      });
      if (previousStatus && job.status === 'success') {
        publishShellFeedback({
          id: `generation-success-${job.id}`,
          tone: 'success',
          message: `任务 #${job.id} 已生成完成`,
          actionLabel: '查看队列',
          actionHref: `/?queue=1&job=${job.id}`,
        });
      } else if (previousStatus && job.status === 'failed') {
        publishShellFeedback({
          id: `generation-failed-${job.id}`,
          tone: 'error',
          message: `任务 #${job.id} 生成失败`,
          actionLabel: '查看并重试',
          actionHref: `/?queue=1&job=${job.id}`,
        });
      }
    }
  }, [jobs]);

  const setQueueRoute = (open: boolean, jobId?: number | null) => {
    setQueueOpen(open);
    setSelectedQueueJobId(jobId || null);
    const url = new URL(window.location.href);
    if (open) {
      url.searchParams.set('queue', '1');
      if (jobId) url.searchParams.set('job', String(jobId));
      else url.searchParams.delete('job');
    } else {
      url.searchParams.delete('queue');
      url.searchParams.delete('job');
    }
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  };

  const registerSubmittedJob = (job: GenerationJob) => {
    trackedJobIdsRef.current.add(job.id);
    publishedJobStatusRef.current.set(job.id, job.status);
    publishShellActivity({
      id: String(job.id),
      kind: 'generation-job',
      status: shellStatusForJob(job.status),
      title: `${CARD_CONFIG[job.jobType]?.label || '学习卡'}生成`,
      summary: jobActivitySummary(job),
      href: `/?queue=1&job=${job.id}`,
    });
    sessionRegistryRef.current.set(job.id, job);
    setSessionJobIds((ids) => [job.id, ...ids.filter((id) => id !== job.id)].slice(0, 12));
  };

  const announceCreated = (created: GenerationJob[]) => {
    if (created.length === 1) {
      publishShellFeedback({
        id: `generation-created-${created[0].id}`,
        tone: 'success',
        message: `生成任务 #${created[0].id} 已加入队列`,
        actionLabel: '查看队列',
        actionHref: `/?queue=1&job=${created[0].id}`,
      });
    } else if (created.length > 1) {
      publishShellFeedback({
        id: `generation-created-batch-${created[0].id}`,
        tone: 'success',
        message: `${created.length} 个生成任务已加入队列`,
        actionLabel: '查看队列',
        actionHref: '/?queue=1',
      });
    }
  };

  // New cards land in today's folder, so the library follows them there and
  // their placeholders are visible while they generate.
  const followNewCards = async () => {
    if (libraryMode === 'folders' && todayFolder) setSelectedFolder(todayFolder);
    await queryClient.invalidateQueries({ queryKey: ['queue'] });
  };

  const submitLines = async (lines: string[], sourceMode: SourceMode): Promise<ComposerSubmitResult> => {
    setSubmitting(true);
    setNotice('');
    const created: GenerationJob[] = [];
    const skipped: string[] = [];
    const remaining: string[] = [];
    let failure = '';
    try {
      // One at a time, so the queue keeps the order the user typed.
      for (const value of lines) {
        try {
          // Preflight is still the authority: the composer's inline check is
          // read-only advice, and a card created in between is caught here.
          const interactionKey = createInteractionKey('generation');
          const preflight = await factoryApi.preflight({ phrase: value, cardType, interactionKey });
          if (preflight.duplicates.length || preflight.activeJob) {
            skipped.push(value);
            continue;
          }
          const { job } = await factoryApi.enqueue({
            phrase: value,
            cardType,
            sourceMode,
            duplicatePolicy: 'reject',
            interactionKey,
            preflightRecorded: true,
          });
          registerSubmittedJob(job);
          created.push(job);
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) {
            skipped.push(value);
            continue;
          }
          remaining.push(value);
          failure ||= error instanceof Error ? error.message : String(error);
        }
      }
    } finally {
      setSubmitting(false);
    }
    announceCreated(created);
    if (failure) {
      setNotice(`有 ${remaining.length} 条没能加入队列：${failure}。它们还留在输入框里，可以再试一次。`);
    } else if (skipped.length) {
      setNotice(`${skipped.length} 条已经有卡片或正在生成，已跳过：${skipped.slice(0, 3).join('、')}${skipped.length > 3 ? ' 等' : ''}`);
    }
    if (created.length) await followNewCards();
    void queryClient.invalidateQueries({ queryKey: ['composer-duplicates'] });
    return { submitted: created.length, remaining };
  };

  const createVersion = async (value: string, sourceMode: SourceMode): Promise<ComposerSubmitResult> => {
    setSubmitting(true);
    setNotice('');
    try {
      const { job } = await factoryApi.enqueue({
        phrase: value,
        cardType,
        sourceMode,
        duplicatePolicy: 'create-version',
        interactionKey: createInteractionKey('new-version'),
      });
      registerSubmittedJob(job);
      announceCreated([job]);
      await followNewCards();
      void queryClient.invalidateQueries({ queryKey: ['composer-duplicates'] });
      return { submitted: 1, remaining: [] };
    } catch (error) {
      setNotice(`没能加入队列：${error instanceof Error ? error.message : String(error)}`);
      return { submitted: 0, remaining: [value] };
    } finally {
      setSubmitting(false);
    }
  };

  const retryJob = async (job: GenerationJob) => {
    try {
      await factoryApi.retry(job.id);
      await queryClient.invalidateQueries({ queryKey: ['queue'] });
    } catch (error) {
      setNotice(`重试失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const addToTodayMutation = useMutation({
    mutationFn: (card: DuplicateCardSummary) => factoryApi.addToToday(
      card.generationId,
      createInteractionKey('add-today')
    ),
    onSuccess: async (result) => {
      const queued = result.learning.queued;
      const planControlled = result.learning.planControlled;
      setNotice(queued
        ? `已加入今日卡片，并将 ${queued} 个可复习单元加入今日学习`
        : planControlled
          ? '已加入今日卡片；新学习单元仍按每日新卡上限进入计划'
          : '已加入今日卡片');
      setSelectedFolder(result.engagement.learningDay.replaceAll('-', ''));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['card-engagement'] }),
        queryClient.invalidateQueries({ queryKey: ['learning'] }),
      ]);
    },
    onError: (error) => setNotice(`加入今日失败：${error.message}`),
  });
  const groupedFolders = useMemo(() => {
    const groups = new Map<string, { folder: string; day: string; title: string }[]>();
    for (const folder of folders) {
      const parts = dateParts(folder);
      const items = groups.get(parts.group) || [];
      items.push({ folder, day: parts.day, title: parts.title });
      groups.set(parts.group, items);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [folders]);

  useEffect(() => {
    if (!groupedFolders.length) return;
    const available = new Set(groupedFolders.map(([group]) => group));
    const selectedGroup = selectedFolder ? dateParts(selectedFolder).group : null;
    setExpandedDateGroups((current) => {
      const next = new Set([...current].filter((group) => available.has(group)));
      if (!dateGroupsInitializedRef.current) {
        groupedFolders.slice(0, 2).forEach(([group]) => next.add(group));
        dateGroupsInitializedRef.current = true;
      }
      if (selectedGroup && available.has(selectedGroup)) next.add(selectedGroup);
      return next;
    });
  }, [groupedFolders, selectedFolder]);

  const openFile = (file: FolderFile) => {
    const baseName = file.sourceBaseFilename || file.file.replace(/\.html$/i, '');
    setSelectedCard({
      folder: file.sourceFolder || selectedFolder,
      baseName,
      title: file.title || baseName,
      cardType: cardTypeOf(file),
      generationId: file.generationId,
    });
  };

  const openDuplicateCard = (card: DuplicateCardSummary) => {
    setSelectedFolder(card.folderName);
    setSelectedCard({
      folder: card.folderName,
      baseName: card.baseFilename,
      title: card.phrase,
      cardType: card.cardType,
      generationId: card.generationId,
    });
  };

  const openGeneratedResult = (job: GenerationJob) => {
    if (!job.resultFolder || !job.resultBaseFilename) return;
    setSelectedFolder(job.resultFolder);
    setSelectedCard({
      folder: job.resultFolder,
      baseName: job.resultBaseFilename,
      title: job.phraseNormalized || job.resultBaseFilename,
      cardType: job.jobType,
    });
    setQueueRoute(false);
  };

  const healthServices = Array.isArray(healthQuery.data?.services)
    ? healthQuery.data.services
    : Object.values(healthQuery.data?.services || {});
  const deepSeekOffline = healthServices.some((service) => (
    /deepseek/i.test(String(service.name || '')) && ['offline', 'error', 'unhealthy'].includes(String(service.status || '').toLowerCase())
  ));
  const healthUnhealthy = healthQuery.isError
    || healthQuery.data?.status === 'unhealthy'
    || healthQuery.data?.system?.criticalOnline === false
    || deepSeekOffline;

  const deepSeekHealth = healthServices.find((service) => /deepseek/i.test(String(service.name || '')));
  const modelDetail = (deepSeekHealth as { details?: { model?: unknown } } | undefined)?.details?.model;
  // The model actually configured, as reported by the health check. The old
  // panel said "DeepSeek V4 Pro" as a literal while deepseek-flash was running.
  const modelName = typeof modelDetail === 'string' && modelDetail ? modelDetail : null;
  const sessionJobs = sessionJobIds
    .map((id) => jobs.find((job) => job.id === id) || sessionRegistryRef.current.get(id))
    .filter((job): job is GenerationJob => Boolean(job));
  const pendingSessionJobs = sessionJobs.filter((job) => job.status === 'queued' || job.status === 'running');
  const shortcutLabel = hydrated && /Mac|iPhone|iPad/u.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K';

  const closeComposer = () => {
    setComposerOpen(false);
    window.requestAnimationFrame(() => composerTriggerRef.current?.focus({ preventScroll: true }));
  };

  // A header chip rather than a panel: the counts it used to repeat already
  // live in the queue dialog, and the queue is idle almost all the time.
  const queueChip = (
    <button
      className={`factory-queue-chip queue-status-${activeJob?.status || 'idle'}${queueUnavailable || queueRefreshFailed ? ' queue-status-warning' : ''}`}
      type="button"
      data-testid="react-queue-status"
      aria-busy={queueInitialLoading || queueRefreshing}
      aria-haspopup="dialog"
      title={`任务队列 · ${queueStatusLabel}`}
      onClick={() => setQueueRoute(true, activeJob?.id)}
    >
      <i />
      <span className="queue-current" role="status" aria-live="polite">
        <strong>{queueStatusLabel}</strong>
        <span>{queueStatusDescription}</span>
      </span>
    </button>
  );

  return (
    <ProductShell
      active="factory"
      title="Cards Factory"
      titleActions={(
        <>
          {queueChip}
          <button
            ref={composerTriggerRef}
            className={`primary factory-composer-trigger${composerOpen ? ' is-pressed' : ''}`}
            type="button"
            data-testid="factory-composer-trigger"
            aria-controls="qc-panel"
            aria-expanded={composerOpen}
            onClick={() => (composerOpen ? closeComposer() : setComposerOpen(true))}
          >
            <Plus aria-hidden="true" /> 新建学习卡
          </button>
        </>
      )}
    >
      <div className={`factory-content-fill${composerOpen ? ' is-composing' : ''}`} data-testid="react-cards-factory">
        <div className="factory-workspace">
          <section className="factory-library-grid">
            <aside className="surface date-rail">
              <div className="library-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={libraryMode === 'folders'} className={libraryMode === 'folders' ? 'active' : ''} onClick={() => setLibraryMode('folders')}>日期</button>
                <button type="button" role="tab" aria-selected={libraryMode === 'history'} className={libraryMode === 'history' ? 'active' : ''} onClick={() => setLibraryMode('history')}>全部卡片</button>
              </div>
              <div className="date-groups" data-testid="react-folder-list">
                <div className="rail-heading"><p className="eyebrow">日期归档</p><h2>日期</h2><span>{folders.length}</span></div>
                {foldersQuery.isLoading && !foldersQuery.data ? (
                  <PageState variant="loading" title="正在读取日期" description="正在恢复卡片归档。" compact testId="factory-folders-loading" />
                ) : foldersQuery.isError && !foldersQuery.data ? (
                  <PageState
                    variant="error"
                    title="日期归档无法读取"
                    description="卡片文件没有被修改。"
                    actions={<button className="primary" type="button" onClick={() => void foldersQuery.refetch()}>重试</button>}
                    compact
                    testId="factory-folders-error"
                  />
                ) : (
                  <>
                    <DataRefreshStatus
                      refreshing={foldersQuery.isFetching && !foldersQuery.isLoading}
                      failed={foldersQuery.isError && Boolean(foldersQuery.data)}
                      label="日期归档"
                      onRetry={() => void foldersQuery.refetch()}
                      compact
                    />
                    {groupedFolders.map(([group, items]) => {
                      const expanded = expandedDateGroups.has(group);
                      return (
                        <section key={group} className={expanded ? 'is-expanded' : 'is-collapsed'}>
                          <h3>
                            <button
                              type="button"
                              className="date-group-toggle"
                              aria-expanded={expanded}
                              aria-label={`${expanded ? '收起' : '展开'} ${group}`}
                              onClick={() => setExpandedDateGroups((current) => {
                                const next = new Set(current);
                                if (next.has(group)) next.delete(group);
                                else next.add(group);
                                return next;
                              })}
                            >
                              <span>{group}</span>
                              <small>{items.length}</small>
                              <ChevronDown aria-hidden="true" />
                            </button>
                          </h3>
                          {expanded && (
                            <div>
                              {items.sort((a, b) => b.folder.localeCompare(a.folder)).map((item) => (
                                <button
                                  key={item.folder}
                                  type="button"
                                  className={libraryMode === 'folders' && selectedFolder === item.folder ? 'active' : ''}
                                  title={item.title}
                                  aria-label={`日期 ${item.title}`}
                                  onClick={() => { setSelectedFolder(item.folder); setLibraryMode('folders'); }}
                                >{item.day}</button>
                              ))}
                            </div>
                          )}
                        </section>
                      );
                    })}
                    {!folders.length && <div className="empty-copy">暂无卡片日期</div>}
                  </>
                )}
              </div>
            </aside>

            <article className={`surface card-library density-${cardDensity}`}>
              <header className="surface-heading">
                <div><p className="eyebrow">学习卡片</p><h2>卡片库</h2><span id="library-search-scope">{libraryMode === 'history' ? '范围：全部日期 · 按标题搜索' : `范围：${dateParts(selectedFolder).title || '当前日期'} · 按标题或类型搜索`}</span></div>
                {libraryMode === 'history' ? <b aria-label={historyQuery.data ? `共 ${historyQuery.data.pagination.total} 条` : '正在读取总数'}>{historyQuery.data?.pagination.total ?? '…'}</b> : <b aria-label={cardSearch.trim() ? `${visibleFiles.length} 条匹配，共 ${files.length} 条` : `共 ${files.length} 条`}>
                  {cardSearch.trim() ? `${visibleFiles.length}/${files.length}` : files.length}
                </b>}
              </header>
              <div className="card-library-toolbar" data-testid="factory-library-toolbar">
                <label className="card-library-search">
                  <Search aria-hidden="true" />
                  <input
                    type="search"
                    value={cardSearch}
                    aria-label={libraryMode === 'history' ? '搜索全部卡片' : '搜索当前日期卡片'}
                    aria-describedby="library-search-scope"
                    placeholder={libraryMode === 'history' ? '搜索所有日期的卡片标题' : '搜索当前日期标题或卡片类型'}
                    onChange={(event) => { setCardSearch(event.target.value); setHistoryPage(1); }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' || !cardSearch.trim()) return;
                      void factoryApi.recordEngagement({
                        eventKey: createInteractionKey('library-search'),
                        phrase: cardSearch.trim(),
                        cardType,
                        eventKind: 'library_search_submitted',
                        sourceSurface: 'cards_factory',
                        metadata: { scope: libraryMode, folder: libraryMode === 'folders' ? selectedFolder : null, resultCount: libraryMode === 'folders' ? visibleFiles.length : historyQuery.data?.pagination.total },
                      }).catch(() => {});
                    }}
                  />
                  {cardSearch && (
                    <button type="button" aria-label="清除卡片搜索" onClick={() => { setCardSearch(''); setHistoryPage(1); }}>
                      <X aria-hidden="true" />
                    </button>
                  )}
                </label>
                {libraryMode === 'folders' ? <label className="card-library-sort">
                  <span>排序</span>
                  <select
                    value={cardSort}
                    aria-label="卡片排序"
                    onChange={(event) => setCardSort(event.target.value as CardSort)}
                  >
                    <option value="newest">最近生成</option>
                    <option value="title">标题</option>
                    <option value="type">卡片类型</option>
                  </select>
                </label> : <span className="card-library-order">按最近生成排序</span>}
                <div className="card-density-control" role="group" aria-label="卡片显示密度">
                  <button
                    type="button"
                    aria-label="舒展显示"
                    aria-pressed={cardDensity === 'comfortable'}
                    title="舒展显示"
                    onClick={() => setCardDensity('comfortable')}
                  >
                    <LayoutGrid aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label="紧凑显示"
                    aria-pressed={cardDensity === 'compact'}
                    title="紧凑显示"
                    onClick={() => setCardDensity('compact')}
                  >
                    <List aria-hidden="true" />
                  </button>
                </div>
              </div>

              {libraryMode === 'history' ? (
                <div className="history-results" data-testid="factory-history-results">
                  <div className="card-file-grid history-items" data-testid="react-file-list">
                    {historyQuery.isLoading && !historyQuery.data ? (
                      <PageState variant="loading" title="正在读取全部卡片" description="正在搜索所有日期的卡片标题。" compact />
                    ) : historyQuery.isError && !historyQuery.data ? (
                      <PageState
                        variant="error"
                        title="全部卡片无法读取"
                        description="现有卡片没有被修改。"
                        actions={<button className="primary" type="button" onClick={() => void historyQuery.refetch()}>重试</button>}
                        compact
                      />
                    ) : (
                      <>
                        <DataRefreshStatus
                          refreshing={historyQuery.isFetching && !historyQuery.isLoading}
                          failed={historyQuery.isError && Boolean(historyQuery.data)}
                          label="全部卡片"
                          onRetry={() => void historyQuery.refetch()}
                          compact
                        />
                        {historyQuery.data?.records.map((record) => (
                          <button key={record.id} type="button" className={`file-card type-${record.card_type || 'trilingual'}`} onClick={() => setSelectedCard({
                            folder: record.folder_name,
                            baseName: record.base_filename,
                            title: record.phrase,
                            cardType: record.card_type || 'trilingual',
                            generationId: record.id,
                          })}>
                            <span>{CARD_CONFIG[record.card_type || 'trilingual'].label}</span><strong>{record.phrase}</strong><small>{record.generation_date || record.folder_name}</small>
                          </button>
                        ))}
                        {!historyQuery.data?.records.length && <div className="empty-library"><Search aria-hidden="true" /><strong>全部卡片中没有匹配结果</strong><span>当前按标题搜索，请尝试其它关键词。</span>{cardSearch && <button type="button" onClick={() => { setCardSearch(''); setHistoryPage(1); }}>清除搜索</button>}</div>}
                      </>
                    )}
                  </div>
                  <div className="history-pager">
                    <button type="button" disabled={!historyQuery.data?.pagination.hasPrev} onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}>上一页</button>
                    <span>{historyPage} / {historyQuery.data?.pagination.totalPages || 1}</span>
                    <button type="button" disabled={!historyQuery.data?.pagination.hasNext} onClick={() => setHistoryPage((page) => page + 1)}>下一页</button>
                  </div>
                </div>
              ) : filesQuery.isLoading && !filesQuery.data ? (
                <PageState variant="loading" title="正在读取卡片" description="正在恢复所选日期的卡片列表。" compact testId="factory-files-loading" />
              ) : filesQuery.isError && !filesQuery.data ? (
                <PageState
                  variant="error"
                  title="卡片列表暂时无法读取"
                  description="卡片文件没有被修改。重新读取后再选择卡片。"
                  actions={<button className="primary" type="button" onClick={() => void filesQuery.refetch()}>重新读取</button>}
                  compact
                  testId="factory-files-error"
                />
              ) : (
                <>
                  <DataRefreshStatus
                    refreshing={filesQuery.isFetching && !filesQuery.isLoading}
                    failed={filesQuery.isError && Boolean(filesQuery.data)}
                    label="卡片列表"
                    onRetry={() => void filesQuery.refetch()}
                    compact
                    testId="factory-files-refresh-status"
                  />
                  <div className="card-file-grid" data-testid="react-file-list">
                    {selectedFolder === todayFolder && pendingSessionJobs.map((job) => (
                      <div
                        key={`pending-${job.id}`}
                        className={`file-card is-pending type-${job.jobType}${job.status === 'queued' ? ' is-queued' : ''}`}
                        data-testid="factory-pending-card"
                      >
                        <span>{CARD_CONFIG[job.jobType]?.label || '学习卡'}</span>
                        <strong>{job.phraseNormalized}</strong>
                        <small>{job.status === 'running' ? '生成中' : '排队中'}</small>
                        <i className="file-card-progress" aria-hidden="true" />
                      </div>
                    ))}
                    {visibleFiles.map(({ file, type }) => {
                      return (
                        <button key={`${file.sourceFolder || selectedFolder}/${file.file}`} type="button" className={`file-card type-${type}`} onClick={() => openFile(file)}>
                          <span>{file.resurfacedToday ? '今日再次学习' : CARD_CONFIG[type].label}</span><strong>{file.title || file.file}</strong>
                        </button>
                      );
                    })}
                  </div>
                  {!files.length && !(selectedFolder === todayFolder && pendingSessionJobs.length > 0) && <div className="empty-library"><CalendarDays aria-hidden="true" /><strong>这个日期还没有学习卡</strong><span>点右上角的“新建学习卡”创建第一张。</span></div>}
                  {files.length > 0 && !visibleFiles.length && (
                    <div className="empty-library is-filtered">
                      <Search aria-hidden="true" />
                      <strong>没有匹配卡片</strong>
                      <span>仅搜索 {dateParts(selectedFolder).title}，其它日期可能有匹配卡片。</span>
                      <button className="primary" type="button" onClick={() => { setLibraryMode('history'); setHistoryPage(1); }}>在全部卡片中搜索</button>
                      <button type="button" onClick={() => { setCardSearch(''); setHistoryPage(1); }}>清除搜索</button>
                    </div>
                  )}
                </>
              )}
            </article>
          </section>
          {composerOpen && (
            <QuickComposer
              cardType={cardType}
              onCardTypeChange={changeCardType}
              onClose={closeComposer}
              healthUnhealthy={healthUnhealthy}
              onRecheckHealth={() => void healthQuery.refetch()}
              modelName={modelName}
              submitting={submitting}
              onSubmit={submitLines}
              onCreateVersion={createVersion}
              onOpenDuplicate={openDuplicateCard}
              onAddToToday={(card) => addToTodayMutation.mutate(card)}
              addingToToday={addToTodayMutation.isPending}
              notice={notice}
              onDismissNotice={() => setNotice('')}
              sessionJobs={sessionJobs}
              allJobs={jobs}
              onOpenJob={openGeneratedResult}
              onRetryJob={(job) => void retryJob(job)}
              shortcutLabel={shortcutLabel}
            />
          )}
        </div>

        <QueuePanel
          open={queueOpen}
          onClose={() => setQueueRoute(false)}
          jobs={jobs}
          summary={summary}
          selectedJobId={selectedQueueJobId}
          onSelectJob={(jobId) => setQueueRoute(true, jobId)}
          onOpenResult={openGeneratedResult}
        />
        {selectedCard && <DeferredCardModal selection={selectedCard} onClose={() => setSelectedCard(null)} />}
      </div>
    </ProductShell>
  );
}
