export type ReviewAnswerLayers = {
  coreMarkdown: string;
  supplementaryMarkdown: string;
  supplementarySectionCount: number;
};

export function splitReviewAnswerMarkdown(markdown: string): ReviewAnswerLayers;
