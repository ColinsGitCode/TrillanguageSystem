import type { PronunciationToken } from './pronunciation-overlay';

export type PronunciationForeignOrigin = {
  language: string;
  term: string;
  source: string;
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
  return {
    language: typeof candidate.language === 'string' && candidate.language.trim()
      ? candidate.language.trim()
      : '外语',
    term,
    source: typeof candidate.source === 'string' ? candidate.source.trim() : '',
  };
}

export function isKatakanaLoanwordCandidate(token: PronunciationToken) {
  return KATAKANA_WORD.test(token.surface);
}
