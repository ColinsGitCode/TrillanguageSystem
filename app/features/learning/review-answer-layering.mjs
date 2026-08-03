import { marked } from 'marked';

const SUPPLEMENTARY_HEADING_PATTERN = /(?:常见误用|误用|扩展|补充|来源|参考|语域|辨析)/u;

export function splitReviewAnswerMarkdown(markdown) {
  const source = typeof markdown === 'string' ? markdown : '';
  const tokens = marked.lexer(source);
  const core = [];
  const supplementary = [];
  let target = core;
  let supplementarySectionCount = 0;

  for (const token of tokens) {
    if (token.type === 'heading' && token.depth === 2) {
      const isSupplementary = SUPPLEMENTARY_HEADING_PATTERN.test(token.text || '');
      target = isSupplementary ? supplementary : core;
      if (isSupplementary) supplementarySectionCount += 1;
    }
    target.push(token.raw);
  }

  return {
    coreMarkdown: core.join('').trim(),
    supplementaryMarkdown: supplementary.join('').trim(),
    supplementarySectionCount,
  };
}
