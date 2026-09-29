import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { factoryApi } from '../factory/factory-api';
import type { CardType } from '../factory/types';

type RecorderProps = {
  generationId: number | null;
  /** Stable for one modal open, so remounting replays the same idempotent key. */
  openEventKey: string;
  phrase: string;
  cardType: CardType;
  readOnly: boolean;
};

const statsKey = (generationId: number | null) => ['card-engagement', 'stats', generationId] as const;

/**
 * Records that the card was opened. It renders nothing and stays mounted for
 * the whole modal: the numbers moved to 生成信息, and recording there would
 * count only the opens where the reader also visited that tab.
 */
export function CardOpenRecorder({ generationId, openEventKey, phrase, cardType, readOnly }: RecorderProps) {
  const queryClient = useQueryClient();
  const recordedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!generationId || recordedRef.current.has(generationId)) return;
    recordedRef.current.add(generationId);
    void factoryApi.recordEngagement({
      eventKey: `${openEventKey}:${generationId}`,
      generationId,
      phrase,
      cardType,
      eventKind: 'existing_card_opened',
      sourceSurface: 'card_modal',
      metadata: { readOnly },
    }).then(() => queryClient.invalidateQueries({ queryKey: statsKey(generationId) })).catch(() => {});
  }, [cardType, generationId, openEventKey, phrase, queryClient, readOnly]);

  return null;
}

/** One line of study record for the 生成信息 tab. */
export function CardEngagementSummary({ generationId }: { generationId: number | null }) {
  const statsQuery = useQuery({
    queryKey: statsKey(generationId),
    queryFn: () => factoryApi.cardStats(generationId!),
    enabled: Boolean(generationId),
  });
  const stats = statsQuery.data?.stats;
  if (!stats) return null;
  return (
    <section className="card-engagement-summary" aria-labelledby="card-engagement-title" data-testid="card-engagement-summary">
      <h2 id="card-engagement-title">学习记录</h2>
      <dl>
        <div><dt>打开</dt><dd>{stats.opens} 次</dd></div>
        <div><dt>生成查询</dt><dd>{stats.generationRequests} 次</dd></div>
        <div><dt>加入今日</dt><dd>{stats.addedToToday} 次</dd></div>
        <div><dt>复习</dt><dd>{stats.reviewCount} 次</dd></div>
        <div><dt>版本</dt><dd>{stats.successfulVersions} 个</dd></div>
      </dl>
      <p>打开和查询只表示近期关注，不代表已经掌握</p>
    </section>
  );
}
