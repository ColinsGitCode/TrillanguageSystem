export type CardSectionLang = 'en' | 'ja' | 'zh';

export type TrilingualSummary = {
  en: string;
  ja: string;
  jaRubyReading: string | null;
  zh: string;
  register: string | null;
};

export type ScenarioOutlineItem = { index: string; label: string };

export type GrammarSummary = { point: string; structure: string };

export function sectionInfo(headingText: string): { label: string; lang: CardSectionLang | null };
export function fieldOf(label: string): string;
export function cleanMarkdownValue(value: string | null | undefined): string;
export function rubyReading(value: string | null | undefined): string | null;
export function extractTrilingualSummary(markdown: string): TrilingualSummary | null;
export function extractGrammarSummary(markdown: string): GrammarSummary | null;
export function readingFromTokens(
  plainText: string,
  tokens: Array<{ surface: string; startCodePoint: number; endCodePoint: number; readingHiragana: string | null }>,
  text: string,
): string | null;
export function extractScenarioOutline(markdown: string): ScenarioOutlineItem[];
export function decorateCardRoot(root: HTMLElement, cardType: string): void;
