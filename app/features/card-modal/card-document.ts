export type CardLanguage = 'en' | 'ja' | 'zh' | 'unknown';

export type CardInline =
  | { kind: 'text'; value: string }
  | { kind: 'strong'; children: CardInline[] }
  | { kind: 'emphasis'; children: CardInline[] }
  | { kind: 'span'; role: 'explanation' | 'loanword-label' | 'loanword-line' | 'loanword-tag'; children: CardInline[] }
  | { kind: 'code'; value: string }
  | { kind: 'link'; href: string; children: CardInline[] }
  | { kind: 'highlight'; tone: string; children: CardInline[] }
  | { kind: 'pronunciation'; surface: string; reading: string; source: 'legacy-ruby' }
  | { kind: 'audio'; src: string; label: string }
  | { kind: 'break' };

export type CardBlock =
  | { kind: 'heading'; depth: number; id: string; children: CardInline[] }
  | { kind: 'paragraph'; id: string; children: CardInline[] }
  | { kind: 'quote'; id: string; blocks: CardBlock[] }
  | { kind: 'list'; id: string; ordered: boolean; items: CardBlock[][] }
  | { kind: 'aside'; id: string; role: 'loanword'; children: CardInline[] }
  | { kind: 'divider'; id: string };

export type CardSection = {
  id: string;
  language: CardLanguage;
  title: CardInline[];
  blocks: CardBlock[];
};

export type CardDocument = {
  version: 'card-document-v1';
  title: CardInline[];
  sections: CardSection[];
  diagnostics: Array<{
    code: 'UNSAFE_NODE_DROPPED' | 'UNSUPPORTED_NODE_FLATTENED';
    tag: string;
  }>;
};
