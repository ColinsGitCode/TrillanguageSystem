import type { PronunciationToken } from './pronunciation-overlay';

// JLM-A1 tiers. `pending` is an unreviewed AI candidate and must never be
// presented with the same wording as a confirmed source.
export type PronunciationOriginTier = 'human' | 'curated' | 'accepted' | 'pending';

export type PronunciationForeignOrigin = {
  language: string;
  term: string;
  source: string;
  tier: PronunciationOriginTier;
  proposalId: number | null;
};

const ORIGIN_TIERS: PronunciationOriginTier[] = ['human', 'curated', 'accepted', 'pending'];

export const ORIGIN_TIER_LABEL: Record<PronunciationOriginTier, string> = {
  human: '人工确认',
  curated: '精选词典',
  accepted: '已确认',
  pending: 'AI 候选',
};

const KATAKANA_WORD = /^[\p{Script=Katakana}ー・]+$/u;

export function pronunciationBasicForm(token: PronunciationToken) {
  // The する half of a compound like 更新した already reports its dictionary form
  // on the noun, so showing "する" here again would split one word across two
  // tooltips.
  if (typeof token.evidence?.suruCompoundOf === 'string') return null;
  const value = token.evidence?.basicForm;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized !== '*' && normalized !== token.surface
    ? normalized
    : null;
}

export function pronunciationForeignOrigin(token: PronunciationToken): PronunciationForeignOrigin | null {
  const value = token.evidence?.foreignOrigin;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const term = typeof candidate.term === 'string' ? candidate.term.trim() : '';
  if (!term) return null;
  const source = typeof candidate.source === 'string' ? candidate.source.trim() : '';
  // Anything the server did not tag with a known tier is treated as curated,
  // which is the pre-JLM behaviour for the shipped dictionary.
  const tier = (ORIGIN_TIERS as string[]).includes(source)
    ? (source as PronunciationOriginTier)
    : 'curated';
  return {
    language: typeof candidate.language === 'string' && candidate.language.trim()
      ? candidate.language.trim()
      : '外语',
    term,
    source,
    tier,
    proposalId: typeof candidate.proposalId === 'number' ? candidate.proposalId : null,
  };
}

export function isKatakanaLoanwordCandidate(token: PronunciationToken) {
  return KATAKANA_WORD.test(token.surface);
}
