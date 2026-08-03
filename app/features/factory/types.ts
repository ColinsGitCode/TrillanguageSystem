export type CardType = 'trilingual' | 'grammar_ja' | 'scenario_phrase';
export type SourceMode = 'input' | 'ocr' | 'selection' | null;

export type FolderFile = {
  file: string;
  title: string;
  cardType?: CardType;
  card_type?: CardType;
};

export type GenerationJobStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';

export type GenerationJob = {
  id: number;
  seq?: number;
  status: GenerationJobStatus;
  jobType: CardType;
  phraseRaw?: string;
  phraseNormalized: string;
  sourceMode?: SourceMode;
  targetFolder?: string;
  attempts?: number;
  maxRetries?: number;
  retryAfterTs?: number | null;
  errorMessage?: string | null;
  createdAt?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  resultFolder?: string | null;
  resultBaseFilename?: string | null;
};

export type QueueSummary = {
  queued?: number;
  running?: number;
  success?: number;
  failed?: number;
  cancelled?: number;
  total?: number;
};

export type GenerationJobEvent = {
  id: number;
  jobId: number;
  eventType: string;
  payload?: Record<string, unknown> | string | null;
  createdAt?: string;
};

export type GenerationRecord = {
  id: number;
  phrase: string;
  card_type?: CardType;
  folder_name: string;
  base_filename: string;
  llm_provider?: string;
  llm_model?: string;
  generation_date?: string;
  markdown_content?: string;
  observability?: {
    quality_score?: number;
    quality_dimensions?: Record<string, number> | string;
    quality_warnings?: string[] | string;
    quality_checks?: Record<string, unknown> | string;
    tokens_input?: number;
    tokens_output?: number;
    tokens_total?: number;
    cost_total?: number;
    performance_total_ms?: number;
    performance_phases?: Record<string, number> | string;
    prompt_full?: string;
    prompt_parsed?: Record<string, unknown> | string;
    llm_output?: string;
    metadata?: Record<string, unknown>;
  };
};

export type HealthService = { name?: string; status?: string; message?: string; critical?: boolean };
export type HealthResponse = {
  status?: string;
  healthy?: boolean;
  services?: HealthService[] | Record<string, HealthService>;
  system?: {
    overallStatus?: string;
    criticalOnline?: boolean;
  };
};

export type CardSelection = {
  folder: string;
  baseName: string;
  title: string;
  cardType: CardType;
};
