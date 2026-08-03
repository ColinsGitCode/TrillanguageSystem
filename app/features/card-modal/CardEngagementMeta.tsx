import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { factoryApi } from '../factory/factory-api';
import type { CardType } from '../factory/types';

type Props = {
  generationId: number | null;
  phrase: string;
  cardType: CardType;
  readOnly: boolean;
};

export function CardEngagementMeta({ generationId, phrase, cardType, readOnly }: Props) {
  const queryClient = useQueryClient();
  const recordedRef = useRef<Set<number>>(new Set());
  const statsQuery = useQuery({
    queryKey: ['card-engagement', 'stats', generationId],
    queryFn: () => factoryApi.cardStats(generationId!),
    enabled: Boolean(generationId),
  });

  useEffect(() => {
    if (!generationId || recordedRef.current.has(generationId)) return;
    recordedRef.current.add(generationId);
    void factoryApi.recordEngagement({
      eventKey: `card-open:${crypto.randomUUID()}`,
      generationId,
      phrase,
      cardType,
      eventKind: 'existing_card_opened',
      sourceSurface: 'card_modal',
      metadata: { readOnly },
    }).then(() => queryClient.invalidateQueries({
      queryKey: ['card-engagement', 'stats', generationId],
    })).catch(() => {});
  }, [cardType, generationId, phrase, queryClient, readOnly]);

  const stats = statsQuery.data?.stats;
  return <>
    {stats && <>
      <div><dt>生成查询</dt><dd>{stats.generationRequests}</dd></div>
      <div><dt>打开次数</dt><dd>{stats.opens}</dd></div>
      <div><dt>加入今日</dt><dd>{stats.addedToToday}</dd></div>
      <div><dt>成功版本</dt><dd>{stats.successfulVersions}</dd></div>
      <div><dt>复习评分</dt><dd>{stats.reviewCount}</dd></div>
      <div><dt>关注度</dt><dd>{stats.attentionScore}<small> / 30</small></dd></div>
    </>}
    <div className="card-engagement-note"><dt>说明</dt><dd>查询和打开只表示近期关注，不代表已经掌握。</dd></div>
  </>;
}
