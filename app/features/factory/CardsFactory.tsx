import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen, CalendarDays, FileText, Image, Languages,
  MessagesSquare, RefreshCw, Search, Upload, X,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ProductShell } from '../../components/ProductShell';
import { ApiError } from '../../lib/api/client';
import { CardModal } from '../card-modal/CardModal';
import { factoryApi } from './factory-api';
import { fileToDataUrl, normalizeOcrText } from './ocr';
import { QueuePanel } from './QueuePanel';
import type { CardSelection, CardType, FolderFile, GenerationJob, SourceMode } from './types';

const CARD_CONFIG: Record<CardType, {
  label: string;
  hint: string;
  action: string;
  icon: typeof Languages;
}> = {
  trilingual: { label: '三语卡片', hint: '中英日核心表达', action: 'Generate Trilingual Card', icon: Languages },
  grammar_ja: { label: '日语语法', hint: '中文讲解与日语例句', action: 'Generate Grammar Card', icon: BookOpen },
  scenario_phrase: { label: '场景表达', hint: '特定场景常用表达', action: 'Generate Scenario Card', icon: MessagesSquare },
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

export function CardsFactory() {
  const hydrated = useHydrated();
  const queryClient = useQueryClient();
  const [cardType, setCardType] = useState<CardType>('trilingual');
  const [phrase, setPhrase] = useState('');
  const [selectedFolder, setSelectedFolder] = useState('');
  const [selectedCard, setSelectedCard] = useState<CardSelection | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [libraryMode, setLibraryMode] = useState<'folders' | 'history'>('folders');
  const [historySearch, setHistorySearch] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const [imageData, setImageData] = useState('');
  const [ocrRaw, setOcrRaw] = useState('');
  const [ocrClean, setOcrClean] = useState('');
  const [notice, setNotice] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastSuccessRef = useRef(0);

  const healthQuery = useQuery({
    queryKey: ['health'], queryFn: factoryApi.health, enabled: hydrated, refetchInterval: 15_000,
  });
  const foldersQuery = useQuery({
    queryKey: ['folders'], queryFn: factoryApi.folders, enabled: hydrated, refetchInterval: 60_000,
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

  const folders = foldersQuery.data?.folders || [];
  const files = filesQuery.data?.files || [];
  const jobs = jobsQuery.data?.jobs || [];
  const computedCounts = queueCounts(jobs);
  const summary = summaryQuery.data?.summary || computedCounts;
  const activeJob = jobs.find((job) => job.status === 'running') || jobs.find((job) => job.status === 'queued') || null;

  useEffect(() => {
    if (!folders.length) return;
    if (!selectedFolder || !folders.includes(selectedFolder)) setSelectedFolder([...folders].sort().reverse()[0]);
  }, [folders, selectedFolder]);

  useEffect(() => {
    const latestSuccess = Math.max(0, ...jobs.filter((job) => job.status === 'success').map((job) => job.id));
    if (latestSuccess > lastSuccessRef.current) {
      lastSuccessRef.current = latestSuccess;
      void queryClient.invalidateQueries({ queryKey: ['folders'] });
      void queryClient.invalidateQueries({ queryKey: ['files'] });
      void queryClient.invalidateQueries({ queryKey: ['history'] });
    }
  }, [jobs, queryClient]);

  const enqueueMutation = useMutation({
    mutationFn: ({ value, sourceMode }: { value: string; sourceMode: SourceMode }) => factoryApi.enqueue({
      phrase: value,
      cardType,
      sourceMode,
    }),
    onSuccess: async () => {
      setPhrase('');
      setNotice('已加入共享任务队列');
      await queryClient.invalidateQueries({ queryKey: ['queue'] });
    },
    onError: (error) => {
      setNotice(error instanceof ApiError && error.status === 409 ? '该内容已在队列中' : `入队失败：${error.message}`);
    },
  });
  const ocrMutation = useMutation({
    mutationFn: factoryApi.ocr,
    onSuccess: (data) => {
      const normalized = normalizeOcrText(data.text);
      setOcrRaw(normalized.raw);
      setOcrClean(normalized.clean);
      setPhrase(normalized.clean);
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

  const handleImage = async (file?: File) => {
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 4 * 1024 * 1024) {
      setNotice('图片不能超过 4 MB');
      return;
    }
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
    const baseName = file.file.replace(/\.html$/i, '');
    setSelectedCard({
      folder: selectedFolder,
      baseName,
      title: file.title || baseName,
      cardType: cardTypeOf(file),
    });
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

  return (
    <ProductShell active="factory" title="Cards Factory">
      <div data-testid="react-cards-factory">
        {healthUnhealthy && (
          <div className="react-alert" role="alert">
            <span>生成服务当前不可用，请检查 DeepSeek API 状态。</span>
            <button type="button" onClick={() => healthQuery.refetch()}><RefreshCw aria-hidden="true" /> 刷新</button>
          </div>
        )}

        <section className="factory-top-grid">
          <article className="surface factory-composer">
            <header className="surface-heading">
              <div><p className="eyebrow">CARDS FACTORY</p><h1>创建学习卡</h1></div>
              <span>DeepSeek V4 Pro · Markdown</span>
            </header>
            <div className="card-type-control" role="radiogroup" aria-label="卡片类型">
              {(Object.entries(CARD_CONFIG) as [CardType, typeof CARD_CONFIG[CardType]][]).map(([type, config]) => {
                const Icon = config.icon;
                return (
                  <button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={cardType === type}
                    className={`card-type-choice type-${type}${cardType === type ? ' active' : ''}`}
                    data-testid={`react-card-type-${type}`}
                    onClick={() => setCardType(type)}
                  >
                    <Icon aria-hidden="true" /><span><strong>{config.label}</strong><small>{config.hint}</small></span>
                  </button>
                );
              })}
            </div>
            <div className="factory-input-grid">
              <label className="text-input-block">
                <span><FileText aria-hidden="true" /> 文本输入</span>
                <textarea
                  value={phrase}
                  data-testid="react-phrase-input"
                  placeholder={cardType === 'scenario_phrase' ? '描述一个具体场景，例如：保育园早上送孩子，说明昨晚有点咳嗽…' : '输入短语或句子…'}
                  onChange={(event) => setPhrase(event.target.value)}
                />
                <button
                  className="primary-button"
                  type="button"
                  disabled={!phrase.trim() || enqueueMutation.isPending || healthUnhealthy}
                  data-testid="react-generate-button"
                  onClick={() => enqueueMutation.mutate({ value: phrase.trim(), sourceMode: ocrClean && phrase === ocrClean ? 'ocr' : 'input' })}
                >
                  {enqueueMutation.isPending ? 'Adding to queue…' : CARD_CONFIG[cardType].action}
                </button>
              </label>
              <div className="ocr-block">
                <span><Image aria-hidden="true" /> 图片识别</span>
                <button
                  type="button"
                  className={`image-drop${imageData ? ' has-image' : ''}`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => { event.preventDefault(); void handleImage(event.dataTransfer.files[0]); }}
                >
                  {imageData ? <img src={imageData} alt="OCR 预览" /> : <><Upload aria-hidden="true" /><span>粘贴、拖放或选择图片</span></>}
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" hidden data-testid="react-image-input" onChange={(event) => void handleImage(event.target.files?.[0])} />
                <div className="ocr-actions">
                  <button type="button" data-testid="react-ocr-button" disabled={!imageData || ocrMutation.isPending} onClick={() => ocrMutation.mutate(imageData)}>
                    {ocrMutation.isPending ? '识别中…' : '识别文字'}
                  </button>
                  <button type="button" disabled={!imageData} onClick={() => { setImageData(''); setOcrRaw(''); setOcrClean(''); }}>清除</button>
                </div>
                {ocrClean && <details className="ocr-result"><summary>OCR 结果</summary><strong>清洗后</strong><p>{ocrClean}</p><strong>原文</strong><p>{ocrRaw}</p></details>}
              </div>
            </div>
            {notice && <div className="inline-notice" role="status">{notice}<button type="button" aria-label="关闭提示" onClick={() => setNotice('')}><X /></button></div>}
          </article>

          <button className={`surface queue-status queue-status-${activeJob?.status || 'idle'}`} type="button" data-testid="react-queue-status" onClick={() => setQueueOpen(true)}>
            <div className="surface-heading"><div><p className="eyebrow">TASK QUEUE</p><h2>队列管理</h2></div><span>点击查看详情</span></div>
            <div className="queue-current"><i /><strong>{activeJob?.status?.toUpperCase() || 'IDLE'}</strong><span>{activeJob?.phraseNormalized || 'Task Queue Idle'}</span></div>
            <div className="queue-progress"><i style={{ width: `${jobs.length ? ((Number(summary.success || 0) + Number(summary.failed || 0)) / jobs.length) * 100 : 0}%` }} /></div>
            <div className="queue-counts">
              <span>待执行 {summary.queued || 0}</span><span>运行中 {summary.running || 0}</span>
              <span>已完成 {summary.success || 0}</span><span>失败 {summary.failed || 0}</span>
            </div>
          </button>
        </section>

        <section className="factory-library-grid">
          <aside className="surface date-rail">
            <div className="library-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={libraryMode === 'folders'} className={libraryMode === 'folders' ? 'active' : ''} onClick={() => setLibraryMode('folders')}>日期</button>
              <button type="button" role="tab" aria-selected={libraryMode === 'history'} className={libraryMode === 'history' ? 'active' : ''} onClick={() => setLibraryMode('history')}>历史</button>
            </div>
            {libraryMode === 'folders' ? (
              <div className="date-groups" data-testid="react-folder-list">
                <div className="rail-heading"><p className="eyebrow">PATH</p><h2>Date</h2><span>{folders.length}</span></div>
                {groupedFolders.map(([group, items]) => (
                  <section key={group}><h3>{group}</h3><div>
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
                  </div></section>
                ))}
                {!folders.length && <div className="empty-copy">暂无卡片日期</div>}
              </div>
            ) : (
              <div className="history-rail">
                <label><Search aria-hidden="true" /><input value={historySearch} placeholder="搜索历史" onChange={(event) => { setHistorySearch(event.target.value); setHistoryPage(1); }} /></label>
                <div className="history-items">
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
                  {!historyQuery.isLoading && !historyQuery.data?.records.length && <div className="empty-copy">没有匹配记录</div>}
                </div>
                <div className="history-pager">
                  <button type="button" disabled={!historyQuery.data?.pagination.hasPrev} onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}>上一页</button>
                  <span>{historyPage} / {historyQuery.data?.pagination.totalPages || 1}</span>
                  <button type="button" disabled={!historyQuery.data?.pagination.hasNext} onClick={() => setHistoryPage((page) => page + 1)}>下一页</button>
                </div>
              </div>
            )}
          </aside>

          <article className="surface card-library">
            <header className="surface-heading">
              <div><p className="eyebrow">RECENT CARDS</p><h2>卡片库</h2><span>选择卡片进入学习</span></div>
              <b>{files.length}</b>
            </header>
            {filesQuery.isLoading && <div className="empty-copy">正在读取卡片…</div>}
            {filesQuery.isError && <div className="empty-copy error">卡片列表加载失败</div>}
            <div className="card-file-grid" data-testid="react-file-list">
              {files.map((file) => {
                const type = cardTypeOf(file);
                return (
                  <button key={file.file} type="button" className={`file-card type-${type}`} onClick={() => openFile(file)}>
                    <span>{CARD_CONFIG[type].label}</span><strong>{file.title || file.file}</strong>
                  </button>
                );
              })}
            </div>
            {!filesQuery.isLoading && !files.length && <div className="empty-library"><CalendarDays aria-hidden="true" /><strong>这个日期还没有学习卡</strong><span>从上方创建第一张卡片。</span></div>}
          </article>
        </section>

        <QueuePanel open={queueOpen} onClose={() => setQueueOpen(false)} jobs={jobs} summary={summary} />
        {selectedCard && <CardModal selection={selectedCard} onClose={() => setSelectedCard(null)} />}
      </div>
    </ProductShell>
  );
}
