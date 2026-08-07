import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen, CalendarDays, CalendarPlus, ChevronDown, ExternalLink, FileText, Image, Languages, LayoutGrid,
  List, MessagesSquare, PlusCircle, RefreshCw, Search, Upload, X,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ProductShell } from '../../components/ProductShell';
import { PageHeader } from '../../components/PageHeader';
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
import { fileToDataUrl, normalizeOcrText } from './ocr';
import { QueuePanel } from './QueuePanel';
import type { CardSelection, CardType, DuplicateCardSummary, FolderFile, GenerationJob, SourceMode } from './types';

type CardSort = 'newest' | 'title' | 'type';
type CardDensity = 'comfortable' | 'compact';
type DuplicateConflict = {
  phrase: string;
  cardType: CardType;
  sourceMode: SourceMode;
  cards: DuplicateCardSummary[];
};

function createInteractionKey(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}

const CARD_CONFIG: Record<CardType, {
  label: string;
  hint: string;
  action: string;
  icon: typeof Languages;
}> = {
  trilingual: { label: '三语卡片', hint: '中英日核心表达', action: '生成三语卡片', icon: Languages },
  grammar_ja: { label: '日语语法', hint: '中文讲解与日语例句', action: '生成语法卡片', icon: BookOpen },
  scenario_phrase: { label: '场景表达', hint: '特定场景常用表达', action: '生成场景卡片', icon: MessagesSquare },
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

function displayGenerationDate(value: string | null, fallback: string) {
  const date = String(value || fallback || '').trim();
  const compact = date.match(/^(\d{4})(\d{2})(\d{2})$/u);
  return compact ? `${compact[1]}-${compact[2]}-${compact[3]}` : date;
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
  const [composerSource, setComposerSource] = useState<'text' | 'image'>('text');
  const [phrase, setPhrase] = useState('');
  const [selectedFolder, setSelectedFolder] = useState('');
  const [selectedCard, setSelectedCard] = useState<CardSelection | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [selectedQueueJobId, setSelectedQueueJobId] = useState<number | null>(null);
  const [libraryMode, setLibraryMode] = useState<'folders' | 'history'>('folders');
  const [expandedDateGroups, setExpandedDateGroups] = useState<Set<string>>(new Set());
  const [historySearch, setHistorySearch] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const [cardSearch, setCardSearch] = useState('');
  const [cardSort, setCardSort] = useState<CardSort>('newest');
  const [cardDensity, setCardDensity] = useState<CardDensity>('comfortable');
  const [libraryPreferencesLoaded, setLibraryPreferencesLoaded] = useState(false);
  const [imageData, setImageData] = useState('');
  const [ocrRaw, setOcrRaw] = useState('');
  const [ocrClean, setOcrClean] = useState('');
  const [notice, setNotice] = useState('');
  const [duplicateConflict, setDuplicateConflict] = useState<DuplicateConflict | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    queryKey: ['history', historySearch, historyPage],
    queryFn: () => factoryApi.history(historySearch, historyPage),
    enabled: hydrated && libraryMode === 'history',
  });

  const physicalFolders = foldersQuery.data?.folders || [];
  const todayFolder = todayCardsQuery.data?.learningDay?.replaceAll('-', '') || '';
  const folders = useMemo(() => {
    const result = new Set(physicalFolders);
    if (todayFolder && todayCardsQuery.data?.cards.length) result.add(todayFolder);
    return [...result];
  }, [physicalFolders, todayCardsQuery.data?.cards.length, todayFolder]);
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
        : activeJob?.status?.toUpperCase() || '空闲';
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

  const enqueueMutation = useMutation({
    mutationFn: ({ value, sourceMode, duplicatePolicy = 'reject', interactionKey, preflightRecorded = false }: {
      value: string;
      sourceMode: SourceMode;
      duplicatePolicy?: 'reject' | 'create-version';
      interactionKey?: string;
      preflightRecorded?: boolean;
    }) => factoryApi.enqueue({
      phrase: value,
      cardType,
      sourceMode,
      duplicatePolicy,
      interactionKey,
      preflightRecorded,
    }),
    onSuccess: async (data) => {
      trackedJobIdsRef.current.add(data.job.id);
      publishedJobStatusRef.current.set(data.job.id, data.job.status);
      publishShellActivity({
        id: String(data.job.id),
        kind: 'generation-job',
        status: shellStatusForJob(data.job.status),
        title: `${CARD_CONFIG[data.job.jobType]?.label || '学习卡'}生成`,
        summary: jobActivitySummary(data.job),
        href: `/?queue=1&job=${data.job.id}`,
      });
      publishShellFeedback({
        id: `generation-created-${data.job.id}`,
        tone: 'success',
        message: `生成任务 #${data.job.id} 已加入队列`,
        actionLabel: '查看队列',
        actionHref: `/?queue=1&job=${data.job.id}`,
      });
      setPhrase('');
      setDuplicateConflict(null);
      setNotice('已加入共享任务队列');
      await queryClient.invalidateQueries({ queryKey: ['queue'] });
    },
    onError: (error, variables) => {
      const payload = error instanceof ApiError ? error.payload as { code?: string; details?: DuplicateCardSummary[] } : null;
      if (error instanceof ApiError && error.status === 409 && payload?.code === 'CARD_DUPLICATE_EXISTS' && payload.details?.length) {
        setDuplicateConflict({ phrase: variables.value, cardType, sourceMode: variables.sourceMode, cards: payload.details });
        setNotice('');
        return;
      }
      const message = error instanceof ApiError && error.status === 409 ? '相同生成任务正在队列中' : `入队失败：${error.message}`;
      setNotice(message);
      publishShellFeedback({ tone: error instanceof ApiError && error.status === 409 ? 'warning' : 'error', message });
    },
  });
  const preflightMutation = useMutation({
    mutationFn: ({ value, sourceMode }: { value: string; sourceMode: SourceMode }) => {
      const interactionKey = createInteractionKey('generation');
      return factoryApi.preflight({ phrase: value, cardType, interactionKey })
        .then((result) => ({ ...result, value, sourceMode }));
    },
    onSuccess: (result) => {
      if (result.duplicates.length) {
        setDuplicateConflict({
          phrase: result.value,
          cardType,
          sourceMode: result.sourceMode,
          cards: result.duplicates,
        });
        setNotice('');
        return;
      }
      if (result.activeJob) {
        setNotice(`相同任务 #${result.activeJob.id} 正在队列中`);
        setQueueRoute(true, result.activeJob.id);
        return;
      }
      enqueueMutation.mutate({
        value: result.value,
        sourceMode: result.sourceMode,
        interactionKey: result.interactionKey,
        preflightRecorded: true,
      });
    },
    onError: (error) => setNotice(`检查已有卡片失败：${error.message}`),
  });
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
      setDuplicateConflict(null);
      setSelectedFolder(result.engagement.learningDay.replaceAll('-', ''));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['card-engagement'] }),
        queryClient.invalidateQueries({ queryKey: ['learning'] }),
      ]);
    },
    onError: (error) => setNotice(`加入今日失败：${error.message}`),
  });
  const ocrMutation = useMutation({
    mutationFn: factoryApi.ocr,
    onSuccess: (data) => {
      const normalized = normalizeOcrText(data.text);
      setOcrRaw(normalized.raw);
      setOcrClean(normalized.clean);
      setPhrase(normalized.clean);
      setComposerSource('text');
      setNotice(normalized.changed ? 'OCR 内容已清洗并填入文本框' : 'OCR 内容已填入文本框');
    },
    onError: (error) => setNotice(`OCR 失败：${error.message}`),
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

  const handleImage = async (file?: File) => {
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 4 * 1024 * 1024) {
      setNotice('图片不能超过 4 MB');
      return;
    }
    setComposerSource('image');
    setImageData(await fileToDataUrl(file));
    setOcrRaw('');
    setOcrClean('');
  };

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const item = Array.from(event.clipboardData?.items || []).find((entry) => entry.type.startsWith('image/'));
      if (item) void handleImage(item.getAsFile() || undefined);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

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
    setDuplicateConflict(null);
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

  const factoryRail = (
    <div className="factory-control-rail" data-testid="factory-control-rail">
      {healthUnhealthy && (
        <div className="react-alert factory-rail-alert" role="alert">
          <span>生成服务不可用，请检查 DeepSeek API。</span>
          <button type="button" aria-label="重新检查生成服务" title="重新检查" onClick={() => healthQuery.refetch()}>
            <RefreshCw aria-hidden="true" />
          </button>
        </div>
      )}

      <article className="surface factory-composer">
        <PageHeader
          className="surface-heading"
          compact
          testId="factory-composer-header"
          eyebrow="Cards Factory"
          title="创建学习卡"
          actions={<span>DeepSeek V4 Pro</span>}
        />
        <div className="card-type-control" role="radiogroup" aria-label="卡片类型">
          {(Object.entries(CARD_CONFIG) as [CardType, typeof CARD_CONFIG[CardType]][]).map(([type, config]) => {
            const Icon = config.icon;
            return (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={cardType === type}
                aria-label={`${config.label}：${config.hint}`}
                title={config.hint}
                className={`card-type-choice type-${type}${cardType === type ? ' active' : ''}`}
                data-testid={`react-card-type-${type}`}
                onClick={() => setCardType(type)}
              >
                <Icon aria-hidden="true" />
                <span><strong>{config.label.replace('卡片', '卡')}</strong></span>
              </button>
            );
          })}
        </div>

        <div className="factory-source-tabs" role="tablist" aria-label="输入方式">
          <button
            type="button"
            role="tab"
            aria-selected={composerSource === 'text'}
            className={composerSource === 'text' ? 'active' : ''}
            onClick={() => setComposerSource('text')}
          >
            <FileText aria-hidden="true" /> 文本
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={composerSource === 'image'}
            className={composerSource === 'image' ? 'active' : ''}
            onClick={() => setComposerSource('image')}
          >
            <Image aria-hidden="true" /> 图片
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          data-testid="react-image-input"
          onChange={(event) => void handleImage(event.target.files?.[0])}
        />

        {composerSource === 'text' ? (
          <label className="text-input-block">
            <span>学习内容</span>
            <textarea
              value={phrase}
              data-testid="react-phrase-input"
              placeholder={cardType === 'scenario_phrase' ? '描述一个具体场景…' : '输入短语或句子…'}
              onChange={(event) => setPhrase(event.target.value)}
            />
          </label>
        ) : (
          <div className="ocr-block">
            <button
              type="button"
              className={`image-drop${imageData ? ' has-image' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); void handleImage(event.dataTransfer.files[0]); }}
            >
              {imageData
                ? <img src={imageData} alt="OCR 预览" />
                : <><Upload aria-hidden="true" /><span>粘贴、拖放或选择图片</span></>}
            </button>
            <div className="ocr-actions">
              <button type="button" data-testid="react-ocr-button" disabled={!imageData || ocrMutation.isPending} onClick={() => ocrMutation.mutate(imageData)}>
                {ocrMutation.isPending ? '识别中…' : '识别文字'}
              </button>
              <button type="button" aria-label="清除图片" title="清除图片" disabled={!imageData} onClick={() => { setImageData(''); setOcrRaw(''); setOcrClean(''); }}>
                <X aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {ocrClean && <details className="ocr-result"><summary>OCR 结果</summary><strong>清洗后</strong><p>{ocrClean}</p><strong>原文</strong><p>{ocrRaw}</p></details>}

        <button
          className="primary-button"
          type="button"
          disabled={!phrase.trim() || preflightMutation.isPending || enqueueMutation.isPending || healthUnhealthy}
          data-testid="react-generate-button"
          onClick={() => preflightMutation.mutate({ value: phrase.trim(), sourceMode: ocrClean && phrase === ocrClean ? 'ocr' : 'input' })}
        >
          {preflightMutation.isPending ? '检查已有卡片…' : enqueueMutation.isPending ? '正在加入队列…' : CARD_CONFIG[cardType].action}
        </button>

        {notice && <div className="inline-notice" role="status">{notice}<button type="button" aria-label="关闭提示" onClick={() => setNotice('')}><X /></button></div>}
        {duplicateConflict && (
          <section className="duplicate-card-panel" data-testid="factory-duplicate-card-panel" aria-label="已有相同学习卡">
            <header>
              <div><strong>已有相同学习卡</strong><span>这不是搜索历史，而是已经成功生成的卡片。</span></div>
              <button type="button" aria-label="关闭已有卡片提示" onClick={() => setDuplicateConflict(null)}><X aria-hidden="true" /></button>
            </header>
            {duplicateConflict.cards.slice(0, 3).map((card) => (
              <div className="duplicate-card-result" key={card.generationId}>
                <div>
                  <strong>{card.phrase}</strong>
                  <span>最初生成于 {displayGenerationDate(card.generationDate, card.folderName)} · {CARD_CONFIG[card.cardType].label}</span>
                </div>
                <div>
                  <button type="button" onClick={() => openDuplicateCard(card)}><ExternalLink aria-hidden="true" /> 打开已有卡</button>
                  <button type="button" disabled={addToTodayMutation.isPending} onClick={() => addToTodayMutation.mutate(card)}><CalendarPlus aria-hidden="true" /> 加入今日</button>
                </div>
              </div>
            ))}
            <footer>
              <span>旧文件与原始日期保持不变；加入今日只建立今日学习关联。</span>
              <button
                type="button"
                disabled={enqueueMutation.isPending}
                onClick={() => enqueueMutation.mutate({
                  value: duplicateConflict.phrase,
                  sourceMode: duplicateConflict.sourceMode,
                  duplicatePolicy: 'create-version',
                  interactionKey: createInteractionKey('new-version'),
                })}
              ><PlusCircle aria-hidden="true" /> 确认生成新版</button>
            </footer>
          </section>
        )}
      </article>

      <button
        className={`surface queue-status queue-status-${activeJob?.status || 'idle'}${queueUnavailable || queueRefreshFailed ? ' queue-status-warning' : ''}`}
        type="button"
        data-testid="react-queue-status"
        aria-busy={queueInitialLoading || queueRefreshing}
        onClick={() => setQueueRoute(true, activeJob?.id)}
      >
        <div className="surface-heading"><div><p className="eyebrow">任务队列</p><h2>队列管理</h2></div><span>查看</span></div>
        <div className="queue-current" role="status" aria-live="polite">
          <i />
          <strong>{queueStatusLabel}</strong>
          <span>{queueStatusDescription}</span>
        </div>
        <div className="queue-progress"><i style={{ width: `${jobs.length ? ((Number(summary.success || 0) + Number(summary.failed || 0)) / jobs.length) * 100 : 0}%` }} /></div>
        <div className="queue-counts">
          <span>待执行 <b>{queueUnavailable || queueInitialLoading ? '--' : summary.queued || 0}</b></span>
          <span>运行中 <b>{queueUnavailable || queueInitialLoading ? '--' : summary.running || 0}</b></span>
          <span>完成 <b>{queueUnavailable || queueInitialLoading ? '--' : summary.success || 0}</b></span>
          <span>失败 <b>{queueUnavailable || queueInitialLoading ? '--' : summary.failed || 0}</b></span>
        </div>
      </button>
    </div>
  );

  return (
    <ProductShell
      active="factory"
      title="Cards Factory"
      workspaceLayout={(content, recovery) => (
        <div className="product-workspace-layout">
          <div className="product-workspace-main">{content}</div>
          <aside className="product-workspace-rail" aria-label="Cards Factory 工具栏">
            {recovery}
            {factoryRail}
          </aside>
        </div>
      )}
    >
      <div data-testid="react-cards-factory">
        <section className="factory-library-grid">
          <aside className="surface date-rail">
            <div className="library-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={libraryMode === 'folders'} className={libraryMode === 'folders' ? 'active' : ''} onClick={() => setLibraryMode('folders')}>日期</button>
              <button type="button" role="tab" aria-selected={libraryMode === 'history'} className={libraryMode === 'history' ? 'active' : ''} onClick={() => setLibraryMode('history')}>历史</button>
            </div>
            {libraryMode === 'folders' ? (
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
                                  className={selectedFolder === item.folder ? 'active' : ''}
                                  title={item.title}
                                  aria-label={`日期 ${item.title}`}
                                  onClick={() => setSelectedFolder(item.folder)}
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
            ) : (
              <div className="history-rail">
                <label><Search aria-hidden="true" /><input value={historySearch} placeholder="搜索历史" onChange={(event) => { setHistorySearch(event.target.value); setHistoryPage(1); }} /></label>
                <div className="history-items">
                  {historyQuery.isLoading && !historyQuery.data ? (
                    <PageState variant="loading" title="正在读取历史" description="正在恢复生成记录。" compact />
                  ) : historyQuery.isError && !historyQuery.data ? (
                    <PageState
                      variant="error"
                      title="历史记录无法读取"
                      description="现有卡片没有被修改。"
                      actions={<button className="primary" type="button" onClick={() => void historyQuery.refetch()}>重试</button>}
                      compact
                    />
                  ) : (
                    <>
                      <DataRefreshStatus
                        refreshing={historyQuery.isFetching && !historyQuery.isLoading}
                        failed={historyQuery.isError && Boolean(historyQuery.data)}
                        label="历史记录"
                        onRetry={() => void historyQuery.refetch()}
                        compact
                      />
                      {historyQuery.data?.records.map((record) => (
                        <button key={record.id} type="button" onClick={() => setSelectedCard({
                          folder: record.folder_name,
                          baseName: record.base_filename,
                          title: record.phrase,
                          cardType: record.card_type || 'trilingual',
                        })}>
                          <strong>{record.phrase}</strong><small>{record.generation_date || record.folder_name}</small>
                        </button>
                      ))}
                      {!historyQuery.data?.records.length && <div className="empty-copy">没有匹配记录</div>}
                    </>
                  )}
                </div>
                <div className="history-pager">
                  <button type="button" disabled={!historyQuery.data?.pagination.hasPrev} onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}>上一页</button>
                  <span>{historyPage} / {historyQuery.data?.pagination.totalPages || 1}</span>
                  <button type="button" disabled={!historyQuery.data?.pagination.hasNext} onClick={() => setHistoryPage((page) => page + 1)}>下一页</button>
                </div>
              </div>
            )}
          </aside>

          <article className={`surface card-library density-${cardDensity}`}>
            <header className="surface-heading">
              <div><p className="eyebrow">最近卡片</p><h2>卡片库</h2><span>选择卡片进入学习</span></div>
              <b aria-label={cardSearch.trim() ? `${visibleFiles.length} 条匹配，共 ${files.length} 条` : `共 ${files.length} 条`}>
                {cardSearch.trim() ? `${visibleFiles.length}/${files.length}` : files.length}
              </b>
            </header>
            {filesQuery.isLoading && !filesQuery.data ? (
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
                {files.length > 0 && (
                  <div className="card-library-toolbar" data-testid="factory-library-toolbar">
                    <label className="card-library-search">
                      <Search aria-hidden="true" />
                      <input
                        type="search"
                        value={cardSearch}
                        aria-label="搜索当前日期卡片"
                        placeholder="搜索标题或卡片类型"
                        onChange={(event) => setCardSearch(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' || !cardSearch.trim()) return;
                          void factoryApi.recordEngagement({
                            eventKey: createInteractionKey('library-search'),
                            phrase: cardSearch.trim(),
                            cardType,
                            eventKind: 'library_search_submitted',
                            sourceSurface: 'cards_factory',
                            metadata: { folder: selectedFolder, resultCount: visibleFiles.length },
                          }).catch(() => {});
                        }}
                      />
                      {cardSearch && (
                        <button type="button" aria-label="清除卡片搜索" onClick={() => setCardSearch('')}>
                          <X aria-hidden="true" />
                        </button>
                      )}
                    </label>
                    <label className="card-library-sort">
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
                    </label>
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
                )}
                <div className="card-file-grid" data-testid="react-file-list">
                  {visibleFiles.map(({ file, type }) => {
                    return (
                      <button key={`${file.sourceFolder || selectedFolder}/${file.file}`} type="button" className={`file-card type-${type}`} onClick={() => openFile(file)}>
                        <span>{file.resurfacedToday ? '今日再次学习' : CARD_CONFIG[type].label}</span><strong>{file.title || file.file}</strong>
                      </button>
                    );
                  })}
                </div>
                {!files.length && <div className="empty-library"><CalendarDays aria-hidden="true" /><strong>这个日期还没有学习卡</strong><span>从上方创建第一张卡片。</span></div>}
                {files.length > 0 && !visibleFiles.length && (
                  <div className="empty-library is-filtered">
                    <Search aria-hidden="true" />
                    <strong>没有匹配卡片</strong>
                    <span>调整搜索词，或清除当前搜索。</span>
                    <button type="button" onClick={() => setCardSearch('')}>清除搜索</button>
                  </div>
                )}
              </>
            )}
          </article>
        </section>

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
