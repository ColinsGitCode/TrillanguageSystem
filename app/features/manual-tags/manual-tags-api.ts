import { requestJson } from '../../lib/api/client';
import type {
  ManualTag,
  ManualTagCategory,
  ManualTagColor,
  ManualTagTarget,
  ManualTagTargetKind,
} from './types';

export const manualTagsApi = {
  list(targetKind: ManualTagTargetKind, targetId: number) {
    return requestJson<{ success: true; tags: ManualTag[]; assignedTagIds: number[] }>(
      `/api/manual-tags?targetKind=${encodeURIComponent(targetKind)}&targetId=${targetId}`
    );
  },
  create(payload: { name: string; category: ManualTagCategory; color: ManualTagColor }) {
    return requestJson<{ success: true; tag: ManualTag }>('/api/manual-tags', {
      method: 'POST', body: JSON.stringify(payload),
    });
  },
  update(tagId: number, payload: {
    expectedVersion: number;
    name: string;
    category: ManualTagCategory;
    color: ManualTagColor;
  }) {
    return requestJson<{ success: true; tag: ManualTag }>(`/api/manual-tags/${tagId}`, {
      method: 'PATCH', body: JSON.stringify(payload),
    });
  },
  archive(tagId: number, expectedVersion: number) {
    return requestJson<{ success: true; tag: ManualTag }>(`/api/manual-tags/${tagId}`, {
      method: 'DELETE', body: JSON.stringify({ expectedVersion }),
    });
  },
  assign(payload: { targetKind: ManualTagTargetKind; targetId: number; tagIds: number[] }) {
    return requestJson<{ success: true; tags: ManualTag[] }>('/api/manual-tags/assignments/current', {
      method: 'PUT', body: JSON.stringify(payload),
    });
  },
  targets(tagId: number) {
    return requestJson<{ success: true; tag: ManualTag; targets: ManualTagTarget[] }>(
      `/api/manual-tags/${tagId}/targets`
    );
  },
};
