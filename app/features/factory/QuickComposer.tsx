import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent as ReactClipboardEvent, DragEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useMutation, useQueries } from '@tanstack/react-query';
import {
  BookOpen, CalendarPlus, Check, CircleAlert, Clock, ExternalLink, Image as ImageIcon,
  Languages, MessagesSquare, RefreshCw, RotateCcw, X,
} from 'lucide-react';
import { factoryApi } from './factory-api';
import { fileToDataUrl, normalizeOcrText } from './ocr';
import { composerLines, describeJob, detectLineLanguage, estimateDuration } from './composer-model.mjs';
import type { CardType, DuplicateCardSummary, GenerationJob, SourceMode } from './types';

export type ComposerSubmitResult = {
  /** Lines that were handed to the queue. */
  submitted: number;
  /** Lines that failed for a reason worth retrying, left in the input. */
  remaining: string[];
};

const TYPE_CONFIG: Record<CardType, {
  short: string;
  unit: string;
  icon: typeof Languages;
  description: string;
  examples: string[];
  placeholder: string;
}> = {
  trilingual: {
    short: '三语卡',
    unit: '张三语卡',
    icon: Languages,
    description: '一个词或短语 → 英日中对照、例句和读音',
    examples: ['assertion', 'それぞれ', '单一'],
    placeholder: '输入一个词或短语，按回车生成',
  },
  grammar_ja: {
    short: '日语语法',
    unit: '张语法卡',
    icon: BookOpen,
    description: '一个语法点 → 中文讲解、日语例句和常见误用',
    examples: ['〜において', 'だが', 'ということで'],
    placeholder: '输入一个语法点，可以在括号里补充语境',
  },
  scenario_phrase: {
    short: '场景表达',
    unit: '张场景卡',
    icon: MessagesSquare,
    description: '描述一个具体场景 → 这个场景里用得上的 20 条说法',
    examples: [],
    placeholder: '写清楚在哪、和谁、要办什么',
  },
};

const TYPE_ORDER: CardType[] = ['trilingual', 'grammar_ja', 'scenario_phrase'];
const LANGUAGE_LABEL = { en: '英语', ja: '日语' } as const;
const LOOKUP_DEBOUNCE_MS = 350;
const MAX_LOOKUPS = 20;

type Props = {
  cardType: CardType;
  onCardTypeChange: (type: CardType) => void;
  onClose: () => void;
  healthUnhealthy: boolean;
  onRecheckHealth: () => void;
  modelName: string | null;
  submitting: boolean;
  onSubmit: (lines: string[], sourceMode: SourceMode) => Promise<ComposerSubmitResult>;
  onCreateVersion: (phrase: string, sourceMode: SourceMode) => Promise<ComposerSubmitResult>;
  onOpenDuplicate: (card: DuplicateCardSummary) => void;
  onAddToToday: (card: DuplicateCardSummary) => void;
  addingToToday: boolean;
  notice: string;
  onDismissNotice: () => void;
  sessionJobs: GenerationJob[];
  allJobs: GenerationJob[];
  onOpenJob: (job: GenerationJob) => void;
  onRetryJob: (job: GenerationJob) => void;
  shortcutLabel: string;
};

function displayDate(card: DuplicateCardSummary) {
  const value = card.generationDate || card.folderName || '';
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})$/u);
  return compact ? `${compact[1]}-${compact[2]}-${compact[3]}` : value;
}

export function QuickComposer({
  cardType,
  onCardTypeChange,
  onClose,
  healthUnhealthy,
  onRecheckHealth,
  modelName,
  submitting,
  onSubmit,
  onCreateVersion,
  onOpenDuplicate,
  onAddToToday,
  addingToToday,
  notice,
  onDismissNotice,
  sessionJobs,
  allJobs,
  onOpenJob,
  onRetryJob,
  shortcutLabel,
}: Props) {
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [imageData, setImageData] = useState('');
  const [imageError, setImageError] = useState('');
  const [ocr, setOcr] = useState<{ raw: string; clean: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Text the OCR step filled in; a submission of exactly that text is recorded
  // as coming from OCR rather than from typing.
  const ocrFilledRef = useRef('');
  const config = TYPE_CONFIG[cardType];

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(text), LOOKUP_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text]);

  // Grow with the content up to the stylesheet's max-height, then scroll.
  useLayoutEffect(() => {
    const area = textareaRef.current;
    if (!area) return;
    area.style.height = 'auto';
    area.style.height = `${area.scrollHeight}px`;
  }, [text, cardType]);

  const hasRunning = sessionJobs.some((job) => job.status === 'running');
  useEffect(() => {
    if (!hasRunning) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasRunning]);

  const lines = useMemo(() => composerLines(text, cardType), [text, cardType]);
  const lookupLines = useMemo(
    () => composerLines(debounced, cardType).slice(0, MAX_LOOKUPS),
    [debounced, cardType],
  );
  // Advisory only: the read-only lookup never records anything, and the real
  // submission still runs preflight so a card created in between is caught.
  const lookups = useQueries({
    queries: lookupLines.map((line) => ({
      queryKey: ['composer-duplicates', cardType, line],
      queryFn: ({ signal }: { signal: AbortSignal }) => factoryApi.duplicates(line, cardType, signal),
      staleTime: 30_000,
      retry: false,
    })),
  });
  const existing = new Map<string, { duplicates: DuplicateCardSummary[]; activeJob: GenerationJob | null }>();
  lookupLines.forEach((line, index) => {
    const data = lookups[index]?.data;
    if (data) existing.set(line, data);
  });
  const lineState = (line: string) => {
    const found = existing.get(line);
    if (found?.duplicates.length) return 'duplicate' as const;
    if (found?.activeJob) return 'active' as const;
    return 'new' as const;
  };
  const submittable = lines.filter((line) => lineState(line) === 'new');
  const skippedCount = lines.length - submittable.length;
  const singleDuplicate = lines.length === 1 && lineState(lines[0]) === 'duplicate'
    ? existing.get(lines[0])!.duplicates
    : null;
  const singleLanguage = lines.length === 1 && cardType === 'trilingual' ? detectLineLanguage(lines[0]) : null;

  const sourceMode = (): SourceMode => (
    ocrFilledRef.current && text.trim() === ocrFilledRef.current.trim() ? 'ocr' : 'input'
  );

  const resetAfterSubmit = (result: ComposerSubmitResult) => {
    setText(result.remaining.join('\n'));
    if (result.submitted > 0) {
      setImageData('');
      setOcr(null);
      ocrFilledRef.current = '';
    }
    window.requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
  };

  const submit = async () => {
    if (!submittable.length || submitting || healthUnhealthy || singleDuplicate) return;
    resetAfterSubmit(await onSubmit(submittable, sourceMode()));
  };

  const createVersion = async () => {
    if (!lines[0] || submitting) return;
    resetAfterSubmit(await onCreateVersion(lines[0], sourceMode()));
  };

  const ocrMutation = useMutation({
    mutationFn: factoryApi.ocr,
    onSuccess: (data) => {
      const normalized = normalizeOcrText(data.text);
      setOcr({ raw: normalized.raw, clean: normalized.clean });
      const next = text.trim() ? `${text.trimEnd()}\n${normalized.clean}` : normalized.clean;
      setText(next);
      ocrFilledRef.current = next;
      setImageError('');
    },
    onError: (error) => setImageError(`识别失败：${error.message}`),
  });

  const takeImage = async (file?: File | null) => {
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 4 * 1024 * 1024) {
      setImageError('图片不能超过 4 MB');
      return;
    }
    setImageError('');
    setOcr(null);
    setImageData(await fileToDataUrl(file));
  };

  const clearImage = () => {
    setImageData('');
    setOcr(null);
    setImageError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const item = Array.from(event.clipboardData?.items || []).find((entry) => entry.type.startsWith('image/'));
    if (!item) return;
    event.preventDefault();
    void takeImage(item.getAsFile());
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    const file = Array.from(event.dataTransfer?.files || []).find((entry) => entry.type.startsWith('image/'));
    if (!file) return;
    event.preventDefault();
    void takeImage(file);
  };

  const onFieldKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    // A Chinese or Japanese input method uses Enter to confirm a candidate.
    // Treating that as "generate" would submit half-typed words.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    void submit();
  };

  const onPanelKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    // Option+1 types "¡" on a Mac keyboard, so match the physical key.
    if (event.altKey && !event.metaKey && !event.ctrlKey) {
      const index = ['Digit1', 'Digit2', 'Digit3'].indexOf(event.code);
      if (index >= 0) {
        event.preventDefault();
        onCardTypeChange(TYPE_ORDER[index]);
      }
    }
  };

  const doneCount = sessionJobs.filter((job) => job.status === 'success').length;
  const buttonLabel = submitting
    ? '正在加入队列…'
    : lines.length && !submittable.length
      ? lines.length > 1
        ? '这些都已经有卡片了'
        : lineState(lines[0]) === 'active' ? '这张卡正在生成' : '已经有这张卡了'
      : cardType === 'scenario_phrase'
        ? '生成场景卡'
        : submittable.length
          ? `生成 ${submittable.length} ${config.unit}`
          : `生成${config.short}`;
  const estimate = estimateDuration(submittable.length, cardType);

  return (
    <aside id="qc-panel" className="qc-panel" aria-labelledby="qc-title" data-testid="factory-control-rail" onKeyDown={onPanelKeyDown}>
      <header className="qc-head" data-testid="factory-composer-header">
        <h2 id="qc-title">新建学习卡</h2>
        <kbd title="在 Cards Factory 里随时打开新建面板">{shortcutLabel}</kbd>
        <button className="icon-button qc-close" type="button" aria-label="关闭新建面板" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </header>

      {healthUnhealthy && (
        <div className="react-alert factory-rail-alert" role="alert">
          <span>生成服务不可用，请检查 DeepSeek API。</span>
          <button type="button" aria-label="重新检查生成服务" title="重新检查" onClick={onRecheckHealth}>
            <RefreshCw aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="qc-types" role="radiogroup" aria-label="卡片类型">
        {TYPE_ORDER.map((type, index) => {
          const Icon = TYPE_CONFIG[type].icon;
          return (
            <button
              key={type}
              type="button"
              role="radio"
              aria-checked={cardType === type}
              aria-keyshortcuts={`Alt+${index + 1}`}
              className={`qc-type type-${type}${cardType === type ? ' active' : ''}`}
              data-testid={`react-card-type-${type}`}
              onClick={() => onCardTypeChange(type)}
            >
              <Icon aria-hidden="true" />
              {TYPE_CONFIG[type].short}
            </button>
          );
        })}
      </div>
      <p className="qc-type-hint">
        <span>{config.description}</span>
        {config.examples.length > 0 && <em>例：{config.examples.join(' · ')}</em>}
      </p>

      <div className={`qc-field type-${cardType}`} onDrop={onDrop} onDragOver={(event) => event.preventDefault()}>
        {imageData && (
          <div className="qc-image">
            <img src={imageData} alt="待识别的图片" />
            <div>
              {ocr
                ? <p><strong>已识别</strong> 文字已填入下方，可以直接改</p>
                : <p>{ocrMutation.isPending ? '正在识别图片里的文字…' : '识别后文字会填入输入框'}</p>}
              <div className="qc-image-actions">
                {!ocr && (
                  <button type="button" data-testid="react-ocr-button" disabled={ocrMutation.isPending} onClick={() => ocrMutation.mutate(imageData)}>
                    {ocrMutation.isPending ? '识别中…' : '识别文字'}
                  </button>
                )}
                <button type="button" aria-label="清除图片" onClick={clearImage}><X aria-hidden="true" />去掉图片</button>
              </div>
            </div>
          </div>
        )}
        {ocr && (
          <details className="ocr-result">
            <summary>OCR 结果</summary>
            <strong>清洗后</strong><p>{ocr.clean}</p>
            <strong>原文</strong><p>{ocr.raw}</p>
          </details>
        )}
        <label className="qc-label" htmlFor="qc-input">学习内容</label>
        <textarea
          id="qc-input"
          ref={textareaRef}
          value={text}
          rows={cardType === 'scenario_phrase' ? 4 : 1}
          data-testid="react-phrase-input"
          placeholder={config.placeholder}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onFieldKeyDown}
          onPaste={onPaste}
        />
        {lines.length > 1 && (
          <ul className="qc-lines" aria-label="将要生成的卡片">
            {lines.map((line) => {
              const state = lineState(line);
              const language = cardType === 'trilingual' ? detectLineLanguage(line) : null;
              return (
                <li key={line} className={state === 'new' ? '' : 'is-skipped'}>
                  <span>{line}</span>
                  {state === 'duplicate' && <em className="qc-tag is-have">已有，跳过</em>}
                  {state === 'active' && <em className="qc-tag is-have">正在生成，跳过</em>}
                  {state === 'new' && language && <em className={`qc-lang lang-${language}`}>{LANGUAGE_LABEL[language]}</em>}
                </li>
              );
            })}
          </ul>
        )}
        <div className="qc-field-foot">
          {singleLanguage && <em className={`qc-lang lang-${singleLanguage}`}>{LANGUAGE_LABEL[singleLanguage]}</em>}
          {lines.length > 1 && (
            <span className="qc-count">{lines.length} 行{skippedCount ? ` · ${skippedCount} 行跳过` : ''}</span>
          )}
          {cardType === 'scenario_phrase' && <span className="qc-count">写清楚：在哪 · 和谁 · 要办什么</span>}
          <button className="qc-tool" type="button" onClick={() => fileInputRef.current?.click()}>
            <ImageIcon aria-hidden="true" />图片
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            data-testid="react-image-input"
            onChange={(event) => void takeImage(event.target.files?.[0])}
          />
        </div>
      </div>
      {imageError && <p className="qc-error" role="alert">{imageError}</p>}

      {singleDuplicate ? (
        <section className="qc-duplicate" data-testid="factory-duplicate-card-panel" aria-label="已有这张卡">
          <p>
            <strong>你已经有「{lines[0]}」的{config.short}</strong>
            <span>最初生成于 {displayDate(singleDuplicate[0])}</span>
          </p>
          <div>
            <button type="button" onClick={() => onOpenDuplicate(singleDuplicate[0])}>
              <ExternalLink aria-hidden="true" />打开这张卡
            </button>
            <button type="button" disabled={addingToToday} onClick={() => onAddToToday(singleDuplicate[0])}>
              <CalendarPlus aria-hidden="true" />加入今日
            </button>
            <button className="qc-link" type="button" disabled={submitting} onClick={() => void createVersion()}>
              仍要生成新版本
            </button>
          </div>
        </section>
      ) : (
        <div className="qc-go">
          <button
            className={`primary-button qc-submit type-${cardType}`}
            type="button"
            data-testid="react-generate-button"
            disabled={!submittable.length || submitting || healthUnhealthy}
            onClick={() => void submit()}
          >
            {buttonLabel}
            {submittable.length > 0 && !submitting && <kbd aria-hidden="true">↵</kbd>}
          </button>
          <small>
            <span>{cardType === 'scenario_phrase' ? 'Shift + ↵ 换行' : 'Shift + ↵ 换行，多行会生成多张'}</span>
            {estimate && <span>{estimate}</span>}
          </small>
        </div>
      )}

      {notice && (
        <div className="inline-notice" role="status">
          {notice}
          <button type="button" aria-label="关闭提示" onClick={onDismissNotice}><X aria-hidden="true" /></button>
        </div>
      )}

      <section className="qc-tray" aria-labelledby="qc-tray-title">
        <header>
          <h3 id="qc-tray-title">本次已提交</h3>
          {sessionJobs.length > 0 && <span>{sessionJobs.length} 张 · 完成 {doneCount}</span>}
        </header>
        {sessionJobs.length ? (
          <ol data-testid="factory-composer-tray">
            {sessionJobs.map((job) => {
              const { tone, text: statusText } = describeJob(job, allJobs, now);
              const Icon = tone === 'done' ? Check : tone === 'failed' ? CircleAlert : Clock;
              return (
                <li key={job.id} className={`qc-job is-${tone}`}>
                  <span className="qc-job-icon" aria-hidden="true">
                    {tone === 'running' ? <span className="qc-spin" /> : <Icon />}
                  </span>
                  <span className="qc-job-text">
                    <b>{job.phraseNormalized}</b>
                    <small>{TYPE_CONFIG[job.jobType]?.short || '学习卡'} · {statusText}</small>
                  </span>
                  {tone === 'done' && (
                    <button type="button" onClick={() => onOpenJob(job)}><ExternalLink aria-hidden="true" />打开</button>
                  )}
                  {tone === 'failed' && (
                    <button type="button" onClick={() => onRetryJob(job)}><RotateCcw aria-hidden="true" />重试</button>
                  )}
                  {tone === 'running' && <span className="qc-job-bar" aria-hidden="true"><i /></span>}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="qc-tray-empty">提交后，每张卡的进度会显示在这里。</p>
        )}
      </section>

      <footer className="qc-foot">
        {modelName ? <span>生成模型 <code>{modelName}</code></span> : <span />}
        <span>关闭面板不影响生成</span>
      </footer>
    </aside>
  );
}
