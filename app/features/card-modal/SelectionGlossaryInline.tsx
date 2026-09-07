import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { ChevronDown, Languages, Sparkles } from 'lucide-react';
import { localGlossaryApi } from './local-glossary';
import type {
  LocalGlossaryFeedbackOutcome,
  LocalGlossaryGloss,
  LocalGlossaryProposal,
} from './local-glossary';
import type { CardLookupLanguage } from './selection-actions';

type Props = {
  phrase: string;
  language: CardLookupLanguage | null;
  generationId: number | null;
  contextLabel: string;
  contextText: string;
  readingHint: string | null;
  onToast: (message: string) => void;
  detailHost: HTMLDivElement | null;
  readOnly: boolean;
  onNote: () => void;
  onKnowledge: () => void;
};

const SOURCE_LABEL = {
  'current-card': '本卡片',
  textbook: '教材确认',
  manual: '本地词库',
  'llm-confirmed': '人工确认',
  imported: '本地导入',
  'history-card': '历史卡片',
  dictionary: '本地词典',
} as const;

const CONFIDENCE_LABEL = {
  high: '高可信',
  medium: '需核对',
  low: '待确认',
} as const;

export function SelectionGlossaryInline({
  phrase,
  language,
  generationId,
  contextLabel,
  contextText,
  readingHint,
  onToast,
  detailHost,
  readOnly,
  onNote,
  onKnowledge,
}: Props) {
  const queryClient = useQueryClient();
  const [editMode, setEditMode] = useState<'none' | 'manual' | 'proposal' | 'edit'>('none');
  const [draftGloss, setDraftGloss] = useState('');
  const [proposal, setProposal] = useState<LocalGlossaryProposal | null>(null);
  const [choiceIndex, setChoiceIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const correctionRef = useRef<HTMLButtonElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [explanation, setExplanation] = useState('');
  const [explainBusy, setExplainBusy] = useState(false);
  const [explainError, setExplainError] = useState('');
  const capabilityQuery = useQuery({ queryKey: ['glossary-capabilities'], queryFn: localGlossaryApi.capabilities, staleTime: 30_000, retry: false });
  useEffect(() => () => requestRef.current?.abort(), []);
  const explain = async () => {
    if (!language || explainBusy) return;
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    setExplainBusy(true);
    setExplainError('');
    try {
      const result = await localGlossaryApi.explain({ text: phrase, language, context: contextText }, controller.signal);
      if (!controller.signal.aborted) setExplanation(result.explanation);
    } catch {
      if (!controller.signal.aborted) setExplainError('解释暂不可用，请重试');
    } finally {
      if (!controller.signal.aborted) setExplainBusy(false);
    }
  };
  const shownRef = useRef('');
  const queryKey = ['local-glossary', language, phrase, generationId, readingHint, contextText];
  const lookupQuery = useQuery({
    queryKey,
    queryFn: () => localGlossaryApi.lookup({
      text: phrase,
      language: language!,
      generationId,
      reading: readingHint,
      context: contextText,
    }),
    enabled: Boolean(language && phrase),
    retry: false,
    staleTime: 30_000,
  });
  const lookup = lookupQuery.data?.lookup || null;
  const choices: LocalGlossaryGloss[] = lookup?.gloss
    ? [lookup.gloss, ...(lookup.alternatives || [])]
    : [];
  const activeGloss = choices[choiceIndex] || lookup?.gloss || null;

  useEffect(() => {
    setEditMode('none');
    setDraftGloss('');
    setProposal(null);
    setChoiceIndex(0);

  }, [phrase, language, readingHint, contextText]);

  // Fire-and-forget usage fact. Never blocks the reader and never carries the
  // surrounding sentence — only the selected short term and candidate facts.
  const recordFeedback = useCallback((
    gloss: LocalGlossaryGloss,
    outcome: LocalGlossaryFeedbackOutcome,
    chosenRank: number,
    candidateCount: number,
  ) => {
    if (!language) return;
    void localGlossaryApi.recordFeedback({
      text: phrase,
      language,
      outcome,
      sourceKind: gloss.sourceKind,
      sourceDetail: gloss.sourceDetail,
      confidence: gloss.confidence,
      matchReason: gloss.matchReason,
      senseKey: gloss.senseKey,
      candidateCount,
      chosenRank,
    }).catch(() => {});
  }, [language, phrase]);

  // Count each resolved term once, so repeated re-renders of the same selection
  // do not inflate the lookup totals the DIC-R2 report is derived from.
  useEffect(() => {
    const gloss = lookup?.gloss;
    if (!gloss || !language) return;
    const key = [language, phrase, readingHint || '', contextText || ''].join('\u0000');
    if (shownRef.current === key) return;
    shownRef.current = key;
    recordFeedback(gloss, 'shown', 0, choices.length);
  }, [lookup, language, phrase, readingHint, contextText, choices.length, recordFeedback]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey });
    setEditMode('none');
    setProposal(null);
    setChoiceIndex(0);

  };

  const manualMutation = useMutation({
    mutationFn: () => localGlossaryApi.createEntry({
      language: language!,
      canonicalForm: phrase,
      zhGloss: draftGloss,
      senseKey: readingHint ? `reading:${readingHint}` : 'default',
    }),
    onSuccess: async () => {
      if (activeGloss) recordFeedback(activeGloss, 'corrected', choiceIndex, choices.length);
      await refresh();
      onToast('本地释义已保存，以后优先使用');
    },
    onError: () => onToast('本地释义保存失败，请重试'),
  });
  const editMutation = useMutation({
    mutationFn: () => localGlossaryApi.updateEntry(Number(activeGloss?.id), {
      expectedVersion: Number(activeGloss?.version),
      canonicalForm: phrase,
      zhGloss: draftGloss,
    }),
    onSuccess: async () => {
      await refresh();
      onToast('本地释义已更新');
    },
    onError: () => onToast('释义已变化，请重新选择后再试'),
  });
  const proposalMutation = useMutation({
    mutationFn: () => localGlossaryApi.propose({
      requestKey: crypto.randomUUID(),
      text: phrase,
      language: language!,
      contextLabel: [contextLabel, contextText].filter(Boolean).join(' · ').slice(0, 200),
    }),
    onSuccess: ({ proposal: next }) => {
      setProposal(next);
      setDraftGloss(next.zhGloss);
      setEditMode('proposal');
    },
    onError: () => onToast('AI 释义候选生成失败，请稍后重试'),
  });
  const acceptMutation = useMutation({
    mutationFn: () => localGlossaryApi.acceptProposal(Number(proposal?.id), draftGloss),
    onSuccess: async () => {
      await refresh();
      onToast('AI 候选已人工确认并保存');
    },
    onError: () => onToast('候选保存失败，请重试'),
  });
  const rejectMutation = useMutation({
    mutationFn: () => localGlossaryApi.rejectProposal(Number(proposal?.id)),
    onSuccess: () => {
      setProposal(null);
      setDraftGloss('');
      setEditMode('none');
    },
  });

  const editable = Boolean(activeGloss?.id && activeGloss.version
    && ['manual', 'llm-confirmed', 'imported'].includes(activeGloss.sourceKind));
  const busy = manualMutation.isPending || editMutation.isPending || acceptMutation.isPending || rejectMutation.isPending;
  const source = activeGloss ? activeGloss.sourceDetail || SOURCE_LABEL[activeGloss.sourceKind] : '';
  const closeDetails = () => {
    setExpanded(false);
    triggerRef.current?.focus({ preventScroll: true });
  };
  const summary = !language ? '请先确认英语或日语'
    : lookupQuery.isPending ? '正在查本地释义…'
      : lookupQuery.isError ? '本地释义暂不可用'
        : activeGloss?.zhGloss || '暂无本地释义';

  return <>
    <span className="csa-gloss csa-gloss-compact">
      <Languages aria-hidden="true" />
      <strong title={summary}>{summary}</strong>
      {activeGloss && <small className="csa-gloss-confidence" data-confidence={activeGloss.confidence}>
        {CONFIDENCE_LABEL[activeGloss.confidence]}
      </small>}
      <button ref={triggerRef} type="button" className="csa-gloss-menu-trigger"
        aria-label="打开释义选项" aria-expanded={expanded} aria-controls="selection-reading-details"
        onClick={() => setExpanded(!expanded)}>
        释义详情 <ChevronDown aria-hidden="true" style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />
      </button>
    </span>
    {expanded && detailHost && createPortal(
      <section className="csa-reading-details" id="selection-reading-details" aria-label="释义详情"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault(); event.stopPropagation();
          if (editMode !== 'none') {
            if (busy) return;
            setEditMode('none');
            correctionRef.current?.focus({ preventScroll: true });
          }
          else closeDetails();
        }}>
        <header><strong>{phrase}</strong><small>{[activeGloss?.partOfSpeech, source].filter(Boolean).join(' · ')}</small>
          <button type="button" onClick={closeDetails} aria-label="收起释义详情">收起</button></header>
        {activeGloss?.confidence === 'low' && <p className="csa-confidence-explanation">
          {source.includes('桥接') ? '经英文桥接，当前句子中的词义有待确认。' : '此释义可信度较低，请结合当前句子核对。'}
        </p>}
        <div className="csa-context-detail"><small>当前语境</small><blockquote>{contextText || phrase}</blockquote>
          <button type="button" disabled={!language || explainBusy || !capabilityQuery.data?.contextExplanation}
            onClick={() => void explain()}><Sparkles aria-hidden="true" />{explainBusy ? '正在解释…' : '解释此处用法'}</button>
          <small>{capabilityQuery.data?.contextExplanation ? 'AI · 点击后生成' : 'AI 解释暂未启用'}</small>
          {explainError && <p role="alert">{explainError}</p>}
          {explanation && <p className="csa-context-answer" role="status"><small>AI 解释 · 仅供参考</small>{explanation}</p>}
        </div>
        {choices.length > 0 && <fieldset className="csa-candidates"><legend>候选释义</legend>
          {choices.map((choice, index) => <label key={index} title={choice.sourceDetail || SOURCE_LABEL[choice.sourceKind]}>
            <input type="radio" name="selection-gloss-choice" checked={choiceIndex === index}
              onChange={() => {
                if (activeGloss && index !== choiceIndex) recordFeedback(activeGloss, 'switched', index, choices.length);
                setChoiceIndex(index);
              }} />{choice.zhGloss}
          </label>)}
        </fieldset>}
        {editMode !== 'none' && <div className="csa-reading-editor">
          <label>中文释义<input aria-label="中文释义" autoFocus value={draftGloss} maxLength={120}
            disabled={busy} onChange={(event) => setDraftGloss(event.target.value)} /></label>
          <small>保存到本地词库，之后查词优先使用；仅记录此处理解请使用笔记。</small>
          {proposal && <p>{proposal.explanation}</p>}
          <button type="button" disabled={busy || !draftGloss.trim()} aria-label="保存中文释义" onClick={() => {
            if (editMode === 'proposal') acceptMutation.mutate();
            else if (editMode === 'edit') editMutation.mutate();
            else manualMutation.mutate();
          }}>保存释义</button>
          <button type="button" disabled={busy} onClick={() => {
            if (editMode === 'proposal' && proposal) rejectMutation.mutate();
            else { setEditMode('none'); correctionRef.current?.focus({ preventScroll: true }); }
          }}>取消</button>
        </div>}
        <footer>
          {!readOnly && language && <button ref={correctionRef} type="button" onClick={() => {
            setDraftGloss(activeGloss?.zhGloss || ''); setEditMode(editable ? 'edit' : 'manual');
          }}>纠正释义</button>}
          {!activeGloss && !readOnly && language && <button type="button" disabled={proposalMutation.isPending || !capabilityQuery.data?.contextExplanation}
            onClick={() => proposalMutation.mutate()}>AI 释义候选</button>}
          {!readOnly && <button type="button" onClick={onNote}>记笔记</button>}
          <button type="button" onClick={onKnowledge}>查知识点</button>
        </footer>
      </section>, detailHost)}
  </>;
}
