export type ProjectionPair = { ch: string; marked: boolean };

export function normalizeProjectionPairs(pairs: ProjectionPair[]): ProjectionPair[];
export function normalizeProjectionText(text: string): string;
export function buildVisibleTextProjection(root: Node): {
  rawText: string;
  text: string;
  pairs: ProjectionPair[];
};
