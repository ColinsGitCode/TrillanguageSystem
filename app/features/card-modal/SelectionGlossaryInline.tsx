import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, Languages, Pencil, Sparkles, ThumbsDown, X } from 'lucide-react';
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
  low: '低可信',
} as const;

export function SelectionGlossaryInline({
  phrase,
  language,
  generationId,
  contextLabel,
  contextText,
  readingHint,
  onToast,
}: Props) {
  const queryClient = useQueryClient();
  const [editMode, setEditMode] = useState<'none' | 'manual' | 'proposal' | 'edit'>('none');
  const [draftGloss, setDraftGloss] = useState('');
  const [proposal, setProposal] = useState<LocalGlossaryProposal | null>(null);
  const [choiceIndex, setChoiceIndex] = useState(0);
  const [rejected, setRejected] = useState(false);
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
    setRejected(false);
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
    setRejected(false);
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

  if (!language) {
    return <span className="csa-gloss is-muted"><Languages aria-hidden="true" />中译：请先确认是英语还是日语</span>;
  }
  if (lookupQuery.isPending) {
    return <span className="csa-gloss is-muted" role="status"><Languages aria-hidden="true" />正在查本地释义…</span>;
  }
  if (lookupQuery.isError) {
    return <span className="csa-gloss is-error" role="status"><Languages aria-hidden="true" />本地释义暂不可用</span>;
  }

  if (editMode !== 'none') {
    const busy = manualMutation.isPending || editMutation.isPending || acceptMutation.isPending || rejectMutation.isPending;
    return (
      <span className="csa-gloss-editor">
        <Languages aria-hidden="true" />
        <input
          aria-label="中文释义"
          value={draftGloss}
          onChange={(event) => setDraftGloss(event.target.value)}
          placeholder="输入简明中文释义"
          autoFocus
          maxLength={120}
          disabled={busy}
        />
        <button
          type="button"
          aria-label="保存中文释义"
          title="保存中文释义"
          disabled={busy || !draftGloss.trim()}
          onClick={() => {
            if (editMode === 'proposal') acceptMutation.mutate();
            else if (editMode === 'edit') editMutation.mutate();
            else manualMutation.mutate();
          }}
        >
          <Check aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="取消"
          title="取消"
          disabled={busy}
          onClick={() => {
            if (editMode === 'proposal' && proposal) rejectMutation.mutate();
            else {
              setEditMode('none');
              setDraftGloss('');
            }
          }}
        >
          <X aria-hidden="true" />
        </button>
      </span>
    );
  }

  if (activeGloss) {
    const editable = Boolean(
      activeGloss.id
      && activeGloss.version
      && ['manual', 'llm-confirmed', 'imported'].includes(activeGloss.sourceKind)
    );
    // A high-confidence dictionary hit can still be the wrong sense, so the
    // "wrong gloss" action stays available for every dictionary result.
    const correctable = activeGloss.sourceKind === 'dictionary';
    const source = activeGloss.sourceDetail || SOURCE_LABEL[activeGloss.sourceKind];
    return (
      <span
        className="csa-gloss"
        title={`${activeGloss.zhGloss}；来源：${source}；可信度：${CONFIDENCE_LABEL[activeGloss.confidence]}`}
      >
        <Languages aria-hidden="true" />
        <span className="csa-gloss-copy">
          <span className="csa-gloss-line">
            <span>中译</span>
            <strong>{activeGloss.zhGloss}</strong>
          </span>
          {(activeGloss.reading || activeGloss.partOfSpeech) && (
            <small className="csa-gloss-meta">
              {[activeGloss.reading, activeGloss.partOfSpeech, source].filter(Boolean).join(' · ')}
            </small>
          )}
          {!activeGloss.reading && !activeGloss.partOfSpeech && (
            <small className="csa-gloss-meta">{source}</small>
          )}
        </span>
        {(choices.length > 1 || editable || correctable) ? (
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className="csa-gloss-menu-trigger"
                aria-label={`打开释义选项，来源 ${source}，${CONFIDENCE_LABEL[activeGloss.confidence]}`}
              >
                <small className="csa-gloss-confidence" data-confidence={activeGloss.confidence}>
                  {CONFIDENCE_LABEL[activeGloss.confidence]}
                </small>
                释义{choices.length > 1 ? ` ${choiceIndex + 1}/${choices.length}` : ''}
                <ChevronDown aria-hidden="true" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="csa-gloss-menu" sideOffset={5} align="end">
                {choices.map((choice, index) => (
                  <DropdownMenu.Item
                    key={`${choice.id || 'local'}-${choice.senseKey || index}-${choice.zhGloss}`}
                    className="csa-gloss-choice"
                    onSelect={() => {
                      setChoiceIndex(index);
                      // Attribute the intervention to the candidate the user
                      // replaced, not to the better candidate they selected.
                      if (index !== choiceIndex) recordFeedback(activeGloss, 'switched', index, choices.length);
                    }}
                  >
                    <span className="csa-gloss-choice-copy">
                      <span>{choice.zhGloss}</span>
                      <small>
                        {[
                          choice.reading,
                          choice.partOfSpeech,
                          choice.sourceDetail || SOURCE_LABEL[choice.sourceKind],
                          CONFIDENCE_LABEL[choice.confidence],
                        ].filter(Boolean).join(' · ')}
                      </small>
                    </span>
                    {index === choiceIndex && <Check aria-label="当前义项" />}
                  </DropdownMenu.Item>
                ))}
                {(correctable || editable) && <DropdownMenu.Separator className="csa-menu-separator" />}
                {correctable && !rejected && (
                  <DropdownMenu.Item
                    className="csa-gloss-menu-action"
                    data-testid="gloss-reject"
                    onSelect={() => {
                      setRejected(true);
                      recordFeedback(activeGloss, 'rejected', choiceIndex, choices.length);
                      onToast(choices.length > 1 ? '可以换一个义项，或自己填写' : '请填写正确的中文释义');
                      if (choices.length <= 1) {
                        setDraftGloss('');
                        setEditMode('manual');
                      }
                    }}
                  >
                    <ThumbsDown aria-hidden="true" />释义不合适
                  </DropdownMenu.Item>
                )}
                {correctable && rejected && choices.length > 1 && (
                  <DropdownMenu.Item
                    className="csa-gloss-menu-action is-active"
                    data-testid="gloss-reject-write"
                    onSelect={() => {
                      setDraftGloss('');
                      setEditMode('manual');
                    }}
                  >
                    <Pencil aria-hidden="true" />自己填写正确释义
                  </DropdownMenu.Item>
                )}
                {(editable || (correctable && !rejected)) && (
                  <DropdownMenu.Item
                    className="csa-gloss-menu-action"
                    onSelect={() => {
                      setDraftGloss(activeGloss.zhGloss);
                      setEditMode(editable ? 'edit' : 'manual');
                    }}
                  >
                    <Pencil aria-hidden="true" />{editable ? '编辑本地释义' : '更正本地释义'}
                  </DropdownMenu.Item>
                )}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        ) : (
          <small className="csa-gloss-confidence" data-confidence={activeGloss.confidence}>
            {CONFIDENCE_LABEL[activeGloss.confidence]}
          </small>
        )}
      </span>
    );
  }

  return (
    <span className="csa-gloss is-missing">
      <Languages aria-hidden="true" />
      <span>暂无本地释义</span>
      <button type="button" onClick={() => { setDraftGloss(''); setEditMode('manual'); }}>
        <Pencil aria-hidden="true" />手动填写
      </button>
      <button type="button" disabled={proposalMutation.isPending} onClick={() => proposalMutation.mutate()}>
        <Sparkles aria-hidden="true" />{proposalMutation.isPending ? '生成中…' : 'AI 候选'}
      </button>
    </span>
  );
}
