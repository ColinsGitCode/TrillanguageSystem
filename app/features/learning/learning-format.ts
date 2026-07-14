import type { QueueEntry, StudyItem } from './types';

export const RATING_OPTIONS = [
  { value: 1, label: '重来', hint: '没想起来', tone: 'again' },
  { value: 2, label: '困难', hint: '吃力想起', tone: 'hard' },
  { value: 3, label: '记住', hint: '正常回忆', tone: 'good' },
  { value: 4, label: '简单', hint: '秒答', tone: 'easy' },
] as const;

export function itemPresentation(item: Pick<StudyItem, 'unitKind' | 'prompt'> | null | undefined) {
  switch (item?.unitKind) {
    case 'trilingual_en': return { type: '三语', language: 'EN', instruction: '用英语说出这个表达', tone: 'trilingual' };
    case 'trilingual_ja': return { type: '三语', language: 'JA', instruction: '用日语说出这个表达', tone: 'trilingual' };
    case 'grammar_ja': return { type: '日语语法', language: 'JA', instruction: '回忆含义、接续方式和使用场景', tone: 'grammar' };
    case 'scenario_bilingual': return { type: '场景表达', language: 'EN+JA', instruction: '先用日语、再用英语说出这个表达', tone: 'scenario' };
    default: return { type: '完整卡片', language: item?.prompt.targetLanguages.join('+').toUpperCase() || 'EN+JA', instruction: '回忆这张卡片的核心内容', tone: 'trilingual' };
  }
}
export function entryPresentation(entry: QueueEntry) {
  const kind = entry.itemSummary?.unitKind;
  if (kind === 'grammar_ja') return { type: '语法', language: 'JA', tone: 'grammar' };
  if (kind === 'scenario_bilingual') return { type: '场景', language: 'EN+JA', tone: 'scenario' };
  if (kind === 'trilingual_en') return { type: '三语', language: 'EN', tone: 'trilingual' };
  if (kind === 'trilingual_ja') return { type: '三语', language: 'JA', tone: 'trilingual' };
  return { type: '整卡', language: 'EN+JA', tone: 'trilingual' };
}

export function reasonLabel(entry: QueueEntry) {
  switch (entry.reason) {
    case 'overdue-recent-failure': return '逾期 · 最近困难';
    case 'overdue': return '逾期复习';
    case 'due-today-recent-failure': return '今日到期 · 最近困难';
    case 'due-today': return '今日到期';
    case 'difficult-reappearance': return '困难项重现';
    case 'new': return '今日新内容';
    default: return entry.explanation?.label || '计划安排';
  }
}

export function relativeDue(iso: string, now = new Date()) {
  const due = new Date(iso);
  const deltaMs = due.getTime() - now.getTime();
  const minutes = Math.max(1, Math.round(Math.abs(deltaMs) / 60_000));
  if (Math.abs(deltaMs) < 60 * 60_000) return deltaMs <= 0 ? `${minutes} 分钟内再次练习` : `${minutes} 分钟后`;
  const days = Math.max(1, Math.round(Math.abs(deltaMs) / 86_400_000));
  return deltaMs <= 0 ? `已到期 ${days} 天` : `${days} 天后`;
}
