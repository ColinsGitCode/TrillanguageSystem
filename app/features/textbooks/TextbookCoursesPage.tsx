import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  BookOpenCheck,
  CheckCircle2,
  FileJson2,
  Headphones,
  Highlighter,
  Languages,
  ListChecks,
  NotebookTabs,
  Play,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Volume2,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ProductShell } from '../../components/ProductShell';
import { ApiError } from '../../lib/api/client';
import { textbookApi } from './textbook-api';
import {
  buildTextbookHighlightDocument,
  escapeTextbookText,
  expressionHighlightFragments,
  highlightedExpressionIds,
  sanitizeTextbookHighlightDocument,
  updateExpressionHighlightDocument,
} from './textbook-highlight';
import { applyMarkerHighlight, applyTextHighlight } from '../card-modal/highlight';
import type { TextbookAsset, TextbookAudio, TextbookCourse, TextbookExpression, TextbookTrack } from './types';

type ImportDraft = {
  manifestRelativePath: string;
  expectedManifestHash: string;
};

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function statusLabel(status: string | null | undefined) {
  switch (status) {
    case 'draft': return '待校对';
    case 'verified': return '已确认';
    case 'published': return '已发布';
    case 'archived': return '已归档';
    default: return '未知';
  }
}

function hashShort(hash?: string | null) {
  return hash ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : 'not set';
}

function audioAsset(track: TextbookTrack | null): TextbookAsset | null {
  return track?.assets.find((asset) => asset.kind === 'official_audio') || null;
}

function confidenceTone(expression: TextbookExpression) {
  const confidence = parseJson<Record<string, number>>(expression.confidence_json, {});
  const min = Math.min(...Object.values(confidence).filter((value) => Number.isFinite(value)));
  if (!Number.isFinite(min)) return 'unknown';
  if (min < 0.85) return 'low';
  if (min < 0.95) return 'medium';
  return 'high';
}

function OfficialAudio({ asset, audioRef, onPlay }: {
  asset: TextbookAsset | null;
  audioRef: RefObject<HTMLAudioElement | null>;
  onPlay: () => void;
}) {
  if (!asset) return <div className="textbook-audio unavailable"><Headphones aria-hidden="true" /><span>未绑定官方 Track 音频</span></div>;
  if (asset.availability !== 'available') {
    return <div className="textbook-audio unavailable"><Headphones aria-hidden="true" /><span>官方音频不可用：{asset.availability}</span></div>;
  }
  return (
    <div className="textbook-audio">
      <div><Headphones aria-hidden="true" /><span>Official Track</span><strong>{Math.round((asset.duration_ms || 0) / 1000)}s</strong></div>
      <audio ref={audioRef} controls preload="none" onPlay={onPlay} src={`/api/textbooks/assets/${asset.id}/content`} />
    </div>
  );
}

function ImportPanel({ onImported }: { onImported: (trackId: number) => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ImportDraft>({ manifestRelativePath: '', expectedManifestHash: '' });
  const [message, setMessage] = useState('');
  const dryRunMutation = useMutation({
    mutationFn: textbookApi.dryRunImport,
    onSuccess: (data) => setMessage(`dry-run ok · ${data.summary.expressionCount} expressions · ${data.summary.unitCounts.total} study candidates`),
    onError: (error) => setMessage(error instanceof ApiError ? error.message : 'dry-run failed'),
  });
  const importMutation = useMutation({
    mutationFn: textbookApi.importDraft,
    onSuccess: async (data) => {
      setMessage(`已导入 Track ${data.track.track_number}，等待人工校对`);
      await queryClient.invalidateQueries({ queryKey: ['textbooks'] });
      onImported(data.track.id);
    },
    onError: (error) => setMessage(error instanceof ApiError ? error.message : 'import failed'),
  });
  const canSubmit = draft.manifestRelativePath.trim() && /^[a-f0-9]{64}$/u.test(draft.expectedManifestHash.trim());
  return (
    <section className="surface textbook-import-panel">
      <header>
        <FileJson2 aria-hidden="true" />
        <div><p className="eyebrow">GIT-EXTERNAL MANIFEST</p><h2>导入教材 Track 草稿</h2></div>
      </header>
      <label>
        <span>Manifest relative path</span>
        <input value={draft.manifestRelativePath} placeholder="daily-english/track-01/manifest.json" onChange={(event) => setDraft({ ...draft, manifestRelativePath: event.target.value })} />
      </label>
      <label>
        <span>Expected manifest hash</span>
        <input value={draft.expectedManifestHash} placeholder="64-char sha256" onChange={(event) => setDraft({ ...draft, expectedManifestHash: event.target.value.toLowerCase() })} />
      </label>
      <div className="textbook-import-actions">
        <button type="button" disabled={!canSubmit || dryRunMutation.isPending} onClick={() => dryRunMutation.mutate(draft)}>Dry-run</button>
        <button type="button" disabled={!canSubmit || importMutation.isPending} onClick={() => importMutation.mutate(draft)}>Import draft</button>
      </div>
      {message && <p className="textbook-inline-message">{message}</p>}
    </section>
  );
}

function TrackList({ courses, activeTrackId, onSelect }: {
  courses: TextbookCourse[];
  activeTrackId: number | null;
  onSelect: (trackId: number) => void;
}) {
  return (
    <section className="surface textbook-sidebar-panel">
      <header><p className="eyebrow">COURSES</p><h2>教材</h2></header>
      {courses.length === 0 ? (
        <div className="textbook-empty-list"><NotebookTabs aria-hidden="true" /><span>暂无课程。先运行 Skill 生成 Manifest，再导入草稿。</span></div>
      ) : courses.map((course) => (
        <div className="textbook-course-group" key={course.id}>
          <h3>{course.title}</h3>
          <p>{course.track_count ?? course.tracks?.length ?? 0} tracks · {course.course_key}</p>
          {(course.tracks || []).map((track) => (
            <button key={track.id} type="button" className={activeTrackId === track.id ? 'selected' : ''} onClick={() => onSelect(track.id)}>
              <span>Track {String(track.track_number).padStart(2, '0')}</span>
              <strong>{track.title}</strong>
              <small>{statusLabel(track.status)} · {track.expression_count || 0} expressions</small>
            </button>
          ))}
        </div>
      ))}
    </section>
  );
}

function ExpressionList({ expressions, activeId, markedIds, onSelect }: {
  expressions: TextbookExpression[];
  activeId: number | null;
  markedIds: Set<number>;
  onSelect: (id: number) => void;
}) {
  return (
    <section className="surface textbook-expression-panel">
      <header><div><p className="eyebrow">EXPRESSION QUEUE</p><h2>表达校对</h2></div><span>{expressions.length} pairs</span></header>
      <ol>
        {expressions.map((expression) => (
          <li key={expression.id} className={`${activeId === expression.id ? 'active' : ''} ${markedIds.has(expression.id) ? 'marked' : ''}`}>
            <button type="button" onClick={() => onSelect(expression.id)}>
              <span>{String(expression.display_ordinal).padStart(2, '0')}</span>
              <strong>{expression.official_en_text}</strong>
              <small>{expression.official_ja_text}</small>
            </button>
            {markedIds.has(expression.expression_id) && <span className="textbook-mark-indicator">含标红</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function guessSelectionLanguage(text: string): 'en' | 'ja' {
  return /[\u3040-\u30ff\u3400-\u9fff]/u.test(text) ? 'ja' : 'en';
}

function ExpressionDetail({
  expression,
  onDerive,
  derivationMessage,
  derivationBusy,
  highlightHtml,
  highlightBusy,
  highlightEnabled,
  onSaveHighlight,
  audioFiles,
  onPlayAudio,
}: {
  expression: TextbookExpression | null;
  onDerive: (payload: { selectionText: string; selectionLanguage: 'en' | 'ja'; targetCardType: 'trilingual' | 'grammar_ja' }) => void;
  derivationMessage: string;
  derivationBusy: boolean;
  highlightHtml: string;
  highlightBusy: boolean;
  highlightEnabled: boolean;
  onSaveHighlight: (html: string) => void;
  audioFiles: TextbookAudio[];
  onPlayAudio: (url: string) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const selectedRangeRef = useRef<Range | null>(null);
  const selectedTextRef = useRef('');
  const [selectedText, setSelectedText] = useState('');
  const [hasHighlightSelection, setHasHighlightSelection] = useState(false);
  const phrases = parseJson<Array<{ label: string; explanation: string; source: string }>>(expression?.phrase_analysis_json, []);
  const grammar = parseJson<Array<{ label: string; explanation: string; source: string }>>(expression?.grammar_points_json, []);
  const confidence = parseJson<Record<string, number>>(expression?.confidence_json, {});
  const fragments = expression ? expressionHighlightFragments(highlightHtml, expression.expression_id) : null;
  const enAudio = audioFiles.find((audio) => audio.language === 'en');
  const jaAudio = audioFiles.find((audio) => audio.language === 'ja');
  useEffect(() => {
    setSelectedText('');
    setHasHighlightSelection(false);
    selectedRangeRef.current = null;
    selectedTextRef.current = '';
  }, [expression?.id]);
  const captureSelection = () => {
    if (typeof window === 'undefined') return;
    const selectionState = window.getSelection();
    const range = selectionState?.rangeCount ? selectionState.getRangeAt(0) : null;
    const selected = selectionState?.toString().trim() || '';
    const startElement = range?.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer as Element
      : range?.startContainer.parentElement;
    const endElement = range?.endContainer.nodeType === Node.ELEMENT_NODE
      ? range.endContainer as Element
      : range?.endContainer.parentElement;
    const valid = Boolean(
      range
      && !range.collapsed
      && selected
      && contentRef.current?.contains(range.commonAncestorContainer)
      && startElement?.closest('[data-textbook-language]')
      && endElement?.closest('[data-textbook-language]')
    );
    selectedRangeRef.current = valid ? range!.cloneRange() : null;
    selectedTextRef.current = valid ? selected : '';
    setHasHighlightSelection(valid);
    setSelectedText(valid ? (selected.length > 120 ? `${selected.slice(0, 120)}…` : selected) : '');
  };
  const saveHighlight = () => {
    const container = contentRef.current;
    const range = selectedRangeRef.current;
    if (!expression || !container || !range) return;
    const applied = applyMarkerHighlight(container, range)
      || applyTextHighlight(container, selectedTextRef.current);
    if (!applied) return;
    const nextHtml = updateExpressionHighlightDocument(highlightHtml, expression.expression_id, container);
    window.getSelection()?.removeAllRanges();
    selectedRangeRef.current = null;
    selectedTextRef.current = '';
    setHasHighlightSelection(false);
    onSaveHighlight(nextHtml);
  };
  const canPlay = (audio?: TextbookAudio) => Boolean(audio && ['generated', 'fallback_generated'].includes(audio.status));
  if (!expression) {
    return <section className="surface textbook-detail-panel empty"><ListChecks aria-hidden="true" /><h2>选择一个表达</h2><p>右侧会显示来源、重点短语、语法和逐方向 hash。</p></section>;
  }
  return (
    <section className={`surface textbook-detail-panel confidence-${confidenceTone(expression)}`} onMouseUp={captureSelection}>
      <header>
        <div><p className="eyebrow">EXPR {String(expression.display_ordinal).padStart(2, '0')} · {expression.expression_key}</p><h2>校对详情</h2></div>
        <span>{confidenceTone(expression).toUpperCase()}</span>
      </header>
      <div className="textbook-tts-boundary">
        官方整轨与系统单句 TTS 独立登记；播放任一来源时会自动暂停另一来源。
      </div>
      <div ref={contentRef} className="textbook-expression-content" onMouseUp={captureSelection}>
        <div className="textbook-answer-card">
          <p className="textbook-lang-label">English official</p>
          <h3 data-textbook-language="en" dangerouslySetInnerHTML={{ __html: fragments?.en || escapeTextbookText(expression.official_en_text) }} />
          <button type="button" disabled={!canPlay(enAudio)} onClick={() => enAudio && onPlayAudio(enAudio.playback_url)}><Play aria-hidden="true" /> {canPlay(enAudio) ? '播放 EN' : 'EN 语音未生成'}</button>
        </div>
        <div className="textbook-answer-card">
          <p className="textbook-lang-label">Japanese official</p>
          <h3 data-textbook-language="ja" className="textbook-ja" dangerouslySetInnerHTML={{ __html: fragments?.ja || expression.ja_ruby_html }} />
          <button type="button" disabled={!canPlay(jaAudio)} onClick={() => jaAudio && onPlayAudio(jaAudio.playback_url)}><Play aria-hidden="true" /> {canPlay(jaAudio) ? '播放 JA' : 'JA 语音未生成'}</button>
        </div>
        <div className="textbook-zh-cue"><Languages aria-hidden="true" /><span data-textbook-language="zh" dangerouslySetInnerHTML={{ __html: fragments?.zh || escapeTextbookText(expression.zh_cue_text) }} /></div>
      </div>
      <section className="textbook-selection-panel">
        <p className="textbook-lang-label">Selection to card</p>
        {selectedText ? <strong>{selectedText}</strong> : <span>选中英文或日文片段后，这里会显示派生卡候选。</span>}
        <div>
          <button
            type="button"
            disabled={!highlightEnabled || !hasHighlightSelection || highlightBusy}
            onMouseDown={(event) => event.preventDefault()}
            onClick={saveHighlight}
          >
            <Highlighter aria-hidden="true" /> {highlightBusy ? '保存中…' : '标红选区'}
          </button>
          <button
            type="button"
            disabled={!selectedText || derivationBusy}
            onClick={() => onDerive({ selectionText: selectedText, selectionLanguage: guessSelectionLanguage(selectedText), targetCardType: 'trilingual' })}
          >
            生成三语卡
          </button>
          <button
            type="button"
            disabled={!selectedText || derivationBusy || guessSelectionLanguage(selectedText) !== 'ja'}
            onClick={() => onDerive({ selectionText: selectedText, selectionLanguage: 'ja', targetCardType: 'grammar_ja' })}
          >
            生成语法卡
          </button>
        </div>
        <small>{derivationMessage || '选区会写入派生关系并创建生成任务；重复选区会复用同一派生键。'}</small>
      </section>
      <dl className="textbook-confidence-grid">
        {Object.entries(confidence).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{Math.round(value * 100)}%</dd></div>)}
      </dl>
      <section className="textbook-analysis-list">
        <h3><Sparkles aria-hidden="true" /> 重点短语</h3>
        {phrases.length ? phrases.map((item) => <p key={`${item.label}-${item.explanation}`}><strong>{item.label}</strong><span>{item.explanation}</span></p>) : <small>暂无重点短语。</small>}
        <h3><BookOpenCheck aria-hidden="true" /> 语法点</h3>
        {grammar.length ? grammar.map((item) => <p key={`${item.label}-${item.explanation}`}><strong>{item.label}</strong><span>{item.explanation}</span></p>) : <small>暂无语法点。</small>}
      </section>
      <footer className="textbook-hash-strip">
        <span>EN {hashShort(expression.en_unit_hash)}</span>
        <span>JA {hashShort(expression.ja_unit_hash)}</span>
      </footer>
    </section>
  );
}

export function TextbookCoursesPage() {
  const queryClient = useQueryClient();
  const officialAudioRef = useRef<HTMLAudioElement | null>(null);
  const generatedAudioRef = useRef<HTMLAudioElement | null>(null);
  const [activeTrackId, setActiveTrackId] = useState<number | null>(null);
  const [activeExpressionId, setActiveExpressionId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [highlightHtml, setHighlightHtml] = useState('');
  const [publishMessage, setPublishMessage] = useState('');
  const [audioMessage, setAudioMessage] = useState('');
  const [derivationMessage, setDerivationMessage] = useState('');
  const coursesQuery = useQuery({ queryKey: ['textbooks', 'courses'], queryFn: textbookApi.courses, retry: false });
  const courseQueries = useQuery({
    queryKey: ['textbooks', 'courses-with-tracks', coursesQuery.data?.courses.map((course) => course.id).join(',') || 'empty'],
    queryFn: async () => {
      const courses = coursesQuery.data?.courses || [];
      return Promise.all(courses.map((course) => textbookApi.course(course.id).then((result) => result.course)));
    },
    enabled: Boolean(coursesQuery.data?.courses?.length),
  });
  const courses = courseQueries.data || coursesQuery.data?.courses || [];
  const trackQuery = useQuery({
    queryKey: ['textbooks', 'track', activeTrackId],
    queryFn: () => textbookApi.track(Number(activeTrackId)),
    enabled: Boolean(activeTrackId),
  });
  const publishPreviewQuery = useQuery({
    queryKey: ['textbooks', 'track', activeTrackId, 'publish-preview'],
    queryFn: () => textbookApi.publishPreview(Number(activeTrackId)),
    enabled: Boolean(activeTrackId && ['verified', 'published'].includes(trackQuery.data?.track.status || '')),
  });
  const highlightQuery = useQuery({
    queryKey: ['textbooks', 'track', activeTrackId, 'highlight'],
    queryFn: () => textbookApi.highlight(Number(activeTrackId)),
    enabled: Boolean(activeTrackId && trackQuery.data?.track.status === 'published'),
    retry: false,
  });
  const searchQuery = useQuery({
    queryKey: ['textbooks', 'search', search],
    queryFn: () => fetch(`/api/textbooks/search?q=${encodeURIComponent(search)}`).then((res) => res.json()),
    enabled: search.trim().length >= 2,
  });
  const verifyMutation = useMutation({
    mutationFn: ({ revisionId, status }: { revisionId: number; status: string }) => textbookApi.verifyRevision(revisionId, status),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['textbooks'] });
      setActiveTrackId(data.track.id);
    },
  });
  const publishMutation = useMutation({
    mutationFn: () => {
      const track = trackQuery.data?.track;
      const preview = publishPreviewQuery.data?.preview;
      if (!track || !preview) throw new Error('publish preview is not ready');
      return textbookApi.publishTrack(track.id, {
        expectedTrackRevision: track.revision_number,
        confirmUnitCount: preview.unitCount,
        expectedPlanRevision: preview.planRevision,
      });
    },
    onSuccess: async (data) => {
      setPublishMessage(`已发布到学习系统：${data.unitCount} 个单元，insert ${data.itemActions.inserted} / update ${data.itemActions.updated}`);
      await queryClient.invalidateQueries({ queryKey: ['textbooks'] });
      await queryClient.invalidateQueries({ queryKey: ['learning'] });
      setActiveTrackId(data.track.id);
    },
    onError: (error) => setPublishMessage(error instanceof Error ? error.message : 'publish failed'),
  });
  const ttsMutation = useMutation({
    mutationFn: () => textbookApi.generateTts(Number(activeTrackId)),
    onSuccess: async (data) => {
      setAudioMessage(`单句语音：生成 ${data.summary.generated}，跳过 ${data.summary.skipped}，失败 ${data.summary.failed}`);
      await queryClient.invalidateQueries({ queryKey: ['textbooks', 'track', activeTrackId] });
      await queryClient.invalidateQueries({ queryKey: ['learning'] });
    },
    onError: (error) => setAudioMessage(error instanceof Error ? error.message : 'TTS generation failed'),
  });
  const saveHighlightMutation = useMutation({
    mutationFn: (html: string) => textbookApi.saveHighlight(Number(activeTrackId), html),
    onSuccess: (data) => {
      setHighlightHtml(sanitizeTextbookHighlightDocument(data.highlight.htmlContent));
      queryClient.setQueryData(['textbooks', 'track', activeTrackId, 'highlight'], data);
    },
  });
  const deleteHighlightMutation = useMutation({
    mutationFn: ({ trackId, highlightId }: { trackId: number; highlightId: number }) => textbookApi.deleteHighlight(trackId, highlightId),
    onSuccess: async () => {
      const currentTrack = trackQuery.data?.track;
      setHighlightHtml(currentTrack ? buildTextbookHighlightDocument(currentTrack) : '');
      await queryClient.invalidateQueries({ queryKey: ['textbooks', 'track', activeTrackId, 'highlight'] });
    },
  });
  const derivationMutation = useMutation({
    mutationFn: (payload: { expressionId: number; selectionText: string; selectionLanguage: 'en' | 'ja'; targetCardType: 'trilingual' | 'grammar_ja' }) => (
      textbookApi.createDerivation(payload.expressionId, {
        selectionText: payload.selectionText,
        selectionLanguage: payload.selectionLanguage,
        targetCardType: payload.targetCardType,
      })
    ),
    onSuccess: (data) => {
      setDerivationMessage(`已创建生成任务 #${data.job.id}，可在队列管理查看进度。`);
      void queryClient.invalidateQueries({ queryKey: ['generation-jobs'] });
    },
    onError: (error) => setDerivationMessage(error instanceof Error ? error.message : 'derivation failed'),
  });

  useEffect(() => {
    if (activeTrackId || !courses.length) return;
    const firstTrack = courses.flatMap((course) => course.tracks || [])[0];
    if (firstTrack) setActiveTrackId(firstTrack.id);
  }, [activeTrackId, courses]);

  useEffect(() => {
    const expressions = trackQuery.data?.track.expressions || [];
    if (!expressions.length) return;
    if (!activeExpressionId || !expressions.some((expression) => expression.id === activeExpressionId)) {
      setActiveExpressionId(expressions[0].id);
    }
  }, [activeExpressionId, trackQuery.data?.track.expressions]);

  useEffect(() => {
    const currentTrack = trackQuery.data?.track;
    if (!currentTrack) {
      setHighlightHtml('');
      return;
    }
    const persisted = highlightQuery.data?.highlight?.htmlContent;
    setHighlightHtml(persisted
      ? sanitizeTextbookHighlightDocument(persisted)
      : buildTextbookHighlightDocument(currentTrack));
  }, [highlightQuery.data?.highlight?.htmlContent, trackQuery.data?.track]);

  useEffect(() => () => {
    officialAudioRef.current?.pause();
    generatedAudioRef.current?.pause();
  }, []);

  const featureDisabled = coursesQuery.isError && coursesQuery.error instanceof ApiError && coursesQuery.error.status === 404;
  const track = trackQuery.data?.track || null;
  const expressions = track?.expressions || [];
  const activeExpression = expressions.find((expression) => expression.id === activeExpressionId) || null;
  const lowConfidenceCount = expressions.filter((expression) => confidenceTone(expression) === 'low').length;
  const officialAudio = audioAsset(track);
  const publishPreview = publishPreviewQuery.data?.preview || null;
  const markedIds = useMemo(() => highlightedExpressionIds(highlightHtml), [highlightHtml]);
  const expressionAudioKey = activeExpression
    ? String(activeExpression.expression_key).replace(/^expr:/u, '').replace(/[^a-z0-9]+/giu, '_')
    : '';
  const activeExpressionAudio = (track?.tts_audio || []).filter((audio) => (
    expressionAudioKey && audio.filename_suffix.endsWith(`_expr_${expressionAudioKey}`)
  ));
  const playGeneratedAudio = (url: string) => {
    officialAudioRef.current?.pause();
    generatedAudioRef.current?.pause();
    const audio = new Audio(url);
    generatedAudioRef.current = audio;
    audio.play().catch(() => setAudioMessage('单句语音播放失败，请检查 TTS 资产。'));
  };
  const onOfficialAudioPlay = () => {
    generatedAudioRef.current?.pause();
  };

  return (
    <ProductShell active="textbooks" title="教材课程">
      <div className="textbook-page" data-testid="textbook-courses-page">
        <header className="textbook-hero surface">
          <div className="textbook-page-edge" aria-hidden="true" />
          <div>
            <p className="eyebrow">TEXTBOOK COURSES · HUMAN REVIEW FIRST</p>
            <h1>教材课程</h1>
            <p>教材截图由 Codex Skill 识别；本页负责浏览、人工校对和官方整轨对照。确认前不会进入复习系统。</p>
          </div>
          <OfficialAudio asset={officialAudio} audioRef={officialAudioRef} onPlay={onOfficialAudioPlay} />
        </header>

        {featureDisabled ? (
          <section className="surface textbook-disabled">
            <ShieldCheck aria-hidden="true" />
            <h2>教材功能未开启</h2>
            <p>设置 `TEXTBOOK_FEATURE_ENABLED=true` 并重启服务后，才会开放本地教材 Manifest 导入和校对页面。</p>
          </section>
        ) : (
          <>
            <section className="textbook-top-row">
              <ImportPanel onImported={setActiveTrackId} />
              <section className="surface textbook-search-panel">
                <header><Search aria-hidden="true" /><div><p className="eyebrow">TEXTBOOK SEARCH</p><h2>教材表达搜索</h2></div></header>
                <input value={search} placeholder="Search English / Japanese / Chinese cue" onChange={(event) => setSearch(event.target.value)} />
                <div className="textbook-search-results">
                  {(searchQuery.data?.results || []).slice(0, 5).map((result: { id: number; track_id: number; official_en_text: string; official_ja_text: string }) => (
                    <button key={result.id} type="button" onClick={() => setActiveTrackId(result.track_id)}>
                      <strong>{result.official_en_text}</strong>
                      <span>{result.official_ja_text}</span>
                    </button>
                  ))}
                  {search.trim().length >= 2 && !searchQuery.data?.results?.length && <span>没有匹配表达。</span>}
                </div>
              </section>
            </section>

            <section className="textbook-workbench">
              <TrackList courses={courses} activeTrackId={activeTrackId} onSelect={setActiveTrackId} />
              <div className="textbook-main-column">
                {track ? (
                  <section className="surface textbook-track-summary">
                    <div>
                      <p className="eyebrow">{track.course_key} · Track {String(track.track_number).padStart(2, '0')}</p>
                      <h2>{track.title}</h2>
                      <p>{statusLabel(track.status)} · {expressions.length} expressions · {lowConfidenceCount} low-confidence{publishPreview ? ` · ${publishPreview.unitCount} study units` : ''}</p>
                      {publishPreview?.shortestIntroductionDays ? <small>按当前每日新单元上限，最短约 {publishPreview.shortestIntroductionDays} 学习日引入完。</small> : null}
                      {publishMessage && <small>{publishMessage}</small>}
                      {audioMessage && <small>{audioMessage}</small>}
                    </div>
                    <div className="textbook-track-actions">
                      <button
                        type="button"
                        disabled={!track.revision_id || track.status !== 'draft' || verifyMutation.isPending}
                        onClick={() => verifyMutation.mutate({ revisionId: Number(track.revision_id), status: track.status })}
                      >
                        <CheckCircle2 aria-hidden="true" /> {track.status === 'verified' || track.status === 'published' ? '已确认' : verifyMutation.isPending ? '确认中…' : '确认校对'}
                      </button>
                      <button
                        type="button"
                        disabled={track.status !== 'verified' || publishMutation.isPending || !publishPreview}
                        onClick={() => publishMutation.mutate()}
                      >
                        <BookOpenCheck aria-hidden="true" /> {track.status === 'published' ? '已发布' : publishMutation.isPending ? '发布中…' : '发布到学习计划'}
                      </button>
                      <button
                        type="button"
                        disabled={track.status !== 'published' || ttsMutation.isPending}
                        onClick={() => ttsMutation.mutate()}
                      >
                        <Volume2 aria-hidden="true" /> {ttsMutation.isPending ? '生成语音中…' : '生成单句语音'}
                      </button>
                      <button
                        type="button"
                        aria-label="清除本 Track 标红"
                        disabled={!highlightQuery.data?.highlight || deleteHighlightMutation.isPending}
                        onClick={() => highlightQuery.data?.highlight && deleteHighlightMutation.mutate({
                          trackId: track.id,
                          highlightId: highlightQuery.data.highlight.id,
                        })}
                      >
                        <Trash2 aria-hidden="true" /> 清除标红
                      </button>
                    </div>
                  </section>
                ) : (
                  <section className="surface textbook-track-summary empty"><h2>尚未选择 Track</h2><p>导入 Manifest 后会在这里显示表达队列。</p></section>
                )}
                <ExpressionList
                  expressions={expressions}
                  activeId={activeExpressionId}
                  markedIds={markedIds}
                  onSelect={setActiveExpressionId}
                />
              </div>
              <ExpressionDetail
                expression={activeExpression}
                derivationMessage={derivationMessage}
                derivationBusy={derivationMutation.isPending}
                highlightHtml={highlightHtml}
                highlightBusy={saveHighlightMutation.isPending}
                highlightEnabled={track?.status === 'published'}
                onSaveHighlight={(html) => saveHighlightMutation.mutate(html)}
                audioFiles={activeExpressionAudio}
                onPlayAudio={playGeneratedAudio}
                onDerive={(payload) => activeExpression && derivationMutation.mutate({ expressionId: activeExpression.expression_id, ...payload })}
              />
            </section>
          </>
        )}
      </div>
    </ProductShell>
  );
}
