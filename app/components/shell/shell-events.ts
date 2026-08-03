export type ShellFeedbackTone = 'info' | 'success' | 'warning' | 'error';
export type ShellActivityKind =
  | 'generation-job'
  | 'textbook-operation'
  | 'textbook-review'
  | 'learning-session'
  | 'knowledge-sync'
  | 'knowledge-resolution';
export type ShellActivityStatus =
  | 'queued'
  | 'running'
  | 'needs_attention'
  | 'succeeded'
  | 'partially_failed'
  | 'failed'
  | 'cancelled';

export type ShellFeedbackCommand = {
  id?: string;
  tone: ShellFeedbackTone;
  message: string;
  actionLabel?: string;
  actionHref?: string;
};

export type ShellActivityCommand = {
  id: string;
  kind: ShellActivityKind;
  status: ShellActivityStatus;
  title: string;
  summary: string;
  href: string;
  updatedAt?: string;
  source?: 'generation' | 'textbooks' | 'learning' | 'knowledge' | 'browser';
  actionLabel?: string;
};

export const SHELL_FEEDBACK_EVENT = 'three-lans:shell-feedback';
export const SHELL_ACTIVITY_EVENT = 'three-lans:shell-activity';
export const SHELL_ACTIVITY_STORAGE_KEY = 'three-lans-shell-activity-v1';

export function publishShellFeedback(command: ShellFeedbackCommand) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ShellFeedbackCommand>(SHELL_FEEDBACK_EVENT, { detail: command }));
}

export function publishShellActivity(command: ShellActivityCommand) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ShellActivityCommand>(SHELL_ACTIVITY_EVENT, { detail: command }));
}

export function readStoredActivities(): ShellActivityCommand[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(sessionStorage.getItem(SHELL_ACTIVITY_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(0, 30) : [];
  } catch {
    return [];
  }
}

export function storeActivities(items: ShellActivityCommand[]) {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(SHELL_ACTIVITY_STORAGE_KEY, JSON.stringify(items.slice(0, 30)));
}
