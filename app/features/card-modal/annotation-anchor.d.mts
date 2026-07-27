import type { CardAnnotationSelector } from './annotation-render.mjs';

export const PROJECTION_VERSION: string;

export function createAnchor(
  root: HTMLElement,
  range: Range,
  contextLength?: number
): CardAnnotationSelector;

export function resolveAnchor(
  root: HTMLElement,
  selector: CardAnnotationSelector
): {
  status: string;
  range: Range | null;
  start?: number;
  end?: number;
  projection?: string;
};

export function canonicalRangeText(range: Range): string;

export function buildCanonicalDomMap(root: HTMLElement): {
  projectionVersion: string;
  offsetUnit: 'utf16';
  text: string;
  pairs: unknown[];
};
