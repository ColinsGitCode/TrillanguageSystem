import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, BookOpen, Database, Pencil, Plus, RotateCcw, Search } from 'lucide-react';
import { ProductShell } from '../../components/ProductShell';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmDialog, DialogSurface } from '../../components/overlays';
import { DataRefreshStatus, PageState } from '../../components/states';
import { dictionaryApi } from './dictionary-api';
import type { DictionaryLanguage, GlossaryEntry } from './types';

type EntryDraft = {
  language: DictionaryLanguage;
  canonicalForm: string;
  senseKey: string;
  zhGloss: string;
  confidence: GlossaryEntry['confidence'];
};

const emptyDraft: EntryDraft = {
  language: 'ja', canonicalForm: '', senseKey: 'default', zhGloss: '', confidence: 'high',
};

function sourceLabel(sourceId: string) {
  if (sourceId === 'zhwiktionary-ja-direct') return '中文维基词典 · 直接日中';
  if (sourceId === 'jmdict-simplified') return 'JMdict · 英中桥接';
  if (sourceId === 'ecdict') return 'ECDICT · 英中';
  if (sourceId === 'three-lans-curated-starter') return 'Three LANS 精选';
  return sourceId;
}

function formatTime(value: string) {
  if (!value) return '未记录';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Tokyo',
  }).format(new Date(value));
}

export function DictionaryPage() {
  const queryClient = useQueryClient();
  const [language, setLanguage] = useState<DictionaryLanguage | 'all'>('all');
  const [status, setStatus] = useState<'active' | 'archived' | 'all'>('active');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<GlossaryEntry | 'new' | null>(null);
  const [draft, setDraft] = useState<EntryDraft>(emptyDraft);
  const [confirmEntry, setConfirmEntry] = useState<GlossaryEntry | null>(null);
  const [message, setMessage] = useState('');

  const entriesQuery = useQuery({
    queryKey: ['dictionary', 'entries', language, query, status],
    queryFn: () => dictionaryApi.entries({
      language: language === 'all' ? undefined : language,
      query: query.trim(),
      includeArchived: status !== 'active',
    }),
  });
  const catalogQuery = useQuery({ queryKey: ['dictionary', 'catalog'], queryFn: dictionaryApi.catalog });
  const entries = useMemo(() => (entriesQuery.data?.entries || []).filter((entry) => (
    status === 'all' || entry.status === status
  )), [entriesQuery.data?.entries, status]);
  const activeSources = (catalogQuery.data?.catalog.dictionaries || []).filter((item) => item.status === 'active');
  const directCount = activeSources
    .filter((item) => item.sourceId === 'zhwiktionary-ja-direct')
    .reduce((sum, item) => sum + item.entryCount, 0);
  const manualCount = (catalogQuery.data?.catalog.manual || [])
    .filter((item) => item.status === 'active')
    .reduce((sum, item) => sum + item.entryCount, 0);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['dictionary', 'entries'] }),
      queryClient.invalidateQueries({ queryKey: ['dictionary', 'catalog'] }),
    ]);
  };
  const saveMutation = useMutation({
    mutationFn: () => editing === 'new'
      ? dictionaryApi.create(draft)
      : dictionaryApi.update(editing!, draft),
    onSuccess: async () => {
      setEditing(null);
      setMessage('人工词条已保存，新的查词会优先使用它。');
      await refresh();
    },
  });
  const archiveMutation = useMutation({
    mutationFn: (entry: GlossaryEntry) => dictionaryApi.archive(entry),
    onSuccess: async () => {
      setConfirmEntry(null);
      setMessage('词条已归档。');
      await refresh();
    },
  });
  const restoreMutation = useMutation({
    mutationFn: (entry: GlossaryEntry) => dictionaryApi.restore(entry),
    onSuccess: async () => {
      setMessage('词条已恢复，并重新成为优先释义。');
      await refresh();
    },
  });

  const openCreate = () => {
    setDraft({ ...emptyDraft, language: language === 'all' ? 'ja' : language });
    setEditing('new');
  };
  const openEdit = (entry: GlossaryEntry) => {
    setDraft({
      language: entry.language,
      canonicalForm: entry.canonicalForm,
      senseKey: entry.senseKey,
      zhGloss: entry.zhGloss,
      confidence: entry.confidence,
    });
    setEditing(entry);
  };

  return (
    <ProductShell active="dictionary" title="本地词典">
      <div className="dictionary-page">
        <PageHeader
          eyebrow="LOCAL DICTIONARY"
          title="本地词典"
          description="快速查词使用只读开放词典；人工词条用于修正和覆盖，不会被词典升级冲掉。"
          compact
          actions={<button className="dictionary-primary" type="button" onClick={openCreate}><Plus aria-hidden="true" />新建人工词条</button>}
        />

        <section className="dictionary-summary" aria-label="词典概览">
          <div><BookOpen aria-hidden="true" /><span><strong>{manualCount}</strong><small>人工优先词条</small></span></div>
          <div><Database aria-hidden="true" /><span><strong>{directCount || '—'}</strong><small>直接日中词条</small></span></div>
          <div><span className="dictionary-source-count">{activeSources.length}</span><span><strong>本机可用</strong><small>当前词典来源</small></span></div>
        </section>

        <div className="dictionary-workbench">
          <aside className="dictionary-sources">
            <header><p className="eyebrow">PROVIDERS</p><h2>释义来源</h2></header>
            <ol>
              <li><strong>人工确认</strong><span>最高优先级</span></li>
              <li><strong>当前卡片 / 教材</strong><span>已有中文原文</span></li>
              <li><strong>直接本地词典</strong><span>日中 / 英中</span></li>
              <li><strong>英中桥接</strong><span>低置信兜底</span></li>
            </ol>
            <div className="dictionary-source-list">
              {activeSources.map((source) => (
                <article key={`${source.sourceId}:${source.dictionaryVersion}:${source.language}`}>
                  <strong>{sourceLabel(source.sourceId)}</strong>
                  <span>{source.language.toUpperCase()} · {source.entryCount.toLocaleString()} 条</span>
                  <small>{source.dictionaryVersion}<br />{formatTime(source.updatedAtUtc)}</small>
                </article>
              ))}
            </div>
          </aside>

          <section className="dictionary-entries">
            <header>
              <div><p className="eyebrow">MANUAL OVERRIDES</p><h2>人工词条</h2></div>
              <DataRefreshStatus
                refreshing={entriesQuery.isFetching || catalogQuery.isFetching}
                failed={entriesQuery.isError || catalogQuery.isError}
                onRetry={() => void refresh()}
              />
            </header>
            <div className="dictionary-toolbar">
              <label><Search aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索词语或中文释义" /></label>
              <div className="dictionary-segments" aria-label="语言筛选">
                {(['all', 'en', 'ja'] as const).map((item) => <button key={item} type="button" className={language === item ? 'selected' : ''} onClick={() => setLanguage(item)}>{item === 'all' ? '全部语言' : item.toUpperCase()}</button>)}
              </div>
              <select aria-label="状态筛选" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
                <option value="active">使用中</option><option value="archived">已归档</option><option value="all">全部状态</option>
              </select>
            </div>
            {message && <p className="dictionary-message" role="status">{message}</p>}
            {entriesQuery.isPending ? <PageState variant="loading" title="正在读取人工词条" description="正在从本机 SQLite 读取，不会访问网络。" />
              : entriesQuery.isError ? <PageState variant="error" title="人工词条读取失败" description="已有词典数据没有改变，可以重试读取。" actions={<button type="button" onClick={() => void entriesQuery.refetch()}>重试</button>} />
                : entries.length === 0 ? <PageState variant="empty" title="当前筛选下没有人工词条" description="可以新建一个简明中文释义，之后查词会优先使用。" actions={<button type="button" onClick={openCreate}>新建词条</button>} />
                  : <div className="dictionary-table" role="table" aria-label="人工词条列表">
                    <div className="dictionary-table-head" role="row"><span>词语</span><span>中文释义</span><span>消歧 / 可信度</span><span>状态</span><span>操作</span></div>
                    {entries.map((entry) => <div className="dictionary-table-row" role="row" key={entry.id}>
                      <span><strong>{entry.canonicalForm}</strong><small>{entry.language.toUpperCase()} · v{entry.version}</small></span>
                      <span>{entry.zhGloss}</span>
                      <span><code>{entry.senseKey}</code><small>{entry.confidence === 'high' ? '高可信' : entry.confidence === 'medium' ? '需核对' : '低可信'}</small></span>
                      <span><i className={`dictionary-status is-${entry.status}`} />{entry.status === 'active' ? '使用中' : '已归档'}</span>
                      <span className="dictionary-row-actions">
                        {entry.status === 'active' ? <>
                          <button type="button" title="编辑" aria-label={`编辑 ${entry.canonicalForm}`} onClick={() => openEdit(entry)}><Pencil aria-hidden="true" /></button>
                          <button type="button" title="归档" aria-label={`归档 ${entry.canonicalForm}`} onClick={() => setConfirmEntry(entry)}><Archive aria-hidden="true" /></button>
                        </> : <button type="button" title="恢复" aria-label={`恢复 ${entry.canonicalForm}`} disabled={restoreMutation.isPending} onClick={() => restoreMutation.mutate(entry)}><RotateCcw aria-hidden="true" /></button>}
                      </span>
                    </div>)}
                  </div>}
          </section>
        </div>
      </div>

      {editing && <DialogSurface onClose={() => setEditing(null)} ariaLabel={editing === 'new' ? '新建人工词条' : '编辑人工词条'} closeLabel="关闭" size="medium" className="dictionary-dialog">
        <form onSubmit={(event) => { event.preventDefault(); saveMutation.mutate(); }}>
          <header><p className="eyebrow">MANUAL OVERRIDE</p><h2>{editing === 'new' ? '新建人工词条' : '编辑人工词条'}</h2><p>人工词条优先于导入词典，适合修正歧义或补充更自然的中文释义。</p></header>
          <div className="dictionary-form-grid">
            <label>语言<select value={draft.language} disabled={editing !== 'new'} onChange={(event) => setDraft({ ...draft, language: event.target.value as DictionaryLanguage })}><option value="en">English</option><option value="ja">日本語</option></select></label>
            <label>词语<input data-dialog-initial-focus value={draft.canonicalForm} onChange={(event) => setDraft({ ...draft, canonicalForm: event.target.value })} required maxLength={300} /></label>
            <label className="is-wide">中文释义<input value={draft.zhGloss} onChange={(event) => setDraft({ ...draft, zhGloss: event.target.value })} required maxLength={120} /></label>
            <label>消歧键<input value={draft.senseKey} onChange={(event) => setDraft({ ...draft, senseKey: event.target.value })} required maxLength={80} /></label>
            <label>可信度<select value={draft.confidence} onChange={(event) => setDraft({ ...draft, confidence: event.target.value as GlossaryEntry['confidence'] })}><option value="high">高可信</option><option value="medium">需核对</option><option value="low">低可信</option></select></label>
          </div>
          {saveMutation.isError && <p className="dictionary-form-error" role="alert">{saveMutation.error.message}</p>}
          <footer><button type="button" onClick={() => setEditing(null)}>取消</button><button className="dictionary-primary" type="submit" disabled={saveMutation.isPending}>{saveMutation.isPending ? '保存中…' : '保存词条'}</button></footer>
        </form>
      </DialogSurface>}
      {confirmEntry && <ConfirmDialog title="归档这个人工词条？" description={`归档“${confirmEntry.canonicalForm}”后，查词将回落到卡片、教材或只读词典。`} confirmLabel="归档" pendingLabel="正在归档…" cancelLabel="保留" tone="warning" busy={archiveMutation.isPending} onCancel={() => setConfirmEntry(null)} onConfirm={() => archiveMutation.mutate(confirmEntry)} />}
    </ProductShell>
  );
}
